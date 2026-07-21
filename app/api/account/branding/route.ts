// POST /api/account/branding — save the user's PDF report branding.
// Subscriber feature (the pricing page sells branded fact packs on paid
// plans); free accounts get a 403 with a friendly message.

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionUser, isActiveSubscriber } from "@/lib/auth";

export const runtime = "nodejs";

const HEX_RE = /^#[0-9a-f]{6}$/i;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!isActiveSubscriber(user)) {
    return NextResponse.json(
      { error: "Report branding is part of the paid plans." },
      { status: 403 },
    );
  }

  let body: { brandName?: unknown; brandColor?: unknown; brandLogoUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name =
    typeof body.brandName === "string" ? body.brandName.trim().slice(0, 60) : "";
  const color =
    typeof body.brandColor === "string" ? body.brandColor.trim() : "";
  const logo =
    typeof body.brandLogoUrl === "string" ? body.brandLogoUrl.trim().slice(0, 300) : "";

  if (color && !HEX_RE.test(color)) {
    return NextResponse.json(
      { error: "Accent colour must be a hex value like #0a84ff." },
      { status: 400 },
    );
  }
  if (logo && !/^https:\/\//i.test(logo)) {
    return NextResponse.json(
      { error: "Logo must be an https image URL." },
      { status: 400 },
    );
  }

  const sql = getDb();
  await sql`
    UPDATE users SET
      brand_name = ${name || null},
      brand_color = ${color || null},
      brand_logo_url = ${logo || null}
    WHERE id = ${user.id}
  `;
  return NextResponse.json({ ok: true });
}
