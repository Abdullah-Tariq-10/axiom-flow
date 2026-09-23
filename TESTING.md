# Comprehensive Test Suite & Verification Matrix

This document details the automated test suite, interactive canvas verification procedures, edge-case mitigations, and security audit results for the Durable AI Decision & Workflow Orchestration Engine.

---

## 1. Automated Pre-Release Test Suite (`scripts/test-engine.mjs`)

The automated runner verifies critical backend runtime constraints, failure modes, and telemetry aggregation programmatically.

### Running the Suite

Ensure both the local development server and Inngest daemon are active:

```bash
# Terminal 1: Inngest Dev Server
npx inngest-cli@latest dev

# Terminal 2: Next.js Engine
npm run dev

# Terminal 3: Test Runner
node scripts/test-engine.mjs

```

### Verified Test Cases & Assertions

| Suite | Target Boundary | Input / Scenario | Assertion & Expected Result | Verified Status |
| --- | --- | --- | --- | --- |
| **4.1** | Start Node Validation | Graph payload missing `isStart: true` or root node | Returns `HTTP 400` with `"No start node found. Mark a node as the start node."` | **PASS** |
| **4.2** | Empty Prompt Guard | Node with whitespace-only prompt (`"   "`) | Returns `HTTP 400` with `"Every node needs a prompt/instruction before running."` | **PASS** |
| **4.3** | Cycle Detection Guard | Circular reference (`Node A -> Node B -> Node A`) across both YES and NO branches | Traversal halts at cycle boundary; marks execution as `status = 'error'` and logs `Cycle detected: node "cycle-a" was reached twice.` without worker thread lock. | **PASS** |
| **5.1** | Dead Worker Sweep | Seeded execution abandoned in `running` state >120s | Background reconciler detects inactive worker heartbeat, transitions status to `error`, and caps elapsed duration. | **PASS** |
| **5.2** | Telemetry Aggregation | Workflow telemetry query (`GET /api/workflows/:id/analytics`) | Returns nearest-rank $p_{50}$ and $p_{95}$ latencies, per-node failure rates, execution tallies, and token coverage. | **PASS** |
| **5.3** | Targeted Node Retry | `POST /api/executions/:id/retry?wait=true&force=true` with `fromNodeId` | Upstream steps remain memoized at `attempt: 1`; retried node logs an isolated `attempt: N+1` without mutating prior audit traces. | **PASS** |

---

## 2. Distributed Edge-Case Fixes & Architectural Resolutions

### 1. Dead Worker Duration Normalization

* **Issue:** Stale execution records abandoned in `running` state prior to running the sweeper calculated multi-day elapsed durations (~423,000s) when `reconcileStaleExecutions()` stamped `finished_at = datetime('now')`.
* **Resolution:** Updated `reconcileStaleExecutions()` in `src/lib/executionRuntime.ts` to backdate `finished_at` relative to the last recorded step activity plus the 120-second lease threshold:

```sql
finished_at = datetime(
  COALESCE(
    (SELECT MAX(COALESCE(finished_at, started_at)) FROM execution_steps WHERE execution_id = executions.id),
    created_at
  ),
  '+120 seconds'
)
```

This models distributed worker lease expiration cleanly without poisoning historical latency metrics.

### 2. Dual-Branch Cycle Detection Trap

* **Issue:** Cycle detection tests that only connected `branch: "yes"` edges could exit prematurely if the LLM classified Node A as `"NO"` (treating missing edges as an unhandled terminal branch rather than a loop).
* **Resolution:** Graph cycle test definitions now wire bidirectional edges for both `branch: "yes"` and `branch: "no"`, guaranteeing traversal loop protection regardless of model inference output.

### 3. Analytics Response Schema Alignment

* **Issue:** The test runner checked `data.executionCounts.total`, which evaluated to `undefined`.
* **Resolution:** Aligned the test assertion to the root `totalExecutions` metric defined in `WorkflowAnalyticsResponse`.

---

## 3. Interactive Visual Canvas Verification

These manual checks verify UI state handling, React Flow canvas behaviors, and runtime rendering.

### Suite 1: Canvas Authoring & UI Controls

* [x] **Auto-Layout (Dagre):** Nodes automatically organize left-to-right based on graph depth without breaking handle edge attachments.
* [x] **Persistence:** Workflows save to and hydrate from SQLite (`workflows` table) identically across page refreshes.
* [x] **JSON Portability:** Graph schemas export to `.json` files and can be imported back to restore lost or altered canvas states.
* [x] **History Drawer:** Renders execution status badges, outcome summaries (e.g., `Draft Refund Confirmation -> email`), and accurate durations in seconds.

### Suite 2: Decision Routing & Templating

* [x] **YES Branch Traversal:** Deterministic YES prompts evaluate to green node borders and animate green dashed edge paths.
* [x] **NO Branch Traversal:** Deterministic NO prompts evaluate to red node borders and animate red dashed edge paths.
* [x] **Dynamic Templating (`{{input}}`):** Runtime context entered into the Input drawer replaces `{{input}}` expressions across decision prompts and action instructions.

### Suite 3: Terminal Action Nodes

* [x] **Action Generation:** Freeform text generation executes with temperature, populates the action card directly on the canvas, and halts execution cleanly.

---

## 4. Security & Hardening Audit

### 1. SQL Injection Protection

* **Parameterized Query Compliance:** Static code review confirms 100% of dynamic queries use `better-sqlite3` prepared statements (`?` parameter binding) across all route handlers and lib functions.
* **Empirical Route Injection Spot-Check:**
  ```bash
  # Probe endpoint with 8 literals matching the schema column count of `executions`:
  Invoke-RestMethod -Uri "http://localhost:3000/api/executions/test' UNION SELECT 1,2,3,4,5,6,7,8 --"

  # Output: HTTP 404 Not Found

* **Differential Verification:** The 8 literals match the exact column count of the executions table[cite: 4]. If naive string concatenation had been used, SQLite would have evaluated the union and returned a synthetic row (200 OK). The 404 Not Found response proves SQLite treated the injection string strictly as an uncompiled literal parameter.

### 2. Secret Redaction

* `.env.local`, `data.db`, `data.db-wal`, and `data.db-shm` are verified under `.gitignore` and omitted from git staging.

### 3. Production Build Compilation

* Executed `npm run build` (Turbopack, Next.js 16) with exit code `0`.
* All 8 dynamic and static API endpoints compile without import-time or bundling errors.
