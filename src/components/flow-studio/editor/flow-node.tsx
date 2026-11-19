"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import * as Lucide from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogNode } from "../store";

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  def: CatalogNode;
  config: Record<string, unknown>;
  status?: string; // execution status overlay
  hasError?: boolean; // validation error flag
  isWaiting?: boolean;
}

export type FlowNodeType = Node<FlowNodeData, "flow">;

function iconFor(name: string): React.ElementType {
  const Icon = (Lucide as unknown as Record<string, React.ElementType>)[name];
  return Icon || Lucide.Box;
}
export { iconFor };

const kindColors: Record<string, string> = {
  trigger: "from-blue-500/15 to-blue-600/5 text-blue-600 dark:text-blue-400 border-blue-500/25",
  action: "from-violet-500/15 to-violet-600/5 text-violet-600 dark:text-violet-400 border-violet-500/25",
  logic: "from-teal-500/15 to-teal-600/5 text-teal-600 dark:text-teal-400 border-teal-500/25",
};

const statusRing: Record<string, string> = {
  succeeded: "ring-2 ring-teal-500",
  failed: "ring-2 ring-red-500",
  running: "ring-2 ring-blue-500 animate-pulse",
  waiting: "ring-2 ring-amber-500",
  skipped: "ring-2 ring-gray-400/60 opacity-60",
  cancelled: "ring-2 ring-gray-400/60 opacity-60",
};

export const FlowNode = memo(function FlowNode({ data, selected }: NodeProps<FlowNodeType>) {
  const def = data.def;
  const isTrigger = def.kind === "trigger";
  const ring = data.status ? statusRing[data.status] ?? "" : "";
  const errCount = data.hasError;

  return (
    <div
      className={cn(
        "group relative w-56 rounded-xl border bg-card shadow-sm transition-all",
        selected ? "border-primary shadow-md" : "border-border hover:border-primary/40",
        ring
      )}
    >
      {/* Input handle */}
      {def.inputs > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!bg-muted-foreground/70"
          isConnectable
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 p-3 border-b border-border/60">
        <div className={cn("rounded-lg border bg-gradient-to-br p-1.5 shrink-0", kindColors[def.kind])}>
          {React.createElement(iconFor(def.icon), { className: "h-4 w-4" })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate leading-tight" title={data.label}>
            {data.label}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{def.name}</div>
        </div>
        {errCount && (
          <div className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="This node has validation issues" />
        )}
        {data.status === "running" && (
          <Lucide.Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
        )}
      </div>

      {/* Output ports with labels */}
      {(def.outputs.length > 0) && (
        <div className="p-2.5 space-y-1.5">
          {def.outputs.map((port) => (
            <div key={port.id} className="relative flex items-center justify-end pr-1">
              <span
                className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5"
                style={port.color ? { color: port.color, borderColor: port.color } : undefined}
              >
                {port.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                className="!bg-primary"
                style={port.color ? { background: port.color } : undefined}
                isConnectable
              />
            </div>
          ))}
        </div>
      )}

      {/* trigger badge */}
      {isTrigger && (
        <div className="absolute -top-2 left-3 rounded-full bg-blue-600 text-white text-[9px] font-semibold px-2 py-0.5 uppercase tracking-wide">
          Trigger
        </div>
      )}
    </div>
  );
});
