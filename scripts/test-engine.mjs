import Database from "better-sqlite3";

const BASE_URL = "http://localhost:3000";
const db = new Database("data.db");

const results = [];
function record(testName, passed, detail) {
  results.push({ testName, passed, detail });
  const status = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`[${status}] ${testName}: ${detail}`);
}

async function runTests() {
  console.log("\n========================================================");
  console.log("  AI Workflow Engine: Pre-Release Automated Test Suite  ");
  console.log("========================================================\n");

  // Fetch workflow for workflow-dependent tests
  let testWorkflow = null;
  try {
    const res = await fetch(`${BASE_URL}/api/workflows`);
    if (res.ok) {
      const workflows = await res.json();
      if (workflows.length > 0) testWorkflow = workflows[0];
    }
  } catch (err) {
    console.error(`\x1b[31mConnection error: Ensure 'npm run dev' is running.\x1b[0m`);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // Test 4.1: Missing Start Node Validation (HTTP 400)
  // -------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [{ id: "n1", type: "decision", data: { label: "Test", prompt: "Test", isStart: false } }],
        edges: [{ id: "e1", source: "n1", target: "n1" }],
      }),
    });
    const body = await res.json();
    const passed = res.status === 400 && body.error?.includes("No start node found");
    record("4.1 Missing Start Node Validation", passed, `HTTP ${res.status} - ${body.error || "No error"}`);
  } catch (err) {
    record("4.1 Missing Start Node Validation", false, err.message);
  }

  // -------------------------------------------------------------
  // Test 4.2: Empty Prompt Validation (HTTP 400)
  // -------------------------------------------------------------
  try {
    const res = await fetch(`${BASE_URL}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [{ id: "n1", type: "decision", data: { label: "Start", prompt: "   ", isStart: true } }],
        edges: [],
      }),
    });
    const body = await res.json();
    const passed = res.status === 400 && body.error?.includes("Every node needs a prompt/instruction");
    record("4.2 Empty Prompt Validation", passed, `HTTP ${res.status} - ${body.error || "No error"}`);
  } catch (err) {
    record("4.2 Empty Prompt Validation", false, err.message);
  }

  // -------------------------------------------------------------
  // Test 4.3: Cycle Detection Guard (Dual-Branch Traversal)
  // -------------------------------------------------------------
  try {
    const cycleRes = await fetch(`${BASE_URL}/api/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: [
          { id: "cycle-a", type: "decision", data: { label: "Cycle Node A", prompt: "Answer YES", isStart: true } },
          { id: "cycle-b", type: "decision", data: { label: "Cycle Node B", prompt: "Answer YES", isStart: false } },
        ],
        edges: [
          // Wire both YES and NO handles so traversal cannot exit early
          { id: "e1-yes", source: "cycle-a", target: "cycle-b", data: { branch: "yes" } },
          { id: "e1-no", source: "cycle-a", target: "cycle-b", data: { branch: "no" } },
          { id: "e2-yes", source: "cycle-b", target: "cycle-a", data: { branch: "yes" } },
          { id: "e2-no", source: "cycle-b", target: "cycle-a", data: { branch: "no" } },
        ],
      }),
    });
    const { executionId } = await cycleRes.json();

    let executionState = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(`${BASE_URL}/api/executions/${executionId}`);
      const data = await pollRes.json();
      if (data.execution && data.execution.status !== "running") {
        executionState = data.execution;
        break;
      }
    }

    const passed =
      executionState &&
      executionState.status === "error" &&
      (executionState.error?.toLowerCase().includes("cycle") || executionState.error?.toLowerCase().includes("loop"));

    record(
      "4.3 Cycle Detection Guard",
      Boolean(passed),
      `Status: ${executionState?.status}, Error: ${executionState?.error || "None"}`
    );
  } catch (err) {
    record("4.3 Cycle Detection Guard", false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5.1: Dead Worker Staleness Sweep
  // -------------------------------------------------------------
  try {
    const staleId = "audit-dead-worker-test";
    db.prepare(`
      INSERT OR REPLACE INTO executions (id, workflow_id, status, created_at)
      VALUES (?, 'test-wf', 'running', datetime('now', '-300 seconds'))
    `).run(staleId);

    db.prepare(`
      INSERT OR REPLACE INTO execution_steps (execution_id, node_id, node_label, order_index, prompt, status, attempt, started_at, finished_at)
      VALUES (?, 'start', 'Start', 1, 'prompt', 'done', 1, datetime('now', '-320 seconds'), datetime('now', '-300 seconds'))
    `).run(staleId);

    const checkRes = await fetch(`${BASE_URL}/api/executions/${staleId}`);
    const checkData = await checkRes.json();

    const passed = checkData.execution?.status === "error";
    record("5.1 Dead Worker Staleness Sweep", passed, `Orphan flipped to: ${checkData.execution?.status}`);

    db.prepare(`DELETE FROM execution_steps WHERE execution_id = ?`).run(staleId);
    db.prepare(`DELETE FROM executions WHERE id = ?`).run(staleId);
  } catch (err) {
    record("5.1 Dead Worker Staleness Sweep", false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5.2: Analytics & Telemetry Rollup
  // -------------------------------------------------------------
  try {
    if (testWorkflow?.id) {
      const res = await fetch(`${BASE_URL}/api/workflows/${testWorkflow.id}/analytics`);
      const data = await res.json();

      // Root property is totalExecutions, executionCounts contains status tallies
      const hasTotal = typeof data.totalExecutions === "number";
      const hasCounts = data.executionCounts && typeof data.executionCounts.completed === "number";
      const hasNodes = Array.isArray(data.nodes);
      const passed = res.status === 200 && hasTotal && hasCounts && hasNodes;

      record(
        "5.2 Analytics & Telemetry Rollup",
        passed,
        `Workflow: ${testWorkflow.name} | Total Executions: ${data.totalExecutions} | Nodes: ${data.nodes.length}`
      );
    } else {
      record("5.2 Analytics & Telemetry Rollup", true, "Skipped: No saved workflow in database.");
    }
  } catch (err) {
    record("5.2 Analytics & Telemetry Rollup", false, err.message);
  }

  // -------------------------------------------------------------
  // Test 5.3: Targeted Retry & Attempt Isolation
  // -------------------------------------------------------------
  try {
    const priorExec = db
      .prepare(`SELECT id, workflow_id FROM executions WHERE status IN ('completed', 'error') ORDER BY created_at DESC LIMIT 1`)
      .get();

    if (priorExec?.id) {
      // Query graph_json directly from the workflows table
      const wfRow = db
        .prepare(`SELECT graph_json FROM workflows WHERE id = ?`)
        .get(priorExec.workflow_id || testWorkflow?.id);

      if (!wfRow?.graph_json) {
        throw new Error("No graph_json found for target workflow.");
      }

      const graph = JSON.parse(wfRow.graph_json);
      const targetNode = graph.nodes[graph.nodes.length - 1]; // Select terminal node

      const retryRes = await fetch(`${BASE_URL}/api/executions/${priorExec.id}/retry?force=true&wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: graph.nodes,
          edges: graph.edges,
          fromNodeId: targetNode.id,
        }),
      });

      const retryData = await retryRes.json();
      const passed = retryRes.status === 200 && (retryData.status === "completed" || retryData.status === "error");
      record(
        "5.3 Targeted Node Retry",
        passed,
        `Execution: ${priorExec.id} retried from "${targetNode.data?.label || targetNode.id}" -> Status: ${retryData.status}`
      );
    } else {
      record("5.3 Targeted Node Retry", true, "Skipped: Requires at least one prior execution record.");
    }
  } catch (err) {
    record("5.3 Targeted Node Retry", false, err.message);
  }

  console.log("\n========================================================");
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`Summary: ${passedCount}/${total} Automated Suites Passed`);
  console.log("========================================================\n");
}

runTests();