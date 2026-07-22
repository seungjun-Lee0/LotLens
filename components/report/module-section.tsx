import { Fragment } from "react";
import { Check, TriangleAlert } from "lucide-react";

import { ModuleMap } from "@/components/report/module-map";
import type { ModuleNarrative } from "@/lib/anthropic";
import { MODULE_META } from "@/lib/module-meta";
import { extractOverlays, type OverlayFeature } from "@/lib/overlays";
import type { ReportModuleRow } from "@/lib/pipeline";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";
import { RISK_STYLE } from "@/lib/risk-style";
import type { Module, RiskLevel } from "@/lib/db";
import { prettyUrl } from "@/lib/url";

// ── Per-module facts panel ────────────────────────────────────────────────

function ModuleFacts({
  module,
  raw,
}: {
  module: Module;
  raw: Record<string, unknown> | undefined;
}) {
  if (!raw) return null;
  // The source didn't respond when the report ran — error-toned banner,
  // distinct from "not integrated for this LGA" below.
  if (raw.fetchFailed === true) {
    return (
      <p
        className="rounded-xl border border-dashed p-3 text-[12.5px] leading-relaxed"
        style={{
          borderColor: "color-mix(in oklab, var(--apple-orange) 45%, transparent)",
          background: "color-mix(in oklab, var(--apple-orange) 8%, transparent)",
          color: "color-mix(in oklab, var(--apple-orange) 65%, var(--foreground))",
        }}
      >
        This source didn&apos;t respond when the report ran, so this module was
        not checked. Re-run the checks to retry. No finding here does not
        mean &quot;clear&quot;.
      </p>
    );
  }
  // Council-overlay modules outside adapted LGAs mark themselves
  // unavailable — surface the note instead of module facts.
  if (raw.available === false) {
    return (
      <p className="rounded-xl border border-dashed border-border/70 bg-muted/40 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {typeof raw.availabilityNote === "string"
          ? raw.availabilityNote
          : "This overlay has not been integrated for this council area yet."}
      </p>
    );
  }
  switch (module) {
    case "flooding": {
      const ft = raw.floodType as string | null;
      const ev = Array.isArray(raw.historicEvents)
        ? (raw.historicEvents as { event: string }[])
        : [];
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Flood type</dt>
          <dd className="font-medium">{ft ?? "Not stated"}</dd>
          {ev.length > 0 && (
            <>
              <dt className="text-muted-foreground">Historic events</dt>
              <dd className="font-medium">{ev.map((e) => e.event).join(", ")}</dd>
            </>
          )}
        </dl>
      );
    }
    case "overland_flow":
    case "storm_tide": {
      const ft = raw.floodType as string | null;
      const r = raw.riskLevel as string | null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Risk level</dt>
          <dd className="font-medium">{r ?? "Not stated"}</dd>
          {ft && (
            <>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">{ft}</dd>
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
          <dd className="font-medium">{cat ?? "Not stated"}</dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono text-[11px]">{code ?? "Not stated"}</dd>
        </dl>
      );
    }
    case "vegetation": {
      const cat = raw.category as string | null;
      const code = raw.code as string | null;
      if (!cat) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Category</dt>
          <dd className="font-medium">{cat}</dd>
          {code && (
            <>
              <dt className="text-muted-foreground">Code</dt>
              <dd className="font-mono text-[11px]">{code}</dd>
            </>
          )}
        </dl>
      );
    }
    case "flood_planning": {
      const river = raw.riverArea as string | null;
      const creek = raw.creekArea as string | null;
      if (!river && !creek) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {river && (
            <>
              <dt className="text-muted-foreground">River area</dt>
              <dd className="font-medium">{river}</dd>
            </>
          )}
          {creek && (
            <>
              <dt className="text-muted-foreground">Creek area</dt>
              <dd className="font-medium">{creek}</dd>
            </>
          )}
        </dl>
      );
    }
    case "noise": {
      const t = raw.transportCorridor as string | null;
      const a = raw.anefCategory as string | null;
      if (!t && !a) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {t && (
            <>
              <dt className="text-muted-foreground">Transport</dt>
              <dd className="font-medium">{t}</dd>
            </>
          )}
          {a && (
            <>
              <dt className="text-muted-foreground">Aircraft</dt>
              <dd className="font-medium">{a}</dd>
            </>
          )}
        </dl>
      );
    }
    case "schools": {
      const schools = Array.isArray(raw.schools)
        ? (raw.schools as { name: string; type: string; yearLevels: string[] }[])
        : [];
      if (schools.length === 0) return null;
      return (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {schools.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                style={{
                  background:
                    "color-mix(in oklab, var(--apple-teal) 14%, transparent)",
                  color: "var(--apple-teal)",
                }}
              >
                {s.type || "Catchment"}
              </span>
              <span className="text-foreground/85">
                <span className="font-medium">{s.name}</span>
                {s.yearLevels.length > 0 && (
                  <span className="text-muted-foreground"> · years {s.yearLevels.join(", ")}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
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
              <span className="text-muted-foreground">{e.description ?? "No description recorded"}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "easements": {
      const desc = raw.description as string | null;
      const cadastral = (raw.cadastralEasements as
        | Array<{ lotplan?: string | null; areaSqm?: number | null }>
        | undefined) ?? [];
      if (!desc && cadastral.length === 0) return null;
      return (
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {desc && (
            <>
              <dt className="text-muted-foreground">High-voltage</dt>
              <dd className="font-medium">{desc}</dd>
            </>
          )}
          {cadastral.length > 0 && (
            <>
              <dt className="text-muted-foreground">Cadastral parcels</dt>
              <dd className="font-medium">
                {cadastral
                  .map((e) =>
                    e.lotplan
                      ? `${e.lotplan}${e.areaSqm ? ` · ${Math.round(e.areaSqm)} m²` : ""}`
                      : "Easement parcel",
                  )
                  .join(", ")}
              </dd>
            </>
          )}
        </dl>
      );
    }
    case "environment": {
      const cat = raw.category as string | null;
      if (!cat) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Habitat</dt>
          <dd className="font-medium">{cat}</dd>
        </dl>
      );
    }
    case "steep_land": {
      const cat = raw.category as string | null;
      if (!cat) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Overlay</dt>
          <dd className="font-medium">{cat}</dd>
        </dl>
      );
    }
    case "acid_sulfate": {
      const code = raw.mapCode as string | null;
      const meaning = raw.meaning as string | null;
      const scale = raw.scale as string | null;
      if (!code && !meaning) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Classification</dt>
          <dd className="font-medium">{meaning ?? "Mapped acid sulfate soils"}</dd>
          {code && (
            <>
              <dt className="text-muted-foreground">Map code</dt>
              <dd className="font-mono text-[11px]">{code}{scale ? ` · ${scale}` : ""}</dd>
            </>
          )}
        </dl>
      );
    }
    case "mining": {
      const cat = raw.category as string | null;
      const tenements = Array.isArray(raw.tenements)
        ? (raw.tenements as Array<{ type?: string | null; status?: string | null; owner?: string | null }>)
        : [];
      if (!cat) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Finding</dt>
          <dd className="font-medium">{cat}</dd>
          {tenements.slice(0, 3).map((t, i) => (
            <Fragment key={i}>
              <dt className="text-muted-foreground">Tenure {i + 1}</dt>
              <dd className="font-medium">
                {t.type ?? "Resource authority"}
                {t.status ? ` · ${t.status}` : ""}
                {t.owner ? ` · ${t.owner}` : ""}
              </dd>
            </Fragment>
          ))}
        </dl>
      );
    }
    case "zoning": {
      const code = raw.zoneCode as string | null;
      const prec = raw.zonePrecinct as string | null;
      const lvl1 = raw.lvl1Zone as string | null;
      const lvl2 = raw.lvl2Zone as string | null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Zone</dt>
          <dd className="font-medium">{prec ?? code ?? "Not stated"}</dd>
          {lvl2 && (
            <>
              <dt className="text-muted-foreground">Specific</dt>
              <dd className="font-medium">{lvl2}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Family</dt>
          <dd className="font-medium">{lvl1 ?? "Not stated"}</dd>
        </dl>
      );
    }
  }
}

