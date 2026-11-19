"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ValidationResult } from "../store";
import { AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";

export function ValidationDialog({
  open, onClose, validation, onFocusNode,
}: {
  open: boolean;
  onClose: () => void;
  validation: ValidationResult | null;
  onFocusNode: (nodeId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {validation?.valid ? (
              <CheckCircle2 className="h-5 w-5 text-teal-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-500" />
            )}
            Workflow validation
          </DialogTitle>
          <DialogDescription>
            {validation?.valid
              ? "The workflow graph is valid and ready to run or activate."
              : "Fix these issues before running or activating the workflow. Click an issue to focus the node."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto space-y-1.5">
          {validation?.errors.map((issue, i) => (
            <button
              key={`e${i}`}
              className="w-full flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left hover:bg-destructive/10 transition-colors"
              onClick={() => issue.nodeId && onFocusNode(issue.nodeId)}
            >
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm text-destructive">{issue.message}</div>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {issue.code}{issue.nodeId ? ` · ${issue.nodeId}` : ""}{issue.field ? ` · ${issue.field}` : ""}
                </div>
              </div>
              {issue.nodeId && <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground shrink-0" />}
            </button>
          ))}
          {validation?.warnings.map((issue, i) => (
            <button
              key={`w${i}`}
              className="w-full flex items-start gap-2.5 rounded-lg border p-3 text-left hover:bg-muted/60 transition-colors"
              onClick={() => issue.nodeId && onFocusNode(issue.nodeId)}
            >
              <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm">{issue.message}</div>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{issue.code}</div>
              </div>
            </button>
          ))}
          {validation && validation.valid && validation.warnings.length === 0 && (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No errors, no warnings. You are good to go.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            <Badge variant="destructive">{validation?.errors.length ?? 0} errors</Badge>
            <Badge variant="secondary">{validation?.warnings.length ?? 0} warnings</Badge>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
