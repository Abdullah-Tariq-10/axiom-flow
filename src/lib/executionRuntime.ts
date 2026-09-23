import { db } from "./db";
import type { ExecutionOutcome, ExecutionRow, ExecutionStepRow } from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const POLL_INTERVAL_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Silently falls back / clamps rather than erroring — this is a tuning knob, not payload data. */
export function parseTimeoutMs(raw: string | null): number {
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
export function computeDurationSeconds(
  createdAt: string,
  finishedAt: string | null
): number | null {
  if (!finishedAt) return null;
  const start = new Date(createdAt + "Z").getTime();
  const end = new Date(finishedAt + "Z").getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Deterministically summarizes how a completed/errored run ended. */
export function resolveOutcome(
  execution: ExecutionRow,
  steps: ExecutionStepRow[]
): ExecutionOutcome {
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

/**
 * Polls our own `executions` table (never Inngest directly) until the run
 * reaches a terminal status or the timeout elapses. WAL mode keeps these
 * reads non-blocking against the Inngest worker's writes.
 */
export async function waitForTerminalExecution(
  executionId: string,
  timeoutMsRaw: string | null
): Promise<ExecutionRow> {
  const timeoutMs = parseTimeoutMs(timeoutMsRaw);
  const deadline = Date.now() + timeoutMs;
  let execution: ExecutionRow;
  for (;;) {
    execution = db
      .prepare(`SELECT * FROM executions WHERE id = ?`)
      .get(executionId) as ExecutionRow;
    if (!execution || execution.status !== "running" || Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  return execution;
}

/**
 * Scans for orphan executions stuck in 'running' where no step or heartbeat
 * has been recorded within `maxAgeSeconds`. Transitions them to 'error' to
 * unblock retries, un-stick UI polling, and prevent denominator pollution.
 */
export function reconcileStaleExecutions(maxAgeSeconds: number = 120): number {
  const result = db
    .prepare(
      `UPDATE executions
       SET status = 'error',
           error = 'Execution timed out or worker process terminated unexpectedly.',
           finished_at = datetime(
             COALESCE(
               (SELECT MAX(COALESCE(finished_at, started_at))
                FROM execution_steps WHERE execution_id = executions.id),
               created_at
             ),
             '+' || ? || ' seconds'
           )
       WHERE status = 'running'
         AND (strftime('%s', 'now') - strftime('%s',
           COALESCE(
             (SELECT MAX(COALESCE(finished_at, started_at))
                FROM execution_steps WHERE execution_id = executions.id),
             created_at
           )
         )) > ?`
    )
    .run(maxAgeSeconds, maxAgeSeconds);

  return result.changes;
}