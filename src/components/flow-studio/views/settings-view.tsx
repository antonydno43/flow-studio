"use client";

import { useEffect, useState } from "react";
import { useFlowStore } from "../store";
import { api, errMsg } from "../lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  User, Building2, Bell, ShieldAlert, CreditCard, Loader2, Check, Trash2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
  "Australia/Sydney", "UTC",
];

export function SettingsView({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const { session } = useFlowStore();
  const [tab, setTab] = useState("account");

  return (
    <div className="p-4 sm:p-6 max-w-[1000px] space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Account, workspace, notifications, security and billing.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="account" className="gap-1.5"><User className="h-3.5 w-3.5" /> Account</TabsTrigger>
          <TabsTrigger value="workspace" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Workspace</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Security</TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <AccountTab />
        </TabsContent>
        <TabsContent value="workspace" className="mt-4">
          <WorkspaceTab />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityTab onAccountDeleted={onAccountDeleted} />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <BillingTab />
        </TabsContent>
      </Tabs>
      <div className="text-xs text-muted-foreground">
        Signed in as {session?.email} · workspace {session?.workspaceName}
      </div>
    </div>
  );
}

function AccountTab() {
  const { session, setSession } = useFlowStore();
  const { toast } = useToast();
  const [fullName, setFullName] = useState(session?.fullName ?? "");
  const [timezone, setTimezone] = useState(session?.timezone ?? "Asia/Kolkata");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ fullName, timezone }),
    });
    setBusy(false);
    if (!res.ok) { toast({ title: "Could not save", description: errMsg(res), variant: "destructive" }); return; }
    if (session) setSession({ ...session, fullName, timezone });
    toast({ title: "Account updated" });
  };

  const changePassword = async () => {
    setPwBusy(true);
    const res = await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
    });
    setPwBusy(false);
    if (!res.ok) { toast({ title: "Could not change password", description: errMsg(res), variant: "destructive" }); return; }
    setPw({ current: "", next: "" });
    toast({ title: "Password changed", description: "All other sessions were signed out." });
  };

  if (!session) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={session.email} disabled />
            <p className="text-xs text-muted-foreground">Email is your login and cannot be changed in this version.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Change password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {pw.next && pw.next.length < 8 && (
              <p className="text-xs text-destructive">At least 8 characters.</p>
            )}
          </div>
          <Button
            variant="outline"
            onClick={changePassword}
            disabled={pwBusy || !pw.current || pw.next.length < 8}
          >
            {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
          </Button>
          <p className="text-xs text-muted-foreground">
            Changing the password signs out all other sessions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkspaceTab() {
  const { session } = useFlowStore();
  const { toast } = useToast();
  const [name, setName] = useState(session?.workspaceName ?? "");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: { timezone: string } }>("/api/settings").then((res) => {
      if (res.ok) setTimezone(res.data.settings.timezone);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    const res = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ workspaceName: name, workspaceTimezone: timezone }),
    });
    setBusy(false);
    if (!res.ok) { toast({ title: "Could not save", description: errMsg(res), variant: "destructive" }); return; }
    toast({ title: "Workspace updated", description: "Schedule next-run times were recalculated." });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-1.5">
          <Label>Workspace name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Default timezone (used by schedules)</Label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          This workspace is private to <span className="text-foreground font-medium">{session?.email}</span>.
          Flow Studio workspaces are single-owner - there is no sharing or inviting, by design.
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save workspace
        </Button>
      </CardContent>
    </Card>
  );
}

