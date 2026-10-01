// POST /api/checkout/webhook
//
// Stripe webhook: verifies the signature, claims the event id once, and
// hands the event to lib/billing (report unlock, credit pack, or
// subscription sync). The GET form re-applies one Checkout session by id,
// for clients that poll after the redirect back.

import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  applyCheckoutSession,
  syncCheckoutSessionById,
  syncSubscription,
} from "@/lib/billing";
import { getDb } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

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
      await applyCheckoutSession(
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
    return NextResponse.json({ paid: await syncCheckoutSessionById(sessionId) });
  } catch (err) {
    console.error("[checkout/webhook GET] retrieve failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
