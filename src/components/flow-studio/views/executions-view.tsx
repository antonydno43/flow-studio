"use client";

import { useEffect, useState, useCallback } from "react";
import { useFlowStore } from "../store";
import { api } from "../lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, formatDate, formatDuration } from "./shared";
import { Search, Inbox, ChevronLeft, ChevronRight } from "lucide-react";

interface ExecutionRow {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  triggerType: string;
  testMode: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  error: { message?: string } | null;
}

const PAGE_SIZE = 20;

export function ExecutionsView() {
  const { navigate, refreshExecutions } = useFlowStore();
  const [rows, setRows] = useState<ExecutionRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("all");
  const [workflowId, setWorkflowId] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<{ workflows: { id: string; name: string }[] }>("/api/workflows").then((res) => {
      if (res.ok) setWorkflows(res.data.workflows.map((w) => ({ id: w.id, name: w.name })));
    });
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (status !== "all") params.set("status", status);
    if (workflowId !== "all") params.set("workflowId", workflowId);
    if (search.trim()) params.set("search", search.trim());
    if (from) params.set("from", from);
    const res = await api<{ executions: ExecutionRow[]; total: number }>(`/api/executions?${params}`);
    if (res.ok) {
      setRows(res.data.executions);
      setTotal(res.data.total);
    } else {
      setRows([]);
    }
  }, [page, status, workflowId, search, from]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, refreshExecutions]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1200px]">
      <div>
        <h1 className="text-xl font-semibold">Executions</h1>
        <p className="text-sm text-muted-foreground">
          Every run is recorded with per-node inputs, outputs and logs.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by execution id or workflow name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={workflowId} onValueChange={(v) => { setWorkflowId(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workflows</SelectItem>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-38"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0); }}
          aria-label="From date"
        />
      </div>

      {/* Status quick filters */}
      <div className="flex gap-1.5 flex-wrap">
        {["all", "succeeded", "failed", "running", "waiting", "cancelled"].map((s) => (
          <Button
            key={s} size="sm" variant={status === s ? "default" : "outline"}
            className="capitalize h-7 text-xs"
            onClick={() => { setStatus(s); setPage(0); }}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {rows === null ? (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <div className="font-medium">No executions found</div>
              <div className="text-sm text-muted-foreground mt-1">
                Run a workflow from the editor, or clear the filters.
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((row) => (
                <button
                  key={row.id}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 text-left transition-colors"
                  onClick={() => navigate("execution-detail", { executionId: row.id })}
                >
                  <StatusBadge status={row.status} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {row.workflowName}
                      {row.testMode && (
                        <span className="text-[9px] uppercase font-semibold text-amber-600 border border-amber-500/40 rounded px-1">test</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{row.id}</div>
                  </div>
                  <div className="hidden sm:block text-xs text-muted-foreground capitalize">{row.triggerType}</div>
                  <div className="hidden md:block text-xs text-muted-foreground">{formatDate(row.createdAt)}</div>
                  <div className="text-xs text-muted-foreground tabular-nums w-16 text-right">{formatDuration(row.durationMs)}</div>
                  {row.error?.message && (
                    <div className="hidden lg:block text-[11px] text-destructive truncate max-w-48" title={row.error.message}>
                      {row.error.message}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} execution{total === 1 ? "" : "s"}
          {pages > 1 && ` · page ${page + 1} of ${pages}`}
        </span>
        {pages > 1 && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

