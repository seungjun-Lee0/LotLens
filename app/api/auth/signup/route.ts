// POST /api/auth/signup — { email, password, name? }
// Creates a user with a bcrypt password hash and signs them in.

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSession, hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();

  try {
    const sql = getDb();
    const existing = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as Array<{ id: string }>;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists. Log in instead." },
        { status: 409 },
      );
    }
    const passwordHash = await hashPassword(body.password);
    const rows = (await sql`
      INSERT INTO users (email, password_hash, name)
      VALUES (${email}, ${passwordHash}, ${body.name ?? null})
      RETURNING id
    `) as Array<{ id: string }>;
    await createSession(rows[0].id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/signup] failed:", err);
    return NextResponse.json(
      { error: "Sign up failed. Please try again." },
      { status: 500 },
    );
  }
}
