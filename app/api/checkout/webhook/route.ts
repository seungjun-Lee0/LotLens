// POST /api/checkout/webhook
//
// Stripe webhook for Checkout completion. Marks the report paid_at +
// stores session id. Also exposed as a public endpoint that the report
// page can poll (with session_id) as a fallback when the webhook hasn't
// landed by the time the user is redirected back.

import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { PLAN_QUOTAS } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// The unlock belongs to the REPORT the buyer was looking at, never to the
// address: addresses are a cache key shared by everyone who searches the
// same label, so an address-level flag handed the full report to the next
// stranger who typed it in.
async function markPaid(session: Stripe.Checkout.Session) {
  const reportId = session.metadata?.reportId;
  const addressId = session.metadata?.addressId;
  if (!reportId && !addressId) {
    console.warn("[checkout/webhook] no reportId/addressId in session metadata", session.id);
    return;
  }
  if (session.payment_status !== "paid") {
    console.log("[checkout/webhook] session not paid yet, skipping", session.id, session.payment_status);
    return;
  }
  const sql = getDb();
  if (reportId) {
    await sql`
      UPDATE reports
      SET paid_at = COALESCE(paid_at, now()),
          stripe_session_id = COALESCE(stripe_session_id, ${session.id})
      WHERE id = ${reportId}::uuid
    `;
    return;
  }
  // Sessions created before reportId rode in the metadata: unlock the
  // newest run of that address, which is the one the buyer came from.
  await sql`
    UPDATE reports
    SET paid_at = COALESCE(paid_at, now()),
        stripe_session_id = COALESCE(stripe_session_id, ${session.id})
    WHERE id = (
      SELECT id FROM reports WHERE address_id = ${addressId}::uuid
      ORDER BY generated_at DESC LIMIT 1
    )
  `;
}

/** Stripe retries deliveries: claim the event id once, skip replays. */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  if (!event.id) return true; // unsigned dev payloads may carry no id
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

// Newer Stripe API versions expose current_period_end on the subscription
// item rather than the subscription itself: read whichever is present.
function periodEnd(sub: Stripe.Subscription): string | null {
  const raw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000).toISOString() : null;
}

/**
 * Persist subscription state onto the user row (idempotent) and manage the
 * credit balance:
 *   - activation / new billing period / plan change → credits reset to the
 *     plan's quota (basic 10, pro 50): plans renew monthly, they don't
 *     accumulate or top up mid-cycle;
 *   - cancellation / non-active status → plan back to free, credits zeroed.
 */
async function syncSubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId;
  const plan = sub.metadata?.plan;
  if (!userId || (plan !== "basic" && plan !== "pro")) {
    console.warn("[checkout/webhook] subscription missing userId/plan metadata", sub.id);
    return;
  }
  const active = sub.status === "active" || sub.status === "trialing";
  const newPeriodEnd = periodEnd(sub);
  const sql = getDb();

  const prevRows = (await sql`
    SELECT plan, current_period_end, credits FROM users WHERE id = ${userId} LIMIT 1
  `) as Array<{ plan: string; current_period_end: string | null; credits: number }>;
  const prev = prevRows[0];
  if (!prev) {
    console.warn("[checkout/webhook] user not found for subscription", sub.id, userId);
    return;
  }

  let credits = prev.credits ?? 0;
  if (!active) {
    credits = 0;
  } else {
    const planChanged = prev.plan !== plan;
    const newCycle =
      !!newPeriodEnd &&
      (!prev.current_period_end ||
        new Date(newPeriodEnd).getTime() >
          new Date(prev.current_period_end).getTime());
    if (planChanged || newCycle) credits = PLAN_QUOTAS[plan];
  }

  await sql`
    UPDATE users
    SET plan = ${active ? plan : "free"},
        subscription_status = ${sub.status},
        stripe_subscription_id = ${sub.id},
        current_period_end = ${newPeriodEnd},
        credits = ${credits}
    WHERE id = ${userId}
  `;
}

/** checkout.session.completed router: one-time report vs subscription. */
async function handleSessionCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (session.mode === "subscription") {
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subId) return;
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscription(sub);
    return;
  }
  await markPaid(session);
}

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
  }

  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  // With a secret configured the signature is mandatory: a missing header
  // is a forged request, not a reason to fall back. (Before, `secret && sig`
  // let anyone bypass verification in production by omitting the header.)
  // Without a secret, only a non-production build accepts raw JSON, for
  // `stripe trigger …` against localhost; production fails closed.
  let event: Stripe.Event;
  if (secret) {
    if (!sig) {
      return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });
    }
    try {
      event = stripe.webhooks.constructEvent(body, sig, secret);
    } catch (err) {
      console.error("[checkout/webhook] signature verify failed:", err);
      return NextResponse.json(
        { error: `webhook signature failed: ${(err as Error).message}` },
        { status: 400 },
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[checkout/webhook] STRIPE_WEBHOOK_SECRET is not set in production");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  } else {
    try {
      event = JSON.parse(body) as Stripe.Event;
    } catch (err) {
      return NextResponse.json({ error: `invalid json: ${(err as Error).message}` }, { status: 400 });
    }
  }

  try {
    if (!(await claimEvent(event))) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (event.type === "checkout.session.completed") {
      await handleSessionCompleted(
        stripe,
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription(event.data.object as Stripe.Subscription);
    }
  } catch (err) {
    console.error(`[checkout/webhook] ${event.type} failed:`, err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ received: true });
}

// GET /api/checkout/webhook?session_id=...: polling fallback the report
// page uses while the webhook is in-flight.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "missing session_id" }, { status: 400 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ paid: false }, { status: 200 });
  }
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    await handleSessionCompleted(stripe, session);
    return NextResponse.json({ paid: session.payment_status === "paid" });
  } catch (err) {
    console.error("[checkout/webhook GET] retrieve failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
