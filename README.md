# Durable AI Decision & Workflow Orchestration Engine

A distributed, fault-tolerant workflow engine designed to execute, route, and observe multi-step LLM decisions and terminal actions across arbitrary Directed Acyclic Graphs (DAGs). Built with **Next.js 16 (App Router)**, **Inngest v3**, **TypeScript**, and **SQLite (WAL mode)**.

---

## 1. System Architecture

Unlike in-memory agent frameworks that can lose state during process restarts or provider rate limits, this engine decouples workflow ingestion, relational state persistence, and model execution using durable step primitives and memoization.

```text
[ External Webhook / API Client ]       [ Visual Canvas (React Flow) ]
                 │                                       │
                 │ POST /api/workflows/:id/run           │ POST /api/executions
                 ▼                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js API Gateway                             │
│  - Graph Topological Validation (O(V) Cycle Checks)                    │
│  - Template Interpolation ({{input}})                                  │
│  - SQLite Write-Ahead Logging Persistence                              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ inngest.send("workflow/run")
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    Inngest Event Bus & Orchestrator                    │
│  - Durable execution loop                                              │
│  - Step-level replay and memoization                                   │
│  - Step isolation: decide-${nodeId} / act-${nodeId}                    │
│  - Native step-level pause, wait, and external dispatch                │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
                    ▼                                ▼
        ┌────────────────────────┐       ┌────────────────────────┐
        │ Decision Step Worker   │       │ Terminal Action Worker │
        │ - Zero-temp extraction │       │ - Freeform synthesis   │
        │ - Dynamic branch path  │       │ - Action tagging       │
        └────────────┬───────────┘       └────────────┬───────────┘
                     │                                │
                     └───────────────┬────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Inference Layer                                │
│       OpenAI-Compatible Provider (Local Ollama llama3.2 / Groq)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Telemetry & Persistence                         │
│  - executions & execution_steps tables                                 │
│  - Idempotent upserts on (execution_id, node_id, attempt)              │
│  - Millisecond latency tracking & token utilization metrics            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Backend Engineering Capabilities

### Durable Step Isolation, Memoization & Targeted Retry

* **Step-Level Isolation:** Each node execution is isolated within an Inngest `step.run` boundary. Completed upstream steps can be reused rather than re-evaluated when execution resumes.
* **Durable Step Memoization:** Inngest maintains durable execution state so that completed steps are not unnecessarily repeated after recoverable interruptions.
* **Natural-Key Idempotency:** Database writes enforce a unique constraint on `(execution_id, node_id, attempt)`. Retries increment an isolated attempt counter without corrupting previous trace audits or creating duplicate step records.
* **Targeted Resume:** `POST /api/executions/:id/retry` resumes execution directly from an intermediate failed node without restarting the root workflow. Upstream results remain available, reducing unnecessary latency and token usage.
* **Step ID Stability:** Inngest step identifiers use static node IDs such as `decide-${nodeId}` and `act-${nodeId}` rather than dynamically incorporating attempt numbers. Attempt tracking is handled by the database layer.

### Deterministic Inference & Constrained Parsing

* **Strict Binary Routing:** Zero-temperature system prompting combined with a single-token regex extractor produces unambiguous `YES`/`NO` decision paths.
* **Automated Fallback:** If an LLM returns open-ended prose on the first attempt, the client immediately re-prompts using stricter single-token formatting before escalating the step to failure.
* **Dynamic Variable Interpolation:** Runtime execution parameters such as `{{input}}` resolve dynamically across nested prompts and instructions at arbitrary graph depths.

### Real-Time Observability & Metric Rollups

* **High-Resolution Latency:** Step durations are tracked using integer epoch timestamps such as `started_at_ms` and `finished_at_ms`, avoiding string-date parsing drift.
* **Truthful Token Accounting:** Prompt, completion, and total token usage are extracted per step when available. If a local model omits usage metadata, the values remain `NULL` rather than being fabricated, and reporting completeness is represented through `reportingCoverage`.
* **Rolling Telemetry:** `GET /api/workflows/:id/analytics` computes p50 and p95 nearest-rank latency distributions, per-node failure rates, execution status aggregations, and token utilization.

### Activity-Based Orphan Reconciliation

* Executions left in `running` because of a worker crash can be detected when no step activity has occurred within the configured 120-second staleness window.
* `reconcileStaleExecutions()` transitions stale executions to `error`.
* Operators can bypass active-state guards with `?force=true` when retrying an execution.

---

## 3. Distributed Failure Modes & Edge-Case Analysis

| Edge Case / Failure Mode | Root System Risk | Implemented Architectural Mitigation |
| :--- | :--- | :--- |
| **Circular Graph Definition** | Infinite recursion, unbounded token drain, and worker exhaustion. | O(V) runtime cycle detection using traversal tracking (`visited = new Set()`). Aborts with a `loop-detected` audit step. |
| **Worker Process Crash / Stale Execution** | Execution remains stuck in `running`, blocking retries and skewing analytics denominators. | Staleness reconciler transitions jobs with no step activity for 120 seconds to `error`; `POST /api/executions/:id/retry?force=true` provides an explicit operator bypass. |
| **High Write Concurrency** | SQLite database lock errors (`SQLITE_BUSY`) during rapid step logging. | SQLite runs in Write-Ahead Logging mode (`PRAGMA journal_mode = WAL`) with cached connection singletons. |
| **Model Parse Ambiguity** | Traversal deadlocks if the model produces non-binary output. | Immediate single-token fallback retry with stricter prompt formatting. If persistent, fails step gracefully with `status = 'error'`. |
| **Headless Request Timeout** | Client connection drops during long multi-step inference chains. | Configurable timeout (`?timeoutMs=`, default 25s, max 60s) with non-blocking server polling. Returns `202 Accepted` with a polling URL if the synchronous wait expires. |

---

## 4. Architectural Trade-offs & Design Decisions

### 1. Inngest Retry Configuration

* **Configuration:** The workflow orchestrator runs with `retries: 0`.
* **Rationale:** Application-level recovery is handled through targeted manual retries. This avoids relying on function-level replays when application side effects require explicit coordination.

### 2. SQLite WAL Mode vs. Distributed PostgreSQL

* **Choice:** Embedded SQLite via `better-sqlite3`, initialized with WAL mode.
* **Trade-off:** PostgreSQL provides stronger options for distributed and multi-region horizontal write scaling, while SQLite provides zero-infrastructure local execution and avoids a separate database service.
* **Concurrency:** WAL mode allows readers and writers to operate with reduced blocking compared with the default rollback journal.

### 3. Client Polling vs. Server-Sent Events (SSE)

* **Choice:** 1-second interval polling for UI state and a 300ms non-blocking polling loop for synchronous API calls.
* **Trade-off:** SSE requires persistent HTTP connections that can be disrupted by reverse-proxy restarts or serverless function termination. Short polling decouples client connectivity from durable server execution.

### 4. Step ID Stability During Retries

* **Choice:** Inngest step identifiers use static node IDs (`decide-${nodeId}`, `act-${nodeId}`) rather than dynamic attempt IDs.
* **Trade-off:** Keeping step IDs stable allows durable step caching/memoization to remain consistent across recoverable replays. Attempt numbers are tracked independently in the database.

### 5. Failed-Step Token Accounting

* If an LLM call fails completely at the network level or throws an unhandled client exception before returning a completion payload, token counts for that failed attempt are unavailable and remain `NULL`.

### 6. Historical Metrics on Mutated Graphs

* The `/analytics` endpoint iterates through the active workflow topology (`graph.nodes`) for its per-node breakdown.
* Historical step metrics remain in SQLite even if a node is later deleted from the canvas, but those historical records may be omitted from the active per-node analytics view.

### 7. Concurrent Execution Hazard with `?force=true`

* Calling `POST /api/executions/:id/retry?force=true` against an execution that is still actively running can dispatch a secondary Inngest run for the same `executionId`.
* The composite `(execution_id, node_id, attempt)` index prevents duplicate key collisions, but concurrent workers can interleave step writes and pollute the chronological trace.
* `?force=true` should therefore be treated as an operator override intended for stale/dead executions rather than normal in-flight executions.

---

## 5. Database Schema

The persistence layer uses three relational tables with strict constraints.

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'error'
  error TEXT,
  initial_input TEXT,
  last_dispatched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE execution_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_label TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'decision', -- 'decision' | 'action'
  order_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  decision TEXT,                               -- 'YES' | 'NO' | NULL
  action_label TEXT,                           -- 'slack' | 'email' | 'escalate' | NULL
  status TEXT NOT NULL DEFAULT 'running',      -- 'running' | 'done' | 'error'
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  started_at_ms INTEGER,
  finished_at_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER
);

-- Idempotency and performance indexes
CREATE UNIQUE INDEX idx_steps_execution_node_attempt
  ON execution_steps (execution_id, node_id, attempt);

CREATE INDEX idx_steps_node_analytics
  ON execution_steps (node_id, status, started_at_ms, finished_at_ms);
```

