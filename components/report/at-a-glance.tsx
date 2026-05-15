import { Check, TriangleAlert } from "lucide-react";

import { MODULE_META } from "@/lib/module-meta";
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

export function AtAGlance({ payload }: { payload: ReportPayload }) {
  const { report, address, modules, considerationCount } = payload;
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
  const zoneFamily = (zoningRaw?.lvl1Zone as string | null) ?? null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset,0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 px-5 py-6 sm:gap-y-8 sm:px-10 sm:py-10 lg:grid-cols-[1fr_280px]">
        {/* Left — title + 5 module rows */}
        <div className="flex flex-col gap-5 sm:gap-6">
          <div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              At a glance
            </h2>
            <p className="mt-2 max-w-md text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">
              Five public-data modules summarising what we found at this
              address. {considerationCount === 0
                ? "Nothing of concern."
                : `${considerationCount} module${considerationCount > 1 ? "s have" : " has"} something worth reading.`}
            </p>
          </div>

          <ul className="flex flex-col gap-2.5">
            {modules.map((m) => {
              const meta = MODULE_META[m.module];
              const Icon = meta.icon;
              const Status = m.hasConsideration ? TriangleAlert : Check;
              const tint = m.hasConsideration ? meta.tint : "var(--apple-green)";
              return (
                <li
                  key={m.module}
                  className="flex items-center gap-3 rounded-2xl border border-border/40 bg-background/40 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3"
                >
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-9"
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
                    <div className="truncate text-[11px] text-muted-foreground sm:text-[11.5px]">
                      {meta.sourceLabel}
                    </div>
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
                      <Status className="size-2.5" strokeWidth={3.5} />
                    </span>
                    <span className="hidden sm:inline">
                      {m.hasConsideration ? "Considerations" : "All clear"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right — metadata sidebar */}
        <aside className="flex flex-col gap-4 border-l-0 border-t border-border/40 pt-6 sm:gap-5 sm:pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <Meta label="Date of report">{formatDate(report.generated_at)}</Meta>
          <Meta label="Address"><span className="break-words">{address.address_text}</span></Meta>
          <Meta label="Council">Brisbane City Council</Meta>
          {zoneText && (
            <Meta label="Zoning">
              <ul className="mt-0.5 list-inside list-disc text-[13.5px] [&>li]:leading-snug">
                <li>{zoneText}</li>
                {zoneFamily && zoneFamily !== zoneText && <li>{zoneFamily}</li>}
              </ul>
            </Meta>
          )}
          <Meta label="Coordinates">
            <span className="font-mono text-[12.5px]">
              {address.lat.toFixed(4)}, {address.lng.toFixed(4)}
            </span>
          </Meta>
          <Meta label="Distance to CBD">{distanceKm.toFixed(1)} km</Meta>
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
