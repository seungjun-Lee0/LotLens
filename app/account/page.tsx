import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site/site-header";
import {
  ManageBillingButton,
  SubscribeButton,
} from "@/components/site/billing-buttons";
import { NameForm, PasswordForm } from "@/components/site/account-security";
import { BrandingForm } from "@/components/site/branding-form";
import {
  PLAN_QUOTAS,
  getSessionUser,
  isActiveSubscriber,
} from "@/lib/auth";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams?: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const sp = (await searchParams) ?? {};

  // Post-checkout: sync the session before rendering so the new plan shows
  // even when the async webhook hasn't landed yet (same trick as /report).
  if (sp.session_id) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/checkout/webhook?session_id=${encodeURIComponent(sp.session_id)}`,
        { cache: "no-store" },
      );
    } catch {
      // webhook will catch up
    }
  }

  const user = await getSessionUser();
  if (!user) redirect("/login?next=%2Faccount");

  const subscriber = isActiveSubscriber(user);
  const quota = subscriber
    ? PLAN_QUOTAS[user.plan as keyof typeof PLAN_QUOTAS]
    : 0;
  const credits = subscriber ? user.credits : 0;
  const renews =
    subscriber && user.currentPeriodEnd
      ? new Date(user.currentPeriodEnd).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-24 pt-12 sm:pt-16">
        <header>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Account
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {user.name ?? user.email}
          </h1>
          {user.name && (
            <p className="mt-1 text-[13.5px] text-muted-foreground">{user.email}</p>
          )}
        </header>

        {sp.checkout === "success" && (
          <div
            className="rounded-2xl px-4 py-3 text-[13.5px] font-medium"
            style={{
              background: "color-mix(in oklab, var(--apple-green) 12%, transparent)",
              color: "var(--apple-green)",
            }}
          >
            ✓ Subscription active — welcome aboard.
          </div>
        )}

        {/* Plan card */}
        <section className="glass rounded-3xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Current plan
              </div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">
                {PLAN_LABELS[user.plan] ?? user.plan}
                {subscriber && renews && (
                  <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                    renews {renews}
                  </span>
                )}
              </div>
              {user.subscriptionStatus && !subscriber && (
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Subscription status: {user.subscriptionStatus}
                </p>
              )}
            </div>
            {user.stripeCustomerId && <ManageBillingButton />}
          </div>

          {subscriber && (
            <div className="mt-5">
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-muted-foreground">
                  Report credits left
                </span>
                <span className="font-medium">
                  {credits} / {quota}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (credits / quota) * 100)}%`,
                    background:
                      "linear-gradient(90deg, var(--apple-blue), var(--apple-purple))",
                  }}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {credits === 0 ? (
                  <>
                    <b className="font-semibold text-foreground">
                      No credits left this cycle
                    </b>{" "}
                    — credits reset when your plan renews
                    {renews ? ` on ${renews}` : ""}. Single reports at $19 still
                    work meanwhile.
                  </>
                ) : (
                  <>
                    1 credit unlocks 1 full report. Credits reset to {quota} when
                    your plan renews — they don&rsquo;t accumulate or top up
                    mid-cycle.
                  </>
                )}
              </p>
            </div>
          )}
        </section>

        {/* Upgrade cards for free users */}
        {!subscriber && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["basic", "pro"] as const).map((plan) => {
              const def = SUBSCRIPTION_PLANS[plan];
              return (
                <div
                  key={plan}
                  className="flex flex-col gap-3 rounded-3xl border border-border/60 bg-card/60 p-6 backdrop-blur-sm"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {PLAN_LABELS[plan]}
                  </div>
                  <div className="text-3xl font-semibold tracking-tight">
                    ${Math.round(def.amountCents / 100)}
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {" "}
                      / month
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {def.description}
                  </p>
                  <SubscribeButton
                    plan={plan}
                    label={`Upgrade to ${PLAN_LABELS[plan]}`}
                    variant={plan === "pro" ? "primary" : "ghost"}
                  />
                </div>
              );
            })}
          </section>
        )}

        {/* Report branding — subscriber feature */}
        {subscriber && (
          <section className="glass flex flex-col gap-4 rounded-3xl p-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Report branding
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Your name, accent colour and logo replace the default LotLens
                header on every PDF fact pack you export.
              </p>
            </div>
            <BrandingForm
              initialName={user.brandName ?? ""}
              initialColor={user.brandColor ?? ""}
              initialLogoUrl={user.brandLogoUrl ?? ""}
            />
          </section>
        )}

        {/* Profile & security */}
        <section className="glass flex flex-col gap-6 rounded-3xl p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Profile &amp; security
          </div>
          <NameForm initialName={user.name ?? ""} />
          <div className="h-px bg-border/60" />
          <PasswordForm hasPassword={user.hasPassword} />
        </section>

        {/* Sign out */}
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button
            type="submit"
            className="text-[13px] text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </main>
    </>
  );
}
