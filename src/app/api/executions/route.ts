import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest/client";
import { nanoid } from "@/lib/nanoid";
import { reconcileStaleExecutions } from "@/lib/executionRuntime";
import type { BranchFlowEdge, DecisionFlowNode, ExecutionHistoryRow } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nodes: DecisionFlowNode[] = body.nodes;
  const edges: BranchFlowEdge[] = body.edges;
  const workflowId: string | null = body.workflowId ?? null;
  const initialInput: string = body.initialInput ?? "";

  const startNode =
    nodes.find((n) => n.data.isStart) ?? nodes.find((n) => !edges.some((e) => e.target === n.id));

  if (!startNode) {
    return NextResponse.json(
      { error: "No start node found. Mark a node as the start node." },
      { status: 400 }
    );
  }

  const missingPrompt = nodes.some((n) => {
    const text =
      n.type === "action"
        ? (n.data as { instruction?: string }).instruction
        : (n.data as { prompt?: string }).prompt;
    return !text?.trim();
  });

  if (missingPrompt) {
    return NextResponse.json(
      { error: "Every node needs a prompt/instruction before running." },
      { status: 400 }
    );
  }

  const executionId = nanoid();
  db.prepare(
    `INSERT INTO executions (id, workflow_id, status, initial_input) VALUES (?, ?, 'running', ?)`
  ).run(executionId, workflowId, initialInput);

  await inngest.send({
    name: "workflow/run",
    data: { executionId, workflowId, nodes, edges, startNodeId: startNode.id, initialInput },
  });

  return NextResponse.json({ executionId });
}

export async function GET(req: NextRequest) {
  // Sweep stale executions so the History Drawer displays up-to-date terminal states
  reconcileStaleExecutions();

  const workflowId = req.nextUrl.searchParams.get("workflowId");

  const query = `
    SELECT
      e.*,
      CASE WHEN e.finished_at IS NOT NULL
        THEN CAST((julianday(e.finished_at) - julianday(COALESCE(e.last_dispatched_at, e.created_at))) * 86400 AS INTEGER)
        ELSE NULL
      END AS duration_seconds,
      last_step.node_label AS last_node_label,
      last_step.decision AS last_decision,
      last_step.action_label AS last_action_label
    FROM executions e
    LEFT JOIN execution_steps last_step
      ON last_step.id = (
        SELECT id FROM execution_steps
        WHERE execution_id = e.id
        ORDER BY order_index DESC
        LIMIT 1
      )
    ${workflowId ? "WHERE e.workflow_id = ?" : ""}
    ORDER BY e.created_at DESC
    LIMIT 25
  `;

  const rows = workflowId
    ? db.prepare(query).all(workflowId)
    : db.prepare(query).all();

  return NextResponse.json(rows as ExecutionHistoryRow[]);
}