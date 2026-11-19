"use client";

import { useEffect, useCallback } from "react";
import { useFlowStore, type SessionUser } from "./store";
import { api } from "./lib/api-client";
import { AuthView } from "./views/auth-view";
import { DashboardView } from "./views/dashboard-view";
import { WorkflowsView } from "./views/workflows-view";
import { EditorView } from "./views/editor-view";
import { ExecutionsView } from "./views/executions-view";
import { ExecutionDetailView } from "./views/execution-detail-view";
import { ConnectionsView } from "./views/connections-view";
import { TemplatesView } from "./views/templates-view";
import { SettingsView } from "./views/settings-view";
import { AppShell } from "./views/app-shell";
import { branding } from "@/config/branding";

export default function FlowStudioApp() {
  const { session, sessionLoading, setSession, setSessionLoading, view, catalog, setCatalog, setCatalogLoading, restoreFromHash } = useFlowStore();

  const loadSession = useCallback(async () => {
    const res = await api<{ authenticated: boolean; user: SessionUser | null }>("/api/auth/me");
    setSession(res.ok && res.data.authenticated ? res.data.user : null);
    setSessionLoading(false);
  }, [setSession, setSessionLoading]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // restore view context (editor / execution) from the URL hash on refresh
  useEffect(() => {
    restoreFromHash();
    const onHashChange = () => restoreFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [restoreFromHash]);

  // Load the shared node catalog once after login
  useEffect(() => {
    if (sessionLoading || !session || catalog.length > 0) return;
    setCatalogLoading(true);
    api<{ nodes: typeof catalog }>("/api/nodes").then((res) => {
      if (res.ok) setCatalog(res.data.nodes);
      else setCatalogLoading(false);
    });
  }, [session, sessionLoading, catalog.length, setCatalog, setCatalogLoading]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 rounded-2xl brand-gradient animate-pulse" />
            <div className="text-lg font-semibold brand-gradient">{branding.productName}</div>
            <div className="text-sm text-muted-foreground">Loading your workspace…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthView onAuthenticated={loadSession} />;
  }

  return (
    <AppShell onLoggedOut={loadSession}>
      {view === "dashboard" && <DashboardView />}
      {view === "workflows" && <WorkflowsView />}
      {view === "editor" && <EditorView />}
      {view === "executions" && <ExecutionsView />}
      {view === "execution-detail" && <ExecutionDetailView />}
      {view === "connections" && <ConnectionsView />}
      {view === "templates" && <TemplatesView />}
      {view === "settings" && <SettingsView onAccountDeleted={loadSession} />}
    </AppShell>
  );
}
