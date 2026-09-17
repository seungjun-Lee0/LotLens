// GET /api/report/[id]/pdf
//
// Renders the report to a branded A4 PDF (maps + narrative). The heavy
// lifting lives in lib/render-report-pdf so the admin bulk-ZIP route shares
// the exact code path. Node runtime required (@react-pdf/renderer + sharp).

import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canViewReport } from "@/lib/pipeline";
import { enforceRateLimit } from "@/lib/rate-limit";
import { renderReportPdf } from "@/lib/render-report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Static map renders can take ~10-30 s when OSM tiles are cold. Bump the
// route timeout so we don't get axed mid-render on a slow upstream.
export const maxDuration = 60;

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  // A render is the most expensive thing this app does (aerial imagery +
  // sharp composites + react-pdf, tens of seconds). Everything that can
  // refuse the request must run BEFORE it: the limiter, the 404, the
  // ownership check and the paywall, all off one cheap row read.
  const limited = await enforceRateLimit("pdf", req, { limit: 10, windowSec: 600 });
  if (limited) return limited;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid report id" }, { status: 400 });
  }
  const sql = getDb();
  const [rows, viewer] = await Promise.all([
    sql`SELECT paid_at, user_id FROM reports WHERE id = ${id}::uuid LIMIT 1`,
    getSessionUser(),
  ]);
  const row = (rows as Array<{ paid_at: string | null; user_id: string | null }>)[0];
  const admin = isAdmin(viewer);
  // Same answer for "not yours" and "doesn't exist": no ownership probe.
  if (!row || !canViewReport({ ownerId: row.user_id }, viewer, admin)) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }
  // The report page only hides the download button for unpaid reports —
  // enforce the paywall here too so the URL can't be hit directly. Admins
  // (ADMIN_EMAILS) always pass.
  if (!row.paid_at && !admin) {
    return NextResponse.json({ error: "report not unlocked" }, { status: 403 });
  }

  const rendered = await renderReportPdf(id);
  if (!rendered) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${rendered.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
