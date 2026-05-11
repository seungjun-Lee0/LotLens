import { notFound } from "next/navigation";
import { Download } from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { ModuleSection } from "@/components/report/module-section";
import { RiskBadge } from "@/components/report/risk-badge";
import { loadReportPayload } from "@/lib/pipeline";
import type { Module } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const payload = await loadReportPayload(id);
  if (!payload) notFound();

  const { report, address, modules, considerationCount } = payload;
  const headlineRisk =
    considerationCount === 0
      ? ("none" as const)
      : modules.find((m) => m.riskLevel === "high")
        ? ("high" as const)
        : modules.find((m) => m.riskLevel === "medium")
          ? ("medium" as const)
          : ("low" as const);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 pb-24 pt-12 sm:pt-16">
        {/* Header card */}
        <header className="rounded-3xl border border-border/60 bg-card/80 p-6 backdrop-blur-sm sm:p-8">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Due Diligence Report
          </div>
          <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {address.address_text}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
            <span>Generated {formatTime(report.generated_at)}</span>
            <span aria-hidden>·</span>
            <span>Report id <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-[11px]">{report.id.slice(0, 8)}</code></span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RiskBadge level={headlineRisk} />
              <span className="text-[13px] text-muted-foreground">
                {considerationCount === 0
                  ? "No considerations identified across the 5 modules."
                  : `${considerationCount} consideration${considerationCount > 1 ? "s" : ""} identified across the 5 modules.`}
              </span>
            </div>
            <a
              href={`/api/report/${report.id}/pdf`}
              className="glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium text-foreground/80 transition hover:text-foreground"
            >
              <Download className="size-4" />
              Download PDF
            </a>
          </div>
        </header>

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
