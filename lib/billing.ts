// Credits and subscription state: the writes behind the Stripe webhook,
// the post-checkout poll, the plan upgrade and every credit spend.
//
// Two balances live on the user row:
//   credits        the month's allowance. Reset to the plan quota on
//                  activation, renewal and plan change; zeroed on cancel.
//   bonus_credits  bought in packs. Never reset, never expire.
// A spend takes from the monthly allowance first, so paid-for credits are
// the last to go. Neon's HTTP driver gives each statement its own
// transaction, so every multi-step write here is ONE statement (CTEs)
// rather than a sequence that could stop half way.

import type Stripe from "stripe";

import { isActiveSubscriber, PLAN_QUOTAS, type SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

// ── Subscription sync ─────────────────────────────────────────────────────

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
 * monthly credit balance:
 *   - activation / new billing period / plan change → credits reset to the
 *     plan's quota (basic 10, pro 50): the allowance renews monthly, it
 *     does not accumulate;
 *   - cancellation / non-active status → plan back to free, monthly
 *     credits zeroed. Pack credits are never touched here.
 */
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.userId;
  const plan = sub.metadata?.plan;
  if (!userId || (plan !== "basic" && plan !== "pro")) {
    console.warn("[billing] subscription missing userId/plan metadata", sub.id);
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
    console.warn("[billing] user not found for subscription", sub.id, userId);
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

// ── Credit packs ──────────────────────────────────────────────────────────

/**
 * Add a paid pack's credits to the buyer. Keyed on the Checkout session
 * id: the ledger insert and the balance bump are one statement, and a
 * second call for the same session inserts nothing and so adds nothing.
 * Returns the credits granted by THIS call (0 on a replay).
 */
export async function grantCreditPack(session: Stripe.Checkout.Session): Promise<number> {
  const userId = session.metadata?.userId;
  const credits = Number(session.metadata?.credits ?? 0);
  if (!userId || !Number.isInteger(credits) || credits <= 0) {
    console.warn("[billing] credit pack session missing metadata", session.id);
    return 0;
  }
  if (session.payment_status !== "paid") return 0;
  const sql = getDb();
  const rows = (await sql`
    WITH ins AS (
      INSERT INTO credit_purchases (user_id, credits, amount_cents, stripe_session_id)
      VALUES (${userId}::uuid, ${credits}, ${session.amount_total ?? 0}, ${session.id})
      ON CONFLICT (stripe_session_id) DO NOTHING
      RETURNING credits
    )
    UPDATE users
    SET bonus_credits = bonus_credits + (SELECT credits FROM ins)
    WHERE id = ${userId}::uuid AND EXISTS (SELECT 1 FROM ins)
    RETURNING bonus_credits
  `) as Array<{ bonus_credits: number }>;
  return rows.length > 0 ? credits : 0;
}

// ── Spending ──────────────────────────────────────────────────────────────

export type CreditSpend = {
  /** True when the report is unlocked after this call. */
  unlocked: boolean;
  /** Spendable credits left (monthly while subscribed + pack credits). */
  creditsLeft: number;
  /** The plan's monthly quota, 0 for non-subscribers. */
  quota: number;
  /** False when the report was already unlocked and nothing was spent. */
  spent: boolean;
};

/**
 * Unlock one report with one credit. Monthly credits go first and only
 * count while the subscription is active; pack credits cover the rest and
 * work regardless of plan. The decrement is a single conditional UPDATE,
 * so two concurrent spends can never take the same credit. Never spends
 * on a report that is already unlocked.
 */
export async function spendCredit(user: SessionUser, reportId: string): Promise<CreditSpend> {
  const active = isActiveSubscriber(user);
  const quota = active ? PLAN_QUOTAS[user.plan as keyof typeof PLAN_QUOTAS] : 0;
  const sql = getDb();

  const existing = (await sql`
    SELECT paid_at FROM reports WHERE id = ${reportId}::uuid LIMIT 1
  `) as Array<{ paid_at: string | null }>;
  if (existing.length === 0) {
    return { unlocked: false, creditsLeft: (active ? user.credits : 0) + user.bonusCredits, quota, spent: false };
  }
  if (existing[0].paid_at) {
    return { unlocked: true, creditsLeft: (active ? user.credits : 0) + user.bonusCredits, quota, spent: false };
  }

  // The decrement, the unlock and the usage row are ONE statement, so a
  // failure cannot leave a credit taken and the report still locked.
  //   dec    takes the credit. SET expressions all read the row's OLD
  //          values, so both CASEs test the same "monthly credit?" test.
  //   claim  unlocks the run, only if it is still locked. An ownerless
  //          (anonymous) run is claimed by whoever pays for it.
  //   used   the usage ledger row, only for a claim that happened.
  const rows = (await sql`
    WITH dec AS (
      UPDATE users SET
        credits = CASE WHEN ${active}::boolean AND credits > 0 THEN credits - 1 ELSE credits END,
        bonus_credits = CASE WHEN ${active}::boolean AND credits > 0 THEN bonus_credits ELSE bonus_credits - 1 END
      WHERE id = ${user.id}::uuid
        AND ((${active}::boolean AND credits > 0) OR bonus_credits > 0)
      RETURNING credits, bonus_credits
    ),
    claim AS (
      UPDATE reports
      SET paid_at = now(),
          user_id = COALESCE(user_id, ${user.id}::uuid)
      WHERE id = ${reportId}::uuid
        AND paid_at IS NULL
        AND EXISTS (SELECT 1 FROM dec)
      RETURNING id
    ),
    used AS (
      INSERT INTO report_usage (user_id, report_id)
      SELECT ${user.id}::uuid, id FROM claim
      RETURNING 1
    )
    SELECT dec.credits, dec.bonus_credits,
           (SELECT count(*)::int FROM claim) AS claimed
    FROM dec
  `) as Array<{ credits: number; bonus_credits: number; claimed: number }>;
  if (rows.length === 0) {
    return { unlocked: false, creditsLeft: 0, quota, spent: false };
  }
  const left = (active ? rows[0].credits : 0) + rows[0].bonus_credits;

  if (rows[0].claimed === 0) {
    // Someone unlocked this run between the check above and the claim
    // (a second tab, a double submit): the run is open, so the credit
    // taken for it goes back. Pack balance takes the refund: it never
    // resets, so a renewal landing in between cannot swallow it.
    await sql`
      UPDATE users SET bonus_credits = bonus_credits + 1 WHERE id = ${user.id}::uuid
    `;
    return { unlocked: true, creditsLeft: left + 1, quota, spent: false };
  }
  return { unlocked: true, creditsLeft: left, quota, spent: true };
}

// ── Checkout completion ───────────────────────────────────────────────────

// The unlock belongs to the REPORT the buyer was looking at, never to the
// address: addresses are a cache key shared by everyone who searches the
// same label, so an address-level flag handed the full report to the next
// stranger who typed it in.
async function markReportPaid(session: Stripe.Checkout.Session): Promise<void> {
  const reportId = session.metadata?.reportId;
  const addressId = session.metadata?.addressId;
  if (!reportId && !addressId) {
    console.warn("[billing] no reportId/addressId in session metadata", session.id);
    return;
  }
  if (session.payment_status !== "paid") return;
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

/**
 * Apply one completed Checkout session: a subscription (sync the plan), a
 * credit pack (grant it) or a single report (unlock it). Every branch is
 * idempotent, because the webhook and the post-redirect sync both land
 * here for the same session.
 */
export async function applyCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode === "subscription") {
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subId) return;
    await syncSubscription(await stripe.subscriptions.retrieve(subId));
    return;
  }
  if (session.metadata?.kind === "credit_pack") {
    await grantCreditPack(session);
    return;
  }
  await markReportPaid(session);
}

/**
 * Post-redirect catch-up: Stripe sends the buyer back before the webhook
 * necessarily lands, so the page they return to applies the session
 * itself. Called in-process by the pages (no HTTP hop to our own API).
 * Returns whether the session is paid; never throws for "Stripe is not
 * configured", which is simply false.
 */
export async function syncCheckoutSessionById(sessionId: string): Promise<boolean> {
  const { getStripe, isStripeConfigured } = await import("@/lib/stripe");
  if (!isStripeConfigured()) return false;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  await applyCheckoutSession(stripe, session);
  return session.payment_status === "paid";
}
