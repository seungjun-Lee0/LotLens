// POST /api/report/[id]/share — mint a read-only share link + QR code.
//
// Owner or admin only. Returns { url, qr, expiresIn }: `url` is the report
// page with the share token, `qr` a PNG data URL of that link, ready for a
// phone to scan at an open home. The token itself is stateless (lib/share).

import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canViewReport } from "@/lib/pipeline";
import { createShareToken, SHARE_DAYS_LABEL, withShareToken } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid report id" }, { status: 400 });
  }
  const [viewer, rows] = await Promise.all([
    getSessionUser(),
    getDb()`SELECT user_id FROM reports WHERE id = ${id}::uuid LIMIT 1`,
  ]);
  const row = (rows as Array<{ user_id: string | null }>)[0];
  // Sharing is an owner action: an anonymous run (no owner) has no one to
  // authorise it, and its plain URL already works as a link.
  if (!viewer || !row || !canViewReport({ ownerId: row.user_id }, viewer, isAdmin(viewer))) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  const origin = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const token = await createShareToken(id);
  const url = withShareToken(`${origin}/report/${id}`, token);
  // Medium error correction: a phone camera reads it from a laptop screen
  // or a printed A4 at arm's length; the margin keeps the quiet zone.
  const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 512 });
  return NextResponse.json({ url, qr, expiresIn: SHARE_DAYS_LABEL });
}
