import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { apiError } from "@/lib/apiError";
import { findMissingPromptNode } from "@/lib/workflow-graph";
import {
  computeDurationSeconds,
  reconcileStaleExecutions,
  resolveOutcome,
  waitForTerminalExecution,
} from "@/lib/executionRuntime";
import type {
  BranchFlowEdge,
  DecisionFlowNode,
  ExecutionRow,
  ExecutionStepRow,
  RunWorkflowPendingResponse,
  RunWorkflowSyncResponse,
} from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: executionId } = await params;

  // 1. Reconcile dead workers before evaluating state
  reconcileStaleExecutions();

  const execution = db
    .prepare(`SELECT * FROM executions WHERE id = ?`)
    .get(executionId) as ExecutionRow | undefined;

  if (!execution) {
    return apiError(
      "EXECUTION_NOT_FOUND",
      `Execution with ID '${executionId}' does not exist.`
    );
  }

  const force = req.nextUrl.searchParams.get("force") === "true";

  if (execution.status === "running" && !force) {
    return apiError(
      "EXECUTION_STILL_RUNNING",
      "This execution is currently active. Wait for completion, allow staleness cleanup (120s), or pass ?force=true to override."
    );
  }

  // 2. Validate request payload
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_PAYLOAD", "Request body must be valid JSON.");
  }

  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_PAYLOAD", "Request body must be a JSON object.");
  }

  const rawNodes = (body as { nodes?: unknown }).nodes;
  const rawEdges = (body as { edges?: unknown }).edges;

  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return apiError("INVALID_PAYLOAD", "`nodes` must be a non-empty array.");
  }
  if (!Array.isArray(rawEdges)) {
    return apiError("INVALID_PAYLOAD", "`edges` must be an array.");
  }

  const nodes = rawNodes as DecisionFlowNode[];
  const edges = rawEdges as BranchFlowEdge[];

  // 3. Identify targeted node (explicit override or auto-detect last failed step)
  const rawFromNodeId = (body as { fromNodeId?: unknown }).fromNodeId;
  if (rawFromNodeId !== undefined && typeof rawFromNodeId !== "string") {
    return apiError("INVALID_PAYLOAD", "`fromNodeId` must be a string if provided.");
  }

  let fromNodeId = rawFromNodeId;
  if (!fromNodeId) {
    const lastFailedStep = db
      .prepare(
        `SELECT node_id FROM execution_steps
         WHERE execution_id = ? AND status = 'error'
         ORDER BY order_index DESC LIMIT 1`
      )
      .get(executionId) as { node_id: string } | undefined;
    fromNodeId = lastFailedStep?.node_id;
  }

  if (!fromNodeId) {
    return apiError(
      "NOTHING_TO_RETRY",
      "No failed step found for this execution, and no `fromNodeId` was provided."
    );
  }

  const targetNode = nodes.find((n) => n.id === fromNodeId);
  if (!targetNode) {
    return apiError(
      "MALFORMED_GRAPH",
      `Node "${fromNodeId}" was not found in the supplied graph.`,
      { nodeId: fromNodeId }
    );
  }

  const missingPromptNode = findMissingPromptNode(nodes);
  if (missingPromptNode) {
    return apiError(
      "MALFORMED_GRAPH",
      `Node "${missingPromptNode.data.label}" is missing a prompt/instruction.`,
      { nodeId: missingPromptNode.id }
    );
  }

// 4. Reset execution record to running and stamp dispatch baseline
  db.prepare(
    `UPDATE executions 
     SET status = 'running', 
         error = NULL, 
         finished_at = NULL, 
         last_dispatched_at = datetime('now') 
     WHERE id = ?`
  ).run(executionId);

  // 5. Dispatch retry execution starting from the target node
  try {
    await inngest.send({
      name: "workflow/run",
      data: {
        executionId,
        workflowId: execution.workflow_id,
        nodes,
        edges,
        startNodeId: targetNode.id,
        initialInput: execution.initial_input ?? "",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown dispatch error";
    db.prepare(
      `UPDATE executions SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`
    ).run(`Failed to dispatch retry event: ${message}`, executionId);

    return apiError(
      "EXECUTION_TRIGGER_FAILED",
      "Failed to dispatch the retry workflow/run event to Inngest.",
      { executionId, cause: message }
    );
  }

  // 6. Asynchronous exit path
  const wait = req.nextUrl.searchParams.get("wait") === "true";
  if (!wait) {
    const pending: RunWorkflowPendingResponse = { executionId, status: "running" };
    return NextResponse.json(pending, { status: 202 });
  }

  // 7. Synchronous wait path
  const finalExecution = await waitForTerminalExecution(
    executionId,
    req.nextUrl.searchParams.get("timeoutMs")
  );

  if (finalExecution.status === "running") {
    const pending: RunWorkflowPendingResponse = {
      executionId,
      status: "running",
      pollUrl: `/api/executions/${executionId}`,
      message: "Retry timed out waiting for completion. Continue polling via pollUrl.",
    };
    return NextResponse.json(pending, { status: 202 });
  }

  const steps = db
    .prepare(
      `SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY order_index ASC`
    )
    .all(executionId) as ExecutionStepRow[];

  const response: RunWorkflowSyncResponse = {
    executionId,
    workflowId: finalExecution.workflow_id,
    status: finalExecution.status,
    duration_seconds: computeDurationSeconds(
      finalExecution.last_dispatched_at ?? finalExecution.created_at,
      finalExecution.finished_at
    ),
    outcome: resolveOutcome(finalExecution, steps),
    steps,
  };

  return NextResponse.json(response, { status: 200 });
}