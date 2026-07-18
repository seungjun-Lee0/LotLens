// POST /api/report/[id]/retry
// Re-runs the overlay fetches for a report whose last run had unreachable
// sources (fetchFailed council_data rows) and regenerates the narrative
// into the SAME report row. Never creates a new report, never spends
// credits — it's a repair action, so it's only allowed when at least one
// module actually failed.

import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { retryFailedChecks } from "@/lib/pipeline";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // Same upstream cost as fetch-overlays; retries should be rare.
  const limited = enforceRateLimit("report-retry", req, { limit: 3, windowSec: 600 });
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid report id" }, { status: 400 });
  }

  try {
    const sql = getDb();
    // Guard: only reports that actually have a failed row may be re-run
    // from this endpoint (stops it being used as a free "refresh my data"
    // hammer against the council endpoints).
    const failedRows = (await sql`
      SELECT cd.module
      FROM council_data cd
      JOIN reports r ON r.address_id = cd.address_id
      WHERE r.id = ${id} AND cd.raw_response->>'fetchFailed' = 'true'
    `) as Array<{ module: string }>;
    if (failedRows.length === 0) {
      return NextResponse.json(
        { error: "nothing to retry — all checks completed" },
        { status: 409 },
      );
    }

    const result = await retryFailedChecks(id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[report-retry] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
