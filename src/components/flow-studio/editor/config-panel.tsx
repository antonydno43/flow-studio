"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, errMsg } from "../lib/api-client";
import { useFlowStore, type CatalogNode, type ValidationIssue } from "../store";
import { MappingDialog } from "./mapping-dialog";
import { iconFor } from "./node-palette";
import { JsonView } from "../views/shared";
import { OPERATOR_OPTIONS } from "@/core/nodes/utils";
import {
  Braces, Trash2, Plus, FlaskConical, Loader2, Link2, RefreshCw, Copy,
  AlertTriangle, Lightbulb,
} from "lucide-react";

export interface ConnectionOption {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface ConfigPanelProps {
  node: {
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
  };
  def: CatalogNode | undefined;
  validationIssues: ValidationIssue[];
  nodeOutputs: Record<string, unknown>;
  nodeNames: Record<string, string>;
  triggerData: unknown;
  onRename: (name: string) => void;
  onChange: (key: string, value: unknown) => void;
  onClose: () => void;
}

export function ConfigPanel({
  node, def, validationIssues, nodeOutputs, nodeNames, triggerData,
  onRename, onChange, onClose,
}: ConfigPanelProps) {
  const { toast } = useToast();
  const [mappingField, setMappingField] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<{ url: string; secret: string; enabled: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testInput, setTestInput] = useState("{}");

  useEffect(() => {
    api<{ connections: ConnectionOption[] }>("/api/connections").then((res) => {
      if (res.ok) setConnections(res.data.connections);
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the selected node changes
    setTestResult(null);
    setTestInput("{}");
    if (def?.type === "trigger-webhook") {
      api<{ hasWebhook: boolean; url: string | null; secret: string | null; enabled: boolean }>(
        `/api/workflows/${useFlowStore.getState().activeWorkflowId}/webhook-info`
      ).then((res) => {
        if (res.ok && res.data.hasWebhook) {
          setWebhookInfo({ url: res.data.url!, secret: res.data.secret!, enabled: res.data.enabled });
        } else {
          setWebhookInfo(null);
        }
      });
    } else {
      setWebhookInfo(null);
    }
  }, [def?.type, node.id]);

  if (!def) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Unknown node type “{node.type}”. Remove this node.
      </div>
    );
  }

  const issueFor = (key: string) => validationIssues.find((i) => i.field === key);
  const runTest = async () => {
    setTesting(true);
    let input: unknown = {};
    try { input = JSON.parse(testInput || "{}"); } catch { /* keep {} */ }
    const res = await api<{ result: { status: string; output?: unknown; error?: { message?: string } } }>(
      `/api/workflows/${useFlowStore.getState().activeWorkflowId}/test-node`,
      {
        method: "POST",
        body: JSON.stringify({ nodeId: node.id, input, triggerSample: triggerData }),
      }
    );
    setTesting(false);
    if (!res.ok) {
      toast({ title: "Test failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    setTestResult(res.data.result);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-start gap-2.5">
          <div className="rounded-lg bg-muted p-2 shrink-0">
            {React.createElement(iconFor(def.icon), { className: "h-4 w-4" })}
          </div>
          <div className="min-w-0 flex-1">
            <input
              className="w-full bg-transparent text-sm font-medium outline-none focus:bg-muted/50 rounded px-1 -ml-1"
              value={node.name}
              onChange={(e) => onRename(e.target.value)}
              aria-label="Node name"
            />
            <div className="text-[11px] text-muted-foreground">{def.name}</div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        {validationIssues.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1">
            {validationIssues.map((issue, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {issue.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* webhook trigger: show URL */}
        {def.type === "trigger-webhook" && webhookInfo && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-medium flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Your webhook URL
            </div>
            <div className="flex gap-1.5">
              <code className="flex-1 text-[11px] font-mono bg-card border rounded px-2 py-1.5 break-all">
                {webhookInfo.url}
              </code>
              <Button
                size="icon" variant="outline" className="h-8 w-8 shrink-0"
                onClick={() => { navigator.clipboard.writeText(webhookInfo.url); toast({ title: "Webhook URL copied" }); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex gap-1.5 items-center">
              <div className="text-[11px] text-muted-foreground">Signing secret:</div>
              <code className="text-[10px] font-mono">{webhookInfo.secret.slice(0, 10)}…</code>
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] ml-auto"
                onClick={() => { navigator.clipboard.writeText(webhookInfo.secret); toast({ title: "Secret copied" }); }}
              >
                copy
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {webhookInfo.enabled
                ? "Accepting requests now (workflow is active)."
                : "The endpoint accepts requests after you publish & activate this workflow."}
            </div>
          </div>
        )}

        {def.configSchema.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">
            This node has no configuration.
          </div>
        )}

        {def.configSchema.map((field) => (
          <ConfigFieldRenderer
            key={field.key}
            field={field}
            def={def}
            config={node.config}
            value={node.config[field.key]}
            issue={issueFor(field.key)}
            connections={connections}
            onChange={(v) => onChange(field.key, v)}
            onOpenMapping={() => setMappingField(field.key)}
          />
        ))}

        <Separator />

        {/* Test node */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Test this node</div>
            <Button size="sm" variant="outline" className="h-7" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Run test
            </Button>
          </div>
          <Textarea
            className="text-xs font-mono h-20"
            placeholder='Test input JSON, e.g. {"amount": 1500}'
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
          {testResult !== null && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                Result:{" "}
                <Badge variant={((testResult as { status?: string })?.status) === "succeeded" ? "accent" : "destructive"} className="text-[10px]">
                  {String((testResult as { status?: string })?.status)}
                </Badge>
              </div>
              <JsonView data={testResult} maxHeight={240} />
            </div>
          )}
        </div>
      </div>

      {/* Mapping dialog */}
      <MappingDialog
        open={mappingField !== null}
        onClose={() => setMappingField(null)}
        onInsert={(expr) => {
          if (!mappingField) return;
          const current = String(node.config[mappingField] ?? "");
          const sep = current && !current.endsWith(" ") ? " " : "";
          onChange(mappingField, current + sep + expr);
        }}
        nodeOutputs={nodeOutputs}
        nodeNames={nodeNames}
        triggerData={triggerData}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

function ConfigFieldRenderer({
  field, def, config, value, issue, connections, onChange, onOpenMapping,
}: {
  field: CatalogNode["configSchema"][number];
  def: CatalogNode;
  config: Record<string, unknown>;
  value: unknown;
  issue: ValidationIssue | undefined;
  connections: ConnectionOption[];
  onChange: (v: unknown) => void;
  onOpenMapping: () => void;
}) {
  const visible = !field.showIf || config[field.showIf.key] === field.showIf.equals ||
    String(config[field.showIf.key] ?? "") === String(field.showIf.equals);

  const isExpressionish = ["expression", "json", "code", "textarea", "text"].includes(field.type);
  const label = (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs font-medium">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {isExpressionish && (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
          onClick={onOpenMapping}
        >
          <Braces className="h-3 w-3" /> insert data
        </button>
      )}
    </div>
  );

  let control: React.ReactNode;

  switch (field.type) {
    case "text":
    case "password":
      control = (
        <Input
          type={field.type === "password" ? "password" : "text"}
          className="h-8 text-sm"
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "number":
      control = (
        <Input
          type="number"
          className="h-8 text-sm"
          value={value === undefined || value === null || value === "" ? "" : Number(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
      break;
    case "textarea":
    case "json":
    case "code":
      control = (
        <Textarea
          className={`text-xs ${field.type === "json" || field.type === "code" ? "font-mono" : ""}`}
          rows={field.type === "textarea" ? 3 : 5}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "expression":
      control = (
        <Textarea
          className="text-xs font-mono"
          rows={2}
          placeholder={field.placeholder || "{{ $trigger.body.field }}"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "select":
      control = (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "radio":
      control = (
        <div className="flex flex-col gap-1.5">
          {(field.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`${def.type}-${field.key}`}
                checked={String(value ?? "") === o.value}
                onChange={() => onChange(o.value)}
                className="accent-primary"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    case "boolean":
      control = (
        <div className="flex items-center gap-2">
          <Switch
            checked={value === true || value === "true"}
            onCheckedChange={(v) => onChange(v)}
          />
          <span className="text-xs text-muted-foreground">
            {value === true || value === "true" ? "Enabled" : "Disabled"}
          </span>
        </div>
      );
      break;
    case "credential": {
      const allowed = connections.filter((c) => c.provider === field.credentialProvider);
      control = (
        <div className="space-y-1.5">
          <Select value={String(value ?? "") || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="No connection selected" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No connection (use server config if available)</SelectItem>
              {allowed.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {allowed.length === 0 && (
            <div className="text-[10px] text-amber-600 flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              No {field.credentialProvider} connection yet. Create one on the Connections page.
            </div>
          )}
        </div>
      );
      break;
    }
    case "fields":
      control = (
        <FieldListEditor
          rows={Array.isArray(value) ? (value as { key?: string; value?: string }[]) : []}
          onChange={onChange}
          onOpenMapping={onOpenMapping}
        />
      );
      break;
    case "renames":
      control = (
        <RenameListEditor
          rows={Array.isArray(value) ? (value as { from?: string; to?: string }[]) : []}
          onChange={onChange}
        />
      );
      break;
    case "fieldOps":
      control = (
        <FieldOpsEditor
          rows={Array.isArray(value) ? (value as { op?: string; key?: string; value?: string; to?: string }[]) : []}
          onChange={onChange}
          onOpenMapping={onOpenMapping}
        />
      );
      break;
    case "conditions":
      control = (
        <ConditionsEditor
          rows={Array.isArray(value) ? (value as { source?: string; operator?: string; target?: string }[]) : []}
          onChange={onChange}
          onOpenMapping={onOpenMapping}
        />
      );
      break;
    case "cases":
      control = (
        <CasesEditor
          rows={Array.isArray(value) ? (value as { value?: string }[]) : []}
          onChange={onChange}
        />
      );
      break;
    case "filters":
      control = (
        <FiltersEditor
          rows={Array.isArray(value) ? (value as { column?: string; op?: string; value?: string }[]) : []}
          onChange={onChange}
        />
      );
      break;
    case "date":
      control = (
        <Input
          type="date"
          className="h-8 text-sm"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "datetime":
      control = (
        <Input
          type="datetime-local"
          className="h-8 text-sm"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      control = <div className="text-xs text-muted-foreground">Unsupported field type</div>;
  }

  const visibleFinal = visible;
  if (!visibleFinal) return null;

  return (
    <div className="space-y-1.5" data-field={field.key}>
      {label}
      {control}
      {field.help && (
        <div className="text-[10px] text-muted-foreground flex items-start gap-1">
          <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" /> {field.help}
        </div>
      )}
      {issue && (
        <div className="text-[10px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {issue.message}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List editors
// ---------------------------------------------------------------------------

function FieldListEditor({
  rows, onChange, onOpenMapping,
}: {
  rows: { key?: string; value?: string }[];
  onChange: (rows: unknown) => void;
  onOpenMapping: () => void;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <Input
            className="h-7 text-xs w-28 shrink-0"
            placeholder="name"
            value={row.key ?? ""}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, key: e.target.value };
              onChange(next);
            }}
          />
          <Input
            className="h-7 text-xs flex-1 font-mono"
            placeholder="value or {{ expression }}"
            value={row.value ?? ""}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...row, value: e.target.value };
              onChange(next);
            }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { key: "", value: "" }])}>
          <Plus className="h-3 w-3" /> Add field
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpenMapping}>
          <Braces className="h-3 w-3" /> Map data
        </Button>
      </div>
    </div>
  );
}

function RenameListEditor({ rows, onChange }: { rows: { from?: string; to?: string }[]; onChange: (rows: unknown) => void }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <Input
            className="h-7 text-xs flex-1" placeholder="current name"
            value={row.from ?? ""}
            onChange={(e) => { const n = [...rows]; n[i] = { ...row, from: e.target.value }; onChange(n); }}
          />
          <span className="text-muted-foreground text-xs">→</span>
          <Input
            className="h-7 text-xs flex-1" placeholder="new name"
            value={row.to ?? ""}
            onChange={(e) => { const n = [...rows]; n[i] = { ...row, to: e.target.value }; onChange(n); }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { from: "", to: "" }])}>
        <Plus className="h-3 w-3" /> Add rename
      </Button>
    </div>
  );
}

function FieldOpsEditor({
  rows, onChange, onOpenMapping,
}: {
  rows: { op?: string; key?: string; value?: string; to?: string }[];
  onChange: (rows: unknown) => void;
  onOpenMapping: () => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border p-2 space-y-1.5">
          <div className="flex gap-1.5 items-center">
            <Select
              value={row.op ?? "set"}
              onValueChange={(v) => { const n = [...rows]; n[i] = { ...row, op: v }; onChange(n); }}
            >
              <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Set</SelectItem>
                <SelectItem value="rename">Rename</SelectItem>
                <SelectItem value="remove">Remove</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="h-7 text-xs flex-1"
              placeholder={row.op === "rename" ? "current field" : "field name"}
              value={row.key ?? ""}
              onChange={(e) => { const n = [...rows]; n[i] = { ...row, key: e.target.value }; onChange(n); }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {row.op === "rename" ? (
            <Input
              className="h-7 text-xs" placeholder="new field name"
              value={row.to ?? ""}
              onChange={(e) => { const n = [...rows]; n[i] = { ...row, to: e.target.value }; onChange(n); }}
            />
          ) : row.op !== "remove" && (
            <div className="flex gap-1.5">
              <Input
                className="h-7 text-xs flex-1 font-mono"
                placeholder='value or {{ expression }}'
                value={row.value ?? ""}
                onChange={(e) => { const n = [...rows]; n[i] = { ...row, value: e.target.value }; onChange(n); }}
              />
              <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0" onClick={onOpenMapping}>
                <Braces className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { op: "set", key: "", value: "" }])}>
        <Plus className="h-3 w-3" /> Add operation
      </Button>
    </div>
  );
}

function ConditionsEditor({
  rows, onChange, onOpenMapping,
}: {
  rows: { source?: string; operator?: string; target?: string }[];
  onChange: (rows: unknown) => void;
  onOpenMapping: () => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="bg-blue-500/10 text-blue-600 rounded px-1.5 py-0.5 font-medium">WHEN</span>
            <span>value</span>
          </div>
          <div className="flex gap-1.5">
            <Input
              className="h-7 text-xs flex-1 font-mono"
              placeholder='{{ $trigger.body.amount }} or "static"'
              value={row.source ?? ""}
              onChange={(e) => { const n = [...rows]; n[i] = { ...row, source: e.target.value }; onChange(n); }}
            />
            <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0 px-1.5" onClick={onOpenMapping} title="Insert data">
              <Braces className="h-3 w-3" />
            </Button>
          </div>
          <Select
            value={row.operator ?? "eq"}
            onValueChange={(v) => { const n = [...rows]; n[i] = { ...row, operator: v }; onChange(n); }}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPERATOR_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {row.operator && !["is_empty", "is_not_empty", "exists", "not_exists"].includes(row.operator) && (
            <Input
              className="h-7 text-xs font-mono"
              placeholder='{{ other.field }} or "value"'
              value={row.target ?? ""}
              onChange={(e) => { const n = [...rows]; n[i] = { ...row, target: e.target.value }; onChange(n); }}
            />
          )}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 className="h-3 w-3" /> Remove condition
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { source: "", operator: "eq", target: "" }])}>
        <Plus className="h-3 w-3" /> Add condition
      </Button>
    </div>
  );
}

function CasesEditor({ rows, onChange }: { rows: { value?: string }[]; onChange: (rows: unknown) => void }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <span className="text-[10px] text-muted-foreground w-14 shrink-0">Output {i + 1}</span>
          <Input
            className="h-7 text-xs flex-1 font-mono"
            placeholder='value or {{ expression }}'
            value={row.value ?? ""}
            onChange={(e) => { const n = [...rows]; n[i] = { ...row, value: e.target.value }; onChange(n); }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { value: "" }])}>
        <Plus className="h-3 w-3" /> Add case
      </Button>
    </div>
  );
}

function FiltersEditor({ rows, onChange }: { rows: { column?: string; op?: string; value?: string }[]; onChange: (rows: unknown) => void }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <Input
            className="h-7 text-xs w-24 shrink-0" placeholder="column"
            value={row.column ?? ""}
            onChange={(e) => { const n = [...rows]; n[i] = { ...row, column: e.target.value }; onChange(n); }}
          />
          <Select
            value={row.op ?? "eq"}
            onValueChange={(v) => { const n = [...rows]; n[i] = { ...row, op: v }; onChange(n); }}
          >
            <SelectTrigger className="h-7 text-xs w-16 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["eq", "neq", "gt", "lt", "gte", "lte", "like", "ilike", "is", "in"].map((op) => (
                <SelectItem key={op} value={op}>{op}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-7 text-xs flex-1" placeholder="value"
            value={row.value ?? ""}
            onChange={(e) => { const n = [...rows]; n[i] = { ...row, value: e.target.value }; onChange(n); }}
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...rows, { column: "", op: "eq", value: "" }])}>
        <Plus className="h-3 w-3" /> Add filter
      </Button>
    </div>
  );
}
