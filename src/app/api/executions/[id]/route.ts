import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reconcileStaleExecutions } from "@/lib/executionRuntime";
import type { ExecutionDetail, ExecutionRow, ExecutionStepRow } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sweep stale executions so UI polling detects dead workers automatically
  reconcileStaleExecutions();

  const execution = db
    .prepare(`SELECT * FROM executions WHERE id = ?`)
    .get(id) as ExecutionRow | undefined;

  if (!execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 });
  }

  const steps = db
    .prepare(
      `SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY order_index ASC`
    )
    .all(id) as ExecutionStepRow[];

  const detail: ExecutionDetail = { execution, steps };
  return NextResponse.json(detail);
}