"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useFlowStore, type ExecutionStepDto } from "../store";
import { ChevronRight, Braces, FunctionSquare, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { EXPRESSION_FUNCTIONS } from "@/core/expression/engine";

interface MappingDialogProps {
  open: boolean;
  onClose: () => void;
  /** insert at end of the field value */
  onInsert: (expression: string) => void;
  /** node outputs available from the last execution (nodeId -> output) */
  nodeOutputs: Record<string, unknown>;
  nodeNames: Record<string, string>;
  triggerData: unknown;
}

export function MappingDialog({ open, onClose, onInsert, nodeOutputs, nodeNames, triggerData }: MappingDialogProps) {
  const [expanded, setExpanded] = useState<string | null>("$trigger");
  const [tab, setTab] = useState<"data" | "functions">("data");

  const sources = useMemo(() => {
    const list: { key: string; label: string; data: unknown }[] = [
      { key: "$trigger", label: "Trigger data", data: triggerData },
    ];
    for (const [nodeId, output] of Object.entries(nodeOutputs)) {
      list.push({ key: nodeId, label: nodeNames[nodeId] || nodeId, data: output });
    }
    return list;
  }, [nodeOutputs, nodeNames, triggerData]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Braces className="h-4 w-4 text-primary" /> Insert data reference
          </DialogTitle>
          <DialogDescription>
            Click any field to insert a reference like {"{{ $trigger.body.email }}"} into the
            selected setting. Values resolve at execution time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 mb-2">
          <Button size="sm" variant={tab === "data" ? "default" : "outline"} onClick={() => setTab("data")}>
            <Zap className="h-3.5 w-3.5" /> Data
          </Button>
          <Button size="sm" variant={tab === "functions" ? "default" : "outline"} onClick={() => setTab("functions")}>
            <FunctionSquare className="h-3.5 w-3.5" /> Functions
          </Button>
        </div>

        {tab === "data" ? (
          <div className="flex-1 overflow-y-auto rounded-lg border divide-y">
            {sources.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                Run the workflow once - then every node's output appears here for mapping.
              </div>
            )}
            {sources.map((src) => {
              const isOpen = expanded === src.key;
              return (
                <div key={src.key}>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left"
                    onClick={() => setExpanded(isOpen ? null : src.key)}
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
                    <span className="text-sm font-medium">{src.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{src.key}</span>
                    <span
                      className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                      onClick={(e) => { e.stopPropagation(); onInsert(`{{ ${src.key} }}`); onClose(); }}
                      title="Insert whole object"
                    >
                      insert object
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pb-2">
                      <DataTree
                        data={src.data}
                        path={src.key}
                        depth={0}
                        onInsert={(p) => { onInsert(`{{ ${p} }}`); onClose(); }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-lg border p-2">
            <div className="text-xs text-muted-foreground mb-2 px-1">
              Safe, sandboxed functions usable inside {"{{ }}"} expressions.
            </div>
            <div className="grid grid-cols-2 gap-1">
              {EXPRESSION_FUNCTIONS.map((fn) => (
                <button
                  key={fn}
                  className="text-left text-xs font-mono px-2 py-1.5 rounded hover:bg-primary/10 transition-colors truncate"
                  onClick={() => { onInsert(`${fn}()`); onClose(); }}
                  title={`Insert ${fn}()`}
                >
                  {fn}()
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function DataTree({
  data, path, depth, onInsert,
}: {
  data: unknown; path: string; depth: number; onInsert: (path: string) => void;
}) {
  if (data === null || data === undefined) {
    return <div className="text-xs text-muted-foreground px-3 py-1 font-mono">null</div>;
  }
  if (typeof data !== "object") {
    const t = typeof data;
    return (
      <button
        className="w-full flex items-center gap-2 px-3 py-1 hover:bg-primary/10 text-left"
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onInsert(path)}
      >
        <span className="text-[10px] text-muted-foreground uppercase w-9 shrink-0">{t}</span>
        <span className="text-xs font-mono truncate">{String(data).slice(0, 60) || '""'}</span>
      </button>
    );
  }
  const entries: [string, unknown][] = Array.isArray(data)
    ? data.slice(0, 50).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data).slice(0, 50);
  if (Array.isArray(data) && data.length > 50) {
    entries.push([`… ${data.length - 50} more`, undefined]);
  }
  return (
    <div>
      {entries.map(([k, v]) => {
        const childPath = Array.isArray(data) ? `${path}[${k}]` : `${path}.${k}`;
        return (
          <DataTree key={k} data={v} path={childPath} depth={depth + 1} onInsert={onInsert} />
        );
      })}
    </div>
  );
}

export type { ExecutionStepDto };
