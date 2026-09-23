import type { Edge, Node } from "reactflow";

export type Decision = "YES" | "NO";
export type NodeStatus = "idle" | "running" | "yes" | "no" | "done" | "error";
export type Branch = "yes" | "no";
export type ActionLabel = "slack" | "email" | "escalate";

export interface DecisionNodeData {
  kind?: "decision";
  label: string;
  prompt: string;
  isStart?: boolean;
  status?: NodeStatus;
  [key: string]: unknown;
}

export interface ActionNodeData {
  kind: "action";
  label: string;
  /** LLM instruction, e.g. "Draft a polite refund confirmation using {{input}}" */
  instruction: string;
  actionLabel: ActionLabel;
  status?: NodeStatus;
  /** Populated after a run with the generated text (for display on the node itself). */
  output?: string;
  [key: string]: unknown;
}

export type AnyNodeData = DecisionNodeData | ActionNodeData;
/** Kept as the original name to minimize churn — now represents any node kind. */
export type DecisionFlowNode = Node<AnyNodeData>;

export interface BranchEdgeData {
  branch: Branch;
  active?: boolean;
  [key: string]: unknown;
}

export type BranchFlowEdge = Edge<BranchEdgeData>;

export interface WorkflowGraph {
  nodes: DecisionFlowNode[];
  edges: BranchFlowEdge[];
}

export interface WorkflowRow {
  id: string;
  name: string;
  graph_json: string;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRow {
  id: string;
  workflow_id: string | null;
  status: "running" | "completed" | "error";
  error: string | null;
  initial_input: string | null;
  last_dispatched_at: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Row shape returned by the history list endpoint — execution + a computed summary. */
export interface ExecutionHistoryRow extends ExecutionRow {
  duration_seconds: number | null;
  last_node_label: string | null;
  last_decision: Decision | null;
  last_action_label: ActionLabel | null;
}

export interface ExecutionStepRow {
  id: number;
  execution_id: string;
  node_id: string;
  node_label: string;
  node_type: "decision" | "action";
  order_index: number;
  prompt: string;
  response: string | null;
  decision: Decision | null;
  action_label: ActionLabel | null;
  status: "running" | "done" | "error";
  error: string | null;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  started_at_ms?: number | null;
  finished_at_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface ExecutionDetail {
  execution: ExecutionRow;
  steps: ExecutionStepRow[];
}

/** Event payload sent to Inngest to kick off a workflow run. */
export interface WorkflowRunEvent {
  name: "workflow/run";
  data: {
    executionId: string;
    workflowId: string | null;
    nodes: DecisionFlowNode[];
    edges: BranchFlowEdge[];
    startNodeId: string;
    initialInput: string;
  };
}

// ---------------------------------------------------------------------------
// Headless execution (POST /api/workflows/[id]/run) — additive, Phase 1.
// ---------------------------------------------------------------------------

export type TerminalType = "action_output" | "unhandled_branch" | "error";

/**
 * Deterministic summary of how a run ended, regardless of whether it
 * terminated at an Action Node, a dead-end Decision Node, or an error/cycle.
 */
export interface ExecutionOutcome {
  nodeId: string | null;
  nodeLabel: string | null;
  nodeType: "decision" | "action" | null;
  terminalType: TerminalType;
  actionLabel: ActionLabel | null;
  value: string | null;
}

/** Response body when ?wait=true and the run reaches a terminal state in time. */
export interface RunWorkflowSyncResponse {
  executionId: string;
  workflowId: string | null;
  status: "completed" | "error";
  duration_seconds: number | null;
  outcome: ExecutionOutcome;
  steps: ExecutionStepRow[];
}

/** Response body when the caller doesn't wait, or ?wait=true times out first. */
export interface RunWorkflowPendingResponse {
  executionId: string;
  status: "running";
  pollUrl?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Observability & Telemetry (Phase 3)
// ---------------------------------------------------------------------------
export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface NodeLatencyMetrics {
  p50Ms: number | null;
  p95Ms: number | null;
  avgMs: number | null;
}

export interface NodeAnalytics {
  nodeId: string;
  nodeLabel: string;
  nodeType: "decision" | "action";
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  failureRate: number; // 0.0 to 1.0
  latency: NodeLatencyMetrics;
  tokens: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    reportingCoverage: number; // 0.0 to 1.0
  };
}

export interface WorkflowAnalyticsResponse {
  workflowId: string;
  workflowName: string;
  totalExecutions: number;
  executionCounts: {
    completed: number;
    error: number;
    running: number;
  };
  nodes: NodeAnalytics[];
}