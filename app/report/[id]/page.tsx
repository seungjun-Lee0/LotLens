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
import { heroAerialUrl, heroLotPath } from "@/lib/aerial";
import { formatAuAddress } from "@/lib/format-address";
import { canViewReport, loadReportPayload } from "@/lib/pipeline";
import { SHARE_PARAM, verifyShareToken, withShareToken } from "@/lib/share";
import { ShareButton } from "@/components/report/share-button";
import { isFlagged, isUnavailable, RISK_RANK, riskOf } from "@/lib/risk-style";
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
  searchParams?: Promise<{ session_id?: string; skin?: string; [SHARE_PARAM]?: string }>;
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

  const shareToken = typeof sp[SHARE_PARAM] === "string" ? sp[SHARE_PARAM] : null;
  const [payload, viewer, shared] = await Promise.all([
    loadReportPayload(id),
    getSessionUser(),
    verifyShareToken(shareToken, id),
  ]);
  if (!payload) notFound();
  const admin = isAdmin(viewer);
  // A signed-in user's run is theirs: anyone else gets the same 404 as a
  // missing id, so a leaked link is not a bearer token for a paid report.
  // A share link (lib/share) is the deliberate exception.
  if (!canViewReport(payload.report, viewer, admin, shared)) notFound();
  // The token must ride along on every same-report request the page makes
  // (map overlays, PDF), or a shared viewer's maps would 404.
  const accessQuery = shared && shareToken ? withShareToken("", shareToken).slice(1) : null;
  // Sharing is the owner's call. A viewer who arrived via a share link, or
  // an anonymous run's URL-only reader, gets no Share button.
  const canShare =
    !shared && !!viewer && (admin || payload.report.ownerId === viewer.id);

  const { report, address, modules, propertyPolygon, parcelLines } = payload;
  // Admins bypass the paywall outright: full report, no unlock, no
  // credit spend (ADMIN_EMAILS env).
  const paid = payload.paid || admin;
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
  // A module whose council layer doesn't exist for this LGA also keeps a
  // full section: the section carries the "No source information
  // available" pill and the note, where the compact strip would show it
  // with a green tick as if it had been checked.
  const essentialClearModules = paid
    ? modules.filter(
        (m) =>
          (ESSENTIAL_MODULES.has(m.module) || isUnavailable(m.raw)) &&
          !isFlagged(m.riskLevel, m.hasConsideration) &&
          !isFailed(m),
      )
    : [];
  const clearModules = paid
    ? modules.filter(
        (m) =>
          !isFlagged(m.riskLevel, m.hasConsideration) &&
          !isFailed(m) &&
          !isUnavailable(m.raw) &&
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

  // "Paper" skin trial (?skin=paper): the report body renders as an ivory
  // sheet on the dark chrome, with an aerial hero, a display serif for
  // titles and hairline section breaks instead of stacked cards. Styled
  // by [data-skin="paper"] rules in globals.css so the default is untouched.
  const paper = sp.skin === "paper";
  const displayAddress = formatAuAddress(address.address_text, payload.postcode);
  const flaggedCount = modules.filter(
    (m) => isFlagged(m.riskLevel, m.hasConsideration) && !isFailed(m),
  ).length;
  const unavailableCount = modules.filter(
    (m) => isUnavailable(m.raw) && !isFlagged(m.riskLevel, m.hasConsideration),
  ).length;
  const clearCount =
    modules.length - flaggedCount - infoModules.length - unavailableCount - failedCount;

  return (
    <>
      <SiteHeader />

      <main
        data-skin={paper ? "paper" : undefined}
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:gap-10 sm:px-6 sm:pb-24 sm:pt-16"
      >
        {paper ? (
          /* Paper hero: the property's own aerial, desaturated, with the
             address set in the display serif and the verdict as three
             large numerals. Reads as a report cover, not an app header. */
          <header className="report-hero relative overflow-hidden rounded-[28px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroAerialUrl(address.lat, address.lng)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: "grayscale(0.55) contrast(1.05) brightness(0.72)" }}
            />
            {/* The lot itself, in the report's selected-property yellow:
                same frame as the photo, cropped the same way. */}
            {propertyPolygon ? (
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 1600 640"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
              >
                <path
                  d={heroLotPath(propertyPolygon, address.lat, address.lng)}
                  fill="rgba(250, 204, 21, 0.10)"
                  stroke="#facc15"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, rgba(10,12,16,0.10) 0%, rgba(10,12,16,0.30) 45%, rgba(10,12,16,0.88) 100%)",
              }}
            />
            <div className="relative flex min-h-[420px] flex-col justify-end gap-6 p-6 sm:min-h-[520px] sm:p-12">
              <div className="flex flex-col gap-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-white/70 sm:text-[11px]">
                  Property Fact Pack · {new Date(report.generated_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                </div>
                <h1 className="report-display max-w-3xl text-balance text-[2.2rem] leading-[1.02] text-white sm:text-[4.2rem]">
                  {displayAddress}
                </h1>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-6">
                <dl className="report-stats flex flex-wrap gap-x-10 gap-y-4 text-white">
                  <div>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/60">Needs attention</dt>
                    <dd className="report-display mt-1 text-[2.6rem] leading-none sm:text-[3.4rem]">{flaggedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/60">Checked &amp; clear</dt>
                    <dd className="report-display mt-1 text-[2.6rem] leading-none sm:text-[3.4rem]">{clearCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/60">Good to know</dt>
                    <dd className="report-display mt-1 text-[2.6rem] leading-none sm:text-[3.4rem]">{infoModules.length}</dd>
                  </div>
                </dl>
                {(paid || canShare) && (
                  <div className="report-hero-cta flex flex-wrap items-center gap-2">
                    {canShare && <ShareButton reportId={report.id} addressLabel={displayAddress} />}
                    {paid && <DownloadPdfButton reportId={report.id} query={accessQuery} />}
                  </div>
                )}
              </div>
            </div>
          </header>
        ) : (
          /* Hero band: title + download */
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                Property Fact Pack
              </div>
              <h1 className="mt-2 text-balance text-[1.7rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                {displayAddress}
              </h1>
            </div>
            {(paid || canShare) && (
              <div className="flex flex-wrap items-center gap-2">
                {canShare && <ShareButton reportId={report.id} addressLabel={displayAddress} />}
                {paid && <DownloadPdfButton reportId={report.id} query={accessQuery} />}
              </div>
            )}
          </header>
        )}

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
              reportId={report.id}
              accessQuery={accessQuery}
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
                reportId={report.id}
                accessQuery={accessQuery}
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
                  reportId={report.id}
                  accessQuery={accessQuery}
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
          action={<DownloadPdfButton reportId={report.id} iconOnly query={accessQuery} />}
        />
      )}

      <SiteFooter />
    </>
  );
}
