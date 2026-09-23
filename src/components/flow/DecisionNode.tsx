"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Star, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/store";
import type { DecisionNodeData, NodeStatus } from "@/lib/types";

const borderByStatus: Record<NodeStatus, string> = {
  idle: "border-slate-300",
  running: "border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.25)]",
  yes: "border-emerald-500",
  no: "border-rose-500",
  done: "border-blue-500",
  error: "border-red-500",
};

function DecisionNodeImpl({ id, data, selected }: NodeProps<DecisionNodeData>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);
  const setStartNode = useWorkflowStore((s) => s.setStartNode);
  const status = data.status ?? "idle";

  return (
    <div
      className={cn(
        "w-64 rounded-lg border-2 bg-white p-3 shadow-md transition-shadow",
        borderByStatus[status],
        selected && "ring-2 ring-slate-400"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-slate-500" />

      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          value={data.label}
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
          className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold outline-none"
          placeholder="Node name"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={status === "idle" ? "idle" : status}>{status}</Badge>
          <button
            title={data.isStart ? "Start node" : "Set as start node"}
            onClick={() => setStartNode(id)}
            className={cn(
              "rounded p-1 hover:bg-slate-100",
              data.isStart ? "text-amber-500" : "text-slate-300"
            )}
          >
            <Star className="h-3.5 w-3.5" fill={data.isStart ? "currentColor" : "none"} />
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-red-600"
            onClick={() => deleteNode(id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Textarea
        value={data.prompt}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
        placeholder='e.g. "Is this a support request?"'
        rows={3}
        className="nodrag"
      />

      <div className="mt-2 flex justify-between text-[10px] font-semibold">
        <span className="text-emerald-600">YES ↓</span>
        <span className="text-rose-600">NO ↓</span>
      </div>

      <Handle
        id="yes"
        type="source"
        position={Position.Right}
        style={{ top: "38%", background: "#10b981" }}
        className="!h-3 !w-3"
      />
      <Handle
        id="no"
        type="source"
        position={Position.Right}
        style={{ top: "62%", background: "#f43f5e" }}
        className="!h-3 !w-3"
      />
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeImpl);