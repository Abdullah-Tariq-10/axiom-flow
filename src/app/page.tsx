"use client";

import { ReactFlowProvider } from "reactflow";
import { FlowCanvas } from "@/components/flow/FlowCanvas";
import { Toolbar } from "@/components/panels/Toolbar";
import { LogsPanel } from "@/components/panels/LogsPanel";
import { useExecutionPolling } from "@/lib/useExecutionPolling";

function WorkflowBuilder() {
  useExecutionPolling();

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <FlowCanvas />
        </div>
        <LogsPanel />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilder />
    </ReactFlowProvider>
  );
}