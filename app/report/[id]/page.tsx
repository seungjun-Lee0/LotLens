import { notFound } from "next/navigation";
import { Download, Lock } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { AtAGlance } from "@/components/report/at-a-glance";
import { ModuleSection } from "@/components/report/module-section";
import { UnlockButton } from "@/components/report/unlock-button";
import { loadReportPayload } from "@/lib/pipeline";
import type { Module } from "@/lib/db";

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
  // hasn't landed yet. We don't await response — the page server-render
  // re-loads paid status straight from the DB after.
  if (sp.session_id) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/checkout/webhook?session_id=${encodeURIComponent(sp.session_id)}`,
        { cache: "no-store" },
      );
    } catch {
      // ignore — the webhook itself will eventually catch up
    }
  }

  const payload = await loadReportPayload(id);
  if (!payload) notFound();

  const { report, address, modules, propertyPolygon, paid } = payload;
  const visibleModules = paid
    ? modules
    : modules.filter((m) => m.module === PREVIEW_MODULE);
  const lockedCount = paid ? 0 : modules.length - visibleModules.length;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:gap-10 sm:px-6 sm:pb-24 sm:pt-16">
        {/* Hero band — title + download */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              Property Fact Pack
            </div>
            <h1 className="mt-2 text-balance text-[1.7rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              {address.address_text}
            </h1>
          </div>
          {paid && (
            <a
              href={`/api/report/${report.id}/pdf`}
              className="glass inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full px-4 text-[13px] font-medium text-foreground/80 transition hover:text-foreground sm:self-end sm:text-[13.5px]"
            >
              <Download className="size-4" />
              Download PDF
            </a>
          )}
        </header>

        {/* At a glance */}
        <AtAGlance payload={payload} />

        {/* Module sections — flooding preview + paywall, OR all 8 once paid */}
        <div className="flex flex-col gap-6">
          {visibleModules.map((row) => (
            <ModuleSection
              key={row.module}
              row={row}
              narrative={report.narrative[row.module as Module]}
              lat={address.lat}
              lng={address.lng}
              propertyPolygon={propertyPolygon}
            />
          ))}

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
                Bushfire, Overland Flow, Storm Tide, Vegetation, Heritage &amp;
                Character, Easements, and Zoning — already fetched from BCC.
                Unlock to see the full per-module narrative, maps, and PDF
                download.
              </p>
              <div className="mt-7">
                <UnlockButton addressId={address.id} reportId={report.id} />
              </div>
            </section>
          )}
        </div>

        {/* Disclaimer */}
        <section
          id="disclaimer"
          className="mx-auto max-w-3xl rounded-3xl border border-border/60 bg-card/60 p-5 text-center text-[12.5px] leading-relaxed text-muted-foreground backdrop-blur-sm sm:p-6 sm:text-[13px]"
        >
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-foreground/80 sm:text-[11px]">
            Disclaimer
          </div>
          <p className="text-pretty">{DISCLAIMER}</p>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-background/40 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-[11.5px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left sm:text-[12px]">
          <span>© PropAI</span>
          <span>Public data only · No valuation · No title search</span>
        </div>
      </footer>
    </>
  );
}
