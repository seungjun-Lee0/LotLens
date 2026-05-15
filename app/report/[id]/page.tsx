import { notFound } from "next/navigation";
import { Download } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { AtAGlance } from "@/components/report/at-a-glance";
import { ModuleSection } from "@/components/report/module-section";
import { loadReportPayload } from "@/lib/pipeline";
import type { Module } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const payload = await loadReportPayload(id);
  if (!payload) notFound();

  const { report, address, modules, propertyPolygon } = payload;

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
          <a
            href={`/api/report/${report.id}/pdf`}
            className="glass inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full px-4 text-[13px] font-medium text-foreground/80 transition hover:text-foreground sm:self-end sm:text-[13.5px]"
          >
            <Download className="size-4" />
            Download PDF
          </a>
        </header>

        {/* At a glance */}
        <AtAGlance payload={payload} />

        {/* Module sections */}
        <div className="flex flex-col gap-6">
          {modules.map((row) => (
            <ModuleSection
              key={row.module}
              row={row}
              narrative={report.narrative[row.module as Module]}
              lat={address.lat}
              lng={address.lng}
              propertyPolygon={propertyPolygon}
            />
          ))}
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

        {/* Mobile-only sources line below the disclaimer — keeps a hint
            visible since the in-section "Sources: …" eyebrow is hidden
            on small screens. */}
      </main>

      <footer className="border-t border-border/40 bg-background/40 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-[11.5px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left sm:text-[12px]">
          <span>© PropAI — Brisbane DD prototype</span>
          <span>Public data only · No valuation · No title search</span>
        </div>
      </footer>
    </>
  );
}
