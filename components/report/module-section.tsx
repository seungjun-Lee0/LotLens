import { Check, TriangleAlert } from "lucide-react";

import { RiskBadge } from "@/components/report/risk-badge";
import { ModuleMap } from "@/components/report/module-map";
import type { ModuleNarrative } from "@/lib/anthropic";
import { MODULE_META } from "@/lib/module-meta";
import { extractOverlays } from "@/lib/overlays";
import type { ReportModuleRow } from "@/lib/pipeline";
import type { Module, RiskLevel } from "@/lib/supabase";

// ── Per-module facts panel ────────────────────────────────────────────────

function ModuleFacts({
  module,
  raw,
}: {
  module: Module;
  raw: Record<string, unknown> | undefined;
}) {
  if (!raw) return null;
  switch (module) {
    case "flooding": {
      const ft = raw.floodType as string | null;
      const ev = Array.isArray(raw.historicEvents)
        ? (raw.historicEvents as { event: string }[])
        : [];
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Flood type</dt>
          <dd className="font-medium">{ft ?? "—"}</dd>
          {ev.length > 0 && (
            <>
              <dt className="text-muted-foreground">Historic events</dt>
              <dd className="font-medium">{ev.map((e) => e.event).join(", ")}</dd>
            </>
          )}
        </dl>
      );
    }
    case "bushfire": {
      const cat = raw.hazardCategory as string | null;
      const code = raw.hazardCode as string | null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Hazard category</dt>
          <dd className="font-medium">{cat ?? "—"}</dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono text-[11px]">{code ?? "—"}</dd>
        </dl>
      );
    }
    case "heritage": {
      const entries = Array.isArray(raw.entries)
        ? (raw.entries as { type: string; description: string | null }[])
        : [];
      if (entries.length === 0) return null;
      return (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                style={{
                  background:
                    "color-mix(in oklab, var(--apple-purple) 12%, transparent)",
                  color: "var(--apple-purple)",
                }}
              >
                {e.type}
              </span>
              <span className="text-muted-foreground">{e.description ?? "—"}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "easements": {
      const desc = raw.description as string | null;
      if (!desc) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Layer</dt>
          <dd className="font-medium">{desc}</dd>
        </dl>
      );
    }
    case "zoning": {
      const code = raw.zoneCode as string | null;
      const prec = raw.zonePrecinct as string | null;
      const lvl1 = raw.lvl1Zone as string | null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Zone</dt>
          <dd className="font-medium">{prec ?? code ?? "—"}</dd>
          <dt className="text-muted-foreground">Family</dt>
          <dd className="font-medium">{lvl1 ?? "—"}</dd>
        </dl>
      );
    }
  }
}

// ── Status pill (Develo "CONSIDERATIONS IDENTIFIED" / "NO CONSIDERATIONS") ─

function StatusPill({
  hasConsideration,
  tint,
}: {
  hasConsideration: boolean;
  tint: string;
}) {
  const bg = hasConsideration
    ? `color-mix(in oklab, ${tint} 18%, transparent)`
    : "color-mix(in oklab, var(--apple-green) 14%, transparent)";
  const border = hasConsideration
    ? `color-mix(in oklab, ${tint} 35%, transparent)`
    : "color-mix(in oklab, var(--apple-green) 35%, transparent)";
  const color = hasConsideration ? tint : "var(--apple-green)";
  const Icon = hasConsideration ? TriangleAlert : Check;
  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{ background: bg, borderWidth: 1, borderStyle: "solid", borderColor: border, color }}
    >
      <span
        className="flex size-5 items-center justify-center rounded-full"
        style={{ background: color, color: "white" }}
      >
        <Icon className="size-3" strokeWidth={3} />
      </span>
      {hasConsideration ? "Considerations identified" : "No considerations identified"}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

