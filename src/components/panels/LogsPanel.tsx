"use client";

import { useWorkflowStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function LogsPanel() {
  const { steps, executionStatus } = useWorkflowStore();

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold">Execution log</h2>
        <Badge
          variant={
            executionStatus === "running"
              ? "running"
              : executionStatus === "completed"
              ? "yes"
              : executionStatus === "error"
              ? "error"
              : "idle"
          }
        >
          {executionStatus}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {steps.length === 0 && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Run the workflow to see step-by-step decisions here.
          </p>
        )}

        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={cn(
                "rounded-md border bg-white p-2 text-xs shadow-sm",
                step.status === "error"
                  ? "border-red-300"
                  : step.decision === "YES"
                  ? "border-emerald-300"
                  : step.decision === "NO"
                  ? "border-rose-300"
                  : step.node_type === "action"
                  ? "border-indigo-300"
                  : "border-amber-300"
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">
                  {i + 1}. {step.node_label}
                </span>
                {step.decision && (
                  <Badge variant={step.decision === "YES" ? "yes" : "no"}>
                    {step.decision}
                  </Badge>
                )}
                {step.action_label && <Badge variant="done">{step.action_label}</Badge>}
                {step.status === "running" && <Badge variant="running">running</Badge>}
                {step.status === "error" && <Badge variant="error">error</Badge>}
              </div>
              <p className="text-slate-500">
                <span className="font-medium text-slate-700">
                  {step.node_type === "action" ? "Instruction: " : "Prompt: "}
                </span>
                {step.prompt}
              </p>
              {step.response && (
                <p className="mt-1 text-slate-500">
                  <span className="font-medium text-slate-700">
                    {step.node_type === "action" ? "Generated output: " : "Raw response: "}
                  </span>
                  {step.response}
                </p>
              )}
              {step.error && <p className="mt-1 text-red-600">{step.error}</p>}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}