// POST /api/auth/forgot-password — { email }
// Always answers 200 with the same body so the endpoint can't be used to
// probe which emails have accounts. When the user exists and email sending
// is configured, a single-use 1-hour reset link is issued.

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { emailConfigured, passwordResetHtml, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ email: z.string().email().max(254) });

const GENERIC = {
  ok: true,
  message:
    "If an account exists for that email, a reset link is on its way. Check your inbox.",
};

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  try {
    if (!emailConfigured()) {
      // No sender configured — still answer generically.
      console.warn("[auth/forgot-password] RESEND_API_KEY not set; skipping send");
      return NextResponse.json(GENERIC);
    }
    const sql = getDb();
    const rows = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as Array<{ id: string }>;
    if (rows.length === 0) return NextResponse.json(GENERIC);
    const userId = rows[0].id;

    // One live token per user — a new request invalidates older links.
    await sql`
      DELETE FROM password_resets WHERE user_id = ${userId} AND used_at IS NULL
    `;
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await sql`
      INSERT INTO password_resets (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, now() + interval '1 hour')
    `;

    const origin =
      req.headers.get("origin") ??
      process.env.NEXT_PUBLIC_BASE_URL ??
      "http://localhost:3000";
    await sendEmail({
      to: email,
      subject: "Reset your LotLens password",
      html: passwordResetHtml(`${origin}/reset-password?token=${token}`),
    });
    return NextResponse.json(GENERIC);
  } catch (err) {
    console.error("[auth/forgot-password] failed:", err);
    // Still generic — never leak internals to this endpoint.
    return NextResponse.json(GENERIC);
  }
}
