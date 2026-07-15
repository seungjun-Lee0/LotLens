// POST /api/auth/profile — { name } — update display name.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }
  try {
    const sql = getDb();
    await sql`UPDATE users SET name = ${body.name} WHERE id = ${user.id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/profile] failed:", err);
    return NextResponse.json(
      { error: "Could not update the profile. Please try again." },
      { status: 500 },
    );
  }
}
