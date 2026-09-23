import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { reconcileStaleExecutions } from "@/lib/executionRuntime";
import type {
  NodeAnalytics,
  WorkflowAnalyticsResponse,
  WorkflowGraph,
  WorkflowRow,
} from "@/lib/types";

function calculatePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

interface StepMetricRow {
  node_id: string;
  status: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params;

  // Reconcile dead workers globally so running counters are never artificially inflated
  reconcileStaleExecutions();

  const workflow = db
    .prepare(`SELECT * FROM workflows WHERE id = ?`)
    .get(workflowId) as WorkflowRow | undefined;

  if (!workflow) {
    return apiError("WORKFLOW_NOT_FOUND", `Workflow with ID '${workflowId}' does not exist.`);
  }

  let graph: WorkflowGraph;
  try {
    graph = JSON.parse(workflow.graph_json) as WorkflowGraph;
  } catch {
    return apiError("MALFORMED_GRAPH", "Stored workflow graph JSON could not be parsed.");
  }

  const executionCounts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
       FROM executions
       WHERE workflow_id = ?`
    )
    .get(workflowId) as {
      total: number;
      completed: number;
      error: number;
      running: number;
    };

  const rawSteps = db
    .prepare(
      `SELECT
         s.node_id,
         s.status,
         CASE
           WHEN s.finished_at_ms IS NOT NULL AND s.started_at_ms IS NOT NULL
             THEN MAX(0, s.finished_at_ms - s.started_at_ms)
           ELSE NULL
         END AS latency_ms,
         s.prompt_tokens,
         s.completion_tokens,
         s.total_tokens
       FROM execution_steps s
       JOIN executions e ON e.id = s.execution_id
       WHERE e.workflow_id = ?`
    )
    .all(workflowId) as StepMetricRow[];

  const stepsByNode = new Map<string, StepMetricRow[]>();
  for (const step of rawSteps) {
    const list = stepsByNode.get(step.node_id) ?? [];
    list.push(step);
    stepsByNode.set(step.node_id, list);
  }

  const nodesAnalytics: NodeAnalytics[] = (graph.nodes ?? []).map((node) => {
    const steps = stepsByNode.get(node.id) ?? [];
    const totalAttempts = steps.length;
    const successfulAttempts = steps.filter((s) => s.status === "done").length;
    const failedAttempts = steps.filter((s) => s.status === "error").length;

    const failureRate = totalAttempts > 0 ? failedAttempts / totalAttempts : 0;

    const latencies = steps
      .map((s) => s.latency_ms)
      .filter((l): l is number => l !== null);

    const avgMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
        : null;

    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalTokens = 0;
    let reportedTokenSteps = 0;

    for (const s of steps) {
      if (s.total_tokens !== null) {
        reportedTokenSteps += 1;
        totalPrompt += s.prompt_tokens ?? 0;
        totalCompletion += s.completion_tokens ?? 0;
        totalTokens += s.total_tokens;
      }
    }

    const reportingCoverage =
      totalAttempts > 0 ? reportedTokenSteps / totalAttempts : 0;

    return {
      nodeId: node.id,
      nodeLabel: node.data.label,
      nodeType: node.type === "action" ? "action" : "decision",
      totalAttempts,
      successfulAttempts,
      failedAttempts,
      failureRate: Math.round(failureRate * 1000) / 1000,
      latency: {
        p50Ms: calculatePercentile(latencies, 50),
        p95Ms: calculatePercentile(latencies, 95),
        avgMs,
      },
      tokens: {
        totalPromptTokens: totalPrompt,
        totalCompletionTokens: totalCompletion,
        totalTokens,
        reportingCoverage: Math.round(reportingCoverage * 1000) / 1000,
      },
    };
  });

  const response: WorkflowAnalyticsResponse = {
    workflowId,
    workflowName: workflow.name,
    totalExecutions: executionCounts.total ?? 0,
    executionCounts: {
      completed: executionCounts.completed ?? 0,
      error: executionCounts.error ?? 0,
      running: executionCounts.running ?? 0,
    },
    nodes: nodesAnalytics,
  };

  return NextResponse.json(response, { status: 200 });
}