"use client";

import React, { useEffect, useState } from "react";
import { useFlowStore } from "../store";
import { api, errMsg } from "../lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { LayoutTemplate, Plus, Loader2, Plug, ArrowRight } from "lucide-react";
import { iconFor } from "../editor/node-palette";

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  requiredProviders: string[];
  nodeCount: number;
}

export function TemplatesView() {
  const { navigate } = useFlowStore();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [connections, setConnections] = useState<string[]>([]); // providers with at least one connection

  useEffect(() => {
    api<{ templates: TemplateRow[] }>("/api/templates").then((res) => {
      setTemplates(res.ok ? res.data.templates : []);
    });
    api<{ connections: { provider: string }[] }>("/api/connections").then((res) => {
      if (res.ok) setConnections([...new Set(res.data.connections.map((c) => c.provider))]);
    });
  }, []);

  const use = async (tpl: TemplateRow) => {
    setUsingId(tpl.id);
    const res = await api<{ workflow: { id: string }; setupNotes: string | null }>(`/api/templates/${tpl.id}/use`, {
      method: "POST",
    });
    setUsingId(null);
    if (!res.ok) {
      toast({ title: "Could not create from template", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({
      title: `“${tpl.name}” added`,
      description: res.data.setupNotes ?? "Open the editor to review and activate it.",
    });
    navigate("editor", { workflowId: res.data.workflow.id });
  };

  const grouped = templates?.reduce((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {} as Record<string, TemplateRow[]>);


  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm text-muted-foreground">
          Ready-made workflows you can edit and activate. Templates with integrations show what to connect first.
        </p>
      </div>

      {templates === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : (
        (Object.entries(grouped ?? {}) as [string, TemplateRow[]][]).map(([category, list]) => (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((tpl) => {
                const missing = tpl.requiredProviders.filter((p) => !connections.includes(p));
                return (
                  <Card key={tpl.id} className="flex flex-col hover:shadow-md transition-shadow">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-gradient-to-br from-blue-600/10 to-violet-600/10 p-2.5 shrink-0">
                          {React.createElement(iconFor(tpl.icon), { className: "h-5 w-5 text-primary" })}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium leading-tight">{tpl.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {tpl.nodeCount} node{tpl.nodeCount === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-3 flex-1">{tpl.description}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-3">
                        {tpl.requiredProviders.length === 0 ? (
                          <Badge variant="accent" className="text-[10px]">No setup needed</Badge>
                        ) : missing.length === 0 ? (
                          <Badge variant="accent" className="text-[10px]">
                            <Plug className="h-3 w-3" /> Connections ready
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                            Connects: {missing.join(", ")}
                          </Badge>
                        )}
                      </div>
                      <Button
                        className="mt-4 w-full"
                        variant={missing.length ? "outline" : "default"}
                        onClick={() => use(tpl)}
                        disabled={usingId === tpl.id}
                      >
                        {usingId === tpl.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Use this template
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
