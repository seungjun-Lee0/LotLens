// GET /api/report/[id]/pdf
//
// Renders the report to a branded A4 PDF (maps + narrative). The heavy
// lifting lives in lib/render-report-pdf so the admin bulk-ZIP route shares
// the exact code path. Node runtime required (@react-pdf/renderer + sharp).

import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { renderReportPdf } from "@/lib/render-report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Static map renders can take ~10-30 s when OSM tiles are cold. Bump the
// route timeout so we don't get axed mid-render on a slow upstream.
export const maxDuration = 60;

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const rendered = await renderReportPdf(id);
  if (!rendered) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }
  // The report page only hides the download button for unpaid reports —
  // enforce the paywall here too so the URL can't be hit directly. Admins
  // (ADMIN_EMAILS) always pass.
  if (!rendered.paid && !isAdmin(await getSessionUser())) {
    return NextResponse.json({ error: "report not unlocked" }, { status: 403 });
  }

  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${rendered.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
