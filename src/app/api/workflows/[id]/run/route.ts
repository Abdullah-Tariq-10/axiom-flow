import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { nanoid } from "@/lib/nanoid";
import { apiError } from "@/lib/apiError";
import { findMissingPromptNode, findStartNode } from "@/lib/workflow-graph";
import type {
  ExecutionOutcome,
  ExecutionRow,
  ExecutionStepRow,
  RunWorkflowPendingResponse,
  RunWorkflowSyncResponse,
  WorkflowGraph,
  WorkflowRow,
} from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Silently falls back / clamps rather than erroring — this is a tuning knob, not payload data. */
function parseTimeoutMs(raw: string | null): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" (space-separated, no
 * zone). Appending "Z" and letting Date parse it matches the exact convention
 * already used in HistoryDrawer.tsx, kept consistent here deliberately.
 */
function computeDurationSeconds(createdAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const start = new Date(createdAt + "Z").getTime();
  const end = new Date(finishedAt + "Z").getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Deterministically summarizes how a completed/errored run ended. */
function resolveOutcome(execution: ExecutionRow, steps: ExecutionStepRow[]): ExecutionOutcome {
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;

  if (execution.status === "error") {
    return {
      nodeId: lastStep?.node_id ?? null,
      nodeLabel: lastStep?.node_label ?? null,
      nodeType: lastStep?.node_type ?? null,
      terminalType: "error",
      actionLabel: null,
      value: execution.error,
    };
  }

  if (!lastStep) {
    // Structurally shouldn't happen for a "completed" execution, but this is
    // an externally-callable API — never assume, always return a defined shape.
    return {
      nodeId: null,
      nodeLabel: null,
      nodeType: null,
      terminalType: "error",
      actionLabel: null,
      value: "No steps were recorded for this execution.",
    };
  }

  if (lastStep.node_type === "action") {
    return {
      nodeId: lastStep.node_id,
      nodeLabel: lastStep.node_label,
      nodeType: "action",
      terminalType: "action_output",
      actionLabel: lastStep.action_label,
      value: lastStep.response,
    };
  }

  return {
    nodeId: lastStep.node_id,
    nodeLabel: lastStep.node_label,
    nodeType: "decision",
    terminalType: "unhandled_branch",
    actionLabel: null,
    value: lastStep.decision,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params;

  // 1. Payload validation
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_PAYLOAD", "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null) {
    return apiError("INVALID_PAYLOAD", "Request body must be a JSON object.");
  }
  const rawInput = (body as { input?: unknown }).input;
  if (rawInput !== undefined && typeof rawInput !== "string") {
    return apiError("INVALID_PAYLOAD", "`input` must be a string if provided.");
  }
  const initialInput = rawInput ?? "";

  // 2. Load + validate the stored workflow graph
  const workflowRow = db
    .prepare(`SELECT * FROM workflows WHERE id = ?`)
    .get(workflowId) as WorkflowRow | undefined;
  if (!workflowRow) {
    return apiError("WORKFLOW_NOT_FOUND", `Workflow with ID '${workflowId}' does not exist.`);
  }

  let graph: WorkflowGraph;
  try {
    graph = JSON.parse(workflowRow.graph_json) as WorkflowGraph;
  } catch {
    return apiError("MALFORMED_GRAPH", "Stored workflow graph JSON could not be parsed.");
  }

  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  if (nodes.length === 0) {
    return apiError("MALFORMED_GRAPH", "Workflow has no nodes.");
  }

  const startNode = findStartNode(nodes, edges);
  if (!startNode) {
    return apiError(
      "MALFORMED_GRAPH",
      "No start node found — mark a node as the start node before running headlessly."
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

  // 3. Query params
  const wait = req.nextUrl.searchParams.get("wait") === "true";
  const timeoutMs = parseTimeoutMs(req.nextUrl.searchParams.get("timeoutMs"));

  // 4. Create the execution row, then dispatch — durability comes from the
  //    row existing before the event is sent, and from Inngest's own event
  //    durability once sent successfully.
  const executionId = nanoid();
  db.prepare(
    `INSERT INTO executions (id, workflow_id, status, initial_input) VALUES (?, ?, 'running', ?)`
  ).run(executionId, workflowId, initialInput);

  try {
    await inngest.send({
      name: "workflow/run",
      data: { executionId, workflowId, nodes, edges, startNodeId: startNode.id, initialInput },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown dispatch error";
    db.prepare(
      `UPDATE executions SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?`
    ).run(`Failed to dispatch execution event: ${message}`, executionId);
    return apiError(
      "EXECUTION_TRIGGER_FAILED",
      "Failed to dispatch the workflow/run event to Inngest.",
      { executionId, cause: message }
    );
  }

  if (!wait) {
    const pending: RunWorkflowPendingResponse = { executionId, status: "running" };
    return NextResponse.json(pending, { status: 202 });
  }

  // 5. Synchronous wait: poll our own tables (never Inngest directly) until
  //    terminal or timeout. WAL mode keeps these reads non-blocking against
  //    the Inngest worker's writes.
  const deadline = Date.now() + timeoutMs;
  let execution: ExecutionRow;
  for (;;) {
    execution = db.prepare(`SELECT * FROM executions WHERE id = ?`).get(executionId) as ExecutionRow;
    if (execution.status !== "running" || Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (execution.status === "running") {
    const pending: RunWorkflowPendingResponse = {
      executionId,
      status: "running",
      pollUrl: `/api/executions/${executionId}`,
      message: "Execution timed out waiting for completion. Continue polling via pollUrl.",
    };
    return NextResponse.json(pending, { status: 202 });
  }

  const steps = db
    .prepare(`SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY order_index ASC`)
    .all(executionId) as ExecutionStepRow[];

  const response: RunWorkflowSyncResponse = {
    executionId,
    workflowId,
    status: execution.status,
    duration_seconds: computeDurationSeconds(
      execution.last_dispatched_at ?? execution.created_at,
      execution.finished_at
    ),
    outcome: resolveOutcome(execution, steps),
    steps,
  };
  return NextResponse.json(response, { status: 200 });
}