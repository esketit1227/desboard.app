/**
 * Outbound email — Resend-backed over a plain fetch call (no SDK needed for
 * one endpoint), gracefully degrading to a console log when RESEND_API_KEY
 * isn't set. Same tradeoff as ANTHROPIC_API_KEY: the app works without it,
 * the feature it powers (client reminders) just doesn't actually send
 * anything until a studio configures a provider.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.REMINDER_FROM_EMAIL || "Desboard <onboarding@resend.dev>";

export const emailConfigured = !!RESEND_API_KEY;

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/** Returns true only if the email was actually handed to a provider — false (not a thrown error) when unconfigured or on failure, so callers can degrade gracefully. */
export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — would have sent "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] Resend API error ${res.status}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] Failed to send:", e);
    return false;
  }
}

/** A short, plain reminder — deliberately not trying to reproduce the studio's handover branding, since this is a nudge, not the deliverable itself. */
export function reminderEmailHtml(params: { studioName: string; handoverTitle: string; portalUrl: string; note?: string }): string {
  // Must also escape quotes: params.portalUrl (built from the request's Host
  // header in server.ts) lands inside an href="..." attribute below, and an
  // unescaped " could break out of it.
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1d1d1f;">
      <p>Hi,</p>
      <p><strong>${esc(params.studioName)}</strong> sent you <strong>${esc(params.handoverTitle)}</strong> for review, and it's still waiting on you.</p>
      ${params.note ? `<p style="color:#555;">${esc(params.note)}</p>` : ""}
      <p style="margin: 24px 0;">
        <a href="${esc(params.portalUrl)}" style="background:#2c2c2e; color:#fff; padding:12px 22px; border-radius:999px; text-decoration:none; font-weight:600;">Review now</a>
      </p>
      <p style="color:#86868b; font-size:13px;">No account needed — this link opens the review directly.</p>
    </div>`;
}
