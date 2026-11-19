"use client";

import { useState, useEffect, useCallback } from "react";
import { useFlowStore, type ViewId } from "../store";
import { api } from "../lib/api-client";
import { branding } from "@/config/branding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard, Workflow, Activity, Plug, LayoutTemplate, Settings, LogOut,
  Bell, Menu, Moon, Sun, ChevronRight, CircleUser,
} from "lucide-react";

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ElementType;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "executions", label: "Executions", icon: Activity },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "settings", label: "Settings", icon: Settings },
];

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function AppShell({ children, onLoggedOut }: { children: React.ReactNode; onLoggedOut: () => void }) {
  const { session, view, navigate, bumpExecutions } = useFlowStore();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("fs-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);

  // keep <html> class in sync with the theme state
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("fs-theme", next ? "dark" : "light");
  };

  const loadNotifications = useCallback(async () => {
    const res = await api<{ notifications: NotificationRow[]; unreadCount: number }>("/api/notifications");
    if (res.ok) {
      setNotifications(res.data.notifications);
      setUnread(res.data.unreadCount);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, setState happens after await
    loadNotifications();
    const t = setInterval(loadNotifications, 60_000);
    return () => clearInterval(t);
  }, [loadNotifications]);

  const markAllRead = async () => {
    await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ markAllRead: true }) });
    loadNotifications();
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    toast({ title: "Logged out" });
    onLoggedOut();
  };

  const initials = (session?.fullName || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex min-h-0">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex w-60 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border sticky top-0 h-screen">
          <SidebarContent view={view} navigate={navigate} onLogout={logout} />
        </aside>

        {/* Sidebar (mobile drawer) */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
            <aside className="relative w-64 max-w-[80%] bg-sidebar text-sidebar-foreground flex flex-col h-full">
              <SidebarContent
                view={view}
                navigate={(v) => { navigate(v); setSidebarOpen(false); }}
                onLogout={logout}
              />
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="sticky top-0 z-40 h-14 border-b bg-card/80 backdrop-blur flex items-center gap-2 px-3 sm:px-5">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>

            <div className="lg:hidden flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white">
                <Workflow className="h-4 w-4" />
              </div>
              <span className="font-semibold text-foreground">{branding.productName}</span>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>{session?.workspaceName}</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium capitalize">{view === "execution-detail" ? "Execution" : view}</span>
            </div>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
                {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
              </Button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                    <Bell className="h-4.5 w-4.5" />
                    {unread > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-[10px] text-white flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <span className="font-medium text-sm">Notifications</span>
                    {unread > 0 && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllRead}>
                        Mark all read
                      </Button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        No notifications yet. Failed executions and alerts appear here.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={cn("px-4 py-3 border-b last:border-0", !n.readAt && "bg-primary/5")}
                        >
                          <div className="text-sm font-medium">{n.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {new Date(n.createdAt).toLocaleString("en-IN")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 h-9 pl-1">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-primary/15 text-primary text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:inline text-sm font-medium text-foreground max-w-32 truncate">
                      {session?.fullName.split(" ")[0]}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="text-sm font-medium">{session?.fullName}</div>
                    <div className="text-xs text-muted-foreground font-normal truncate">{session?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("settings")}>
                    <CircleUser className="h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { navigate("settings"); }}>
                    <Badge variant="secondary" className="text-[10px] capitalize">{session?.planId} plan</Badge>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive">
                    <LogOut className="h-4 w-4" /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 min-h-0">{children}</main>

          {/* Sticky footer */}
          <footer className="mt-auto border-t bg-card">
            <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded bg-gradient-to-br from-blue-600 to-violet-600" />
                <span>{branding.productName} — {branding.tagline}</span>
              </div>
              <div className="flex items-center gap-4">
                <span>{session?.planId.toUpperCase()} plan</span>
                <span>·</span>
                <span>{branding.productName} never asks for your credentials in chat or email.</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  view, navigate, onLogout,
}: {
  view: ViewId;
  navigate: (v: ViewId) => void;
  onLogout: () => void;
}) {
  const { session } = useFlowStore();
  return (
    <>
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white shrink-0">
          <Workflow className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{branding.productName}</div>
          <div className="text-[10px] text-sidebar-foreground/60 truncate">{session?.workspaceName}</div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1" aria-label="Main navigation">
        {NAV.map((item) => {
          const active = view === item.id || (item.id === "executions" && view === "execution-detail");
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white"
              )}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {item.label}
              {active && <ChevronRight className="ml-auto h-4 w-4 opacity-60" />}
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-sidebar-border">
        <div className="rounded-lg bg-sidebar-accent/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-sidebar-foreground/70">Plan</span>
            <Badge variant="secondary" className="capitalize text-[10px]">{session?.planId}</Badge>
          </div>
          <Button
            size="sm"
            className="w-full mt-2 h-7 text-xs bg-gradient-to-r from-blue-600 to-violet-600 border-0 text-white"
            onClick={() => navigate("settings")}
          >
            Manage billing
          </Button>
        </div>
        <button
          onClick={onLogout}
          className="mt-2 w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white transition-colors"
        >
          <LogOut className="h-4.5 w-4.5" /> Log out
        </button>
      </div>
    </>
  );
}
