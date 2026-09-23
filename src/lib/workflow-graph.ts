import type { BranchFlowEdge, DecisionFlowNode } from "./types";

/** Finds the node explicitly marked as start, or falls back to the node with no incoming edges. */
export function findStartNode(
  nodes: DecisionFlowNode[],
  edges: BranchFlowEdge[]
): DecisionFlowNode | undefined {
  return (
    nodes.find((n) => n.data.isStart) ??
    nodes.find((n) => !edges.some((e) => e.target === n.id))
  );
}

/** Returns the first node missing a required prompt/instruction, or undefined if all are filled in. */
export function findMissingPromptNode(
  nodes: DecisionFlowNode[]
): DecisionFlowNode | undefined {
  return nodes.find((n) => {
    const text =
      n.type === "action"
        ? (n.data as { instruction?: string }).instruction
        : (n.data as { prompt?: string }).prompt;
    return !text?.trim();
  });
}