"use client";

import { useEffect, useState } from "react";
import { useFlowStore } from "../store";
import { api } from "../lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, formatDate, formatDuration } from "./shared";
import {
  Workflow as WorkflowIcon, Activity, CheckCircle2, XCircle, Loader2,
  Plus, LayoutTemplate, Zap, ArrowRight, Inbox, Timer,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

interface StatsData {
  stats: {
    totalWorkflows: number;
    activeWorkflows: number;
    inactiveWorkflows: number;
    totalExecutions: number;
    succeededExecutions: number;
    failedExecutions: number;
    runningExecutions: number;
    successRate: number | null;
  };
  chart: { date: string; total: number; succeeded: number; failed: number }[];
  recentWorkflows: {
    id: string; name: string; status: string; isFavorite: boolean; updatedAt: string;
  }[];
  favoriteWorkflows: { id: string; name: string; status: string; updatedAt: string }[];
  recentExecutions: {
    id: string; workflowName: string; status: string; triggerType: string;
    testMode: boolean; createdAt: string; durationMs: number | null;
  }[];
  connectionsHealth: { id: string; name: string; provider: string; status: string; lastTestedAt: string | null }[];
  usage: {
    executionCount: number;
    nodeOperationCount: number;
    planName: string;
    planLimits: {
      maxWorkflows: number; maxExecutionsPerMonth: number; maxConnections: number;
      executionHistoryDays: number; maxConcurrentRuns: number; minScheduleIntervalMinutes: number;
    };
  };
}

export function DashboardView() {
  const { navigate, bumpExecutions } = useFlowStore();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api<StatsData>("/api/stats").then((res) => {
      if (alive && res.ok) setData(res.data);
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [bumpExecutions]);

  const empty = data && data.stats.totalWorkflows === 0;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Could not load dashboard statistics.</div>;
  }

  const s = data.stats;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Live statistics from your workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("templates")}>
            <LayoutTemplate className="h-4 w-4" /> Templates
          </Button>
          <Button onClick={() => navigate("workflows")}>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </div>
      </div>

      {empty ? (
        <EmptyDashboard onTemplates={() => navigate("templates")} onNewWorkflow={() => navigate("workflows")} />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={WorkflowIcon} label="Total workflows" value={s.totalWorkflows} sub={`${s.activeWorkflows} active`} tone="blue" />
            <StatCard icon={Activity} label="Total executions" value={s.totalExecutions} sub={`${s.runningExecutions} running now`} tone="violet" />
            <StatCard icon={CheckCircle2} label="Successful" value={s.succeededExecutions} sub={s.successRate !== null ? `${s.successRate}% success rate` : "no finished runs yet"} tone="teal" />
            <StatCard icon={XCircle} label="Failed" value={s.failedExecutions} sub="inspect errors in Executions" tone="red" />
          </div>

          {/* Chart + usage */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Execution activity — last 14 days</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.chart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gSucc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14B8A6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#14B8A6" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gFail" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#EF4444" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#EF4444" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(5)}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)", border: "1px solid var(--border)",
                        borderRadius: 10, fontSize: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="succeeded" name="Succeeded" stroke="#14B8A6" fill="url(#gSucc)" strokeWidth={2} />
                    <Area type="monotone" dataKey="failed" name="Failed" stroke="#EF4444" fill="url(#gFail)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Usage this month — {data.usage.planName} plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageRow
                  label="Executions" used={data.usage.executionCount}
                  limit={data.usage.planLimits.maxExecutionsPerMonth}
                />
                <UsageRow
                  label="Workflows" used={s.totalWorkflows}
                  limit={data.usage.planLimits.maxWorkflows}
                />
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  {data.usage.nodeOperationCount.toLocaleString()} node operations this month
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5" />
                  Scheduling precision: every {data.usage.planLimits.minScheduleIntervalMinutes} min
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("settings")}>
                  Manage plan
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Recent executions + workflows */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Recent executions</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("executions")}>
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent>
                {data.recentExecutions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No executions yet. Run a workflow to see it here.
                  </div>
                ) : (
                  <div className="divide-y">
                    {data.recentExecutions.map((e) => (
                      <button
                        key={e.id}
                        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/40 rounded-md px-2 -mx-2 transition-colors"
                        onClick={() => {
                          useFlowStore.getState().navigate("execution-detail", { executionId: e.id });
                        }}
                      >
                        <StatusBadge status={e.status} small />
                        <span className="text-sm font-medium truncate flex-1">{e.workflowName}</span>
                        {e.testMode && <span className="text-[10px] text-muted-foreground uppercase">test</span>}
                        <span className="text-xs text-muted-foreground hidden sm:block">{e.triggerType}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(e.durationMs)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Recently modified</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("workflows")}>
                  All workflows <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent>
                {data.recentWorkflows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No workflows yet.</div>
                ) : (
                  <div className="divide-y">
                    {data.recentWorkflows.map((w) => (
                      <button
                        key={w.id}
                        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/40 rounded-md px-2 -mx-2 transition-colors"
                        onClick={() => useFlowStore.getState().navigate("editor", { workflowId: w.id })}
                      >
                        <StatusBadge status={w.status} small />
                        <span className="text-sm font-medium truncate flex-1">{w.name}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(w.updatedAt, false)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Connection health */}
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Connection health</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("connections")}>
                Manage <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              {data.connectionsHealth.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No connections yet. Add a Resend, Slack, Discord or Supabase connection to power integration nodes.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.connectionsHealth.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <StatusBadge status={c.status} small />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.provider}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, tone,
}: {
  icon: React.ElementType; label: string; value: number; sub: string;
  tone: "blue" | "violet" | "teal" | "red";
}) {
  const tones: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
  };
  return (
    <Card className="frosted">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-xs text-muted-foreground mt-1">{sub}</div>
        </div>
        <div className={`rounded-xl p-2.5 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <Progress value={pct} className={pct >= 90 ? "text-destructive" : undefined} />
    </div>
  );
}

function EmptyDashboard({ onTemplates, onNewWorkflow }: { onTemplates: () => void; onNewWorkflow: () => void }) {
  return (
    <Card className="frosted">
      <CardContent className="py-14 px-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 flex items-center justify-center mb-5">
          <WorkflowIcon className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Build your first automation</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Start from a ready-made template, or open the visual editor and drag in a trigger.
          Everything runs for real - real HTTP calls, real emails, real data.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-6">
          <Button onClick={onNewWorkflow}><Plus className="h-4 w-4" /> Create a workflow</Button>
          <Button variant="outline" onClick={onTemplates}><LayoutTemplate className="h-4 w-4" /> Browse templates</Button>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-10 max-w-2xl mx-auto text-left">
          {[
            { t: "1. Pick a trigger", d: "Manual, incoming webhook, or a schedule." },
            { t: "2. Add actions", d: "HTTP calls, conditions, loops, transforms, integrations." },
            { t: "3. Run & inspect", d: "Watch every node's input and output." },
          ].map((s) => (
            <div key={s.t} className="rounded-xl border p-4">
              <div className="text-sm font-medium">{s.t}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.d}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
