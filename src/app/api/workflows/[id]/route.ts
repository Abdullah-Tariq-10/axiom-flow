import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { DecisionFlowNode, BranchFlowEdge, WorkflowRow } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = db
      .prepare(`SELECT * FROM workflows WHERE id = ?`)
      .get(id) as WorkflowRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const graph = JSON.parse(row.graph_json) as {
      nodes: DecisionFlowNode[];
      edges: BranchFlowEdge[];
    };

    return NextResponse.json({ ...row, graph });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const name: string = body.name?.trim() || "Untitled workflow";
    const graph = {
      nodes: (body.nodes ?? []) as DecisionFlowNode[],
      edges: (body.edges ?? []) as BranchFlowEdge[],
    };

    db.prepare(
      `UPDATE workflows SET name = ?, graph_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(name, JSON.stringify(graph), id);

    const row = db
      .prepare(`SELECT * FROM workflows WHERE id = ?`)
      .get(id) as WorkflowRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete workflow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}