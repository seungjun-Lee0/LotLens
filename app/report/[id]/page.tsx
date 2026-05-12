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

  const { report, address, modules } = payload;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 pb-24 pt-12 sm:pt-16">
        {/* Hero band — title + download */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Property Fact Pack
            </div>
            <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              {address.address_text}
            </h1>
          </div>
          <a
            href={`/api/report/${report.id}/pdf`}
            className="glass inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full px-4 text-[13.5px] font-medium text-foreground/80 transition hover:text-foreground sm:self-end"
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
            />
          ))}
        </div>

        {/* Disclaimer */}
        <section
          id="disclaimer"
          className="mx-auto max-w-3xl rounded-3xl border border-border/60 bg-card/60 p-6 text-center text-[13px] leading-relaxed text-muted-foreground backdrop-blur-sm"
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80">
            Disclaimer
          </div>
          <p className="text-pretty">{DISCLAIMER}</p>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-background/40 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-[12px] text-muted-foreground sm:flex-row">
          <span>© PropAI — Brisbane DD prototype</span>
          <span>Public data only · No valuation · No title search</span>
        </div>
      </footer>
    </>
  );
}
