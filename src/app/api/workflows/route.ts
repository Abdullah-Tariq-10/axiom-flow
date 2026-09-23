import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nanoid } from "@/lib/nanoid";
import type { DecisionFlowNode, BranchFlowEdge, WorkflowRow } from "@/lib/types";

export async function GET() {
  try {
    const rows = db
      .prepare(
        `SELECT id, name, created_at, updated_at FROM workflows ORDER BY updated_at DESC`
      )
      .all();
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch workflows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name: string = body.name?.trim() || "Untitled workflow";
    const graph = {
      nodes: (body.nodes ?? []) as DecisionFlowNode[],
      edges: (body.edges ?? []) as BranchFlowEdge[],
    };

    const id = nanoid();
    db.prepare(
      `INSERT INTO workflows (id, name, graph_json) VALUES (?, ?, ?)`
    ).run(id, name, JSON.stringify(graph));

    const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as WorkflowRow;
    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}