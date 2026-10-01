// POST /api/report/[id]/unlock
//
// Unlock an existing report with one of the caller's credits. Credits are
// normally spent when a report is generated; this covers the run that was
// generated with an empty balance and topped up afterwards, so a pack
// bought from the paywall can be used on the report the buyer is looking
// at. No Stripe involved: the money changed hands when the credit was
// granted.

import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { spendCredit } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { invalidateReportPdf } from "@/lib/pdf-cache";
import { canViewReport } from "@/lib/pipeline";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const limited = await enforceRateLimit("report-unlock", req, { limit: 30, windowSec: 600 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid report id" }, { status: 400 });
  }
  const sql = getDb();
  const rows = (await sql`
    SELECT user_id FROM reports WHERE id = ${id}::uuid LIMIT 1
  `) as Array<{ user_id: string | null }>;
  if (!rows[0] || !canViewReport({ ownerId: rows[0].user_id }, user, isAdmin(user))) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  try {
    const result = await spendCredit(user, id);
    if (!result.unlocked) {
      return NextResponse.json(
        { error: "No credits left.", creditsLeft: 0 },
        { status: 402 },
      );
    }
    // Unlock state is not part of the PDF, but a cached preview-era file
    // should never outlive a state change on the run.
    if (result.spent) await invalidateReportPdf(id).catch(() => {});
    return NextResponse.json({ ok: true, creditsLeft: result.creditsLeft, spent: result.spent });
  } catch (err) {
    console.error("[report-unlock] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
