// What a subscriber can do when the month's credits run out. Server
// component: it reads prices from lib/stripe and hands plain props to the
// client buttons.
//
//   Basic: upgrade to Pro (the better deal, the price difference buys 40
//          more reports every month) and the small pack
//   Pro:   the large pack, and the small one for a light top-up

import {
  BuyCreditsButton,
  UpgradeToProButton,
} from "@/components/site/billing-buttons";
import { PLAN_QUOTAS, type SessionUser } from "@/lib/auth";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, packsForPlan } from "@/lib/stripe";

const dollars = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export function TopUpOptions({
  user,
  reportId,
}: {
  user: SessionUser;
  /** Return to this report after buying a pack. */
  reportId?: string;
}) {
  const packs = packsForPlan(user.plan);
  if (packs.length === 0) return null;
  const canUpgrade = user.plan === "basic";
  const diff =
    SUBSCRIPTION_PLANS.pro.amountCents - SUBSCRIPTION_PLANS.basic.amountCents;

  return (
    <div className="flex flex-col gap-3">
      {canUpgrade && (
        <UpgradeToProButton
          label={`Upgrade to Pro: ${PLAN_QUOTAS.pro} reports a month`}
          priceNote={`Your plan switches to Pro (${dollars(SUBSCRIPTION_PLANS.pro.amountCents)} / month) now. You are charged the prorated difference for the rest of this billing period (at most ${dollars(diff)}), and your credits reset to ${PLAN_QUOTAS.pro} straight away.`}
        />
      )}
      <div
        className={
          packs.length > 1
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
            : "grid grid-cols-1 gap-3"
        }
      >
        {packs.map((pack, i) => {
          const def = CREDIT_PACKS[pack];
          return (
            <BuyCreditsButton
              key={pack}
              pack={pack}
              reportId={reportId}
              variant={!canUpgrade && i === 0 ? "primary" : "ghost"}
              label={`${def.credits} credits · ${dollars(def.amountCents)}`}
            />
          );
        })}
      </div>
      <p className="text-center text-[11.5px] text-muted-foreground">
        Pack credits never expire and are used after your monthly credits.
      </p>
    </div>
  );
}
