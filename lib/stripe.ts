// Stripe Checkout integration — MVP beta pricing (Option 2).
//
//   Single report  $19 one-time  (standard $29 after beta — REPORT_PRICE_CENTS)
//   Basic          $49 / month   10 reports/month, single user
//   Pro            $79 / month   50 reports/month, branded reports
//
// One-time payment unlocks one address. Subscriptions unlock reports
// against a monthly quota (see lib/auth.ts PLAN_QUOTAS + pipeline).
// Subscription prices use inline price_data so no dashboard products are
// required; monthly plans renew monthly, nothing tops up without going
// through Checkout again.

import Stripe from "stripe";

export const REPORT_PRICE_CENTS = Number(
  process.env.REPORT_PRICE_CENTS ?? 1900,
); // AUD cents — beta $19 (2900 = $29 after beta)
export const REPORT_CURRENCY = (process.env.REPORT_CURRENCY ?? "aud").toLowerCase();

export const SUBSCRIPTION_PLANS = {
  basic: {
    name: "LotLens Basic",
    description: "10 reports per month · single user · cancel anytime",
    amountCents: Number(process.env.BASIC_PRICE_CENTS ?? 4900),
  },
  pro: {
    name: "LotLens Pro",
    description: "50 reports per month · branded reports · for professionals",
    amountCents: Number(process.env.PRO_PRICE_CENTS ?? 7900),
  },
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;

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