export function ModuleSection({
  row,
  narrative,
  lat,
  lng,
}: {
  row: ReportModuleRow;
  narrative: ModuleNarrative | undefined;
  lat: number;
  lng: number;
}) {
  const meta = MODULE_META[row.module];
  const Icon = meta.icon;
  const risk: RiskLevel = row.riskLevel ?? "none";
  const raw =
    row.raw && typeof row.raw === "object"
      ? (row.raw as Record<string, unknown>)
      : undefined;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset,0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      {/* Header: name + clarifying question */}
      <div className="flex flex-col gap-3 px-6 pt-7 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:pt-9">
        <div className="flex items-center gap-3">
          <div
            className="flex size-11 items-center justify-center rounded-2xl"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklab, ${meta.tint} 22%, transparent), color-mix(in oklab, ${meta.tint} 6%, transparent))`,
              color: meta.tint,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${meta.tint} 25%, transparent)`,
            }}
          >
            <Icon className="size-5" />
          </div>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {meta.name}
          </h2>
        </div>
        <p className="text-balance text-[14.5px] leading-snug text-muted-foreground sm:text-right sm:text-[15px]">
          {meta.question}
        </p>
      </div>

      {/* Hero map */}
      <div className="px-6 pt-6 sm:px-10">
        <ModuleMap
          lat={lat}
          lng={lng}
          tint={meta.tint}
          className="h-64"
          overlays={extractOverlays(row.module, row.raw)}
        />
      </div>

      {/* Status + source + AI summary */}
      <div className="flex flex-col gap-4 px-6 pt-6 sm:px-10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusPill hasConsideration={row.hasConsideration} tint={meta.tint} />
          <RiskBadge level={risk} size="sm" />
          <span className="text-[11.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Sources: {meta.sourceLabel}
          </span>
        </div>

        {narrative?.summary && (
          <p
            className="text-[16.5px] leading-snug text-foreground text-pretty"
            style={{ fontWeight: 500 }}
          >
            {narrative.summary}
          </p>
        )}
      </div>

      {/* Two-column body: Things to know + Note (L) / Questions + Legend (R) */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 px-6 pb-8 pt-7 sm:px-10 sm:pb-10 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Things to know
            </h3>
            {meta.thingsToKnow.map((p, i) => (
              <p
                key={i}
                className="text-[14px] leading-relaxed text-foreground/80 text-pretty"
              >
                {p}
              </p>
            ))}
            {narrative?.detail && (
              <div
                className="rounded-2xl p-4"
                style={{
                  background: `color-mix(in oklab, ${meta.tint} 6%, var(--muted))`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `color-mix(in oklab, ${meta.tint} 16%, transparent)`,
                }}
              >
                <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: meta.tint }}>
                  For this property
                </div>
                <p className="text-[13.5px] leading-relaxed text-foreground/85 text-pretty">
                  {narrative.detail}
                </p>
              </div>
            )}
          </div>

          {(raw && Object.keys(raw).length > 0) && (
            <div className="rounded-2xl bg-foreground/[0.04] p-4">
              <ModuleFacts module={row.module} raw={raw} />
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-muted-foreground text-pretty">
            <span className="font-semibold text-foreground/80">Note: </span>
            {meta.note}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {narrative?.questions_to_ask?.length ? (
            <div>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Questions to ask
              </h3>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-foreground/90">
                {narrative.questions_to_ask.map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      className="mt-2 size-1 shrink-0 rounded-full"
                      style={{ background: meta.tint }}
                    />
                    <span className="text-pretty">{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Legend
            </h3>
            <ul className="flex flex-col gap-2 text-[12.5px]">
              <li className="flex items-center gap-2">
                <span
                  className="size-3 rounded-sm"
                  style={{
                    background: meta.tint,
                    boxShadow: "0 0 0 1.5px white",
                    outline: `1px solid color-mix(in oklab, ${meta.tint} 60%, transparent)`,
                  }}
                />
                <span className="text-foreground/80">Selected property</span>
              </li>
              {meta.legend.map((l) => (
                <li key={l.label} className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-sm"
                    style={{
                      background: `color-mix(in oklab, ${l.color} 65%, transparent)`,
                      outline: `1px solid color-mix(in oklab, ${l.color} 70%, transparent)`,
                    }}
                  />
                  <span className="text-foreground/80">{l.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {narrative?.sources?.length ? (
            <div>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Source links
              </h3>
              <ul className="flex flex-col gap-1.5 text-[12px]">
                {Array.from(new Set(narrative.sources)).map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[var(--apple-blue)] hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
