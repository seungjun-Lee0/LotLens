import {
  Flame,
  Landmark,
  LayoutGrid,
  ScrollText,
  Waves,
  type LucideIcon,
} from "lucide-react";

import { RiskBadge } from "@/components/report/risk-badge";
import { ModuleMap } from "@/components/report/module-map";
import type { ModuleNarrative } from "@/lib/anthropic";
import type { ReportModuleRow } from "@/lib/pipeline";
import type { Module, RiskLevel } from "@/lib/supabase";

const MODULE_META: Record<
  Module,
  { name: string; icon: LucideIcon; tint: string; sourceLabel: string }
> = {
  flooding:  { name: "Flooding",            icon: Waves,       tint: "var(--apple-blue)",   sourceLabel: "BCC Flood Awareness Mapping" },
  bushfire:  { name: "Bushfire",            icon: Flame,       tint: "var(--apple-orange)", sourceLabel: "BCC City Plan — Bushfire overlay" },
  heritage:  { name: "Heritage & Character", icon: Landmark,    tint: "var(--apple-purple)", sourceLabel: "BCC heritage + character overlays" },
  easements: { name: "Easements",           icon: ScrollText,  tint: "var(--apple-teal)",   sourceLabel: "BCC HV easements overlay (public only)" },
  zoning:    { name: "Zoning",              icon: LayoutGrid,  tint: "var(--apple-indigo)", sourceLabel: "BCC City Plan — Zoning" },
};

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
        ? (raw.historicEvents as { event: string; sourceName: string | null }[])
        : [];
      return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <dt className="text-muted-foreground">Flood type</dt>
          <dd className="font-medium">{ft ?? "—"}</dd>
          {ev.length > 0 && (
            <>
              <dt className="text-muted-foreground">Historic events</dt>
              <dd className="font-medium">
                {ev.map((e) => e.event).join(", ")}
              </dd>
            </>
          )}
        </dl>
      );
    }
    case "bushfire": {
      const cat = raw.hazardCategory as string | null;
      const code = raw.hazardCode as string | null;
      return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <dt className="text-muted-foreground">Hazard category</dt>
          <dd className="font-medium">{cat ?? "—"}</dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono text-[11px]">{code ?? "—"}</dd>
        </dl>
      );
    }
    case "heritage": {
      const entries = Array.isArray(raw.entries)
        ? (raw.entries as {
            type: string;
            description: string | null;
          }[])
        : [];
      if (entries.length === 0) return null;
      return (
        <ul className="flex flex-col gap-1 text-[12px]">
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
              <span className="text-muted-foreground">
                {e.description ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "easements": {
      const desc = raw.description as string | null;
      const scope = raw.scopeNote as string | null;
      return (
        <div className="flex flex-col gap-2 text-[12px]">
          {desc && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Layer</dt>
              <dd className="font-medium">{desc}</dd>
            </dl>
          )}
          {scope && (
            <p className="rounded-lg bg-foreground/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {scope}
            </p>
          )}
        </div>
      );
    }
    case "zoning": {
      const code = raw.zoneCode as string | null;
      const prec = raw.zonePrecinct as string | null;
      const lvl1 = raw.lvl1Zone as string | null;
      return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <dt className="text-muted-foreground">Zone</dt>
          <dd className="font-medium">{prec ?? code ?? "—"}</dd>
          <dt className="text-muted-foreground">Family</dt>
          <dd className="font-medium">{lvl1 ?? "—"}</dd>
        </dl>
      );
    }
  }
}

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
    <section className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset,0_8px_24px_-12px_rgba(15,23,42,0.12)] backdrop-blur-sm sm:p-8">
      <div className="flex items-start justify-between gap-4">
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
          <div>
            <div className="text-[16px] font-semibold tracking-tight">
              {meta.name}
            </div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {meta.sourceLabel}
            </div>
          </div>
        </div>
        <RiskBadge level={risk} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Narrative */}
        <div className="flex flex-col gap-4">
          {narrative ? (
            <>
              <p className="text-[18px] leading-snug tracking-tight text-foreground text-pretty">
                {narrative.summary}
              </p>
              <p className="text-[14px] leading-relaxed text-muted-foreground text-pretty">
                {narrative.detail}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-[14px]">
              No narrative was generated for this module.
            </p>
          )}

          <div className="mt-1 flex flex-col gap-3">
            <ModuleFacts module={row.module} raw={raw} />
          </div>

          {narrative?.questions_to_ask?.length ? (
            <div className="mt-2">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Questions to ask
              </div>
              <ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-foreground/90">
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

          {narrative?.sources?.length ? (
            <div className="mt-2">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Sources
              </div>
              <ul className="flex flex-col gap-1.5 text-[12.5px]">
                {Array.from(new Set(narrative.sources)).map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--apple-blue)] hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Map */}
        <div className="flex flex-col gap-2">
          <ModuleMap lat={lat} lng={lng} tint={meta.tint} />
          <p className="text-[11px] text-muted-foreground">
            Property pin only — overlay polygons available in a future
            iteration. {row.sourceName} is the data source.
          </p>
        </div>
      </div>
    </section>
  );
}
