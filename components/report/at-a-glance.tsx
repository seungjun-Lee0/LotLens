import { Check, TriangleAlert } from "lucide-react";

import { MODULE_META } from "@/lib/module-meta";
import { RISK_RANK, RISK_STYLE, riskOf } from "@/lib/risk-style";
import type { ReportPayload } from "@/lib/pipeline";

// Brisbane CBD GPO (approx). Used for the "distance to CBD" stat in the
// sidebar — purely informational, no business logic depends on it.
const CBD = { lat: -27.4694, lng: 153.0235 };

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function isFailed(m: ReportPayload["modules"][number]): boolean {
  return (
    !!m.raw &&
    typeof m.raw === "object" &&
    (m.raw as Record<string, unknown>).fetchFailed === true
  );
}

export function AtAGlance({ payload }: { payload: ReportPayload }) {
  const { report, address, modules, considerationCount } = payload;
  const failedCount = modules.filter(isFailed).length;

  // Verdict layer: flagged modules first, most severe on top, then failed
  // checks; everything clear collapses into a compact strip below. The
  // canonical module order stays in the report BODY — this block is the
  // "read the punchline first" view.
  const attention = modules
    .filter((m) => m.hasConsideration || isFailed(m))
    .sort((a, b) => {
      const fa = isFailed(a) ? 1 : 0;
      const fb = isFailed(b) ? 1 : 0;
      if (fa !== fb) return fa - fb; // failed checks after real findings
      return (
        RISK_RANK[riskOf(b.riskLevel, b.hasConsideration)] -
        RISK_RANK[riskOf(a.riskLevel, a.hasConsideration)]
      );
    });
  const clear = modules.filter((m) => !m.hasConsideration && !isFailed(m));
  const topLine = attention
    .filter((m) => !isFailed(m))
    .slice(0, 3)
    .map(
      (m) =>
        `${MODULE_META[m.module].name} (${RISK_STYLE[riskOf(m.riskLevel, m.hasConsideration)].label})`,
    )
    .join(", ");
  const distanceKm = haversineKm(CBD, { lat: address.lat, lng: address.lng });
  const zoningRow = modules.find((m) => m.module === "zoning");
  const zoningRaw =
    zoningRow?.raw && typeof zoningRow.raw === "object"
      ? (zoningRow.raw as Record<string, unknown>)
      : null;
  const zoneText =
    (zoningRaw?.zonePrecinct as string | null) ??
    (zoningRaw?.zoneCode as string | null) ??
    null;
  const zoneSpecific = (zoningRaw?.lvl2Zone as string | null) ?? null;
  const zoneFamily = (zoningRaw?.lvl1Zone as string | null) ?? null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm">
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-5 py-6 sm:gap-y-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        {/* Left — title + 5 module rows */}
        <div className="flex flex-col gap-5 sm:gap-6">
          <div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              At a glance
            </h2>
            <p className="mt-2 max-w-md text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">
              {considerationCount === 0
                ? failedCount === 0
                  ? "All 15 public-data checks came back clear at this address."
                  : "Nothing of concern found in the checks that ran."
                : `${considerationCount} of ${modules.length} checks need your attention${topLine ? ` — most important: ${topLine}` : ""}.`}
              {failedCount > 0 &&
                ` ${failedCount} check${failedCount > 1 ? "s" : ""} couldn't reach ${failedCount > 1 ? "their sources" : "its source"} this run — re-run to retry.`}
            </p>
          </div>

          {attention.length > 0 && (
            <div>
              <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Needs attention ({attention.length})
              </div>
              <ul className="flex flex-col gap-2.5">
                {attention.map((m) => {
                  const meta = MODULE_META[m.module];
                  const Icon = meta.icon;
                  const failed = isFailed(m);
                  const level = riskOf(m.riskLevel, m.hasConsideration);
                  // Severity on the shared scale; module identity on the icon.
                  const tint = failed
                    ? "var(--apple-orange)"
                    : RISK_STYLE[level].cssVar;
                  const summary = report.narrative[m.module]?.summary;
                  return (
                    <li
                      key={m.module}
                      className="flex items-start gap-3 rounded-2xl border border-border/40 bg-background/40 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3"
                    >
                      <div
                        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-9"
                        style={{
                          background: `color-mix(in oklab, ${meta.tint} 14%, transparent)`,
                          color: meta.tint,
                        }}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold tracking-tight sm:text-[15px]">
                          {meta.name}
                        </div>
                        {failed ? (
                          <div className="text-[12px] leading-snug text-muted-foreground">
                            Source unreachable this run — re-run the checks.
                          </div>
                        ) : summary ? (
                          <div className="line-clamp-2 text-[12px] leading-snug text-muted-foreground sm:text-[12.5px]">
                            {summary}
                          </div>
                        ) : (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {meta.sourceLabel}
                          </div>
                        )}
                      </div>
                      <div
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] sm:gap-2 sm:px-3 sm:text-[11px] sm:tracking-[0.14em]"
                        style={{
                          background: `color-mix(in oklab, ${tint} 14%, transparent)`,
                          color: tint,
                        }}
                      >
                        <span
                          className="flex size-4 items-center justify-center rounded-full"
                          style={{ background: tint, color: "white" }}
                        >
                          <TriangleAlert className="size-2.5" strokeWidth={3.5} />
                        </span>
                        <span className="hidden sm:inline">
                          {failed ? "Not checked" : RISK_STYLE[level].label}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {clear.length > 0 && (
            <div>
              <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Checked &amp; clear ({clear.length})
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {clear.map((m) => {
                  const meta = MODULE_META[m.module];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={m.module}
                      className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-background/30 px-3 py-2"
                    >
                      <Icon className="size-3.5 shrink-0" style={{ color: meta.tint }} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                        {meta.name}
                      </span>
                      <Check
                        className="size-3.5 shrink-0"
                        strokeWidth={3}
                        style={{ color: "var(--apple-green)" }}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Right — metadata sidebar */}
        <aside className="flex min-w-0 flex-col gap-4 border-l-0 border-t border-border/40 pt-6 [overflow-wrap:anywhere] sm:gap-5 sm:pt-7 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <Meta label="Date of report">{formatDate(report.generated_at)}</Meta>
          <Meta label="Address"><span className="break-words">{address.address_text}</span></Meta>
          {payload.parcel?.lotPlan && (
            <Meta label="Lot / Plan">
              <span className="font-mono text-[13.5px]">
                {payload.parcel.lotNumber ?? payload.parcel.lotPlan} / {payload.parcel.planNumber ?? ""}
              </span>
            </Meta>
          )}
          {payload.parcel?.areaM2 && (
            <Meta label="Lot area">
              {payload.parcel.areaM2.toLocaleString("en-AU")} m²
              {payload.parcel.tenure && (
                <span className="ml-1.5 text-muted-foreground">· {payload.parcel.tenure}</span>
              )}
            </Meta>
          )}
          {payload.parcel?.lga && (
            <Meta label="Council">
              {/council/i.test(payload.parcel.lga)
                ? payload.parcel.lga
                : `${payload.parcel.lga} Council`}
            </Meta>
          )}
          {payload.parcel?.suburb && (
            <Meta label="Locality">{payload.parcel.suburb}</Meta>
          )}
          {zoneText && (
            <Meta label="Zoning">
              <ul className="mt-0.5 list-inside list-disc text-[13.5px] [&>li]:leading-snug">
                <li>{zoneText}</li>
                {zoneSpecific && zoneSpecific !== zoneText && <li>{zoneSpecific}</li>}
                {zoneFamily && zoneFamily !== zoneText && <li>{zoneFamily}</li>}
              </ul>
            </Meta>
          )}
          <Meta label="Coordinates">
            <span className="font-mono text-[12.5px]">
              {address.lat.toFixed(4)}, {address.lng.toFixed(4)}
            </span>
          </Meta>
          <Meta label="Distance to Brisbane CBD">{distanceKm.toFixed(1)} km</Meta>
          <Meta label="Report id">
            <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-[11.5px]">
              {report.id.slice(0, 8)}
            </code>
          </Meta>
        </aside>
      </div>
    </section>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
        {label}
      </div>
      <div className="mt-1 text-[13.5px] leading-snug text-foreground/90">
        {children}
      </div>
    </div>
  );
}
