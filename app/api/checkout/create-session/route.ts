// POST /api/checkout/create-session
// Body (single report): { addressId, reportId }: one-time $19 beta payment.
// Body (subscription):  { plan: "basic" | "pro" }: requires a signed-in
// user; creates a monthly subscription Checkout. Webhook activates the plan.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser, isActiveSubscriber } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  CREDIT_PACKS,
  REPORT_CURRENCY,
  REPORT_PRICE_CENTS,
  SUBSCRIPTION_PLANS,
  getStripe,
  isStripeConfigured,
  packsForPlan,
  type CreditPack,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.union([
  z.object({
    addressId: z.string().uuid(),
    reportId: z.string().uuid(),
  }),
  z.object({
    plan: z.enum(["basic", "pro"]),
  }),
  z.object({
    pack: z.enum(["small", "large"]),
    /** Report to land back on after paying (else /account). */
    reportId: z.string().uuid().optional(),
  }),
]);

/**
 * One-off Checkout for a credit pack. Subscribers only, and only the
 * packs their plan may buy (see packsForPlan): the pack is a top-up for an
 * exhausted allowance, not a cheaper way around the subscription.
 */
async function createPackSession(
  req: Request,
  pack: CreditPack,
  reportId?: string,
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "auth required", loginUrl: "/login?next=%2Faccount" },
      { status: 401 },
    );
  }
  if (!isActiveSubscriber(user) || !packsForPlan(user.plan).includes(pack)) {
    return NextResponse.json(
      { error: "This credit pack is not available on your plan." },
      { status: 403 },
    );
  }
  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000";
  const def = CREDIT_PACKS[pack];
  const back = reportId ? `/report/${reportId}` : "/account";
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    currency: REPORT_CURRENCY,
    ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: REPORT_CURRENCY,
          unit_amount: def.amountCents,
          product_data: {
            name: `LotLens: ${def.name}`,
            description: "Report credits that never expire. Used after your monthly credits.",
          },
        },
      },
    ],
    metadata: {
      kind: "credit_pack",
      userId: user.id,
      pack,
      credits: String(def.credits),
    },
    success_url: `${origin}${back}?checkout=credits&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${back}`,
  });
  return NextResponse.json({ redirectUrl: session.url });
}

async function createSubscriptionSession(
  req: Request,
  plan: "basic" | "pro",
): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "auth required", loginUrl: "/login?next=%2F%23pricing" },
      { status: 401 },
    );
  }

  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000";
  const stripe = getStripe();
  const sql = getDb();

  // Reuse the Stripe customer so upgrades/cancels stay on one record.
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await sql`
      UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${user.id}
    `;
  }

  const planDef = SUBSCRIPTION_PLANS[plan];
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: REPORT_CURRENCY,
          unit_amount: planDef.amountCents,
          recurring: { interval: "month" },
          product_data: {
            name: planDef.name,
            description: planDef.description,
          },
        },
      },
    ],
    metadata: { userId: user.id, plan },
    subscription_data: { metadata: { userId: user.id, plan } },
    success_url: `${origin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
  });
  return NextResponse.json({ redirectUrl: session.url });
}

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe not configured. Set STRIPE_SECRET_KEY on Vercel." },
      { status: 503 },
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid body", details: String(err) },
      { status: 400 },
    );
  }

  if ("plan" in parsed) {
    try {
      return await createSubscriptionSession(req, parsed.plan);
    } catch (err) {
      console.error("[checkout] subscription session failed:", err);
      return NextResponse.json(
        { error: `stripe error: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }
  if ("pack" in parsed) {
    try {
      return await createPackSession(req, parsed.pack, parsed.reportId);
    } catch (err) {
      console.error("[checkout] credit pack session failed:", err);
      return NextResponse.json(
        { error: `stripe error: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  let addressText = "Property report";
  try {
    const sql = getDb();
    // The unlock is per report run (see the webhook): check the run the
    // buyer is on, and insist it belongs to the address in the body.
    const rows = (await sql`
      SELECT a.address_text, r.paid_at
      FROM reports r
      JOIN addresses a ON a.id = r.address_id
      WHERE r.id = ${parsed.reportId}::uuid AND r.address_id = ${parsed.addressId}::uuid
      LIMIT 1
    `) as Array<{ address_text: string; paid_at: string | null }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "report not found" }, { status: 404 });
    }
    if (rows[0].paid_at) {
      // Already paid: short-circuit back to the report page.
      return NextResponse.json({
        alreadyPaid: true,
        redirectUrl: `/report/${parsed.reportId}`,
      });
    }
    addressText = rows[0].address_text;
  } catch (err) {
    console.error("[checkout] db read failed:", err);
    return NextResponse.json(
      { error: `db read failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000";

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: REPORT_CURRENCY,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: REPORT_CURRENCY,
            unit_amount: REPORT_PRICE_CENTS,
            product_data: {
              name: "Queensland Due Diligence Report",
              description: addressText.slice(0, 120),
            },
          },
        },
      ],
      metadata: {
        addressId: parsed.addressId,
        reportId: parsed.reportId,
      },
      success_url: `${origin}/report/${parsed.reportId}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/report/${parsed.reportId}?cancelled=1`,
    });
    return NextResponse.json({ redirectUrl: session.url });
  } catch (err) {
    console.error("[checkout] stripe error:", err);
    return NextResponse.json(
      { error: `stripe error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
