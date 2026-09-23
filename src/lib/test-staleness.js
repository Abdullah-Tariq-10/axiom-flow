// test-staleness.js
const Database = require('better-sqlite3');
const db = new Database('data.db');

// Scenario A: Active job (started 10m ago, but has an active step 15s ago -> MUST STAY RUNNING)
db.prepare(`
  INSERT OR REPLACE INTO executions (id, workflow_id, status, created_at)
  VALUES ('test-active-long', '9b968dea-cc11-4f14-a66c-b29798fe808c', 'running', datetime('now', '-600 seconds'))
`).run();

db.prepare(`
  INSERT OR REPLACE INTO execution_steps (execution_id, node_id, node_label, order_index, prompt, status, attempt, started_at)
  VALUES ('test-active-long', 'start', 'Start', 1, 'prompt', 'running', 1, datetime('now', '-15 seconds'))
`).run();

// Scenario B: Dead worker orphan (started 10m ago, last step ended 300s ago -> MUST FLIP TO ERROR)
db.prepare(`
  INSERT OR REPLACE INTO executions (id, workflow_id, status, created_at)
  VALUES ('test-dead-orphan', '9b968dea-cc11-4f14-a66c-b29798fe808c', 'running', datetime('now', '-600 seconds'))
`).run();

db.prepare(`
  INSERT OR REPLACE INTO execution_steps (execution_id, node_id, node_label, order_index, prompt, status, attempt, started_at, finished_at)
  VALUES ('test-dead-orphan', 'start', 'Start', 1, 'prompt', 'done', 1, datetime('now', '-320 seconds'), datetime('now', '-300 seconds'))
`).run();

console.log('Seeded test records.');