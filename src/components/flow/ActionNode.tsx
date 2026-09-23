"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Trash2, MessageSquare, Mail, AlertTriangle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/store";
import type { ActionLabel, ActionNodeData, NodeStatus } from "@/lib/types";

const borderByStatus: Record<NodeStatus, string> = {
  idle: "border-slate-300",
  running: "border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.25)]",
  yes: "border-blue-500",
  no: "border-blue-500",
  done: "border-blue-500",
  error: "border-red-500",
};

const actionIcon: Record<ActionLabel, React.ReactNode> = {
  slack: <MessageSquare className="h-3 w-3" />,
  email: <Mail className="h-3 w-3" />,
  escalate: <AlertTriangle className="h-3 w-3" />,
};

function ActionNodeImpl({ id, data, selected }: NodeProps<ActionNodeData>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);
  const status = data.status ?? "idle";

  return (
    <div
      className={cn(
        "w-64 rounded-lg border-2 border-dashed bg-indigo-50/40 p-3 shadow-md transition-shadow",
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
          placeholder="Action name"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={status === "idle" ? "idle" : status}>{status}</Badge>
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

      <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
        {actionIcon[data.actionLabel]}
        <select
          value={data.actionLabel}
          onChange={(e) => updateNodeData(id, { actionLabel: e.target.value as ActionLabel })}
          className="nodrag bg-transparent uppercase outline-none"
        >
          <option value="slack">Slack alert</option>
          <option value="email">Draft email</option>
          <option value="escalate">Escalate ticket</option>
        </select>
        <span className="ml-auto rounded bg-indigo-100 px-1 py-0.5 text-indigo-500">
          simulated — no real integration
        </span>
      </div>

      <Textarea
        value={data.instruction}
        onChange={(e) => updateNodeData(id, { instruction: e.target.value })}
        placeholder='e.g. "Draft a polite refund confirmation using: {{input}}"'
        rows={3}
        className="nodrag"
      />

      {data.output && (
        <p className="mt-2 max-h-20 overflow-y-auto rounded bg-white p-1.5 text-[10px] text-slate-600">
          {data.output}
        </p>
      )}

      <p className="mt-2 text-[10px] font-semibold text-slate-400">Terminal node — ends the run</p>
    </div>
  );
}

export const ActionNode = memo(ActionNodeImpl);