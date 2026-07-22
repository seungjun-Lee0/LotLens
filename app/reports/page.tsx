import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatAuAddress } from "@/lib/format-address";

export const dynamic = "force-dynamic";

type ReportListRow = {
  id: string;
  generated_at: string;
  address_text: string;
  paid_at: string | null;
};

export default async function MyReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=%2Freports");

  const sql = getDb();
  const rows = (await sql`
    SELECT r.id, r.generated_at, a.address_text, a.paid_at
    FROM reports r
    JOIN addresses a ON a.id = r.address_id
    WHERE r.user_id = ${user.id}
    ORDER BY r.generated_at DESC
    LIMIT 50
  `) as ReportListRow[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-24 pt-12 sm:pt-16">
        <header>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            My reports
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Reports you&rsquo;ve run
          </h1>
        </header>

        {rows.length === 0 ? (
          <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center">
            <FileText className="size-6 text-muted-foreground" />
            <p className="text-[14px] text-muted-foreground">
              No reports yet. Run your first one from the home page.
            </p>
            <Link
              href="/"
              className="mt-1 inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
              }}
            >
              Run a report <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/report/${r.id}`}
                  className="glass flex items-center justify-between gap-4 rounded-2xl px-5 py-4 transition hover:bg-foreground/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-medium">
                      {formatAuAddress(r.address_text)}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {new Date(r.generated_at).toLocaleDateString("en-AU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      {r.paid_at ? "Full report" : "Preview"}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
