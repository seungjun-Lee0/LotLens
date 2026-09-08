import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ReportList } from "@/components/reports/report-list";
import { ReportListSkeleton } from "@/components/reports/report-list-skeleton";
import { SiteHeader } from "@/components/site/site-header";
import { getSessionUser, isAdmin } from "@/lib/auth";
import {
  listUserReports,
  parseReportListFilter,
  type ReportListFilter,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

// The list query is the slow part (council_data join). It streams in behind
// a skeleton, while the auth check above it stays synchronous so a
// signed-out visitor gets a real 307 rather than a flash of placeholders.
async function List({
  userId,
  q,
  filter,
  canDownloadPreviews,
}: {
  userId: string;
  q: string;
  filter: ReportListFilter;
  canDownloadPreviews: boolean;
}) {
  const page = await listUserReports(userId, { q, filter, limit: 20 });
  return (
    <ReportList
      initial={page}
      q={q}
      filter={filter}
      canDownloadPreviews={canDownloadPreviews}
    />
  );
}

export default async function MyReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; filter?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim();
  const filter = parseReportListFilter(sp.filter);

  const user = await getSessionUser();
  if (!user) {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (filter !== "all") next.set("filter", filter);
    const s = next.toString();
    redirect(`/login?next=${encodeURIComponent(s ? `/reports?${s}` : "/reports")}`);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-24 pt-12 sm:pt-16">
        <header>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            My reports
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Reports you&rsquo;ve run
          </h1>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            One card per address, latest run first. Tick unlocked reports to
            download several PDFs as one ZIP.
          </p>
        </header>

        {/* key: a new query = a fresh list (local state, selection, cursor). */}
        <Suspense key={`${q}|${filter}`} fallback={<ReportListSkeleton />}>
          <List
            userId={user.id}
            q={q}
            filter={filter}
            canDownloadPreviews={isAdmin(user)}
          />
        </Suspense>
      </main>
    </>
  );
}
