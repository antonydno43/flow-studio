"use client";

import { useEffect, useState, useRef } from "react";
import { useFlowStore } from "../store";
import { api } from "../lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, JsonView, formatDuration, formatDate, CopyButton } from "./shared";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Ban, RotateCcw, Play, Timer, Clock, Activity, AlertTriangle,
} from "lucide-react";

interface ExecutionDetail {
  execution: {
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
    triggerData?: unknown;
  };
  steps: {
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
  }[];
  events: { id: string; severity: string; eventType: string; message: string; createdAt: string; nodeId: string | null }[];
}

export function ExecutionDetailView() {
  const { activeExecutionId, navigate, bumpExecutions } = useFlowStore();
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!activeExecutionId) return;
    let alive = true;
    const load = async () => {
      const res = await api<ExecutionDetail>(`/api/executions/${activeExecutionId}`);
      if (!alive) return;
      if (res.ok) {
        setDetail(res.data);
        if (["running", "waiting", "queued"].includes(res.data.execution.status)) {
          if (!timer.current) timer.current = setInterval(load, 1500);
        } else if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
          bumpExecutions();
        }
      }
    };
    load();
    return () => {
      alive = false;
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [activeExecutionId, bumpExecutions]);

  if (!activeExecutionId) {
    return <div className="p-6 text-sm text-muted-foreground">No execution selected.</div>;
  }

  const exec = detail?.execution ?? null;
  const active = ["running", "waiting", "queued"].includes(exec?.status ?? "");
  const selectedStep = detail?.steps.find((s) => s.id === selectedStepId) ?? null;

  const cancel = async () => {
    await api(`/api/executions/${activeExecutionId}/cancel`, { method: "POST" });
  };
  const retry = async () => {
    const res = await api<{ executionId: string }>(`/api/executions/${activeExecutionId}/retry`, { method: "POST" });
    if (res.ok) navigate("execution-detail", { executionId: res.data.executionId });
  };
  const openWorkflow = () => {
    if (exec?.workflowId) navigate("editor", { workflowId: exec.workflowId });
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1200px]">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("executions")}>
          <ArrowLeft className="h-4 w-4" /> Executions
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg font-semibold truncate">{exec?.workflowName ?? "Execution"}</h1>
            {exec && <StatusBadge status={exec.status} />}
            {exec?.testMode && <Badge variant="outline" className="text-[10px] uppercase">test run</Badge>}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">{activeExecutionId}</div>
        </div>
        <div className="flex gap-2">
          {active && (
            <Button variant="outline" size="sm" onClick={cancel}>
              <Ban className="h-4 w-4" /> Cancel
            </Button>
          )}
          {!active && exec && exec.status !== "succeeded" && (
            <Button variant="outline" size="sm" onClick={retry}>
              <RotateCcw className="h-4 w-4" /> Retry
            </Button>
          )}
          <Button size="sm" onClick={openWorkflow}>
            <Play className="h-4 w-4" /> Open workflow
          </Button>
        </div>
      </div>

      {!detail ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryTile label="Trigger" value={<span className="capitalize">{exec?.triggerType ?? "—"}</span>} />
            <SummaryTile label="Started" value={formatDate(exec?.startedAt ?? null)} />
            <SummaryTile label="Finished" value={formatDate(exec?.finishedAt ?? null)} />
            <SummaryTile label="Duration" value={formatDuration(exec?.durationMs ?? null)} />
            <SummaryTile
              label="Steps"
              value={`${detail.steps.filter((s) => s.itemIndex === null).length} recorded`}
            />
          </div>

          {exec?.error?.message && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" /> Execution failed
              </div>
              <div className="text-sm text-destructive/90 mt-1">{exec?.error?.message}</div>
            </div>
          )}

          {/* Steps + inspector */}
          <div className="grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4" /> Node timeline
              </div>
              <div className="max-h-96 overflow-y-auto divide-y">
                {detail.steps.map((step) => (
                  <button
                    key={step.id}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors",
                      selectedStepId === step.id && "bg-primary/10"
                    )}
                    onClick={() => setSelectedStepId(step.id)}
                  >
                    <StatusBadge status={step.status} small />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{step.nodeType}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {step.nodeId}
                        {step.itemIndex !== null && step.itemIndex !== undefined && (
                          <span className="text-amber-600"> · iteration {step.itemIndex + 1}</span>
                        )}
                      </div>
                    </div>
                    {step.attemptNumber > 1 && (
                      <span className="text-[10px] text-muted-foreground">try {step.attemptNumber}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDuration(step.durationMs)}
                    </span>
                  </button>
                ))}
                {detail.steps.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No steps recorded yet.
                  </div>
                )}
              </div>
            </div>

            {/* Inspector */}
            <div className="lg:col-span-3 rounded-xl border bg-card overflow-hidden flex flex-col min-h-80">
              {selectedStep ? (
                <div className="flex flex-col h-full">
                  <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{selectedStep.nodeType}</span>
                    <StatusBadge status={selectedStep.status} small />
                    <span className="text-[11px] text-muted-foreground font-mono ml-auto">
                      {selectedStep.nodeId}
                    </span>
                  </div>
                  {selectedStep.error?.message && (
                    <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                      {selectedStep.error.message}
                    </div>
                  )}
                  <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">
                    <div className="px-4 pt-2">
                      <TabsList className="h-7">
                        <TabsTrigger value="input" className="text-xs h-6 px-3">Input</TabsTrigger>
                        <TabsTrigger value="output" className="text-xs h-6 px-3">Output</TabsTrigger>
                        <TabsTrigger value="meta" className="text-xs h-6 px-3">Details</TabsTrigger>
                      </TabsList>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 pt-2">
                      <TabsContent value="input" className="m-0">
                        <CopyButton text={JSON.stringify(selectedStep.inputData ?? null, null, 2)} label="Copy JSON" />
                        <div className="mt-2"><JsonView data={selectedStep.inputData} maxHeight={320} /></div>
                      </TabsContent>
                      <TabsContent value="output" className="m-0">
                        <CopyButton text={JSON.stringify(selectedStep.outputData ?? null, null, 2)} label="Copy JSON" />
                        <div className="mt-2"><JsonView data={selectedStep.outputData} maxHeight={320} /></div>
                      </TabsContent>
                      <TabsContent value="meta" className="m-0 text-sm space-y-2">
                        <div className="flex justify-between border-b pb-1.5">
                          <span className="text-muted-foreground">Node type</span><code className="text-xs">{selectedStep.nodeType}</code>
                        </div>
                        <div className="flex justify-between border-b pb-1.5">
                          <span className="text-muted-foreground">Attempt</span><span>{selectedStep.attemptNumber}</span>
                        </div>
                        <div className="flex justify-between border-b pb-1.5">
                          <span className="text-muted-foreground">Started</span><span>{formatDate(selectedStep.startedAt)}</span>
                        </div>
                        <div className="flex justify-between border-b pb-1.5">
                          <span className="text-muted-foreground">Finished</span><span>{formatDate(selectedStep.finishedAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Duration</span><span>{formatDuration(selectedStep.durationMs)}</span>
                        </div>
                        {selectedStep.error && (
                          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
                            <JsonView data={selectedStep.error} maxHeight={160} />
                          </div>
                        )}
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                  <Activity className="h-8 w-8 mb-3 opacity-40" />
                  <div className="text-sm">Select a step to inspect its input, output and errors.</div>
                </div>
              )}
            </div>
          </div>

          {/* Trigger data + logs */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" /> Trigger data
              </div>
              <div className="p-4">
                <JsonView data={exec?.triggerData ?? null} maxHeight={220} />
              </div>
            </div>
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b text-sm font-medium flex items-center gap-2">
                <Timer className="h-4 w-4" /> Event log
              </div>
              <div className="p-4 max-h-64 overflow-y-auto space-y-1">
                {detail.events.map((e) => (
                  <div key={e.id} className="flex gap-2 text-[11px] font-mono">
                    <span className={cn(
                      "shrink-0",
                      e.severity === "error" && "text-red-500",
                      e.severity === "warn" && "text-amber-500",
                      e.severity === "info" && "text-blue-500"
                    )}>
                      [{e.severity.toUpperCase()}]
                    </span>
                    <span className="text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleTimeString()}</span>
                    <span>{e.message}</span>
                  </div>
                ))}
                {detail.events.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-6">No events.</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-sm font-medium mt-1 truncate">{value}</div>
    </div>
  );
}
