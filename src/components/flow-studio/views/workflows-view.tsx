"use client";

import { useEffect, useState, useCallback } from "react";
import { useFlowStore } from "../store";
import { api, errMsg } from "../lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, formatDate } from "./shared";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, MoreVertical, Star, Copy, Trash2, Download, Upload, Archive,
  Power, PowerOff, Workflow as WorkflowIcon, FileJson, Loader2, Inbox, Rocket,
} from "lucide-react";
import type { ValidationResult } from "../store";

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  isFavorite: boolean;
  updatedAt: string;
  publishedVersionId: string | null;
  currentDraftVersionId: string | null;
  executionCount: number;
  lastExecution: { id: string; status: string; createdAt: string } | null;
}

export function WorkflowsView() {
  const { navigate, refreshWorkflows, bumpWorkflows } = useFlowStore();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<WorkflowRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importName, setImportName] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await api<{ workflows: WorkflowRow[] }>(`/api/workflows?${params}`);
    setWorkflows(res.ok ? res.data.workflows : []);
  }, [search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, refreshWorkflows]);

  const createWorkflow = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await api<{ workflow: { id: string } }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name: newName.trim() }),
    });
    setCreating(false);
    if (!res.ok) { toast({ title: "Could not create workflow", description: errMsg(res), variant: "destructive" }); return; }
    toast({ title: "Workflow created", description: "Open the editor to add nodes." });
    setNewName("");
    navigate("editor", { workflowId: res.data.workflow.id });
  };

  const action = async (wf: WorkflowRow, act: "duplicate" | "activate" | "deactivate" | "archive" | "delete" | "export" | "favorite") => {
    setBusyId(wf.id);
    if (act === "export") {
      window.open(`/api/workflows/${wf.id}/export`, "_blank");
      setBusyId(null);
      return;
    }
    if (act === "delete") {
      const res = await api(`/api/workflows/${wf.id}`, { method: "DELETE" });
      setBusyId(null);
      setDeleteTarget(null);
      if (!res.ok) { toast({ title: "Delete failed", description: errMsg(res), variant: "destructive" }); return; }
      toast({ title: `Deleted "${wf.name}"`, description: "Its execution history was removed with it." });
      load();
      return;
    }
    const res = act === "favorite"
      ? await api(`/api/workflows/${wf.id}`, { method: "PATCH", body: JSON.stringify({ isFavorite: !wf.isFavorite }) })
      : act === "duplicate"
        ? await api(`/api/workflows/${wf.id}/duplicate`, { method: "POST" })
        : act === "activate"
          ? await api<{ activated: boolean; validation: ValidationResult }>(`/api/workflows/${wf.id}/publish`, { method: "POST" })
          : await api(`/api/workflows/${wf.id}`, { method: "PATCH", body: JSON.stringify({ status: act === "deactivate" ? "inactive" : "archived" }) });
    setBusyId(null);
    if (!res.ok) {
      toast({ title: "Action failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    if (act === "activate" && res.ok) {
      const data = (res as { data: { activated?: boolean; validation?: ValidationResult } }).data;
      if (!data.activated) {
        toast({
          title: "Cannot activate yet",
          description: data.validation?.errors?.[0]?.message ?? "Fix validation errors first.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Workflow activated", description: "Triggers are live: webhooks and schedules now start executions." });
    } else if (act === "duplicate") {
      toast({ title: "Workflow duplicated" });
    } else if (act === "deactivate") {
      toast({ title: "Workflow deactivated" });
    } else if (act === "archive") {
      toast({ title: "Workflow archived" });
    }
    load();
    bumpWorkflows();
  };

  const doImport = async () => {
    setImportBusy(true);
    try {
      const payload = JSON.parse(importJson);
      const res = await api<{ workflow: { id: string }; validation: ValidationResult }>("/api/workflows/import", {
        method: "POST",
        body: JSON.stringify({ name: importName || "Imported workflow", payload }),
      });
      setImportBusy(false);
      if (!res.ok) {
        toast({ title: "Import failed", description: errMsg(res), variant: "destructive" });
        return;
      }
      toast({
        title: "Workflow imported",
        description: res.data.validation.valid
          ? "The workflow is valid. Review connections and credentials before running."
          : `Imported with ${res.data.validation.errors.length} issue(s) to fix.`,
      });
      setImportOpen(false);
      setImportJson("");
      setImportName("");
      navigate("editor", { workflowId: res.data.workflow.id });
    } catch (err) {
      setImportBusy(false);
      toast({ title: "Invalid JSON", description: (err as Error).message, variant: "destructive" });
    }
  };

  const favorites = workflows?.filter((w) => w.isFavorite) ?? [];
  const rest = workflows?.filter((w) => !w.isFavorite) ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">Create, activate, and manage your automations.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button onClick={() => document.getElementById("new-wf-focus")?.focus()}>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </div>
      </div>

      {/* Create bar */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row gap-2 p-4">
          <Input
            id="new-wf-focus"
            placeholder="Name your new workflow, e.g. Order notifications"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createWorkflow()}
            className="flex-1"
          />
          <Button onClick={createWorkflow} disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Create & open editor
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["all", "draft", "active", "inactive", "archived"].map((f) => (
            <Button
              key={f}
              size="sm"
              variant={statusFilter === f ? "default" : "outline"}
              className="capitalize"
              onClick={() => setStatusFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {workflows === null ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : workflows.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <WorkflowIcon className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <div className="font-medium">No workflows found</div>
            <div className="text-sm text-muted-foreground mt-1">
              {search || statusFilter !== "all" ? "Try clearing the filters." : "Create your first workflow above."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {favorites.length > 0 && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> Favorites
              </div>
              <WorkflowGrid workflows={favorites} onOpen={(id) => navigate("editor", { workflowId: id })} onAction={action} busyId={busyId} />
            </div>
          )}
          <div>
            {favorites.length > 0 && <div className="text-sm font-medium text-muted-foreground mb-2">All workflows</div>}
            <WorkflowGrid workflows={rest} onOpen={(id) => navigate("editor", { workflowId: id })} onAction={action} busyId={busyId} />
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the workflow, all of its versions, schedules,
              webhook endpoints, and its entire execution history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && action(deleteTarget, "delete")}>
              <Trash2 className="h-4 w-4" /> Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import workflow JSON</DialogTitle>
            <DialogDescription>
              Paste a workflow exported from {`Flow Studio`} (.flow.json). Node ids are regenerated and
              connection references are removed for security.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Workflow name (optional)"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            <textarea
              className="w-full h-48 rounded-md border bg-background px-3 py-2 text-xs font-mono resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder='{"format":"flow-studio-workflow","graph":{"nodes":[...],"edges":[...]}}'
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={doImport} disabled={importBusy || !importJson.trim()}>
              {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Validate & import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkflowGrid({
  workflows, onOpen, onAction, busyId,
}: {
  workflows: WorkflowRow[];
  onOpen: (id: string) => void;
  onAction: (wf: WorkflowRow, act: "duplicate" | "activate" | "deactivate" | "archive" | "delete" | "export" | "favorite") => void;
  busyId: string | null;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {workflows.map((wf) => (
        <Card key={wf.id} className="group hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <button className="min-w-0 text-left flex-1" onClick={() => onOpen(wf.id)}>
                <div className="font-medium truncate group-hover:text-primary transition-colors">{wf.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {wf.description || "No description"}
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={busyId === wf.id}>
                    {busyId === wf.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => onAction(wf, "favorite")}>
                    <Star className="h-4 w-4" /> {wf.isFavorite ? "Remove favorite" : "Add to favorites"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction(wf, "duplicate")}>
                    <Copy className="h-4 w-4" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onAction(wf, "export")}>
                    <Download className="h-4 w-4" /> Export JSON
                  </DropdownMenuItem>
                  {wf.status === "active" ? (
                    <DropdownMenuItem onClick={() => onAction(wf, "deactivate")}>
                      <PowerOff className="h-4 w-4" /> Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onAction(wf, "activate")}>
                      <Power className="h-4 w-4" /> Publish & activate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {wf.status !== "archived" && (
                    <DropdownMenuItem onClick={() => onAction(wf, "archive")}>
                      <Archive className="h-4 w-4" /> Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="text-destructive" onClick={() => onAction(wf, "delete")}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <StatusBadge status={wf.status} small />
              {wf.publishedVersionId && wf.currentDraftVersionId && wf.publishedVersionId !== wf.currentDraftVersionId && (
                <Badge variant="outline" className="text-[10px]">unsaved draft differs</Badge>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {wf.executionCount} run{wf.executionCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
              <span>Edited {formatDate(wf.updatedAt, false)}</span>
              {wf.lastExecution ? (
                <span className="flex items-center gap-1">
                  last: <StatusBadge status={wf.lastExecution.status} small />
                </span>
              ) : (
                <span className="flex items-center gap-1"><Inbox className="h-3 w-3" /> never run</span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
