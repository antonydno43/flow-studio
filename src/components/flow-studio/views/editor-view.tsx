"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  MarkerType, type Connection, type Edge, type NodeChangeset, type EdgeChangeset,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFlowStore, type ValidationResult } from "../store";
import { api, errMsg } from "../lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { NodePalette } from "../editor/node-palette";
import { ConfigPanel } from "../editor/config-panel";
import { FlowNode, type FlowNodeData, type FlowNodeType } from "../editor/flow-node";
import { ExecutionPanel } from "../editor/execution-panel";
import { ValidationDialog } from "../editor/validation-dialog";
import { VersionHistoryDialog } from "../editor/version-dialog";
import {
  Play, Save, Redo2, Undo2, ZoomIn, ZoomOut, Maximize, Power, MoreHorizontal,
  CheckCircle2, Loader2, CircleAlert, LoaderCircle, History, FileDown, FlaskConical,
  PanelBottom, PanelBottomClose,
} from "lucide-react";
import type { GraphEdge, GraphNode, WorkflowGraph } from "@/core/types";

const nodeTypes = { flow: FlowNode };

export function EditorView() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

interface EditorWorkflow {
  id: string;
  name: string;
  status: string;
  currentDraftVersionId: string | null;
  publishedVersionId: string | null;
}