function NotificationsTab() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<{ type: string; label: string; enabled: boolean }[] | null>(null);
  const [notifications, setNotifications] = useState<{ id: string; title: string; body: string; emailStatus: string | null; createdAt: string }[]>([]);

  useEffect(() => {
    api<{
      preferences: { type: string; label: string; enabled: boolean }[];
      notifications: typeof notifications;
    }>("/api/notifications").then((res) => {
      if (res.ok) {
        setPrefs(res.data.preferences);
        setNotifications(res.data.notifications);
      }
    });
  }, []);

  const toggle = async (type: string, enabled: boolean) => {
    setPrefs((p) => p?.map((x) => (x.type === type ? { ...x, enabled } : x)) ?? null);
    await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ type, enabled }) });
  };

  if (!prefs) return <Skeleton className="h-64" />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Notification preferences</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {prefs.map((p) => (
            <div key={p.type} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <div className="text-sm">{p.label}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{p.type}</div>
              </div>
              <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p.type, v)} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            Emails are delivered when the server has a Resend API key configured; otherwise notifications are stored in-app only.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent notifications</CardTitle></CardHeader>
        <CardContent className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">Nothing yet.</div>
          ) : notifications.map((n) => (
            <div key={n.id} className="py-2 border-b last:border-0">
              <div className="text-sm font-medium">{n.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2">
                <span>{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                {n.emailStatus && (
                  <span className={cn(
                    n.emailStatus === "sent" && "text-teal-600",
                    n.emailStatus === "skipped_no_provider" && "text-amber-600",
                    n.emailStatus === "failed" && "text-red-500"
                  )}>
                    email: {n.emailStatus}
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityTab({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api<{ settings: { sessionCount: number } }>("/api/settings").then((res) => {
      if (res.ok) setSessionCount(res.data.settings.sessionCount);
    });
  }, []);

  const deleteAccount = async () => {
    setDeleting(true);
    const res = await api("/api/settings", { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      toast({ title: "Could not delete account", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({ title: "Account deleted", description: "All data has been removed." });
    onAccountDeleted();
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Sessions & credentials</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Active sessions</span>
            <span>{sessionCount ?? "…"} (password change signs out all others)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Integration credentials</span>
            <span>Encrypted with AES-256-GCM (see Connections)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Data isolation</span>
            <Badge variant="accent">Single-owner workspace</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Deleting your account permanently removes your workspace, all workflows, executions,
            connections and stored credentials. This cannot be undone.
          </p>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete account permanently?</DialogTitle>
            <DialogDescription>
              Type <span className="font-mono font-semibold">DELETE</span> to confirm. Everything is removed immediately.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="DELETE"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={confirmText !== "DELETE" || deleting} onClick={deleteAccount}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface PlanInfo {
  id: string;
  name: string;
  priceInr: number;
  description: string;
  features: string[];
  limits: {
    maxWorkflows: number;
    maxExecutionsPerMonth: number;
    maxConnections: number;
    executionHistoryDays: number;
    maxConcurrentRuns: number;
    minScheduleIntervalMinutes: number;
  };
}

function BillingTab() {
  const { session } = useFlowStore();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [usage, setUsage] = useState<{
    usage: { executions: number; workflows: number; connections: number };
    limits: PlanInfo["limits"];
    period: { start: string; end: string };
  } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = async () => {
    const [billing, usageRes] = await Promise.all([
      api<{
        plans: PlanInfo[];
        currentPlanId: string;
        provider: { configured: boolean };
      }>("/api/billing"),
      api<NonNullable<typeof usage>>("/api/usage"),
    ]);
    if (billing.ok) {
      setPlans(billing.data.plans);
      setProviderConfigured(billing.data.provider.configured);
    }
    if (usageRes.ok) setUsage(usageRes.data);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, setState happens after await
    load();
  }, []);

  const choose = async (planId: string) => {
    setBusyPlan(planId);
    const res = await api<{ changed: boolean; message?: string }>(`/api/billing`, {
      method: "POST",
      body: JSON.stringify({ planId }),
    });
    setBusyPlan(null);
    if (!res.ok) {
      toast({ title: "Plan change failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({
      title: res.data.changed ? "Plan updated" : "Action required",
      description: res.data.message,
    });
    load();
  };

  if (!plans || !usage) return <Skeleton className="h-72" />;

  const u = usage.usage;
  const l = usage.limits;

  return (
    <div className="space-y-4">
      {!providerConfigured && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2.5 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Billing is not configured on this server.</span>{" "}
              Paid plan checkout requires Razorpay credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).
              You can still see plans and manage your free subscription - no payments are simulated.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current usage</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-5">
          <UsageMeter label="Executions" value={u.executions} max={l.maxExecutionsPerMonth} />
          <UsageMeter label="Workflows" value={u.workflows} max={l.maxWorkflows} />
          <UsageMeter label="Connections" value={u.connections} max={l.maxConnections} />
          <div className="sm:col-span-3 text-xs text-muted-foreground">
            Billing period: {new Date(usage.period.start).toLocaleDateString("en-IN")} –{" "}
            {new Date(usage.period.end).toLocaleDateString("en-IN")} · Current plan:{" "}
            <span className="font-medium capitalize text-foreground">{session?.planId}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const current = session?.planId === plan.id;
          return (
            <Card key={plan.id} className={cn("flex flex-col", current && "border-primary shadow-md")}>
              <CardContent className="p-5 flex flex-col flex-1">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{plan.name}</div>
                  {current && <Badge>Current</Badge>}
                </div>
                <div className="mt-1">
                  <span className="text-2xl font-bold">₹{plan.priceInr}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                <ul className="mt-4 space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs">
                      <Check className="h-3.5 w-3.5 text-teal-600 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                {current ? (
                  <Button variant="outline" className="mt-4" disabled>Active plan</Button>
                ) : plan.id === "free" ? (
                  <Button variant="outline" className="mt-4" onClick={() => choose("free")} disabled={busyPlan !== null}>
                    {busyPlan === "free" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Downgrade to Free
                  </Button>
                ) : (
                  <Button className="mt-4" onClick={() => choose(plan.id)} disabled={busyPlan !== null || !providerConfigured}>
                    {busyPlan === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                    Upgrade to {plan.name}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function UsageMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{value.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <Progress value={pct} className={pct >= 90 ? "text-destructive" : undefined} />
    </div>
  );
}
