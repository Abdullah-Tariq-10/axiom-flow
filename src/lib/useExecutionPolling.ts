"use client";

import { useEffect } from "react";
import { useWorkflowStore } from "./store";
import type { ExecutionDetail, NodeStatus } from "./types";

export function useExecutionPolling() {
  const executionId = useWorkflowStore((s) => s.executionId);
  const executionStatus = useWorkflowStore((s) => s.executionStatus);
  const edges = useWorkflowStore((s) => s.edges);
  const setNodeStatus = useWorkflowStore((s) => s.setNodeStatus);
  const setEdgeActive = useWorkflowStore((s) => s.setEdgeActive);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const applyExecutionSnapshot = useWorkflowStore((s) => s.applyExecutionSnapshot);

  useEffect(() => {
    if (!executionId || executionStatus !== "running") return;
    let cancelled = false;

    const poll = async () => {
      const res = await fetch(`/api/executions/${executionId}`);
      if (!res.ok || cancelled) return;
      const detail: ExecutionDetail = await res.json();

      for (const s of detail.steps) {
        let status: NodeStatus | null = null;
        if (s.status === "running") status = "running";
        else if (s.status === "error") status = "error";
        else if (s.node_type === "action") status = "done";
        else if (s.decision) status = s.decision === "YES" ? "yes" : "no";
        if (status) setNodeStatus(s.node_id, status);

        // Action nodes: surface the generated output directly on the node.
        if (s.node_type === "action" && s.status === "done" && s.response) {
          updateNodeData(s.node_id, { output: s.response });
        }

        // Decision nodes: highlight the branch edge that was taken.
        if (s.node_type === "decision" && s.decision) {
          const branch = s.decision === "YES" ? "yes" : "no";
          const edge = edges.find((e) => e.source === s.node_id && e.data?.branch === branch);
          if (edge) setEdgeActive(edge.id, true);
        }
      }

      applyExecutionSnapshot(detail.execution.status, detail.steps);
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, executionStatus]);
}