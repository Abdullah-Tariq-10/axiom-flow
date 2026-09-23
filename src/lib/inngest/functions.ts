import { classifyPrompt, generateActionText } from "../groq";
import { db } from "../db";
import type {
  ActionLabel,
  BranchFlowEdge,
  Decision,
  DecisionFlowNode,
  TokenUsage,
} from "../types";
import { inngest } from "./client";

function markExecution(
  id: string,
  status: "completed" | "error",
  error?: string
) {
  db.prepare(
    `UPDATE executions SET status = ?, error = ?, finished_at = datetime('now') WHERE id = ?`
  ).run(status, error ?? null, id);
}

function nextAttempt(executionId: string, nodeId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(attempt), 0) AS maxAttempt FROM execution_steps
       WHERE execution_id = ? AND node_id = ?`
    )
    .get(executionId, nodeId) as { maxAttempt: number };
  return row.maxAttempt + 1;
}

function startStep(
  executionId: string,
  node: DecisionFlowNode,
  attempt: number,
  order: number,
  nodeType: "decision" | "action",
  prompt: string,
  startedAtMs: number
) {
  db.prepare(
    `INSERT INTO execution_steps
       (execution_id, node_id, node_label, node_type, order_index, prompt, status, attempt, started_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
     ON CONFLICT (execution_id, node_id, attempt) DO UPDATE SET
       node_label = excluded.node_label,
       node_type = excluded.node_type,
       order_index = excluded.order_index,
       prompt = excluded.prompt,
       status = 'running',
       response = NULL,
       decision = NULL,
       action_label = NULL,
       error = NULL,
       started_at = datetime('now'),
       started_at_ms = excluded.started_at_ms,
       finished_at = NULL,
       finished_at_ms = NULL,
       prompt_tokens = NULL,
       completion_tokens = NULL,
       total_tokens = NULL`
  ).run(executionId, node.id, node.data.label, nodeType, order, prompt, attempt, startedAtMs);
}

function finishDecisionStepOk(
  executionId: string,
  nodeId: string,
  attempt: number,
  decision: Decision,
  raw: string,
  finishedAtMs: number,
  usage: TokenUsage
) {
  db.prepare(
    `UPDATE execution_steps
       SET status = 'done', decision = ?, response = ?, finished_at = datetime('now'),
           finished_at_ms = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?
     WHERE execution_id = ? AND node_id = ? AND attempt = ?`
  ).run(
    decision,
    raw,
    finishedAtMs,
    usage.promptTokens,
    usage.completionTokens,
    usage.totalTokens,
    executionId,
    nodeId,
    attempt
  );
}

function finishActionStepOk(
  executionId: string,
  nodeId: string,
  attempt: number,
  actionLabel: ActionLabel,
  output: string,
  finishedAtMs: number,
  usage: TokenUsage
) {
  db.prepare(
    `UPDATE execution_steps
       SET status = 'done', action_label = ?, response = ?, finished_at = datetime('now'),
           finished_at_ms = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?
     WHERE execution_id = ? AND node_id = ? AND attempt = ?`
  ).run(
    actionLabel,
    output,
    finishedAtMs,
    usage.promptTokens,
    usage.completionTokens,
    usage.totalTokens,
    executionId,
    nodeId,
    attempt
  );
}

function finishStepError(
  executionId: string,
  nodeId: string,
  attempt: number,
  message: string,
  finishedAtMs: number
) {
  db.prepare(
    `UPDATE execution_steps
       SET status = 'error', error = ?, finished_at = datetime('now'), finished_at_ms = ?
     WHERE execution_id = ? AND node_id = ? AND attempt = ?`
  ).run(message, finishedAtMs, executionId, nodeId, attempt);
}

function resolveTemplate(text: string, input: string): string {
  return text.replaceAll("{{input}}", input);
}

async function runDecisionNode(
  executionId: string,
  node: DecisionFlowNode,
  attempt: number,
  order: number,
  initialInput: string
): Promise<{ decision: Decision; raw: string; usage: TokenUsage }> {
  const prompt = resolveTemplate((node.data as { prompt: string }).prompt, initialInput);
  const startedAtMs = Date.now();
  startStep(executionId, node, attempt, order, "decision", prompt, startedAtMs);

  try {
    const { decision, raw, usage } = await classifyPrompt(prompt);
    finishDecisionStepOk(executionId, node.id, attempt, decision, raw, Date.now(), usage);
    return { decision, raw, usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    finishStepError(executionId, node.id, attempt, message, Date.now());
    throw err;
  }
}

async function runActionNode(
  executionId: string,
  node: DecisionFlowNode,
  attempt: number,
  order: number,
  initialInput: string
): Promise<{ output: string; usage: TokenUsage }> {
  const data = node.data as { instruction: string; actionLabel: ActionLabel };
  const instruction = resolveTemplate(data.instruction, initialInput);
  const startedAtMs = Date.now();
  startStep(executionId, node, attempt, order, "action", instruction, startedAtMs);

  try {
    const { output, usage } = await generateActionText(instruction);
    finishActionStepOk(executionId, node.id, attempt, data.actionLabel, output, Date.now(), usage);
    return { output, usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    finishStepError(executionId, node.id, attempt, message, Date.now());
    throw err;
  }
}

export const runWorkflow = inngest.createFunction(
  { id: "run-workflow", retries: 0 },
  { event: "workflow/run" },
  async ({ event, step }) => {
    const { executionId, nodes, edges, startNodeId, initialInput } = event.data;

    let currentId: string | null = startNodeId;
    let order = 0;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) {
        await step.run("loop-detected", async () =>
          markExecution(
            executionId,
            "error",
            `Cycle detected: node "${currentId}" was reached twice.`
          )
        );
        return { status: "error", reason: "cycle" };
      }
      visited.add(currentId);

      const node = nodes.find((n: DecisionFlowNode) => n.id === currentId);
      if (!node) break;

      order += 1;
      const nodeForStep = node;
      const stepOrder = order;
      const isAction = node.type === "action";
      const attempt = nextAttempt(executionId, node.id);

      try {
        if (isAction) {
          await step.run(`act-${node.id}`, () =>
            runActionNode(executionId, nodeForStep, attempt, stepOrder, initialInput)
          );
          currentId = null;
          break;
        }

        const result = await step.run(`decide-${node.id}`, () =>
          runDecisionNode(executionId, nodeForStep, attempt, stepOrder, initialInput)
        );
        const branch = result.decision === "YES" ? "yes" : "no";
        const nextEdge = edges.find(
          (e: BranchFlowEdge) => e.source === currentId && e.data?.branch === branch
        );
        currentId = nextEdge ? nextEdge.target : null;
      } catch (err) {
        await step.run("finalize-error", async () =>
          markExecution(
            executionId,
            "error",
            err instanceof Error ? err.message : "LLM step failed"
          )
        );
        return { status: "error" };
      }
    }

    await step.run("finalize-success", async () =>
      markExecution(executionId, "completed")
    );
    return { status: "completed", steps: order };
  }
);