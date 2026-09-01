import { notFound } from "next/navigation";
import { Lock } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { AtAGlance } from "@/components/report/at-a-glance";
import { ClearModules } from "@/components/report/clear-modules";
import { DownloadPdfButton } from "@/components/report/download-pdf-button";
import { ModuleSection } from "@/components/report/module-section";
import { ModuleNav } from "@/components/report/module-nav";
import { NextSteps } from "@/components/report/next-steps";
import { RetryChecks } from "@/components/report/retry-checks";
import { UnlockButton } from "@/components/report/unlock-button";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { formatAuAddress } from "@/lib/format-address";
import { loadReportPayload } from "@/lib/pipeline";
import { isFlagged, RISK_RANK, riskOf } from "@/lib/risk-style";
import { ESSENTIAL_MODULES, GOOD_TO_KNOW_MODULES, type Module } from "@/lib/db";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

// First module is the free preview when unpaid. Everything else is gated.
const PREVIEW_MODULE: Module = "flooding";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ session_id?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // Best-effort: if Stripe redirected back with session_id, ping the
  // webhook GET handler so paid_at is set even when the async webhook
  // hasn't landed yet. We don't await response: the page server-render
  // re-loads paid status straight from the DB after.
  if (sp.session_id) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/checkout/webhook?session_id=${encodeURIComponent(sp.session_id)}`,
        { cache: "no-store" },
      );
    } catch {
      // ignore: the webhook itself will eventually catch up
    }
  }

  const payload = await loadReportPayload(id);
  if (!payload) notFound();

  const { report, address, modules, propertyPolygon, parcelLines } = payload;
  // Admins bypass the paywall outright: full report, no unlock, no
  // credit spend (ADMIN_EMAILS env).
  const paid = payload.paid || isAdmin(await getSessionUser());
  const isFailed = (m: (typeof modules)[number]) =>
    !!m.raw &&
    typeof m.raw === "object" &&
    (m.raw as Record<string, unknown>).fetchFailed === true;
  const failedCount = modules.filter(isFailed).length;

  // Three lanes, all reading from the same two facts on each row:
  //   flagged        → full section, ⚠, counted, feeds Next steps
  //   informational  → full section, neutral chip, NOT counted
  //   clear          → compact evidence strip, no map
  // Note what informational is NOT: it is not the "clear" lane. School
  // catchments and the zone code are the content buyers actually read, so
  // they keep their map and narrative: they just stop shouting.
  // Body keeps the canonical module order (comparable across reports);
  // severity-first reading lives in the At-a-glance verdict layer.
  const attentionModules = paid
    ? modules.filter((m) => isFlagged(m.riskLevel, m.hasConsideration) || isFailed(m))
    : modules.filter((m) => m.module === PREVIEW_MODULE);
  // "Good to know" is a fixed set of fact modules (zone, schools, transport,
  // local plan) — always a full section.
  const infoModules = paid
    ? modules.filter(
        (m) =>
          GOOD_TO_KNOW_MODULES.has(m.module) &&
          !isFlagged(m.riskLevel, m.hasConsideration) &&
          !isFailed(m),
      )
    : [];
  // Core hazard checks that came back clear keep a full "No considerations
  // identified" section (flood, bushfire, coastal, …); the minor no-finding
  // checks (stormwater, steep land, acid sulfate, mining) collapse into the
  // "Checked & clear" strip instead.
  const essentialClearModules = paid
    ? modules.filter(
        (m) =>
          ESSENTIAL_MODULES.has(m.module) &&
          !isFlagged(m.riskLevel, m.hasConsideration) &&
          !isFailed(m),
      )
    : [];
  const clearModules = paid
    ? modules.filter(
        (m) =>
          !isFlagged(m.riskLevel, m.hasConsideration) &&
          !isFailed(m) &&
          !GOOD_TO_KNOW_MODULES.has(m.module) &&
          !ESSENTIAL_MODULES.has(m.module),
      )
    : [];
  const flaggedBySeverity = modules
    .filter((m) => isFlagged(m.riskLevel, m.hasConsideration) && !isFailed(m))
    .sort(
      (a, b) =>
        RISK_RANK[riskOf(b.riskLevel, b.hasConsideration)] -
        RISK_RANK[riskOf(a.riskLevel, a.hasConsideration)],
    );
  const lockedCount = paid ? 0 : modules.length - attentionModules.length;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:gap-10 sm:px-6 sm:pb-24 sm:pt-16">
        {/* Hero band: title + download */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              Property Fact Pack
            </div>
            <h1 className="mt-2 text-balance text-[1.7rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              {formatAuAddress(address.address_text, payload.postcode)}
            </h1>
          </div>
          {paid && <DownloadPdfButton reportId={report.id} />}
        </header>

        {/* Partial-failure banner: some sources were unreachable last run */}
        {failedCount > 0 && (
          <RetryChecks reportId={report.id} failedCount={failedCount} />
        )}

        {/* At a glance */}
        <AtAGlance payload={payload} />

        {/* Module sections: full treatment for flagged/failed checks
            (flooding preview + paywall when unpaid) */}
        <div className="flex flex-col gap-6">
          {attentionModules.map((row) => (
            <ModuleSection
              key={row.module}
              row={row}
              narrative={report.narrative[row.module as Module]}
              lat={address.lat}
              lng={address.lng}
              propertyPolygon={propertyPolygon}
              lotLines={parcelLines}
            />
          ))}

          {/* Core hazard checks that came back clear keep their own full
              section (each carries its "No considerations identified" status),
              so no separate heading is needed. */}
          {paid &&
            essentialClearModules.map((row) => (
              <ModuleSection
                key={row.module}
                row={row}
                narrative={report.narrative[row.module as Module]}
                lat={address.lat}
                lng={address.lng}
                propertyPolygon={propertyPolygon}
                lotLines={parcelLines}
              />
            ))}

          {paid && infoModules.length > 0 && (
            <>
              <div className="flex flex-col gap-1.5 px-1 pt-2">
                <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                  Good to know
                </h2>
                <p className="max-w-xl text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">
                  Facts about the address rather than warnings: what the land
                  is zoned for, which schools it&apos;s in catchment for, what
                  transport is nearby. Nothing here needs action.
                </p>
              </div>
              {infoModules.map((row) => (
                <ModuleSection
                  key={row.module}
                  row={row}
                  narrative={report.narrative[row.module as Module]}
                  lat={address.lat}
                  lng={address.lng}
                  propertyPolygon={propertyPolygon}
                  lotLines={parcelLines}
                />
              ))}
            </>
          )}

          {paid && (
            <ClearModules rows={clearModules} narrative={report.narrative} />
          )}

          {/* Next steps last: the action checklist reads as the closing
              takeaway, after all the module detail. */}
          {paid && (
            <NextSteps rows={flaggedBySeverity} narrative={report.narrative} />
          )}

          {!paid && (
            <section className="glass-strong relative overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-10 sm:py-12">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 opacity-90"
                style={{
                  background:
                    "radial-gradient(circle at 30% 20%, color-mix(in oklab, var(--apple-blue) 20%, transparent), transparent 55%), radial-gradient(circle at 70% 80%, color-mix(in oklab, var(--apple-purple) 18%, transparent), transparent 55%)",
                }}
              />
              <div
                className="mx-auto mb-4 inline-flex size-14 items-center justify-center rounded-2xl"
                style={{
                  background:
                    "color-mix(in oklab, var(--apple-blue) 12%, transparent)",
                  color: "var(--apple-blue)",
                }}
              >
                <Lock className="size-6" />
              </div>
              <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                {lockedCount} more modules ready to unlock
              </h2>
              <p className="mx-auto mt-3 max-w-md text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
                Bushfire, Coastal Hazards, Vegetation, Environment &amp; Koala,
                Heritage, Easements, Mining, Acid Sulfate Soils, Zoning and
                more, already fetched from council and Queensland Government
                sources. Unlock to see the full per-module narrative, maps,
                and PDF download.
              </p>
              <div className="mt-7">
                <UnlockButton addressId={address.id} reportId={report.id} />
              </div>
            </section>
          )}
        </div>

        {/* Disclaimer — same width as the report content above it. */}
        <section
          id="disclaimer"
          className="rounded-3xl border border-border/60 bg-card/60 p-5 text-center text-[12.5px] leading-relaxed text-muted-foreground backdrop-blur-sm sm:p-6 sm:text-[13px]"
        >
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-foreground/80 sm:text-[11px]">
            Disclaimer
          </div>
          <p className="text-pretty">{DISCLAIMER}</p>
        </section>
      </main>

      {/* Floating jump-to-module nav: only when the body has enough
          full sections to make scrolling a chore. */}
      {paid && (
        <ModuleNav
          // Every module that rendered a FULL section (map + detail box), in
          // body order: attention, then the core hazard checks that came back
          // clear ("No considerations identified" sections), then the Good to
          // know facts. The Checked & clear strip is pills only — no section
          // to jump to — so it's excluded.
          items={[
            ...attentionModules,
            ...essentialClearModules,
            ...infoModules,
          ].map((m) => ({
            module: m.module,
            riskLevel: m.riskLevel,
            hasConsideration: m.hasConsideration,
            failed: isFailed(m),
          }))}
          action={<DownloadPdfButton reportId={report.id} iconOnly />}
        />
      )}

      <SiteFooter />
    </>
  );
}
