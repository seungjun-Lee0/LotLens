// POST /api/checkout/create-session
// Body: { addressId: string, reportId: string }
// Creates a Stripe Checkout Session for $29 AUD and returns the redirect
// URL. The session carries { addressId, reportId } in metadata so the
// webhook can mark the address paid afterwards.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import {
  REPORT_CURRENCY,
  REPORT_PRICE_CENTS,
  getStripe,
  isStripeConfigured,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  addressId: z.string().uuid(),
  reportId: z.string().uuid(),
});

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

  let addressText = "Property report";
  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT address_text, paid_at FROM addresses WHERE id = ${parsed.addressId} LIMIT 1
    `) as Array<{ address_text: string; paid_at: string | null }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "address not found" }, { status: 404 });
    }
    if (rows[0].paid_at) {
      // Already paid — short-circuit back to the report page.
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
              name: "Brisbane Due Diligence Report",
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