// ── Status pill — one chip carrying both the finding AND its severity
// (previously a separate risk badge duplicated this and both read
// "clear/none" together on empty modules). ──────────────────────────────

function StatusPill({
  hasConsideration,
  risk,
  failed = false,
}: {
  hasConsideration: boolean;
  risk: RiskLevel;
  /** Source unreachable this run — neutral "couldn't check", not green. */
  failed?: boolean;
}) {
  // Severity is colour-coded on ONE shared scale (lib/risk-style.ts) —
  // never the module tint, or a heritage "high" and a flooding "low"
  // would both just read as their module colour.
  const color = failed
    ? "var(--apple-orange)"
    : RISK_STYLE[hasConsideration ? risk : "none"].cssVar;
  const Icon = failed || hasConsideration ? TriangleAlert : Check;
  const riskLabel = hasConsideration ? RISK_STYLE[risk].label : "";
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
        color,
      }}
    >
      <span
        className="flex size-4 items-center justify-center rounded-full"
        style={{ background: color, color: "white" }}
      >
        <Icon className="size-2.5" strokeWidth={3.5} />
      </span>
      {failed
        ? "Couldn't check · source unavailable"
        : hasConsideration
          ? `Considerations${riskLabel ? ` · ${riskLabel}` : ""}`
          : "No considerations identified"}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

