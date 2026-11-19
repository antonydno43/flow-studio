"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errMsg } from "../lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "../views/shared";
import { History, RotateCcw, Loader2 } from "lucide-react";

interface VersionRow {
  id: string;
  versionNumber: number;
  createdAt: string;
  publishedAt: string | null;
  isDraft: boolean;
  isPublished: boolean;
  nodeCount: number;
}

export function VersionHistoryDialog({
  open, onClose, workflowId, onRestored,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string | null;
  onRestored: () => void;
}) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workflowId) return;
    api<{ versions: VersionRow[] }>(`/api/workflows/${workflowId}/versions`).then((res) => {
      setVersions(res.ok ? res.data.versions : []);
    });
  }, [open, workflowId]);

  const restore = async (versionId: string) => {
    if (!workflowId) return;
    setRestoring(versionId);
    const res = await api(`/api/workflows/${workflowId}/versions`, {
      method: "POST",
      body: JSON.stringify({ versionId }),
    });
    setRestoring(null);
    if (!res.ok) {
      toast({ title: "Restore failed", description: errMsg(res), variant: "destructive" });
      return;
    }
    toast({ title: "Version restored", description: "The old version is now your draft. Publish & activate to make it live." });
    onRestored();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Version history
          </DialogTitle>
          <DialogDescription>
            Activating a workflow publishes an immutable snapshot that runs independently of later edits.
            Restoring a version copies it into a new draft.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto space-y-1.5">
          {versions === null && [...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
          {versions?.map((v) => (
            <div key={v.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="text-sm font-semibold tabular-nums w-8">v{v.versionNumber}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs">{v.nodeCount} node{v.nodeCount === 1 ? "" : "s"}</div>
                <div className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)}</div>
              </div>
              {v.isDraft && <Badge variant="secondary" className="text-[10px]">draft</Badge>}
              {v.isPublished && <Badge className="text-[10px]">published</Badge>}
              {!v.isDraft && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => restore(v.id)}
                  disabled={restoring !== null}
                >
                  {restoring === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Restore
                </Button>
              )}
            </div>
          ))}
          {versions?.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">No versions yet.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
