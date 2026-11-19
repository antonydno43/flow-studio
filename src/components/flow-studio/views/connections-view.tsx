"use client";

import { useEffect, useState, useCallback } from "react";
import { api, errMsg } from "../lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, formatDate } from "./shared";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Plug, Trash2, FlaskConical, Pencil, Loader2, ExternalLink, ShieldCheck, AlertTriangle,
} from "lucide-react";

interface ProviderField {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder?: string;
  help?: string;
}
interface Provider {
  id: string;
  label: string;
  description: string;
  docsUrl: string;
  fields: ProviderField[];
}
interface ConnectionRow {
  id: string;
  provider: string;
  providerLabel: string;
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
}

export function ConnectionsView() {
  const { toast } = useToast();
  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [vaultConfigured, setVaultConfigured] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionRow | null>(null);
  const [form, setForm] = useState({ provider: "", name: "", credentials: {} as Record<string, string> });
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionRow | null>(null);

  const load = useCallback(async () => {
    const res = await api<{
      connections: ConnectionRow[];
      providers: Provider[];
      vaultConfigured: boolean;
    }>("/api/connections");
    if (res.ok) {
      setConnections(res.data.connections);
      setProviders(res.data.providers);
      setVaultConfigured(res.data.vaultConfigured);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, setState happens after await
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ provider: providers[0]?.id ?? "", name: "", credentials: {} });
    setDialogOpen(true);
  };

  const openEdit = (conn: ConnectionRow) => {
    setEditing(conn);
    setForm({ provider: conn.provider, name: conn.name, credentials: {} });
    setDialogOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    const payload = editing
      ? { name: form.name, ...(Object.keys(form.credentials).length ? { credentials: form.credentials } : {}) }
      : { provider: form.provider, name: form.name, credentials: form.credentials };
    const res = editing
      ? await api(`/api/connections/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api("/api/connections", { method: "POST", body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not save connection", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Connection updated" : "Connection stored", description: "Credentials are encrypted with AES-256-GCM." });
    setDialogOpen(false);
    load();
  };

  const test = async (conn: ConnectionRow) => {
    setTestingId(conn.id);
    const res = await api<{ status: string; message: string }>(`/api/connections/${conn.id}/test`, { method: "POST" });
    setTestingId(null);
    if (!res.ok) {
      toast({ title: "Test failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({
      title: res.data.status === "connected" ? "Connection works" : res.data.status === "failed" ? "Connection failed" : "No automated test",
      description: res.data.message,
      variant: res.data.status === "failed" ? "destructive" : undefined,
    });
    load();
  };

  const remove = async (conn: ConnectionRow) => {
    const res = await api(`/api/connections/${conn.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (!res.ok) {
      toast({ title: "Delete failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({ title: "Connection deleted" });
    load();
  };

  const selectedProvider = providers.find((p) => p.id === form.provider);
  const canSubmit = form.name.trim() && form.provider &&
    (editing || (selectedProvider?.fields.filter((f) => f.required).every((f) => form.credentials[f.key]) ?? false));

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Connections</h1>
          <p className="text-sm text-muted-foreground">
            Store integration credentials securely. They are AES-256-GCM encrypted and only decrypted server-side during execution.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!vaultConfigured}>
          <Plus className="h-4 w-4" /> New connection
        </Button>
      </div>

      {!vaultConfigured && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2.5 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              The credential vault is not configured on this server (CREDENTIAL_ENCRYPTION_KEY missing).
              Ask the administrator to set it before storing connections.
            </div>
          </CardContent>
        </Card>
      )}

      {connections === null ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : connections.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Plug className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <div className="font-medium">No connections yet</div>
            <div className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Add a Resend API key to send emails, a Slack or Discord webhook to post messages,
              or your Supabase project to read and write data.
            </div>
            <Button className="mt-5" onClick={openCreate}><Plus className="h-4 w-4" /> Add your first connection</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => (
            <Card key={conn.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{conn.name}</div>
                    <div className="text-xs text-muted-foreground">{conn.providerLabel}</div>
                  </div>
                  <StatusBadge status={conn.status} small />
                </div>
                {conn.lastTestResult && (
                  <div className="text-[11px] text-muted-foreground line-clamp-2" title={conn.lastTestResult}>
                    {conn.lastTestResult}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {conn.lastTestedAt ? `Last tested ${formatDate(conn.lastTestedAt)}` : "Never tested"}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => test(conn)} disabled={testingId === conn.id}>
                    {testingId === conn.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                    Test
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => openEdit(conn)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => setDeleteTarget(conn)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Security note */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-2.5 p-4 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-muted-foreground">
            <span className="text-foreground font-medium">How your credentials are protected:</span>{" "}
            encrypted at rest with AES-256-GCM, never returned by any API, never written to logs,
            and only decrypted inside the server-side execution engine when a node runs.
          </div>
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New connection"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the name or re-enter credentials. Leave fields blank to keep stored values."
                : "Credentials are encrypted immediately and never leave the server unencrypted."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label className="text-sm">Application</Label>
                <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v, credentials: {} })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProvider && (
                  <p className="text-xs text-muted-foreground">{selectedProvider.description}</p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-sm">Connection name</Label>
              <Input
                placeholder="e.g. Production Resend"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            {selectedProvider?.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-sm">
                  {field.label}
                  {field.required && !editing && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  type={field.type}
                  placeholder={editing ? "•••••• (unchanged)" : field.placeholder}
                  value={form.credentials[field.key] ?? ""}
                  onChange={(e) => setForm({
                    ...form,
                    credentials: { ...form.credentials, [field.key]: e.target.value },
                  })}
                />
                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              </div>
            ))}
            {selectedProvider?.docsUrl && (
              <a
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                href={selectedProvider.docsUrl} target="_blank" rel="noreferrer"
              >
                <ExternalLink className="h-3 w-3" /> Where do I find these credentials?
              </a>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!canSubmit || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save changes" : "Store connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              Nodes using this connection will fail with a configuration error until you reconnect them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && remove(deleteTarget)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
