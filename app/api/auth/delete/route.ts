// POST /api/auth/delete — self-serve account deletion (Privacy policy
// promises it; this is the button behind that promise).
//
// Order matters: cancel the Stripe subscription FIRST (so we never delete
// the local user while they keep getting billed), then delete the user
// row. FK cascade removes password_resets + report_usage; reports.user_id
// is ON DELETE SET NULL so past reports survive un-linked (they hold no
// personal data beyond the searched address). Finally clear the session.

import { NextResponse } from "next/server";

import { destroySession, getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit("account-delete", req, { limit: 5, windowSec: 3600 });
  if (limited) return limited;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const sql = getDb();

  // Cancel any live subscription so deletion doesn't leave a billing zombie.
  try {
    const rows = (await sql`
      SELECT stripe_subscription_id FROM users WHERE id = ${user.id} LIMIT 1
    `) as Array<{ stripe_subscription_id: string | null }>;
    const subId = rows[0]?.stripe_subscription_id;
    if (subId && isStripeConfigured()) {
      await getStripe().subscriptions.cancel(subId);
    }
  } catch (err) {
    // A stale/already-canceled subscription must not block deletion.
    console.error("[auth/delete] subscription cancel (non-fatal):", err);
  }

  try {
    await sql`DELETE FROM users WHERE id = ${user.id}`;
  } catch (err) {
    console.error("[auth/delete] failed:", err);
    return NextResponse.json(
      { error: "Could not delete the account. Please try again." },
      { status: 500 },
    );
  }

  await destroySession();
  return NextResponse.json({ ok: true });
}
