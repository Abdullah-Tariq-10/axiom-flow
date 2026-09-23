"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow";
import type { BranchEdgeData } from "@/lib/types";

export function BranchEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<BranchEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isYes = data?.branch !== "no";
  const color = isYes ? "#10b981" : "#f43f5e";

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: data?.active ? 3 : 1.5,
          filter: data?.active ? `drop-shadow(0 0 4px ${color})` : undefined,
          strokeDasharray: data?.active ? 6 : undefined,
          animation: data?.active ? "dash-flow 0.6s linear infinite" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: color,
          }}
          className="nodrag nopan rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
        >
          {isYes ? "Yes" : "No"}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}