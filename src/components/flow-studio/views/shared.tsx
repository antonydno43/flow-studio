"use client";

import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, Clock, Loader2, PauseCircle, Ban, Timer, AlertTriangle,
} from "lucide-react";

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "accent"; icon: React.ElementType; color: string }> = {
  succeeded: { label: "Succeeded", variant: "accent", icon: CheckCircle2, color: "text-teal-600 dark:text-teal-400" },
  failed: { label: "Failed", variant: "destructive", icon: XCircle, color: "text-red-600 dark:text-red-400" },
  running: { label: "Running", variant: "default", icon: Loader2, color: "text-blue-600 dark:text-blue-400" },
  queued: { label: "Queued", variant: "secondary", icon: Clock, color: "text-muted-foreground" },
  waiting: { label: "Waiting", variant: "secondary", icon: PauseCircle, color: "text-amber-600 dark:text-amber-400" },
  cancelled: { label: "Cancelled", variant: "outline", icon: Ban, color: "text-muted-foreground" },
  timed_out: { label: "Timed out", variant: "destructive", icon: Timer, color: "text-red-600 dark:text-red-400" },
  skipped: { label: "Skipped", variant: "outline", icon: Ban, color: "text-muted-foreground" },
  pending: { label: "Pending", variant: "outline", icon: Clock, color: "text-muted-foreground" },
  active: { label: "Active", variant: "default", icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400" },
  draft: { label: "Draft", variant: "secondary", icon: Clock, color: "text-muted-foreground" },
  inactive: { label: "Inactive", variant: "outline", icon: PauseCircle, color: "text-muted-foreground" },
  archived: { label: "Archived", variant: "outline", icon: Ban, color: "text-muted-foreground" },
  connected: { label: "Connected", variant: "accent", icon: CheckCircle2, color: "text-teal-600 dark:text-teal-400" },
  untested: { label: "Untested", variant: "secondary", icon: Clock, color: "text-muted-foreground" },
  config_required: { label: "Setup needed", variant: "outline", icon: AlertTriangle, color: "text-amber-600" },
};

export function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const cfg = statusMap[status] ?? { label: status, variant: "outline" as const, icon: Clock, color: "text-muted-foreground" };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className={`${small ? "text-[10px] px-1.5 py-0" : ""} gap-1 font-medium`}>
      <Icon className={`${small ? "h-3 w-3" : "h-3.5 w-3.5"} ${status === "running" ? "animate-spin" : ""}`} />
      {cfg.label}
    </Badge>
  );
}

export function JsonView({ data, maxHeight = 300 }: { data: unknown; maxHeight?: number }) {
  const text = data === null || data === undefined
    ? "null"
    : typeof data === "string"
      ? tryPretty(data)
      : JSON.stringify(data, null, 2);
  return (
    <pre
      className="json-view rounded-lg border bg-muted/40 p-3 overflow-auto"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}

function tryPretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function formatDate(d: string | Date | null | undefined, withTime = true): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 h-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}
