"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkflowStore } from "@/lib/store";
import type { ExecutionHistoryRow } from "@/lib/types";

function formatOutcome(row: ExecutionHistoryRow): string {
  if (row.status === "error") return row.error ?? "Error";
  if (row.last_action_label) return `${row.last_node_label} → ${row.last_action_label}`;
  if (row.last_decision) return `${row.last_node_label} → ${row.last_decision}`;
  return row.status;
}

export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const [rows, setRows] = useState<ExecutionHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = workflowId ? `/api/executions?workflowId=${workflowId}` : "/api/executions";
    fetch(url)
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, [workflowId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Execution history{workflowId ? "" : " (all workflows)"}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-slate-400">No runs yet for this workflow.</p>
        )}

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-white text-slate-400">
              <tr>
                <th className="py-1 pr-2 font-medium">When</th>
                <th className="py-1 pr-2 font-medium">Duration</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {new Date(row.created_at + "Z").toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.duration_seconds != null ? `${row.duration_seconds}s` : "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Badge
                      variant={
                        row.status === "completed"
                          ? "done"
                          : row.status === "error"
                          ? "error"
                          : "running"
                      }
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="py-1.5 text-slate-600">{formatOutcome(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}