function EditorInner() {
  const { activeWorkflowId, navigate, catalog, catalogLoading, bumpWorkflows, bumpExecutions } = useFlowStore();
  const { toast } = useToast();
  const rf = useReactFlow();

  const [workflow, setWorkflow] = useState<EditorWorkflow | null>(null);
  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNodeType>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [executionOutputs, setExecutionOutputs] = useState<{
    statusMap: Record<string, string>;
    nodeOutputs: Record<string, unknown>;
    nodeNames: Record<string, string>;
    triggerData: unknown;
  }>({ statusMap: {}, nodeOutputs: {}, nodeNames: {}, triggerData: null });

  // history (undo/redo)
  const history = useRef<{ graph: WorkflowGraph; label: string }[]>([]);
  const historyIndex = useRef(-1);
  const skipHistory = useRef(false);
  const suppressAutosave = useRef(false);

  const nodeMap = useMemo(() => new Map(catalog.map((c) => [c.type, c])), [catalog]);

  const unknownDef = (type: string) => ({
    type, version: 0, name: "Unknown node", description: `Unknown type ${type}`,
    category: "Unknown", icon: "Box", kind: "action" as const, inputs: 1,
    outputs: [{ id: "out", label: "Output" }], configSchema: [], defaultConfig: {},
  });

  const loadGraph = (graph: WorkflowGraph) => {
    skipHistory.current = true;
    const rfNodes: FlowNodeType[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "flow" as const,
      position: n.position,
      data: {
        label: n.name,
        nodeType: n.type,
        def: nodeMap.get(n.type) ?? unknownDef(n.type),
        config: n.config ?? {},
      } satisfies FlowNodeData,
    }));
    const rfEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourcePort,
      targetHandle: "in",
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    history.current = [{ graph, label: "loaded" }];
    historyIndex.current = 0;
    setTimeout(() => { skipHistory.current = false; }, 50);
  };

  // ------------------------------------------------------------------ load
  useEffect(() => {
    if (!activeWorkflowId) return;
    let alive = true;
    (async () => {
      const res = await api<{ workflow: EditorWorkflow }>(`/api/workflows/${activeWorkflowId}`);
      if (!alive || !res.ok) {
        toast({ title: "Could not load workflow", description: errMsg(res), variant: "destructive" });
        navigate("workflows");
        return;
      }
      setWorkflow(res.data.workflow);
      setName(res.data.workflow.name);
      // load the draft (or published) graph
      const graphRes = await api<{ graph: WorkflowGraph }>(`/api/workflows/${activeWorkflowId}/graph`);
      if (graphRes.ok && alive) {
        loadGraph(graphRes.data.graph);
      } else if (alive) {
        loadGraph({ nodes: [], edges: [] });
      }
      setSaveState("saved");
    })();
    return () => { alive = false; };
  }, [activeWorkflowId]);

  // graph snapshot helpers
  const toGraph = useCallback((): WorkflowGraph => {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        name: n.data.label,
        position: n.position,
        config: n.data.config ?? {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourcePort: e.sourceHandle || "out",
        target: e.target,
      })),
    };
  }, [nodes, edges]);

  const pushHistory = useCallback((label: string) => {
    if (skipHistory.current) return;
    const graph = toGraph();
    history.current = history.current.slice(0, historyIndex.current + 1);
    history.current.push({ graph, label });
    if (history.current.length > 60) history.current.shift();
    historyIndex.current = history.current.length - 1;
  }, [toGraph]);

  const restoreHistory = (index: number) => {
    const entry = history.current[index];
    if (!entry) return;
    historyIndex.current = index;
    suppressAutosave.current = true;
    loadGraph(entry.graph);
    setSaveState("dirty");
    setTimeout(() => { suppressAutosave.current = false; }, 60);
  };

  // ------------------------------------------------------------------ changes
  const onNodesChange = useCallback((changes: NodeChangeset<FlowNodeType>) => {
    const arr = changes.toArray();
    const structural = arr.some((c) => c.type === "remove" || c.type === "add");
    onNodesChangeBase(changes);
    if (structural) {
      pushHistory("nodes");
      setSaveState("dirty");
    } else if (arr.some((c) => c.type === "position" && c.dragging === false)) {
      pushHistory("move");
      setSaveState("dirty");
    }
  }, [onNodesChangeBase, pushHistory]);

  const onEdgesChange = useCallback((changes: EdgeChangeset<Edge>) => {
    const removed = changes.getByType("remove").length > 0;
    onEdgesChangeBase(changes);
    if (removed) {
      pushHistory("edge-removed");
      setSaveState("dirty");
    }
  }, [onEdgesChangeBase, pushHistory]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source === connection.target) return;
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const sourceDef = sourceNode?.data.def;
    const port = connection.sourceHandle || sourceDef?.outputs[0]?.id || "out";
    // prevent duplicate connections
    const dup = edges.some((e) => e.source === connection.source && e.target === connection.target && e.sourceHandle === port);
    if (dup) return;
    setEdges((eds) => addEdge({
      ...connection,
      id: `e_${Math.random().toString(36).slice(2, 10)}`,
      sourceHandle: port,
      targetHandle: "in",
      markerEnd: { type: MarkerType.ArrowClosed },
      label: sourceDef && sourceDef.outputs.length > 1
        ? sourceDef.outputs.find((o) => o.id === port)?.label
        : undefined,
      labelShowBg: false,
      labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
    }, eds));
    setTimeout(() => { pushHistory("connect"); setSaveState("dirty"); }, 0);
  }, [edges, nodes, setEdges, pushHistory]);

  const addNode = useCallback((type: string, position?: { x: number; y: number }) => {
    const def = nodeMap.get(type);
    if (!def) return;
    const pos = position ?? rf.screenToFlowPosition({
      x: window.innerWidth / 2 + (Math.random() * 120 - 60),
      y: window.innerHeight / 2 + (Math.random() * 120 - 60),
    });
    const newNode: FlowNodeType = {
      id: `n_${Math.random().toString(36).slice(2, 10)}`,
      type: "flow",
      position: pos,
      data: {
        label: def.name,
        nodeType: type,
        def,
        config: { ...def.defaultConfig },
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setTimeout(() => { pushHistory("add-node"); setSaveState("dirty"); }, 0);
  }, [nodeMap, rf, setNodes, pushHistory]);

  // ------------------------------------------------------------------ save
  const save = useCallback(async (silent = false): Promise<boolean> => {
    if (!workflow) return false;
    setSaveState("saving");
    const res = await api(`/api/workflows/${workflow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, graph: toGraph() }),
    });
    if (!res.ok) {
      setSaveState("error");
      if (!silent) toast({ title: "Save failed", description: errMsg(res), variant: "destructive" });
      return false;
    }
    setSaveState("saved");
    return true;
  }, [workflow, name, toGraph, toast]);

  // autosave (debounced)
  useEffect(() => {
    if (saveState !== "dirty" || suppressAutosave.current || !workflow) return;
    const t = setTimeout(() => { save(true); }, 1200);
    return () => clearTimeout(t);
  }, [saveState, nodes, edges, name, workflow, save]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) restoreHistory(Math.min(historyIndex.current + 1, history.current.length - 1));
        else restoreHistory(Math.max(historyIndex.current - 1, 0));
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        restoreHistory(Math.min(historyIndex.current + 1, history.current.length - 1));
      } else if (mod && e.key.toLowerCase() === "d" && selectedNodeId && !typing) {
        // duplicate selected node
        e.preventDefault();
        const src = nodes.find((n) => n.id === selectedNodeId);
        if (src) {
          const copy: FlowNodeType = {
            id: `n_${Math.random().toString(36).slice(2, 10)}`,
            type: "flow",
            position: { x: src.position.x + 60, y: src.position.y + 60 },
            data: { ...src.data, label: `${src.data.label} (copy)` },
          };
          setNodes((nds) => [...nds, copy]);
          setTimeout(() => { pushHistory("duplicate"); setSaveState("dirty"); }, 0);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, selectedNodeId, nodes, setNodes, pushHistory]);

  // ------------------------------------------------------------------ actions
  const validate = async (): Promise<ValidationResult | null> => {
    if (!workflow) return null;
    await save(true);
    const res = await api<{ validation: ValidationResult }>(`/api/workflows/${workflow.id}/validate`, { method: "POST" });
    if (!res.ok) {
      toast({ title: "Validation failed", description: errMsg(res), variant: "destructive" });
      return null;
    }
    setValidation(res.data.validation);
    return res.data.validation;
  };

  const runTest = async () => {
    if (!workflow) return;
    const v = await validate();
    if (v && !v.valid) {
      setValidationOpen(true);
      return;
    }
    setRunning(true);
    setActiveExecutionId(null);
    const res = await api<{ ran: boolean; executionId?: string; status?: string; validation?: ValidationResult }>(
      `/api/workflows/${workflow.id}/run`,
      { method: "POST", body: JSON.stringify({ mode: "test" }) }
    );
    if (!res.ok) {
      setRunning(false);
      toast({ title: "Run failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    if (!res.data.ran) {
      setValidation(res.data.validation ?? null);
      setValidationOpen(true);
      setRunning(false);
      return;
    }
    setActiveExecutionId(res.data.executionId ?? null);
    setPanelOpen(true);
    setRunning(false);
    bumpExecutions();
    toast({
      title: `Test run ${res.data.status}`,
      description: res.data.status === "succeeded" ? "Every step completed." : "Check the execution panel for details.",
      variant: res.data.status === "succeeded" ? undefined : "destructive",
    });
  };

  const activate = async () => {
    if (!workflow) return;
    const v = await validate();
    if (v && !v.valid) { setValidationOpen(true); return; }
    const res = await api<{ activated: boolean }>(`/api/workflows/${workflow.id}/publish`, { method: "POST" });
    if (!res.ok) {
      toast({ title: "Activation blocked", description: errMsg(res), variant: "destructive" });
      return;
    }
    if (!res.data.activated) {
      const v2 = await validate();
      setValidation(v2);
      setValidationOpen(true);
      return;
    }
    setWorkflow({ ...workflow, status: "active", publishedVersionId: "refreshed" });
    bumpWorkflows();
    toast({ title: "Workflow activated", description: "Triggers (webhook / schedule) are now live. Manual Run executes the published version." });
  };

  const deactivate = async () => {
    if (!workflow) return;
    const res = await api(`/api/workflows/${workflow.id}/deactivate`, { method: "POST" });
    if (res.ok) {
      setWorkflow({ ...workflow, status: "inactive" });
      bumpWorkflows();
      toast({ title: "Workflow deactivated" });
    }
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const validationByNode = useMemo(() => {
    const map = new Map<string, ValidationResult["errors"]>();
    for (const err of validation?.errors ?? []) {
      if (!err.nodeId) continue;
      if (!map.has(err.nodeId)) map.set(err.nodeId, []);
      map.get(err.nodeId)!.push(err);
    }
    return map;
  }, [validation]);

  // apply validation + execution statuses to nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          hasError: validationByNode.has(n.id),
        },
      }))
    );
  }, [validation, setNodes]);

  const graphToPersist = toGraph();
  void graphToPersist;
  void bumpWorkflows;

  const saveIcon =
    saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
    saveState === "saved" ? <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" /> :
    saveState === "error" ? <CircleAlert className="h-3.5 w-3.5 text-red-500" /> :
    <CircleAlert className="h-3.5 w-3.5 text-amber-500" />;

  const saveLabel =
    saveState === "saving" ? "Saving…" :
    saveState === "saved" ? "Saved" :
    saveState === "error" ? "Save failed" : "Unsaved changes";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="h-12 border-b bg-card flex items-center gap-2 px-3 shrink-0 overflow-x-auto">
        <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => navigate("workflows")}>
          ← Workflows
        </Button>
        <Input
          className="h-8 w-40 sm:w-56 font-medium"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaveState("dirty"); }}
          aria-label="Workflow name"
        />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          {saveIcon} {saveLabel}
        </div>
        {workflow?.status === "active" && <Badge className="shrink-0">Active</Badge>}

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Undo (Ctrl+Z)" onClick={() => restoreHistory(Math.max(historyIndex.current - 1, 0))}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Redo (Ctrl+Shift+Z)" onClick={() => restoreHistory(Math.min(historyIndex.current + 1, history.current.length - 1))}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Zoom out" onClick={() => rf.zoomOut()}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Zoom in" onClick={() => rf.zoomIn()}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Fit to screen" onClick={() => rf.fitView({ padding: 0.2, duration: 300 })}>
            <Maximize className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button variant="outline" size="sm" className="h-8" onClick={runTest} disabled={running}>
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Test run
          </Button>
          {workflow?.status === "active" ? (
            <Button variant="outline" size="sm" className="h-8" onClick={deactivate}>
              <Power className="h-3.5 w-3.5" /> Deactivate
            </Button>
          ) : (
            <Button size="sm" className="h-8" onClick={activate}>
              <Play className="h-3.5 w-3.5" /> Publish & activate
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-8 w-8" title="More actions"
            onClick={() => navigate("workflows")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Palette */}
        <div className="hidden md:flex w-60 border-r bg-card shrink-0">
          <NodePalette onAddNode={(t) => addNode(t)} />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const type = e.dataTransfer.getData("application/flow-node");
              if (!type) return;
              const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              addNode(type, pos);
            }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} className="opacity-70" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => {
                const kind = (n.data as FlowNodeData)?.def?.kind;
                return kind === "trigger" ? "#2563EB" : kind === "logic" ? "#14B8A6" : "#6757D9";
              }}
            />
          </ReactFlow>

          {catalogLoading && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading node catalog…
            </div>
          )}

          {/* Floating status chip */}
          {(validation?.errors.length ?? 0) > 0 && (
            <button
              className="absolute top-3 left-3 rounded-full bg-destructive text-white text-xs font-medium px-3 py-1.5 shadow-lg flex items-center gap-1.5"
              onClick={() => setValidationOpen(true)}
            >
              <CircleAlert className="h-3.5 w-3.5" />
              {validation!.errors.length} validation issue{validation!.errors.length > 1 ? "s" : ""}
            </button>
          )}

          {/* Validation quick button */}
          <div className="absolute top-3 right-3 flex gap-1.5">
            <Button variant="outline" size="sm" className="h-8 bg-card shadow-sm text-xs" onClick={async () => { await validate(); setValidationOpen(true); }}>
              <CircleAlert className="h-3.5 w-3.5" /> Validate
            </Button>
            <Button variant="outline" size="sm" className="h-8 bg-card shadow-sm text-xs" onClick={() => setVersionsOpen(true)}>
              <History className="h-3.5 w-3.5" /> Versions
            </Button>
            <Button variant="outline" size="sm" className="h-8 bg-card shadow-sm text-xs" onClick={() => window.open(`/api/workflows/${workflow?.id}/export`, "_blank")}>
              <FileDown className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
        </div>

        {/* Config panel */}
        <div className={cn(
          "hidden lg:flex w-80 border-l bg-card shrink-0",
          !selectedNode && "hidden"
        )}>
          {selectedNode && nodeMap.get(selectedNode.data.nodeType) && (
            <ConfigPanel
              node={{
                id: selectedNode.id,
                name: selectedNode.data.label,
                type: selectedNode.data.nodeType,
                config: selectedNode.data.config ?? {},
              }}
              def={nodeMap.get(selectedNode.data.nodeType)}
              validationIssues={validationByNode.get(selectedNode.id) ?? []}
              nodeOutputs={executionOutputs.nodeOutputs}
              nodeNames={executionOutputs.nodeNames}
              triggerData={executionOutputs.triggerData}
              onRename={(label) => {
                setNodes((nds) => nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, label } } : n));
                setSaveState("dirty");
              }}
              onChange={(key, value) => {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === selectedNode.id
                      ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
                      : n
                  )
                );
                setSaveState("dirty");
              }}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      </div>

      {/* Mobile config drawer */}
      {selectedNode && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 top-auto z-50 h-[60vh] border-t bg-card shadow-2xl">
          <ConfigPanel
            node={{
              id: selectedNode.id,
              name: selectedNode.data.label,
              type: selectedNode.data.nodeType,
              config: selectedNode.data.config ?? {},
            }}
            def={nodeMap.get(selectedNode.data.nodeType)}
            validationIssues={validationByNode.get(selectedNode.id) ?? []}
            nodeOutputs={executionOutputs.nodeOutputs}
            nodeNames={executionOutputs.nodeNames}
            triggerData={executionOutputs.triggerData}
            onRename={(label) => {
              setNodes((nds) => nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, label } } : n));
              setSaveState("dirty");
            }}
            onChange={(key, value) => {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === selectedNode.id
                    ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
                    : n
                )
              );
              setSaveState("dirty");
            }}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}

      {/* Execution bottom panel */}
      {panelOpen && (
        <ExecutionPanel
          executionId={activeExecutionId}
          onClose={() => setPanelOpen(false)}
          onExecutionData={(data) => {
            setExecutionOutputs(data);
            setNodes((nds) =>
              nds.map((n) => ({
                ...n,
                data: { ...n.data, status: data.statusMap[n.id] },
              }))
            );
          }}
        />
      )}
      {!panelOpen && activeExecutionId && (
        <Button
          variant="outline" size="sm"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 shadow-lg h-8 bg-card"
          onClick={() => setPanelOpen(true)}
        >
          <PanelBottom className="h-3.5 w-3.5" /> Show execution
        </Button>
      )}

      <ValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        validation={validation}
        onFocusNode={(nodeId) => {
          setSelectedNodeId(nodeId);
          rf.fitView({ nodes: [{ id: nodeId }], duration: 400, padding: 0.5 });
        }}
      />

      <VersionHistoryDialog
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        workflowId={workflow?.id ?? null}
        onRestored={() => {
          // reload graph after restore
          api<{ graph: WorkflowGraph }>(`/api/workflows/${workflow?.id}/graph`).then((res) => {
            if (res.ok) loadGraph(res.data.graph);
          });
        }}
      />
    </div>
  );
}
