// POST /api/billing/portal — opens the Stripe customer portal so
// subscribers can update cards, switch plans, or cancel.

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing profile yet — subscribe to a plan first." },
      { status: 400 },
    );
  }
  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000";
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/account`,
    });
    return NextResponse.json({ redirectUrl: session.url });
  } catch (err) {
    console.error("[billing/portal] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
