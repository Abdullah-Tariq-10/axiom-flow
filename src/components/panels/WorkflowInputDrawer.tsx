"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkflowStore } from "@/lib/store";

export function WorkflowInputDrawer({ onClose }: { onClose: () => void }) {
  const workflowInput = useWorkflowStore((s) => s.workflowInput);
  const setWorkflowInput = useWorkflowStore((s) => s.setWorkflowInput);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Workflow input</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Paste a customer email, ticket, or any document here. Reference it in
          any node&apos;s prompt/instruction with{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">{"{{input}}"}</code>
          — it gets substituted in at run time.
        </p>
        <Textarea
          value={workflowInput}
          onChange={(e) => setWorkflowInput(e.target.value)}
          rows={10}
          className="text-sm"
          placeholder="Paste the raw input this run should evaluate…"
        />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}