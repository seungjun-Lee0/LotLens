// Stripe Checkout integration — one-time payment per report.
//
// Prototype scope: $29 AUD per address. Payment unlocks the full 8-module
// report at /report/[reportId]. When unpaid, the report page shows the
// Flooding module as a free preview and blurs the rest behind a CTA.

import Stripe from "stripe";

export const REPORT_PRICE_CENTS = Number(
  process.env.REPORT_PRICE_CENTS ?? 2900,
); // AUD cents — 2900 = $29
export const REPORT_CURRENCY = (process.env.REPORT_CURRENCY ?? "aud").toLowerCase();

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (typeof window !== "undefined") {
    throw new Error("getStripe() called from the browser. Use server-only.");
  }
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Missing STRIPE_SECRET_KEY. Use a test-mode `sk_test_…` key for now; swap to `sk_live_…` after ABN + Stripe activation.",
    );
  }
  cached = new Stripe(key);
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
