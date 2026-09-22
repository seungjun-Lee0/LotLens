// GET /api/report/[id]/overlays/[module]
//
// One module's map overlays (context scope) for a report, fetched by the
// section's map when it nears the viewport. Before this the geometry for
// every section rode the page's RSC payload on first paint, whether or
// not its map was ever created. Reads the same cached council_data rows
// as the page, so the cost is one extractOverlays per request.

import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb, MODULE_ORDER, type Module } from "@/lib/db";
import { extractOverlays } from "@/lib/overlays";
import { canViewReport, loadCouncilRowsCached } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the report page: the one module an unpaid report shows in full.
const PREVIEW_MODULE: Module = "flooding";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; module: string }> },
) {
  const { id, module } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !MODULE_ORDER.includes(module as Module)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const sql = getDb();
  const [rows, viewer] = await Promise.all([
    sql`SELECT paid_at, user_id FROM reports WHERE id = ${id}::uuid LIMIT 1`,
    getSessionUser(),
  ]);
  const report = (rows as Array<{ paid_at: string | null; user_id: string | null }>)[0];
  const admin = isAdmin(viewer);
  if (!report || !canViewReport({ ownerId: report.user_id }, viewer, admin)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Same paywall as the page: an unpaid report serves only the preview.
  if (!report.paid_at && !admin && module !== PREVIEW_MODULE) {
    return NextResponse.json({ error: "report not unlocked" }, { status: 403 });
  }

  const row = (await loadCouncilRowsCached(id)).find((r) => r.module === module);
  const overlays = row ? extractOverlays(module as Module, row.raw_response) : [];
  return NextResponse.json(
    { overlays },
    {
      headers: {
        // Per-report data is immutable apart from a retry; an hour in the
        // browser cache covers a reading session without going stale for
        // long after one.
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