function legendItemsFromOverlays(overlays: OverlayFeature[]): { color: string; label: string }[] {
  const seen = new Set<string>();
  const items: { color: string; label: string }[] = [];
  for (const f of overlays) {
    const key = `${f.properties.fillColor}|${f.properties.legendLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      color: f.properties.fillColor,
      label: f.properties.legendLabel,
    });
  }
  return items;
}

function splitLegendItems(
  visibleOverlays: OverlayFeature[],
  applicableOverlays: OverlayFeature[],
) {
  const applicableKeys = new Set(
    applicableOverlays.map((f) => `${f.properties.fillColor}|${f.properties.legendLabel}`),
  );
  const visibleItems = legendItemsFromOverlays(visibleOverlays);
  return {
    applies: visibleItems.filter((item) => applicableKeys.has(`${item.color}|${item.label}`)),
    nearby: visibleItems.filter((item) => !applicableKeys.has(`${item.color}|${item.label}`)),
  };
}

export function ModuleSection({
  row,
  narrative,
  lat,
  lng,
  propertyPolygon = null,
  lotLines = null,
}: {
  row: ReportModuleRow;
  narrative: ModuleNarrative | undefined;
  lat: number;
  lng: number;
  propertyPolygon?: unknown | null;
  lotLines?: unknown | null;
}) {
  const meta = MODULE_META[row.module];
  const Icon = meta.icon;
  const risk: RiskLevel = row.riskLevel ?? "none";
  const raw =
    row.raw && typeof row.raw === "object"
      ? (row.raw as Record<string, unknown>)
      : undefined;
  const mapOverlays = extractOverlays(row.module, row.raw);
  const applicableOverlays = extractOverlays(row.module, row.raw, { scope: "property" });
  const legendItems = splitLegendItems(mapOverlays, applicableOverlays);
  // ModuleFacts returns null for modules with nothing to tabulate — resolve
  // it first so we don't render an empty facts box around nothing.
  const factsContent = raw ? ModuleFacts({ module: row.module, raw }) : null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm">
      {/* Header: name + clarifying question */}
      <div className="flex flex-col gap-3 px-5 pt-6 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:pt-9">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl sm:size-11"
            style={{
              background: `linear-gradient(135deg, color-mix(in oklab, ${meta.tint} 22%, transparent), color-mix(in oklab, ${meta.tint} 6%, transparent))`,
              color: meta.tint,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${meta.tint} 25%, transparent)`,
            }}
          >
            <Icon className="size-5" />
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
            {meta.name}
          </h2>
        </div>
        <p className="text-balance text-[13.5px] leading-snug text-muted-foreground sm:text-right sm:text-[15px]">
          {meta.question}
        </p>
      </div>

      {/* Hero map */}
      <div className="px-5 pt-5 sm:px-10 sm:pt-6">
        <ModuleMap
          lat={lat}
          lng={lng}
          className="h-64 sm:h-80 lg:h-96"
          overlays={mapOverlays}
          applicableOverlays={applicableOverlays}
          propertyPolygon={propertyPolygon}
          // Lot boundary lines only add value on the zoning map (they make the
          // dissolved zone fill read per-lot). Other modules don't need them.
          lotLines={row.module === "zoning" ? lotLines : null}
        />
      </div>

      {/* Status + source + AI summary */}
      <div className="flex flex-col gap-3 px-5 pt-5 sm:gap-4 sm:px-10 sm:pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
          <StatusPill
            hasConsideration={row.hasConsideration}
            risk={risk}
            failed={raw?.fetchFailed === true}
          />
        </div>

        {narrative?.summary && (
          <p
            className="text-[15px] leading-snug text-foreground text-pretty sm:text-[16.5px]"
            style={{ fontWeight: 500 }}
          >
            {narrative.summary}
          </p>
        )}
      </div>

      {/* Two-column body: Things to know + Note (L) / Questions + Legend (R) */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-5 pb-6 pt-5 sm:gap-y-8 sm:px-10 sm:pb-10 sm:pt-7 lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
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

          {factsContent && (
            <div className="rounded-2xl bg-foreground/[0.04] p-4">{factsContent}</div>
          )}

          <p className="text-[12px] leading-relaxed text-muted-foreground text-pretty">
            <span className="font-semibold text-foreground/80">Note: </span>
            {meta.note}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
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
                    background: SELECTED_PROPERTY_STYLE.color,
                    boxShadow: "0 0 0 1.5px white",
                    outline: `1px solid color-mix(in oklab, ${SELECTED_PROPERTY_STYLE.color} 70%, transparent)`,
                  }}
                />
                <span className="text-foreground/80">{SELECTED_PROPERTY_STYLE.label}</span>
              </li>
              {legendItems.applies.map((item) => (
                <li key={`applies-${item.color}-${item.label}`} className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-sm"
                    style={{
                      background: `color-mix(in oklab, ${item.color} 65%, transparent)`,
                      outline: `1px solid color-mix(in oklab, ${item.color} 70%, transparent)`,
                    }}
                  />
                  <span className="text-foreground/80">{item.label}</span>
                </li>
              ))}
              {legendItems.nearby.map((item) => (
                <li
                  key={`nearby-${item.color}-${item.label}`}
                  className="flex items-center gap-2 opacity-55"
                >
                  <span
                    className="size-3 rounded-sm"
                    style={{
                      background: `color-mix(in oklab, ${item.color} 45%, transparent)`,
                      outline: `1px solid color-mix(in oklab, ${item.color} 55%, transparent)`,
                    }}
                  />
                  <span className="text-foreground/70">{item.label} (nearby only)</span>
                </li>
              ))}
            </ul>
          </div>

          {narrative?.sources?.length ? (
            <div className="min-w-0">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                References
              </h3>
              <ul className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
                {Array.from(new Set(narrative.sources)).map((url) => (
                  <li key={url} className="min-w-0">
                    <span className="block truncate text-muted-foreground">
                      {prettyUrl(url)}
                    </span>
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