---

## 6. Programmatic API Reference

### 1. Headless Workflow Ingestion

Execute any stored workflow without touching the UI canvas.

```http
POST /api/workflows/:id/run?wait=true&timeoutMs=30000
Content-Type: application/json

{
  "input": "Incident report: High packet loss and dropped connections on primary payment gateway."
}
```

#### Synchronous Response (`200 OK`)

```json
{
  "executionId": "4bf47b64-a068-443e-8542-c73953003602",
  "workflowId": "9b968dea-cc11-4f14-a66c-b29798fe808c",
  "status": "completed",
  "duration_seconds": 15,
  "outcome": {
    "nodeId": "ebc90201-b70e-4d0c-ae8d-27768216ea3f",
    "nodeLabel": "Page On-Call Security",
    "nodeType": "action",
    "terminalType": "action_output",
    "actionLabel": "escalate",
    "value": "**URGENT P0 SECURITY ESCALATION NOTICE**\n..."
  },
  "steps": [ ... ]
}
```

#### Asynchronous / Timeout Fallback (`202 Accepted`)

```json
{
  "executionId": "4bf47b64-a068-443e-8542-c73953003602",
  "status": "running",
  "pollUrl": "/api/executions/4bf47b64-a068-443e-8542-c73953003602",
  "message": "Execution timed out waiting for completion. Continue polling via pollUrl."
}
```

