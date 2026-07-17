// POST /api/auth/login — { email, password }

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSession, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  // Credential-stuffing guard: 10 attempts per 10 minutes per IP.
  const limited = enforceRateLimit("login", req, { limit: 10, windowSec: 600 });
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Enter your email and password." },
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();

  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT id, password_hash FROM users WHERE email = ${email} LIMIT 1
    `) as Array<{ id: string; password_hash: string | null }>;
    // Same error for unknown email vs wrong password — don't leak which.
    const fail = () =>
      NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    if (rows.length === 0) return fail();
    if (!rows[0].password_hash) {
      return NextResponse.json(
        { error: "This account uses Google sign-in. Use the Google button." },
        { status: 401 },
      );
    }
    const ok = await verifyPassword(body.password, rows[0].password_hash);
    if (!ok) return fail();
    await createSession(rows[0].id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json(
      { error: "Log in failed. Please try again." },
      { status: 500 },
    );
  }
}
