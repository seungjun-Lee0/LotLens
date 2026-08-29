import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import {
  ManageBillingButton,
  SubscribeButton,
} from "@/components/site/billing-buttons";
import { NameForm, PasswordForm } from "@/components/site/account-security";
import { BrandingForm } from "@/components/site/branding-form";
import { DeleteAccount } from "@/components/site/delete-account";
import { formatAuAddress } from "@/lib/format-address";
import {
  PLAN_QUOTAS,
  getSessionUser,
  isActiveSubscriber,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe";

export const dynamic = "force-dynamic";

type RecentReport = {
  id: string;
  generated_at: string;
  address_text: string;
  paid_at: string | null;
};

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3 0-5.6-2-6.6-4.8H1.4v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.4 6.9 9 4.8 12 4.8z"
      />
    </svg>
  );
}

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

  // Most-recent reports, shown inline so the account page is a hub rather
  // than a dead link to /reports.
  const sql = getDb();
  const recent = (await sql`
    SELECT r.id, r.generated_at, a.address_text, a.paid_at
    FROM reports r
    JOIN addresses a ON a.id = r.address_id
    WHERE r.user_id = ${user.id}
    ORDER BY r.generated_at DESC
    LIMIT 3
  `) as RecentReport[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-24 pt-12 sm:pt-16">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Account
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {user.name ?? user.email}
            </h1>
            {user.name && (
              <p className="mt-1 text-[13.5px] text-muted-foreground">{user.email}</p>
            )}
          </div>
          <Link
            href="/reports"
            className="glass inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium text-foreground/80 transition hover:text-foreground"
          >
            <FileText className="size-4" />
            My reports
          </Link>
        </header>

        {sp.checkout === "success" && (
          <div
            className="rounded-2xl px-4 py-3 text-[13.5px] font-medium"
            style={{
              background: "color-mix(in oklab, var(--apple-green) 12%, transparent)",
              color: "var(--apple-green)",
            }}
          >
            ✓ Subscription active: welcome aboard.
          </div>
        )}

        {/* Recent reports — inline hub */}
        {recent.length > 0 && (
          <section className="glass flex flex-col gap-3 rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Recent reports
              </div>
              <Link
                href="/reports"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-border/50">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/report/${r.id}`}
                    className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-foreground/5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">
                        {formatAuAddress(r.address_text)}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {new Date(r.generated_at).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
                      style={{
                        background: r.paid_at
                          ? "color-mix(in oklab, var(--apple-green) 14%, transparent)"
                          : "color-mix(in oklab, var(--apple-blue) 12%, transparent)",
                        color: r.paid_at ? "var(--apple-green)" : "var(--apple-blue)",
                      }}
                    >
                      {r.paid_at ? "Full" : "Preview"}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
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
                      No credits left this cycle.
                    </b>{" "}
                    Credits reset when your plan renews
                    {renews ? ` on ${renews}` : ""}. Single reports at $19 still
                    work meanwhile.
                  </>
                ) : (
                  <>
                    1 credit unlocks 1 full report. Credits reset to {quota} when
                    your plan renews: they don&rsquo;t accumulate or top up
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

        {/* Report branding: subscriber feature */}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Profile &amp; security
            </div>
            {/* Google-only accounts have no password; make the sign-in
                method explicit so the differing password form isn't a
                mystery. */}
            {!user.hasPassword && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
                <GoogleGlyph />
                Signed in with Google
              </span>
            )}
          </div>
          <NameForm initialName={user.name ?? ""} />
          <div className="h-px bg-border/60" />
          <PasswordForm hasPassword={user.hasPassword} />
        </section>

        {/* Danger zone: account deletion */}
        <DeleteAccount email={user.email} />

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
