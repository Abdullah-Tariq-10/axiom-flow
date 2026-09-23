import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "reactflow";
import { create } from "zustand";
import { computeAutoLayout } from "./layout";
import { nanoid } from "./nanoid";
import type {
  AnyNodeData,
  BranchFlowEdge,
  DecisionFlowNode,
  ExecutionStepRow,
  NodeStatus,
} from "./types";

const initialNodes: DecisionFlowNode[] = [
  {
    id: "start",
    type: "decision",
    position: { x: 250, y: 80 },
    data: {
      kind: "decision",
      label: "Start",
      prompt: "Is this a support request?",
      isStart: true,
      status: "idle",
    },
  },
];

interface WorkflowState {
  workflowId: string | null;
  workflowName: string;
  workflowInput: string;
  nodes: DecisionFlowNode[];
  edges: BranchFlowEdge[];

  executionId: string | null;
  executionStatus: "idle" | "running" | "completed" | "error";
  steps: ExecutionStepRow[];

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: () => void;
  addActionNode: () => void;
  updateNodeData: (id: string, patch: Partial<AnyNodeData>) => void;
  deleteNode: (id: string) => void;
  setStartNode: (id: string) => void;
  applyAutoLayout: () => void;

  setNodeStatus: (id: string, status: NodeStatus) => void;
  setEdgeActive: (id: string, active: boolean) => void;
  resetExecutionVisuals: () => void;

  setWorkflowName: (name: string) => void;
  setWorkflowInput: (input: string) => void;
  loadGraph: (
    workflowId: string | null,
    name: string,
    nodes: DecisionFlowNode[],
    edges: BranchFlowEdge[]
  ) => void;

  startExecution: (executionId: string) => void;
  applyExecutionSnapshot: (
    status: "running" | "completed" | "error",
    steps: ExecutionStepRow[]
  ) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflowId: null,
  workflowName: "Untitled workflow",
  workflowInput: "",
  nodes: initialNodes,
  edges: [],

  executionId: null,
  executionStatus: "idle",
  steps: [],

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) as DecisionFlowNode[] }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) as BranchFlowEdge[] }),

  onConnect: (connection) => {
    // Action nodes are terminal (no source handles), so a connection can
    // only originate from a decision node's "yes"/"no" handle.
    const branch = connection.sourceHandle === "no" ? "no" : "yes";
    const edge: BranchFlowEdge = {
      ...connection,
      id: nanoid(),
      source: connection.source!,
      target: connection.target!,
      type: "branch",
      data: { branch },
    };
    // Only one outgoing edge per branch per node — replace if one exists.
    const filtered = get().edges.filter(
      (e) => !(e.source === connection.source && e.data?.branch === branch)
    );
    set({ edges: addEdge(edge, filtered) as BranchFlowEdge[] });
  },

  addNode: () => {
    const id = nanoid();
    const node: DecisionFlowNode = {
      id,
      type: "decision",
      position: {
        x: 120 + Math.random() * 400,
        y: 200 + Math.random() * 300,
      },
      data: { kind: "decision", label: "New node", prompt: "", status: "idle" },
    };
    set({ nodes: [...get().nodes, node] });
  },

  addActionNode: () => {
    const id = nanoid();
    const node: DecisionFlowNode = {
      id,
      type: "action",
      position: {
        x: 120 + Math.random() * 400,
        y: 200 + Math.random() * 300,
      },
      data: {
        kind: "action",
        label: "New action",
        instruction: "",
        actionLabel: "email",
        status: "idle",
      },
    };
    set({ nodes: [...get().nodes, node] });
  },

  updateNodeData: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ) as DecisionFlowNode[],
    }),

  deleteNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
    }),

  setStartNode: (id) =>
    set({
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, isStart: n.id === id },
      })),
    }),

  applyAutoLayout: () => set({ nodes: computeAutoLayout(get().nodes, get().edges) }),

  setNodeStatus: (id, status) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, status } } : n
      ),
    }),

  setEdgeActive: (id, active) =>
    set({
      edges: get().edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data!, active } } : e
      ),
    }),

  resetExecutionVisuals: () =>
    set({
      nodes: get().nodes.map((n) => ({ ...n, data: { ...n.data, status: "idle" } })),
      edges: get().edges.map((e) => ({ ...e, data: { ...e.data!, active: false } })),
      steps: [],
      executionStatus: "idle",
      executionId: null,
    }),

  setWorkflowName: (name) => set({ workflowName: name }),
  setWorkflowInput: (input) => set({ workflowInput: input }),

  loadGraph: (workflowId, name, nodes, edges) =>
  set({
    workflowId,
    workflowName: name || "Untitled workflow",
    nodes,
    edges,
  }),

  startExecution: (executionId) =>
    set({ executionId, executionStatus: "running", steps: [] }),

  applyExecutionSnapshot: (status, steps) => set({ executionStatus: status, steps }),
}));