// POST /api/auth/reset-password — { token, newPassword }
// Consumes a valid reset token, sets the new password, signs the user in.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createSession, hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  // Token brute-force guard: 10 attempts per hour per IP.
  const limited = enforceRateLimit("reset-password", req, { limit: 10, windowSec: 3600 });
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const sql = getDb();
    const tokenHash = createHash("sha256").update(body.token).digest("hex");
    // Atomically consume the token so it can't be replayed.
    const rows = (await sql`
      UPDATE password_resets
      SET used_at = now()
      WHERE token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id
    `) as Array<{ user_id: string }>;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one." },
        { status: 400 },
      );
    }
    const newHash = await hashPassword(body.newPassword);
    await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${rows[0].user_id}`;
    await createSession(rows[0].user_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/reset-password] failed:", err);
    return NextResponse.json(
      { error: "Could not reset the password. Please try again." },
      { status: 500 },
    );
  }
}
