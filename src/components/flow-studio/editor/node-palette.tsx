"use client";

import React, { useMemo, useState } from "react";
import { useFlowStore, type CatalogNode } from "../store";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import * as Lucide from "lucide-react";
import { Search, Sparkles } from "lucide-react";

export function iconFor(name: string): React.ElementType {
  const Icon = (Lucide as unknown as Record<string, React.ElementType>)[name];
  return Icon || Lucide.Box;
}

export function NodePalette({
  onAddNode, compact,
}: {
  onAddNode: (nodeType: string) => void;
  compact?: boolean;
}) {
  const { catalog, catalogLoading } = useFlowStore();
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? catalog.filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            n.type.includes(q) ||
            n.category.toLowerCase().includes(q)
        )
      : catalog;
    const groups = new Map<string, CatalogNode[]>();
    for (const n of filtered) {
      if (!groups.has(n.category)) groups.set(n.category, []);
      groups.get(n.category)!.push(n);
    }
    // triggers first
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === "Triggers") return -1;
      if (b[0] === "Triggers") return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [catalog, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search nodes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {catalogLoading && (
          <div className="text-xs text-muted-foreground text-center py-8">Loading node catalog…</div>
        )}
        {grouped.map(([category, nodes]) => (
          <div key={category}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
              {category}
            </div>
            <div className="space-y-1">
              {nodes.map((node) => {
                return (
                  <div
                    key={node.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/flow-node", node.type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onAddNode(node.type)}
                    title={node.description}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 cursor-grab active:cursor-grabbing",
                      "hover:border-border hover:bg-muted/50 transition-colors group"
                    )}
                  >
                    <div className="rounded-md bg-muted p-1.5 group-hover:bg-primary/10 transition-colors shrink-0">
                      {React.createElement(iconFor(node.icon), { className: "h-3.5 w-3.5" })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{node.name}</div>
                      {!compact && (
                        <div className="text-[10px] text-muted-foreground truncate">{node.description}</div>
                      )}
                    </div>
                    {node.kind === "trigger" && (
                      <Sparkles className="h-3 w-3 text-blue-500 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!catalogLoading && grouped.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            No nodes match “{search}”.
          </div>
        )}
      </div>
      <div className="p-2.5 border-t text-[10px] text-muted-foreground">
        Drag onto the canvas, or click to add. Connect the round ports to build the flow.
      </div>
    </div>
  );
}
