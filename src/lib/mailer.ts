/**
 * Transactional email through Resend (https://resend.com). If RESEND_API_KEY is not set, emails
 * are skipped silently, so the app works the same without it. Email never blocks or fails an action.
 */

const resendKey = () => process.env.RESEND_API_KEY || process.env.SEND_API_KEY; // either name works

export function emailConfigured() {
  return Boolean(resendKey());
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Simple branded email: a heading, a line of text and one button. */
export function renderEmail(p: { title: string; body?: string | null; ctaLabel: string; ctaUrl: string }) {
  return `<!doctype html><html><body style="margin:0;background:#fbf4e8;font-family:Arial,Helvetica,sans-serif;color:#13261c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #ece3d3;border-radius:16px" cellpadding="0" cellspacing="0">
<tr><td style="background:#0f3d2a;border-radius:16px 16px 0 0;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:bold">The True Scholars</td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escape(p.title)}</h1>
${p.body ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#4b5c51">${escape(p.body)}</p>` : ""}
<a href="${escape(p.ctaUrl)}" style="display:inline-block;background:#0f3d2a;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${escape(p.ctaLabel)}</a>
</td></tr></table>
<p style="font-size:12px;color:#4b5c51;margin:16px 0 0">You're receiving this because of activity on your True Scholars account.</p>
</td></tr></table></body></html>`;
}

export async function sendEmail(p: { to: string; subject: string; html: string }): Promise<boolean> {
  const key = resendKey();
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "The True Scholars <notifications@thetruescholars.com>",
        to: [p.to],
        subject: p.subject,
        html: p.html,
      }),
    });
    if (!res.ok) console.error("email failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("email failed", err);
    return false;
  }
}
