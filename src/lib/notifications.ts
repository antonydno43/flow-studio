/**
 * Notification service: in-app records + optional email delivery via Resend.
 * Emails are only attempted when RESEND_API_KEY is configured; otherwise the
 * record is stored with emailStatus "skipped_no_provider" (never fake-sent).
 */
import { db } from "@/lib/db";
import { safeFetch } from "@/lib/ssrf";

export type NotificationType =
  | "execution_succeeded"
  | "execution_failed"
  | "execution_failed_repeated"
  | "integration_alert"
  | "usage_limit"
  | "billing";

export const NOTIFICATION_TYPES: { id: NotificationType; label: string; default: boolean }[] = [
  { id: "execution_succeeded", label: "Successful executions", default: false },
  { id: "execution_failed", label: "Failed executions", default: true },
  { id: "execution_failed_repeated", label: "Repeated failures (3+ in a row)", default: true },
  { id: "integration_alert", label: "Integration connection problems", default: true },
  { id: "usage_limit", label: "Usage limit warnings", default: true },
  { id: "billing", label: "Billing & subscription events", default: true },
];

export async function ensureDefaultPreferences(workspaceId: string) {
  const existing = await db.notificationPreference.findMany({ where: { workspaceId } });
  const have = new Set(existing.map((p) => p.notificationType));
  const missing = NOTIFICATION_TYPES.filter((t) => !have.has(t.id));
  if (missing.length) {
    await db.notificationPreference.createMany({
      data: missing.map((t) => ({
        workspaceId,
        notificationType: t.id,
        enabled: t.default,
      })),
    });
  }
}

async function isPreferred(workspaceId: string, type: NotificationType): Promise<boolean> {
  const pref = await db.notificationPreference.findUnique({
    where: { workspaceId_notificationType: { workspaceId, notificationType: type } },
  });
  return pref ? pref.enabled : (NOTIFICATION_TYPES.find((t) => t.id === type)?.default ?? false);
}

function emailTemplate(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F5F7FB;font-family:Segoe UI,Arial,sans-serif;color:#202A3B;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5E9F2;">
    <div style="background:linear-gradient(135deg,#2563EB,#6757D9);padding:20px 28px;">
      <h1 style="color:#ffffff;font-size:18px;margin:0;font-weight:600;">Flow Studio</h1>
    </div>
    <div style="padding:28px;">
      <h2 style="margin:0 0 12px;font-size:16px;color:#202A3B;">${escapeHtml(title)}</h2>
      <div style="font-size:14px;line-height:1.6;color:#4B5563;">${bodyHtml}</div>
    </div>
    <div style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E5E9F2;font-size:12px;color:#768196;">
      You are receiving this because of your Flow Studio notification preferences.
    </div>
  </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendEmail(to: string, subject: string, html: string): Promise<"sent" | "failed" | "skipped_no_provider"> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return "skipped_no_provider";
  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  try {
    const res = await safeFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
      timeoutMs: 15000,
    });
    return res.status >= 200 && res.status < 300 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function notify(opts: {
  workspaceId: string;
  type: NotificationType;
  title: string;
  body: string;
  emailTo?: string;
}): Promise<void> {
  try {
    const preferred = await isPreferred(opts.workspaceId, opts.type);
    if (!preferred) return;
    let emailStatus: string | null = null;
    if (opts.emailTo) {
      emailStatus = await sendEmail(
        opts.emailTo,
        `[Flow Studio] ${opts.title}`,
        emailTemplate(opts.title, `<p>${escapeHtml(opts.body)}</p>`)
      );
    }
    await db.notificationRecord.create({
      data: {
        workspaceId: opts.workspaceId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        channel: opts.emailTo ? "email+in_app" : "in_app",
        emailStatus,
      },
    });
  } catch (err) {
    console.error("[notifications] failed to record notification:", err);
  }
}
