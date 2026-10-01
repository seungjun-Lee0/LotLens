// POST /api/billing/upgrade
//
// Basic → Pro on the subscriber's EXISTING subscription. A second Checkout
// would create a second subscription beside the first; this swaps the
// price on the one they have, invoices the prorated difference now, and
// resets the month's credits to Pro's quota (syncSubscription treats a
// plan change like a new cycle).

import { NextResponse } from "next/server";

import { getSessionUser, isActiveSubscriber } from "@/lib/auth";
import { syncSubscription } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  REPORT_CURRENCY,
  SUBSCRIPTION_PLANS,
  getStripe,
  isStripeConfigured,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Subscription items need a product ID (inline product_data is a
 * Checkout-only convenience), so keep one Pro product, found by its tag. */
async function proProductId(): Promise<string> {
  const stripe = getStripe();
  const found = await stripe.products.search({
    query: "active:'true' AND metadata['lotlens_plan']:'pro'",
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;
  const created = await stripe.products.create({
    name: SUBSCRIPTION_PLANS.pro.name,
    description: SUBSCRIPTION_PLANS.pro.description,
    metadata: { lotlens_plan: "pro" },
  });
  return created.id;
}

export async function POST(req: Request) {
  const limited = await enforceRateLimit("billing-upgrade", req, { limit: 5, windowSec: 600 });
  if (limited) return limited;
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  if (!isActiveSubscriber(user) || user.plan !== "basic") {
    return NextResponse.json(
      { error: "Only an active Basic plan can be upgraded here." },
      { status: 400 },
    );
  }
  const sql = getDb();
  const rows = (await sql`
    SELECT stripe_subscription_id FROM users WHERE id = ${user.id} LIMIT 1
  `) as Array<{ stripe_subscription_id: string | null }>;
  const subId = rows[0]?.stripe_subscription_id;
  if (!subId) {
    return NextResponse.json({ error: "No subscription on file." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const current = await stripe.subscriptions.retrieve(subId);
    const item = current.items.data[0];
    if (!item) {
      return NextResponse.json({ error: "Subscription has no items." }, { status: 400 });
    }
    const updated = await stripe.subscriptions.update(subId, {
      items: [
        {
          id: item.id,
          price_data: {
            currency: REPORT_CURRENCY,
            product: await proProductId(),
            unit_amount: SUBSCRIPTION_PLANS.pro.amountCents,
            recurring: { interval: "month" },
          },
        },
      ],
      // Charge the difference for the rest of this cycle now, rather than
      // handing over 50 credits on the promise of next month's invoice.
      proration_behavior: "always_invoice",
      // A declined card must leave the subscription exactly as it was:
      // without this the update sticks and the plan goes past_due.
      payment_behavior: "error_if_incomplete",
      metadata: { ...current.metadata, userId: user.id, plan: "pro" },
    });
    // The webhook will land too; syncing here makes the new balance
    // visible on the very next render.
    await syncSubscription(updated);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[billing/upgrade] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
