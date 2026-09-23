import Database from "better-sqlite3";
import path from "path";

declare global {
  var __workflowDb: Database.Database | undefined;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  typeDef: string
) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) {
      throw err;
    }
  }
}

function createConnection() {
  const dbPath = path.join(process.cwd(), "data.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      graph_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_label TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT,
      decision TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_steps_execution
      ON execution_steps (execution_id, order_index);
  `);

  // Additive migrations
  ensureColumn(db, "executions", "initial_input", "TEXT");
  ensureColumn(db, "executions", "last_dispatched_at", "TEXT");
  ensureColumn(db, "execution_steps", "node_type", "TEXT NOT NULL DEFAULT 'decision'");
  ensureColumn(db, "execution_steps", "action_label", "TEXT");
  ensureColumn(db, "execution_steps", "attempt", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "execution_steps", "started_at_ms", "INTEGER");
  ensureColumn(db, "execution_steps", "finished_at_ms", "INTEGER");
  ensureColumn(db, "execution_steps", "prompt_tokens", "INTEGER");
  ensureColumn(db, "execution_steps", "completion_tokens", "INTEGER");
  ensureColumn(db, "execution_steps", "total_tokens", "INTEGER");
  

  // Idempotent attempt unique constraint
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_execution_node_attempt
      ON execution_steps (execution_id, node_id, attempt);
  `);

  // Telemetry index for analytics queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_steps_node_analytics
      ON execution_steps (node_id, status, started_at_ms, finished_at_ms);
  `);

  return db;
}

export const db = globalThis.__workflowDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalThis.__workflowDb = db;