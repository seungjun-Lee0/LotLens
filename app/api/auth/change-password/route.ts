// POST /api/auth/change-password — { currentPassword?, newPassword }
// Logged-in users change their password; Google-only accounts (no hash
// yet) set one without a current password.

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getSessionUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
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
    const rows = (await sql`
      SELECT password_hash FROM users WHERE id = ${user.id} LIMIT 1
    `) as Array<{ password_hash: string | null }>;
    const hash = rows[0]?.password_hash ?? null;

    if (hash) {
      // Existing password — must prove they know it.
      if (!body.currentPassword) {
        return NextResponse.json(
          { error: "Enter your current password." },
          { status: 400 },
        );
      }
      const ok = await verifyPassword(body.currentPassword, hash);
      if (!ok) {
        return NextResponse.json(
          { error: "Current password is incorrect." },
          { status: 401 },
        );
      }
    }

    const newHash = await hashPassword(body.newPassword);
    await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${user.id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/change-password] failed:", err);
    return NextResponse.json(
      { error: "Could not update the password. Please try again." },
      { status: 500 },
    );
  }
}
