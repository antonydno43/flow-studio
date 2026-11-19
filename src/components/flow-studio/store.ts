"use client";

import { create } from "zustand";
import type { ConfigField, WorkflowGraph } from "@/core/types";

/** Client-safe node catalog entry (served by /api/nodes). */
export interface CatalogNode {
  type: string;
  version: number;
  name: string;
  description: string;
  category: string;
  icon: string;
  kind: "trigger" | "action" | "logic";
  inputs: number;
  outputs: { id: string; label: string; color?: string }[];
  configSchema: ConfigField[];
  defaultConfig: Record<string, unknown>;
  outputHint?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  workspaceId: string;
  workspaceName: string;
  planId: string;
}

export type ViewId =
  | "dashboard"
  | "workflows"
  | "editor"
  | "executions"
  | "execution-detail"
  | "connections"
  | "templates"
  | "settings";

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  code: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ExecutionStepDto {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  inputData: unknown;
  outputData: unknown;
  itemIndex: number | null;
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: { message?: string; details?: unknown } | null;
}

export interface ExecutionDto {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  triggerType: string;
  testMode: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  error: { message?: string } | null;
}

interface FlowStudioState {
  // session
  session: SessionUser | null;
  sessionLoading: boolean;
  setSession: (user: SessionUser | null) => void;
  setSessionLoading: (v: boolean) => void;

  // navigation
  view: ViewId;
  activeWorkflowId: string | null;
  activeExecutionId: string | null;
  navigate: (view: ViewId, params?: { workflowId?: string; executionId?: string }) => void;
  restoreFromHash: () => void;

  // node catalog (shared, fetched once)
  catalog: CatalogNode[];
  catalogLoading: boolean;
  setCatalog: (nodes: CatalogNode[]) => void;
  setCatalogLoading: (v: boolean) => void;

  // editor (kept at top level so the canvas keeps state while config panel remounts)
  editorGraph: WorkflowGraph | null;
  editorDirty: boolean;
  setEditorGraph: (graph: WorkflowGraph, dirty?: boolean) => void;
  markSaved: () => void;

  // refresh counters let views reload after actions
  refreshWorkflows: number;
  bumpWorkflows: () => void;
  refreshExecutions: number;
  bumpExecutions: () => void;
}

export const useFlowStore = create<FlowStudioState>((set) => ({
  session: null,
  sessionLoading: true,
  setSession: (user) => set({ session: user }),
  setSessionLoading: (v) => set({ sessionLoading: v }),

  view: "dashboard",
  activeWorkflowId: null,
  activeExecutionId: null,
  navigate: (view, params) =>
    set((s) => {
      const activeWorkflowId = params?.workflowId ?? (view === "editor" ? null : s.activeWorkflowId);
      const activeExecutionId = params?.executionId ?? (view === "execution-detail" ? null : s.activeExecutionId);
      // reflect navigation in the URL hash so refresh keeps context
      if (typeof window !== "undefined") {
        let hash = `#/${view}`;
        if (view === "editor" && activeWorkflowId) hash += `/${activeWorkflowId}`;
        if (view === "execution-detail" && activeExecutionId) hash += `/${activeExecutionId}`;
        if (window.location.hash !== hash) window.location.hash = hash;
      }
      return { view, activeWorkflowId, activeExecutionId };
    }),
  restoreFromHash: () => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#\/?/, "");
    const [seg, id] = hash.split("/");
    const views: ViewId[] = ["dashboard", "workflows", "editor", "executions", "execution-detail", "connections", "templates", "settings"];
    if (seg && views.includes(seg as ViewId)) {
      set((s) => ({
        view: seg as ViewId,
        activeWorkflowId: seg === "editor" ? (id ?? null) : s.activeWorkflowId,
        activeExecutionId: seg === "execution-detail" ? (id ?? null) : s.activeExecutionId,
      }));
    }
  },

  catalog: [],
  catalogLoading: true,
  setCatalog: (nodes) => set({ catalog: nodes, catalogLoading: false }),
  setCatalogLoading: (v) => set({ catalogLoading: v }),

  editorGraph: null,
  editorDirty: false,
  setEditorGraph: (graph, dirty = true) => set({ editorGraph: graph, editorDirty: dirty }),
  markSaved: () => set({ editorDirty: false }),

  refreshWorkflows: 0,
  bumpWorkflows: () => set((s) => ({ refreshWorkflows: s.refreshWorkflows + 1 })),
  refreshExecutions: 0,
  bumpExecutions: () => set((s) => ({ refreshExecutions: s.refreshExecutions + 1 })),
}));
