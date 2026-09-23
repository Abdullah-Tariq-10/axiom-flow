"use client";

import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Zap,
  Play,
  Save,
  FolderOpen,
  Download,
  Upload,
  Loader2,
  FileText,
  History,
  LayoutGrid,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkflowStore } from "@/lib/store";
import type { BranchFlowEdge, DecisionFlowNode } from "@/lib/types";
import { WorkflowInputDrawer } from "./WorkflowInputDrawer";
import { HistoryDrawer } from "./HistoryDrawer";

interface SavedWorkflow {
  id: string;
  name: string;
}

export function Toolbar() {
  const {
    workflowId,
    workflowName,
    workflowInput,
    nodes,
    edges,
    executionStatus,
    addNode,
    addActionNode,
    applyAutoLayout,
    setWorkflowName,
    loadGraph,
    startExecution,
    resetExecutionVisuals,
  } = useWorkflowStore();

  const [saved, setSaved] = useState<SavedWorkflow[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [showInputDrawer, setShowInputDrawer] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshSaved = async () => {
    try {
      const res = await fetch("/api/workflows");
      if (res.ok) {
        const data = await res.json();
        setSaved(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore transient fetch errors on mount
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    refreshSaved();
  }, []);

  const handleRun = async () => {
    setRunError(null);
    resetExecutionVisuals();
    setBusy(true);
    try {
      const res = await fetch("/api/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId, nodes, edges, initialInput: workflowInput }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRunError(json.error ?? "Failed to start execution");
        return;
      }
      startExecution(json.executionId);
    } catch {
      setRunError("Failed to trigger execution");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setRunError(null);
    try {
      const url = workflowId ? `/api/workflows/${workflowId}` : "/api/workflows";
      const method = workflowId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workflowName || "Untitled workflow", nodes, edges }),
      });
      if (!res.ok) {
        setRunError("Database failed to save workflow");
        return;
      }
      const row = await res.json();
      loadGraph(row.id, row.name, nodes, edges);
      await refreshSaved();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch {
      setRunError("Network error saving workflow");
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/workflows/${id}`);
    if (!res.ok) return;
    const row = await res.json();
    loadGraph(row.id, row.name, row.graph.nodes, row.graph.edges);
    resetExecutionVisuals();
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ name: workflowName, nodes, edges }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(workflowName || "workflow").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as {
        name?: string;
        nodes: DecisionFlowNode[];
        edges: BranchFlowEdge[];
      };
      loadGraph(null, parsed.name ?? "Imported workflow", parsed.nodes, parsed.edges);
      resetExecutionVisuals();
    } catch {
      setRunError("Invalid workflow JSON file.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <input
          value={workflowName ?? ""}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          placeholder="Workflow name"
        />

        <Button size="sm" variant="outline" onClick={addNode}>
          <Plus /> Node
        </Button>
        <Button size="sm" variant="outline" onClick={addActionNode}>
          <Zap /> Action
        </Button>
        <Button size="sm" variant="outline" onClick={applyAutoLayout}>
          <LayoutGrid /> Auto-layout
        </Button>

        <Button
          size="sm"
          variant={workflowInput ? "default" : "outline"}
          onClick={() => setShowInputDrawer(true)}
        >
          <FileText /> Input{workflowInput ? " ✓" : ""}
        </Button>

        <Button size="sm" onClick={handleRun} disabled={busy || executionStatus === "running"}>
          {executionStatus === "running" ? <Loader2 className="animate-spin" /> : <Play />}
          Run
        </Button>

        <Button
          size="sm"
          variant={justSaved ? "default" : "outline"}
          onClick={handleSave}
          disabled={busy}
          className={justSaved ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
        >
          {justSaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {justSaved ? "Saved!" : "Save"}
        </Button>

        <div className="flex items-center gap-1">
          <FolderOpen className="h-4 w-4 text-slate-500" />
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={workflowId ?? ""}
            onChange={(e) => handleLoad(e.target.value)}
          >
            <option value="" disabled>
              Load saved…
            </option>
            {saved.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <Button size="sm" variant="ghost" onClick={handleExport}>
          <Download /> Export
        </Button>

        <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
          <Upload /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
        />

        <Button size="sm" variant="ghost" onClick={() => setShowHistoryDrawer(true)}>
          <History /> History
        </Button>

        {runError && <span className="text-xs font-medium text-red-600">{runError}</span>}
      </div>

      {showInputDrawer && <WorkflowInputDrawer onClose={() => setShowInputDrawer(false)} />}
      {showHistoryDrawer && <HistoryDrawer onClose={() => setShowHistoryDrawer(false)} />}
    </>
  );
}