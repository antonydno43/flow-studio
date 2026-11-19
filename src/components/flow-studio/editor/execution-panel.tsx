"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, JsonView, formatDuration, formatDate } from "../views/shared";
import { useFlowStore, type ExecutionStepDto } from "../store";
import { cn } from "@/lib/utils";
import { X, RotateCcw, Ban, ChevronDown } from "lucide-react";

interface ExecutionDetail {
  execution: {
    id: string;
    status: string;
    triggerType: string;
    testMode: boolean;
    createdAt: string;
    durationMs: number | null;
    error: { message?: string } | null;
    workflowName?: string;
    triggerData?: unknown;
  };
  steps: ExecutionStepDto[];
  events: { id: string; severity: string; eventType: string; message: string; createdAt: string; nodeId: string | null }[];
}

export function ExecutionPanel({
  executionId, onClose, onExecutionData,
}: {
  executionId: string | null;
  onClose: () => void;
  onExecutionData: (data: {
    statusMap: Record<string, string>;
    nodeOutputs: Record<string, unknown>;
    nodeNames: Record<string, string>;
    triggerData: unknown;
  }) => void;
}) {
  const { navigate } = useFlowStore();
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [selectedStep, setSelectedStep] = useState<ExecutionStepDto | null>(null);
  const [tab, setTab] = useState("steps");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!executionId) return;
    let alive = true;
    const load = async () => {
      const res = await api<ExecutionDetail>(`/api/executions/${executionId}`);
      if (!alive) return;
      if (res.ok) {
        setDetail(res.data);
        // report statuses + outputs to the editor canvas
        const statusMap: Record<string, string> = {};
        const nodeOutputs: Record<string, unknown> = {};
        const nodeNames: Record<string, string> = {};
        for (const s of res.data.steps) {
          if (s.itemIndex === null || s.itemIndex === undefined) {
            statusMap[s.nodeId] = s.status;
            if (s.status === "succeeded") nodeOutputs[s.nodeId] = s.outputData;
          } else {
            statusMap[s.nodeId] = s.status;
          }
        }
        onExecutionData({
          statusMap,
          nodeOutputs,
          nodeNames,
          triggerData: res.data.execution.triggerData ?? null,
        });
        // keep polling while active
        if (["running", "waiting", "queued"].includes(res.data.execution.status)) {
          if (!timer.current) timer.current = setInterval(load, 1500);
        } else if (timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }
    };
    load();
    return () => {
      alive = false;
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [executionId, onExecutionData]);

  if (!executionId) {
    return (
      <div className="h-48 border-t bg-card flex items-center justify-center text-sm text-muted-foreground">
        Press <span className="font-medium mx-1">Test run</span> to execute this workflow and inspect every step here.
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-3" onClick={onClose}>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const exec = detail?.execution;
  const active = ["running", "waiting", "queued"].includes(exec?.status ?? "");

  const cancel = async () => {
    if (!executionId) return;
    await api(`/api/executions/${executionId}/cancel`, { method: "POST" });
  };
  const retry = async () => {
    if (!executionId) return;
    const res = await api<{ executionId: string }>(`/api/executions/${executionId}/retry`, { method: "POST" });
    if (res.ok) {
      navigate("execution-detail", { executionId: res.data.executionId });
    }
  };

  return (
    <div className="h-64 border-t bg-card flex flex-col shrink-0">
      {/* Summary bar */}
      <div className="h-10 border-b flex items-center gap-3 px-3 text-xs shrink-0 overflow-x-auto">
        {exec ? (
          <>
            <StatusBadge status={exec.status} small />
            <span className="font-medium">{exec.workflowName ?? "Execution"}</span>
            <span className="text-muted-foreground">{formatDate(exec.createdAt)}</span>
            <span className="text-muted-foreground tabular-nums">{formatDuration(exec.durationMs)}</span>
            {exec.testMode && <span className="uppercase text-[10px] text-amber-600 font-semibold">test</span>}
            {exec.error?.message && (
              <span className="text-destructive truncate max-w-xs" title={exec.error.message}>
                {exec.error.message}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Loading execution…</span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {active && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancel}>
              <Ban className="h-3 w-3" /> Cancel
            </Button>
          )}
          {!active && exec && exec.status !== "succeeded" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={retry}>
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => navigate("execution-detail", { executionId })}
          >
            Open details
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-3 pt-1.5 shrink-0 flex items-center">
          <TabsList className="h-7">
            <TabsTrigger value="steps" className="text-xs h-6 px-3">Steps</TabsTrigger>
            <TabsTrigger value="input" className="text-xs h-6 px-3">{selectedStep ? "Step input" : "Input"}</TabsTrigger>
            <TabsTrigger value="output" className="text-xs h-6 px-3">{selectedStep ? "Step output" : "Output"}</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs h-6 px-3">Logs</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="steps" className="h-full m-0 overflow-y-auto p-2">
            <div className="space-y-1">
              {detail?.steps.map((step) => (
                <button
                  key={step.id}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 text-xs",
                    selectedStep?.id === step.id && "bg-primary/10"
                  )}
                  onClick={() => { setSelectedStep(step); setTab("output"); }}
                >
                  <StatusBadge status={step.status} small />
                  <span className="font-mono text-[10px] text-muted-foreground w-16 truncate">{step.nodeId}</span>
                  <span className="flex-1 truncate">{step.nodeType}</span>
                  {step.itemIndex !== null && step.itemIndex !== undefined && (
                    <span className="text-[10px] text-amber-600">item {step.itemIndex}</span>
                  )}
                  {step.attemptNumber > 1 && <span className="text-[10px] text-muted-foreground">try {step.attemptNumber}</span>}
                  <span className="text-muted-foreground tabular-nums">{formatDuration(step.durationMs)}</span>
                </button>
              ))}
              {detail && detail.steps.length === 0 && (
                <div className="text-xs text-muted-foreground p-4 text-center">No steps recorded yet.</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="input" className="h-full m-0 overflow-y-auto p-2">
            {selectedStep ? <JsonView data={selectedStep.inputData} maxHeight={160} /> : (
              <div className="text-xs text-muted-foreground p-4">Select a step to inspect its input.</div>
            )}
          </TabsContent>

          <TabsContent value="output" className="h-full m-0 overflow-y-auto p-2">
            {selectedStep ? (
              <>
                {selectedStep.error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive mb-2">
                    {selectedStep.error.message ?? JSON.stringify(selectedStep.error)}
                  </div>
                )}
                <JsonView data={selectedStep.outputData} maxHeight={150} />
              </>
            ) : (
              <div className="text-xs text-muted-foreground p-4">Select a step to inspect its output.</div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="h-full m-0 overflow-y-auto p-2">
            <div className="space-y-0.5">
              {detail?.events.map((e) => (
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
                  <span className="truncate">{e.message}</span>
                </div>
              ))}
              {detail && detail.events.length === 0 && (
                <div className="text-xs text-muted-foreground p-4 text-center">No log events.</div>
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
