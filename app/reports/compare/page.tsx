// /reports/compare?ids=a,b[,c] — two or three of the caller's reports side
// by side: one row per module, a severity chip + the module's headline
// value per property. Reads the same payloads as the report pages, so the
// chips are the ones the reports show.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check, Info, Lock, TriangleAlert } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { formatRunDate } from "@/lib/format-date";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { MODULE_ORDER, type Module } from "@/lib/db";
import { formatAuAddress } from "@/lib/format-address";
import { MODULE_META } from "@/lib/module-meta";
import { moduleHeadline } from "@/lib/module-headline";
import { canViewReport, loadReportPayload, type ReportPayload } from "@/lib/pipeline";
import { isFlagged, isInformational, isUnavailable, RISK_RANK, RISK_STYLE, riskOf } from "@/lib/risk-style";

export const dynamic = "force-dynamic";

const MAX = 3;
// The one module an unpaid report shows in full (mirrors the report page).
const PREVIEW_MODULE: Module = "flooding";

type Cell = {
  kind: "flagged" | "info" | "clear" | "unavailable" | "failed" | "locked";
  level: ReturnType<typeof riskOf>;
  headline: string | null;
};

function cellFor(p: ReportPayload, module: Module, paid: boolean): Cell {
  const m = p.modules.find((x) => x.module === module);
  if (!paid && module !== PREVIEW_MODULE) return { kind: "locked", level: "none", headline: null };
  if (!m) return { kind: "unavailable", level: "none", headline: null };
  const raw = m.raw as Record<string, unknown> | null;
  const level = riskOf(m.riskLevel, m.hasConsideration);
  const headline = moduleHeadline(module, m.raw);
  if (raw?.fetchFailed === true) return { kind: "failed", level, headline };
  if (isUnavailable(m.raw)) return { kind: "unavailable", level, headline };
  if (isFlagged(m.riskLevel, m.hasConsideration)) return { kind: "flagged", level, headline };
  if (isInformational(m.riskLevel, m.hasConsideration)) return { kind: "info", level, headline };
  return { kind: "clear", level: "none", headline };
}

function Chip({ cell }: { cell: Cell }) {
  if (cell.kind === "locked") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
        <Lock className="size-3" /> Locked
      </span>
    );
  }
  const style =
    cell.kind === "failed"
      ? { color: "var(--apple-orange)", label: "Pending" }
      : cell.kind === "unavailable"
        ? { color: RISK_STYLE.informational.cssVar, label: "No source" }
        : cell.kind === "info"
          ? { color: RISK_STYLE.informational.cssVar, label: "Info" }
          : cell.kind === "clear"
            ? { color: RISK_STYLE.none.cssVar, label: "Clear" }
            : { color: RISK_STYLE[cell.level].cssVar, label: RISK_STYLE[cell.level].label };
  const Icon = cell.kind === "flagged" || cell.kind === "failed" ? TriangleAlert : cell.kind === "clear" ? Check : Info;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
      style={{ background: `color-mix(in oklab, ${style.color} 14%, transparent)`, color: style.color }}
    >
      <Icon className="size-3" strokeWidth={3} />
      {style.label}
    </span>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams?: Promise<{ ids?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const ids = [...new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, MAX);
  const viewer = await getSessionUser();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/reports/compare?ids=${ids.join(",")}`)}`);
  if (ids.length < 2) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pb-24 pt-12 sm:pt-16">
          <p className="text-[14px] text-muted-foreground">Pick two or three reports to compare.</p>
          <Link href="/reports" className="text-[13.5px] font-medium underline underline-offset-2">Back to My reports</Link>
        </main>
      </>
    );
  }
  const admin = isAdmin(viewer);
  const payloads = await Promise.all(ids.map((id) => loadReportPayload(id)));
  // Any report that isn't the caller's 404s the whole page: no partial
  // comparison that leaks another user's address.
  if (payloads.some((p) => !p || !canViewReport(p.report, viewer, admin))) notFound();
  const reports = payloads as ReportPayload[];
  const paid = reports.map((p) => p.paid || admin);

  // Rows: every module any report carries, canonical order. Modules flagged
  // somewhere float to the top so the differences lead.
  const present = new Set(reports.flatMap((p) => p.modules.map((m) => m.module)));
  const rows = MODULE_ORDER.filter((m) => present.has(m)).map((module) => ({
    module,
    cells: reports.map((p, i) => cellFor(p, module, paid[i])),
  }));
  const weight = (r: (typeof rows)[number]) =>
    Math.max(...r.cells.map((c) => (c.kind === "flagged" ? 10 + RISK_RANK[c.level] : c.kind === "failed" ? 5 : 0)));
  rows.sort((a, b) => weight(b) - weight(a) || MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module));

  const gridCols = `minmax(140px,1fr) repeat(${reports.length}, minmax(0, 1.4fr))`;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-24 pt-12 sm:pt-16">
        <header>
          <Link href="/reports" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> My reports
          </Link>
          <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Compare</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {reports.length} properties side by side
          </h1>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            Modules with a warning on any property come first. Open a report for its maps and the full reasoning.
          </p>
        </header>

        <div className="glass overflow-x-auto rounded-3xl">
          <div className="min-w-[640px]">
            {/* Property header row */}
            <div className="grid gap-x-4 border-b border-border/60 px-5 py-4" style={{ gridTemplateColumns: gridCols }}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Module</div>
              {reports.map((p, i) => (
                <div key={p.report.id} className="min-w-0">
                  <Link href={`/report/${p.report.id}`} className="block truncate text-[14px] font-semibold hover:underline">
                    {formatAuAddress(p.address.address_text, p.postcode)}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted-foreground">
                    <span>{formatRunDate(p.report.generated_at)}</span>
                    <span>·</span>
                    <span>{paid[i] ? `${p.considerationCount} consideration${p.considerationCount === 1 ? "" : "s"}` : "Preview"}</span>
                    {p.parcel?.areaM2 ? (
                      <>
                        <span>·</span>
                        <span>{Math.round(p.parcel.areaM2).toLocaleString()} m²</span>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <ul>
              {rows.map(({ module, cells }) => {
                const meta = MODULE_META[module];
                const Icon = meta.icon;
                // Same verdict on every property: dim the row so the eye
                // lands on the ones that differ.
                const same = cells.every((c) => c.kind === cells[0].kind && c.level === cells[0].level);
                return (
                  <li
                    key={module}
                    className={`grid items-start gap-x-4 border-b border-border/40 px-5 py-3 last:border-b-0 ${same ? "opacity-75" : ""}`}
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: `color-mix(in oklab, ${meta.tint} 16%, transparent)`, color: meta.tint }}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="truncate">{meta.name}</span>
                    </div>
                    {cells.map((c, i) => (
                      <div key={i} className="min-w-0">
                        <Chip cell={c} />
                        {c.headline && c.kind !== "locked" && (
                          <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-foreground/85">{c.headline}</div>
                        )}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