### 2. Targeted Node-Level Retry

Resume an errored execution directly from a failed node.

```http
POST /api/executions/:id/retry?wait=true&force=true
Content-Type: application/json

{
  "fromNodeId": "0c342683-61f1-45fb-a2c6-2d6b228f358e",
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

> **Note:** `force=true` is an operator override for stale or otherwise blocked executions. Using it against an actively running execution can result in concurrent runs and interleaved step traces.

### 3. Aggregated Observability & Telemetry

Fetch performance metrics, token utilization, and percentiles for a workflow.

```http
GET /api/workflows/:id/analytics
```

#### Response (`200 OK`)

```json
{
  "workflowId": "9b968dea-cc11-4f14-a66c-b29798fe808c",
  "workflowName": "Customer Incident Triage & Response Engine",
  "totalExecutions": 8,
  "executionCounts": {
    "completed": 6,
    "error": 2,
    "running": 0
  },
  "nodes": [
    {
      "nodeId": "start",
      "nodeLabel": "Start: Incident Check",
      "nodeType": "decision",
      "totalAttempts": 6,
      "successfulAttempts": 6,
      "failedAttempts": 0,
      "failureRate": 0,
      "latency": {
        "p50Ms": 9444,
        "p95Ms": 9444,
        "avgMs": 9444
      },
      "tokens": {
        "totalPromptTokens": 96,
        "totalCompletionTokens": 2,
        "totalTokens": 98,
        "reportingCoverage": 0.167
      }
    }
  ]
}
```

---

## 7. Local Development & Verification

### Prerequisites

* Node.js `>= 20`
* A local Ollama instance running `llama3.2:3b`, or a valid Groq API key

### Installation

```bash
git clone https://github.com/your-username/durable-ai-workflow-engine.git
cd durable-ai-workflow-engine
npm install
cp .env.example .env.local
```

### Environment Configuration (`.env.local`)

```env
# Point to local Ollama or Groq Cloud
GROQ_API_KEY=ollama
GROQ_BASE_URL=http://127.0.0.1:11434/v1
GROQ_MODEL=llama3.2:3b
```

### Running the Engine

Start the services in separate terminal sessions:

```bash
# Terminal 1: Inngest Dev Server
npx inngest-cli@latest dev

# Terminal 2: Next.js Engine
npm run dev
```

Then visit:

* `http://localhost:3000` — Visual workflow editor
* `http://localhost:8288` — Inngest execution dashboard

---

## 8. Test Suite & Verification Matrix

The orchestration engine is thoroughly validated across automated backend runtime tests, distributed edge cases, and visual canvas controls.

For complete verification procedures, reproduction steps, architectural bug fixes, and the security audit, refer to [`TESTING.md`](./TESTING.md).

### Quick Automated Test Run

With both development services active, execute the test runner:

```bash
node scripts/test-engine.mjs
```

The automated suite covers:

* **Suite 4.1:** Missing Start Node Validation (`HTTP 400`)
* **Suite 4.2:** Empty Prompt Guard (`HTTP 400`)
* **Suite 4.3:** Dual-Branch Cycle Detection Guard (`status = 'error'`, `loop-detected`)
* **Suite 5.1:** Dead Worker Staleness Sweep (120-second inactivity lease expiration)
* **Suite 5.2:** Analytics & Telemetry Rollup (p50, p95, failure rates, token coverage)
* **Suite 5.3:** Targeted Node-Level Retry & Attempt Isolation

---

## 9. Summary

This project implements a durable LLM workflow runtime that combines:

* **Next.js 16** for the API gateway and visual workflow interface.
* **React Flow** for graph-based workflow authoring.
* **Inngest v3** for durable, isolated workflow execution and step memoization.
* **SQLite + WAL** for persistent execution state and telemetry.
* **OpenAI-compatible inference** through local Ollama or Groq.
* **Deterministic decision parsing** for binary workflow branches.
* **Targeted node-level retries** instead of restarting entire workflows.
* **Idempotent execution-step persistence** using `(execution_id, node_id, attempt)`.
* **Millisecond latency and token telemetry** with explicit reporting coverage.
* **Stale execution reconciliation** for orphaned workers.
* **Headless HTTP execution** with synchronous completion or asynchronous polling fallback.
* **Analytics APIs** for execution status, node failures, latency percentiles, and token utilization.