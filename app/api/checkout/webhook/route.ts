// POST /api/checkout/webhook
//
// Stripe webhook for Checkout completion. Marks the address paid_at +
// stores session id. Also exposed as a public endpoint that the report
// page can poll (with session_id) as a fallback when the webhook hasn't
// landed by the time the user is redirected back.

import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getDb } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function markPaid(session: Stripe.Checkout.Session) {
  const addressId = session.metadata?.addressId;
  if (!addressId) {
    console.warn("[checkout/webhook] no addressId in session metadata", session.id);
    return;
  }
  if (session.payment_status !== "paid") {
    console.log("[checkout/webhook] session not paid yet, skipping", session.id, session.payment_status);
    return;
  }
  const sql = getDb();
  await sql`
    UPDATE addresses
    SET paid_at = COALESCE(paid_at, now()),
        stripe_session_id = COALESCE(stripe_session_id, ${session.id})
    WHERE id = ${addressId}
  `;
}

// Newer Stripe API versions expose current_period_end on the subscription
// item rather than the subscription itself — read whichever is present.
function periodEnd(sub: Stripe.Subscription): string | null {
  const raw =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000).toISOString() : null;
}

/** Persist subscription state onto the user row (idempotent). */
async function syncSubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId;
  const plan = sub.metadata?.plan;
  if (!userId || (plan !== "basic" && plan !== "pro")) {
    console.warn("[checkout/webhook] subscription missing userId/plan metadata", sub.id);
    return;
  }
  const active = sub.status === "active" || sub.status === "trialing";
  const sql = getDb();
  await sql`
    UPDATE users
    SET plan = ${active ? plan : "free"},
        subscription_status = ${sub.status},
        stripe_subscription_id = ${sub.id},
        current_period_end = ${periodEnd(sub)}
    WHERE id = ${userId}
  `;
}

/** checkout.session.completed router — one-time report vs subscription. */
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

  let event: Stripe.Event;
  try {
    if (secret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, secret);
    } else {
      // Dev convenience: when STRIPE_WEBHOOK_SECRET is not set we accept
      // raw JSON so local testing via `stripe trigger checkout.session.completed`
      // still works. NEVER ship to prod without the secret set.
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    console.error("[checkout/webhook] signature verify failed:", err);
    return NextResponse.json(
      { error: `webhook signature failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  try {
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

// GET /api/checkout/webhook?session_id=... — polling fallback the report
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
