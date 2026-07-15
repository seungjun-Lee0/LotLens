// Transactional email via Resend's HTTP API (no SDK needed). Enabled only
// when RESEND_API_KEY is set — callers should check emailConfigured() and
// degrade gracefully (e.g. hide "forgot password" delivery) without it.
//
// EMAIL_FROM defaults to Resend's shared onboarding sender, which works
// without domain verification but only delivers to the Resend account
// owner's inbox — fine for beta testing, verify lotlens.au before launch.

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const from = process.env.EMAIL_FROM ?? "LotLens <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}

export function passwordResetHtml(link: string): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1d1d1f;">
    <h1 style="font-size:20px;margin:0 0 12px;">Reset your LotLens password</h1>
    <p style="font-size:14px;line-height:1.6;color:#3c3c43;margin:0 0 20px;">
      Someone (hopefully you) asked to reset the password for this account.
      The link below is valid for <b>1 hour</b> and can be used once.
    </p>
    <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px;">
      Choose a new password
    </a>
    <p style="font-size:12px;line-height:1.6;color:#86868b;margin:24px 0 0;">
      If you didn't request this, you can safely ignore this email — your
      password stays unchanged.
    </p>
  </div>`;
}
