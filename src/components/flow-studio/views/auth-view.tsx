"use client";

import { useState, useCallback } from "react";
import { api, errMsg } from "../lib/api-client";
import { branding } from "@/config/branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Workflow, Sparkles, ShieldCheck, Zap, AlertCircle, Loader2 } from "lucide-react";
import type { SessionUser } from "../store";

export function AuthView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [regForm, setRegForm] = useState({ fullName: "", email: "", password: "", workspaceName: "" });

  const submitLogin = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await api<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(loginForm),
    });
    setBusy(false);
    if (!res.ok) { setError(errMsg(res)); return; }
    toast({ title: `Welcome back, ${res.data.user.fullName.split(" ")[0]}!` });
    onAuthenticated();
  }, [loginForm, onAuthenticated, toast]);

  const submitRegister = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await api<{ user: SessionUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        fullName: regForm.fullName,
        email: regForm.email,
        password: regForm.password,
        ...(regForm.workspaceName ? { workspaceName: regForm.workspaceName } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) { setError(errMsg(res)); return; }
    toast({ title: "Account created", description: "Your personal workspace is ready." });
    onAuthenticated();
  }, [regForm, onAuthenticated, toast]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 grid lg:grid-cols-2">
        {/* Left: brand hero */}
        <div className="relative hidden lg:flex flex-col justify-between p-12 bg-[#101729] text-white overflow-hidden">
          <div className="absolute inset-0 grid-pattern opacity-[0.15]" />
          <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-blue-600/30 blur-3xl" />
          <div className="absolute bottom-0 -left-24 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
              <Workflow className="h-5 w-5" />
            </div>
            <span className="text-xl font-semibold">{branding.productName}</span>
          </div>
          <div className="relative space-y-6 max-w-md">
            <h1 className="text-4xl font-bold leading-tight">
              Automate anything.<br />
              <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">See every step.</span>
            </h1>
            <p className="text-blue-100/80 text-lg">
              Build workflows visually, connect real APIs, and watch every execution - node by node.
            </p>
            <div className="space-y-3">
              {[
                { icon: Zap, text: "Manual, webhook & schedule triggers" },
                { icon: Sparkles, text: "40+ logic, data & integration nodes" },
                { icon: ShieldCheck, text: "Encrypted credential vault" },
              ].map((f) => (
                <div key={f.text} className="flex items-center gap-3 text-sm text-blue-100/90">
                  <f.icon className="h-4 w-4 text-teal-400" />
                  {f.text}
                </div>
              ))}
            </div>
          </div>
          <div className="relative text-xs text-white/40">
            © {new Date().getFullYear()} {branding.company}. One private workspace per account.
          </div>
        </div>

        {/* Right: auth forms */}
        <div className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md space-y-8">
            <div className="lg:hidden flex items-center gap-3 justify-center">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white">
                <Workflow className="h-5 w-5" />
              </div>
              <span className="text-xl font-semibold">{branding.productName}</span>
            </div>

            <div className="text-center lg:text-left">
              <h2 className="text-2xl font-semibold">
                {mode === "login" ? "Log in to your workspace" : "Create your workspace"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {mode === "login"
                  ? "Welcome back. Your automations are waiting."
                  : "Free plan: 5 workflows, 200 executions/month. No credit card."}
              </p>
            </div>

            <Tabs
              value={mode}
              onValueChange={(v) => { setMode(v as "login" | "register"); setError(null); }}
            >
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="login">Log in</TabsTrigger>
                <TabsTrigger value="register">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email" type="email" placeholder="you@company.com" autoComplete="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password" type="password" placeholder="••••••••" autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                  />
                </div>
                <Button className="w-full" onClick={submitLogin} disabled={busy || !loginForm.email || !loginForm.password}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log in"}
                </Button>
              </TabsContent>

              <TabsContent value="register" className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name">Full name</Label>
                  <Input
                    id="reg-name" placeholder="Ada Lovelace" autoComplete="name"
                    value={regForm.fullName}
                    onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input
                    id="reg-email" type="email" placeholder="you@company.com" autoComplete="email"
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-password">Password</Label>
                  <Input
                    id="reg-password" type="password" placeholder="At least 8 characters" autoComplete="new-password"
                    value={regForm.password}
                    onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg-workspace">
                    Workspace name <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="reg-workspace" placeholder={`${regForm.fullName.split(" ")[0] || "My"}'s Workspace`}
                    value={regForm.workspaceName}
                    onChange={(e) => setRegForm({ ...regForm, workspaceName: e.target.value })}
                  />
                </div>
                <Button className="w-full" onClick={submitRegister} disabled={busy || !regForm.email || !regForm.password || !regForm.fullName}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
                </Button>
              </TabsContent>
            </Tabs>

            {error && (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="flex items-start gap-2 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-center text-muted-foreground">
              Your workspace is private - one owner per workspace, no sharing or invitations.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
