// /admin — read-only ops dashboard. Access is gated by ADMIN_EMAILS
// (comma-separated env); everyone else is bounced to the landing page.

import { redirect } from "next/navigation";
import Link from "next/link";

import { SiteHeader } from "@/components/site/site-header";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe";
import { getDb } from "@/lib/db";
import { formatAuAddress } from "@/lib/format-address";

export const dynamic = "force-dynamic";

type UserAdminRow = {
  email: string;
  name: string | null;
  plan: string;
  subscription_status: string | null;
  credits: number;
  report_count: number;
  created_at: string;
};

type RecentReportRow = {
  id: string;
  generated_at: string;
  address_text: string;
  paid_at: string | null;
  user_email: string | null;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) redirect("/");

  const sql = getDb();
  const [statRows, planRows, userRows, recentRows] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*)::int FROM users)                                            AS total_users,
        (SELECT count(*)::int FROM reports)                                          AS total_reports,
        (SELECT count(*)::int FROM reports WHERE generated_at >= now() - interval '7 days') AS reports_7d,
        (SELECT count(*)::int FROM addresses WHERE paid_at IS NOT NULL)              AS paid_addresses,
        (SELECT count(*)::int FROM report_usage)                                     AS credit_unlocks
    `,
    sql`
      SELECT plan, count(*)::int AS n FROM users
      WHERE plan IN ('basic','pro')
        AND subscription_status IN ('active','trialing')
      GROUP BY plan
    `,
    sql`
      SELECT u.email, u.name, u.plan, u.subscription_status, u.credits,
             u.created_at,
             (SELECT count(*)::int FROM reports r WHERE r.user_id = u.id) AS report_count
      FROM users u
      ORDER BY u.created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT r.id, r.generated_at, a.address_text, a.paid_at,
             u.email AS user_email
      FROM reports r
      JOIN addresses a ON a.id = r.address_id
      LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.generated_at DESC
      LIMIT 20
    `,
  ]);

  const stats = (statRows as Array<Record<string, number>>)[0] ?? {};
  const plans = Object.fromEntries(
    (planRows as Array<{ plan: string; n: number }>).map((r) => [r.plan, r.n]),
  );
  const basicN = plans.basic ?? 0;
  const proN = plans.pro ?? 0;
  const mrr =
    (basicN * SUBSCRIPTION_PLANS.basic.amountCents +
      proN * SUBSCRIPTION_PLANS.pro.amountCents) /
    100;
  const users = userRows as UserAdminRow[];
  const recent = recentRows as RecentReportRow[];

  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Users", value: String(stats.total_users ?? 0) },
    {
      label: "Active subscribers",
      value: String(basicN + proN),
      hint: `${basicN} basic · ${proN} pro`,
    },
    { label: "MRR (est.)", value: `$${mrr.toLocaleString()}`, hint: "AUD" },
    {
      label: "Reports",
      value: String(stats.total_reports ?? 0),
      hint: `${stats.reports_7d ?? 0} in last 7 days`,
    },
    {
      label: "Unlocked addresses",
      value: String(stats.paid_addresses ?? 0),
      hint: `${stats.credit_unlocks ?? 0} via credits`,
    },
  ];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <header>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Admin
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Operations
          </h1>
        </header>

        {/* Stat tiles */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div
              key={t.label}
              className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {t.label}
              </div>
              <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
                {t.value}
              </div>
              {t.hint && (
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {t.hint}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* Users */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Users <span className="font-normal text-muted-foreground">· newest 100</span>
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credits</th>
                  <th className="px-4 py-2.5 text-right font-medium">Reports</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No users yet.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.email} className="border-b border-border/40 last:border-0">
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-medium">
                      {u.email}
                      {u.name && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {u.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                        style={
                          u.plan === "pro"
                            ? { background: "color-mix(in oklab, var(--apple-purple) 14%, transparent)", color: "var(--apple-purple)" }
                            : u.plan === "basic"
                              ? { background: "color-mix(in oklab, var(--apple-blue) 12%, transparent)", color: "var(--apple-blue)" }
                              : { background: "color-mix(in oklab, var(--apple-gray) 14%, transparent)", color: "var(--apple-gray)" }
                        }
                      >
                        {u.plan}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {u.subscription_status ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.credits}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.report_count}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fmtDate(u.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent reports */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight">
            Recent reports <span className="font-normal text-muted-foreground">· last 20</span>
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Address</th>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Access</th>
                  <th className="px-4 py-2.5 font-medium">Generated</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No reports yet.
                    </td>
                  </tr>
                )}
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="max-w-[260px] truncate px-4 py-2.5">
                      <Link
                        href={`/report/${r.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {formatAuAddress(r.address_text)}
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 text-muted-foreground">
                      {r.user_email ?? "anonymous"}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.paid_at ? (
                        <span style={{ color: "var(--apple-green)" }}>Unlocked</span>
                      ) : (
                        <span className="text-muted-foreground">Preview</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fmtDate(r.generated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
