import { Fragment } from "react";
import { Check, Info, TriangleAlert } from "lucide-react";

import { ModuleMap } from "@/components/report/module-map";
import type { ModuleNarrative } from "@/lib/anthropic";
import { MODULE_META } from "@/lib/module-meta";
import {
  contourColorAt,
  CONTOUR_LEGEND_LABEL,
  CONTOUR_RAMP,
  extractOverlays,
  type OverlayFeature,
} from "@/lib/overlays";
import type { ReportModuleRow } from "@/lib/pipeline";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";
import {
  isInformational,
  isNoSourceText,
  isUnavailable,
  NO_SOURCE_LABEL,
  RISK_STYLE,
} from "@/lib/risk-style";
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
  // The source didn't respond when the report ran: error-toned banner,
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
        Verification is pending because the source mapping was unavailable
        when this report was prepared. Run the check again or confirm the
        property directly with the relevant authority.
      </p>
    );
  }
  // Council-overlay modules outside adapted LGAs mark themselves
  // unavailable: surface the note instead of module facts.
  if (raw.available === false) {
    // The generic line is already on the status pill: only a specific
    // note earns a panel.
    if (typeof raw.availabilityNote !== "string" || isNoSourceText(raw.availabilityNote)) {
      return null;
    }
    return (
      <p className="rounded-xl border border-dashed border-border/70 bg-muted/40 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {raw.availabilityNote}
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
      const council = (raw.councilCategory as string | null | undefined) ?? null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Hazard category</dt>
          <dd className="font-medium">{cat ?? "Not stated"}</dd>
          {council && council !== cat && (
            <>
              <dt className="text-muted-foreground">Council overlay</dt>
              <dd className="font-medium">{council}</dd>
            </>
          )}
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
      const overland = (raw.overlandArea as string | null | undefined) ?? null;
      if (!river && !creek && !overland) return null;
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
          {overland && (
            <>
              <dt className="text-muted-foreground">Overland flow</dt>
              <dd className="font-medium">{overland}</dd>
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
        ? (raw.schools as {
            name: string;
            type: string;
            yearLevels: string[];
            yearRange?: string;
          }[])
        : [];
      const nearby = Array.isArray(raw.nearbySchools)
        ? (raw.nearbySchools as {
            name: string;
            sector: string;
            type: string;
            yearRange: string;
            distanceM: number;
          }[])
        : [];
      if (schools.length === 0 && nearby.length === 0) return null;
      const pill = (label: string, tint: string) => (
        <span
          className="w-full rounded-full px-2 py-0.5 text-center text-[9px] uppercase tracking-normal whitespace-nowrap"
          style={{
            background: `color-mix(in oklab, ${tint} 14%, transparent)`,
            color: tint,
          }}
        >
          {label}
        </span>
      );
      const sectorTint: Record<string, string> = {
        state: "var(--apple-blue)",
        catholic: "var(--apple-purple)",
        independent: "var(--apple-orange)",
      };
      return (
        <div className="flex flex-col gap-3 text-[12.5px]">
          {schools.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Catchment · guaranteed enrolment
              </div>
              <ul className="flex flex-col gap-1.5">
                {schools.map((s, i) => (
                  <li key={i} className="grid grid-cols-[112px_1fr] items-baseline gap-2.5">
                    {pill(s.type || "Catchment", "var(--apple-teal)")}
                    <span className="text-foreground/85">
                      <span className="font-medium">{s.name}</span>
                      {s.yearRange && (
                        <span className="text-muted-foreground"> · {s.yearRange}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {nearby.length > 0 && (
            <div>
              {/* Every sector, nearest first: the catchment says where you
                  MUST be accepted, this says what is actually around. */}
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Nearby schools · all sectors
              </div>
              <ul className="flex flex-col gap-1.5">
                {nearby.map((s, i) => (
                  <li key={i} className="grid grid-cols-[112px_1fr] items-baseline gap-2.5">
                    {pill(s.sector, sectorTint[s.sector.toLowerCase()] ?? "var(--apple-gray)")}
                    <span className="text-foreground/85">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">
                        {" "}· {s.type}
                        {s.yearRange && s.yearRange !== s.type ? `, ${s.yearRange}` : ""}
                      </span>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {" "}· {s.distanceM >= 1000 ? `${(s.distanceM / 1000).toFixed(1)} km` : `${s.distanceM} m`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
    case "heritage": {
      const entries = Array.isArray(raw.entries)
        ? (raw.entries as { type: string; description: string | null }[])
        : [];
      if (entries.length === 0) return null;
      const typeLabel: Record<string, string> = {
        state: "State heritage",
        local: "Local heritage",
        character: "Traditional character",
        dwelling_character: "Dwelling house character",
      };
      return (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                style={{
                  background:
                    "color-mix(in oklab, var(--apple-purple) 12%, transparent)",
                  color: "var(--apple-purple)",
                }}
              >
                {typeLabel[e.type] ?? e.type}
              </span>
              <span className="text-muted-foreground">{e.description ?? "No description recorded"}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "easements": {
      const desc = raw.description as string | null;
      type EasementRow = { lotplan?: string | null; areaSqm?: number | null };
      const cadastral = (raw.cadastralEasements as EasementRow[] | undefined) ?? [];
      const adjoining = (raw.adjoiningEasements as EasementRow[] | undefined) ?? [];
      if (!desc && cadastral.length === 0 && adjoining.length === 0) return null;
      const list = (rows: EasementRow[]) =>
        rows
          .map((e) =>
            e.lotplan
              ? `${e.lotplan}${e.areaSqm ? ` · ${Math.round(e.areaSqm)} m²` : ""}`
              : "Easement parcel",
          )
          .join(", ");
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
              <dd className="font-medium">{list(cadastral)}</dd>
            </>
          )}
          {adjoining.length > 0 && (
            <>
              <dt className="text-muted-foreground">Adjoining the lot</dt>
              <dd className="font-medium">{list(adjoining)}</dd>
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
      const elev = (raw.elevation ?? null) as {
        highM: number;
        lowM: number;
        fallM: number | null;
        interval: string;
        scope: string;
      } | null;
      if (!cat && !elev) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {cat && (
            <>
              <dt className="text-muted-foreground">Overlay</dt>
              <dd className="font-medium">{cat}</dd>
            </>
          )}
          {elev && (
            <>
              {/* Develo's "Property High / Low / Est. Fall". Fall leads -
                  it's the figure that moves build cost. */}
              <dt className="text-muted-foreground">Est. fall</dt>
              <dd className="font-medium">
                {elev.fallM === null ? (
                  <span className="text-muted-foreground">
                    Flat to within {elev.interval.split(" ")[0]} m
                  </span>
                ) : (
                  `${elev.fallM} m`
                )}
              </dd>
              <dt className="text-muted-foreground">Elevation</dt>
              <dd className="font-medium">
                {elev.fallM === null
                  ? `~${elev.highM} m AHD`
                  : `${elev.lowM} m – ${elev.highM} m AHD`}
              </dd>
              <dt className="text-muted-foreground">Measured from</dt>
              <dd className="font-medium">
                {elev.interval} contours
                {elev.scope === "nearby" && (
                  <span className="text-muted-foreground">
                    {" "}· surrounding area, no contour crosses the lot
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      );
    }
    case "acid_sulfate": {
      const codes = Array.isArray(raw.mapCodes) ? (raw.mapCodes as string[]) : [];
      // Every soil class on the lot; older rows only stored the one code.
      const code = codes.length > 0 ? codes.join(", ") : (raw.mapCode as string | null);
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
          {Array.isArray(raw.otherZones) && (raw.otherZones as string[]).length > 0 && (
            <>
              <dt className="text-muted-foreground">Also on lot</dt>
              <dd className="font-medium">{(raw.otherZones as string[]).join(", ")}</dd>
            </>
          )}
        </dl>
      );
    }
    case "internet": {
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Access network</dt>
          <dd className="font-medium">{typeof raw.accessNetwork === "string" ? raw.accessNetwork : "Outside footprints (satellite)"}</dd>
          <dt className="text-muted-foreground">Fixed line</dt>
          <dd className="font-medium">{raw.fixedLine === true ? "In footprint" : "No"}</dd>
          <dt className="text-muted-foreground">Fixed wireless</dt>
          <dd className="font-medium">{raw.fixedWireless === true ? "In footprint" : "No"}</dd>
          <dt className="text-muted-foreground">Data vintage</dt>
          <dd className="font-medium">March 2024</dd>
        </dl>
      );
    }
    case "boundary": {
      const edges = Array.isArray(raw.edges)
        ? (raw.edges as { lengthM: number; approx: boolean }[])
        : [];
      const area = typeof raw.areaM2 === "number" ? raw.areaM2 : null;
      const perimeter = typeof raw.perimeterM === "number" ? raw.perimeterM : null;
      const sorted = [...edges].sort((a, b) => b.lengthM - a.lengthM);
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Area</dt>
          <dd className="font-medium">
            {area === null
              ? "Not measured"
              : `${area.toLocaleString()} m²${raw.areaFromRegister === true ? "" : " (estimated)"}`}
          </dd>
          <dt className="text-muted-foreground">Perimeter</dt>
          <dd className="font-medium">{perimeter === null ? "Not measured" : `~${perimeter.toFixed(0)} m`}</dd>
          <dt className="text-muted-foreground">Sides</dt>
          <dd className="font-medium">
            {edges.length === 0
              ? "Not measured"
              : sorted
                  .slice(0, 8)
                  .map((e) => `${e.approx ? "~" : ""}${e.lengthM.toFixed(1)} m`)
                  .join(" · ") + (sorted.length > 8 ? " …" : "")}
          </dd>
          {typeof raw.lotPlan === "string" && (
            <>
              <dt className="text-muted-foreground">Lot / plan</dt>
              <dd className="font-medium">{raw.lotPlan}</dd>
            </>
          )}
        </dl>
      );
    }
    case "power": {
      const assets = Array.isArray(raw.assets)
        ? (raw.assets as { kind: string; klass: string }[])
        : [];
      const kinds = [...new Set(assets.map((a) => a.kind))];
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">On the lot</dt>
          <dd className="font-medium">
            {assets.length === 0 ? "No network assets on the lot" : kinds.slice(0, 4).join(", ")}
          </dd>
          <dt className="text-muted-foreground">Easement risk</dt>
          <dd className="font-medium">
            {raw.hasSubTransmissionOnLot === true
              ? "Sub-transmission line: check title for easement"
              : raw.hasHvOnLot === true
                ? "11kV feeder: clearance rules apply"
                : "Not triggered by mapped assets"}
          </dd>
        </dl>
      );
    }
    case "water_sewer": {
      const assets = Array.isArray(raw.assets)
        ? (raw.assets as {
            kind: string;
            diameterMm: number | null;
            material: string | null;
            depthM: number | null;
            isMain: boolean;
          }[])
        : [];
      const mains = assets.filter((a) => a.isMain);
      const severe = raw.hasTrunkOrPressureMainOnLot === true;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">On the lot</dt>
          <dd className="font-medium">
            {mains.length === 0
              ? "No main crosses the lot"
              : `${mains.length} main${mains.length > 1 ? "s" : ""} / structure${mains.length > 1 ? "s" : ""}`}
          </dd>
          {/* Service lines are the property's own connection: listing them
              beside the mains would blur the one distinction that matters. */}
          {mains.slice(0, 3).map((a, i) => (
            <Fragment key={i}>
              <dt className="text-muted-foreground">{a.kind}</dt>
              <dd className="font-medium">
                {[
                  a.diameterMm ? `${a.diameterMm} mm` : null,
                  a.material,
                  a.depthM ? `${a.depthM} m deep` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Retailer asset"}
              </dd>
            </Fragment>
          ))}
          {Array.isArray(raw.adjoiningMains) && (raw.adjoiningMains as { kind: string }[]).length > 0 && (
            <>
              <dt className="text-muted-foreground">Along boundary</dt>
              <dd className="font-medium">
                {Array.from(
                  new Set((raw.adjoiningMains as { kind: string }[]).map((a) => a.kind)),
                ).join(", ")}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Build over</dt>
          <dd className="font-medium">
            {severe
              ? "Generally not permitted: trunk or pressure main"
              : raw.hasMainOnLot === true
                ? "Retailer build-over approval required"
                : "Not triggered by mapped assets"}
          </dd>
        </dl>
      );
    }
    case "local_plans": {
      const plan = raw.planName as string | null;
      const precincts = Array.isArray(raw.precincts)
        ? (raw.precincts as {
            name: string;
            code: string | null;
            subPrecinct: string | null;
          }[])
        : [];
      if (!plan && precincts.length === 0) return null;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium">{plan ?? "Not stated"}</dd>
          {precincts.map((p, i) => (
            <Fragment key={i}>
              <dt className="text-muted-foreground">
                {p.code ? `Precinct ${p.code}` : "Precinct"}
              </dt>
              <dd className="font-medium">
                {p.name}
                {p.subPrecinct && (
                  <span className="text-muted-foreground">: {p.subPrecinct}</span>
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      );
    }
    case "stormwater": {
      const assets = Array.isArray(raw.assets)
        ? (raw.assets as {
            kind: string;
            pipeType: string | null;
            diameter: string | null;
            material: string | null;
            public: boolean;
          }[])
        : [];
      const publicAssets = assets.filter((a) => a.public);
      const onLot = raw.hasPublicAssetOnLot === true;
      return (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">On the lot</dt>
          <dd className="font-medium">
            {assets.length === 0
              ? "Nothing mapped"
              : `${assets.length} asset${assets.length > 1 ? "s" : ""}`}
            {assets.length > 0 && (
              <span className="text-muted-foreground">
                {" "}· {publicAssets.length} Council-owned
              </span>
            )}
          </dd>
          {/* Private roof-water runs are numerous and carry no obligation,
              so only the Council assets get itemised. */}
          {publicAssets.slice(0, 3).map((a, i) => (
            <Fragment key={i}>
              <dt className="text-muted-foreground">{a.kind}</dt>
              <dd className="font-medium">
                {[a.diameter, a.pipeType, a.material].filter(Boolean).join(" · ") ||
                  "Council-owned"}
              </dd>
            </Fragment>
          ))}
          <dt className="text-muted-foreground">Build over</dt>
          <dd className="font-medium">
            {onLot ? "Council approval required" : "Not triggered by mapped assets"}
          </dd>
        </dl>
      );
    }
    case "transport": {
      const stops = Array.isArray(raw.stops)
        ? (raw.stops as {
            kind: string;
            name: string | null;
            distanceM: number;
            wheelchair: boolean | null;
          }[])
        : [];
      if (stops.length === 0) return null;
      return (
        <ul className="flex flex-col gap-1.5 text-[12.5px]">
          {stops.map((s, i) => (
            <li key={i} className="grid grid-cols-[112px_1fr] items-baseline gap-2.5">
              <span
                className="w-full rounded-full px-2 py-0.5 text-center text-[9px] uppercase tracking-normal whitespace-nowrap"
                style={{
                  background:
                    "color-mix(in oklab, var(--apple-green) 14%, transparent)",
                  color: "var(--apple-green)",
                }}
              >
                {s.kind}
              </span>
              <span className="text-foreground/85">
                <span className="font-medium">{s.name ?? "Unnamed stop"}</span>
                {/* nowrap: on a phone the line broke between the number
                    and its unit ("· 155" / "m away"). */}
                <span className="whitespace-nowrap text-muted-foreground">
                  {" "}· {s.distanceM} m away
                </span>
              </span>
            </li>
          ))}
        </ul>
      );
    }
  }
}

// ── Status pill: one chip carrying both the finding AND its severity
// (previously a separate risk badge duplicated this and both read
// "clear/none" together on empty modules). ──────────────────────────────

function StatusPill({
  hasConsideration,
  risk,
  failed = false,
  unavailable = false,
}: {
  hasConsideration: boolean;
  risk: RiskLevel;
  /** Source unreachable this run: neutral "couldn't check", not green. */
  failed?: boolean;
  /** No source layer for this LGA: nothing was checked, so never the
   * green "No considerations identified" tick. */
  unavailable?: boolean;
}) {
  // Severity is colour-coded on ONE shared scale (lib/risk-style.ts) -
  // never the module tint, or a heritage "high" and a flooding "low"
  // would both just read as their module colour.
  //
  // Informational rows are flagged (they own a full section) but are not
  // warnings, so they get the off-ramp grey and an info glyph. Without
  // this branch a school catchment renders as a gold ⚠, which is what
  // this whole lane exists to stop.
  const info = !failed && !unavailable && isInformational(risk, hasConsideration);
  const color = failed
    ? "var(--apple-orange)"
    : unavailable
      ? RISK_STYLE.informational.cssVar
      : RISK_STYLE[hasConsideration ? risk : "none"].cssVar;
  const Icon =
    failed || (hasConsideration && !info && !unavailable)
      ? TriangleAlert
      : info || unavailable
        ? Info
        : Check;
  const riskLabel = hasConsideration && !info && !unavailable ? RISK_STYLE[risk].label : "";
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
        ? "Verification pending"
        : unavailable
          ? NO_SOURCE_LABEL
          : info
            ? "For information"
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
    // Labelled points (boundary side lengths) carry their information on
    // the map itself: no legend row.
    if (f.properties.textLabel) continue;
    // Contours share one label across the whole colour ramp, so keying on
    // colour would list "Contour line" once per shade.
    const key =
      f.properties.legendLabel === CONTOUR_LEGEND_LABEL
        ? CONTOUR_LEGEND_LABEL
        : `${f.properties.fillColor}|${f.properties.legendLabel}`;
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

type ElevationLegendData = {
  highM: number;
  lowM: number;
  fallM: number | null;
  interval: string;
  contextLowM: number | null;
  contextHighM: number | null;
};

/**
 * Steep Land's legend, Develo-style: a continuous elevation ramp with the
 * property's own high/low called out against it.
 *
 * A swatch list can't express this. Contours aren't categories: they're
 * samples of one continuous variable, so ~20 rows of "Contour line" says
 * nothing while a labelled gradient says all of it at a glance.
 */
function ElevationLegend({ elevation }: { elevation: ElevationLegendData }) {
  const lo = elevation.contextLowM ?? elevation.lowM;
  const hi = elevation.contextHighM ?? elevation.highM;
  const span = hi - lo;
  // Where the property sits on the map's range: that's what makes the
  // swatches match the lines actually drawn over the lot.
  const at = (m: number) => (span > 0 ? (m - lo) / span : 0.5);
  const intervalMetres = elevation.interval.split(" ")[0];
  // On a flat lot high === low, so separate rows would print the same
  // number twice. One row states the fact instead.
  const rows: { label: string; color?: string }[] =
    elevation.fallM === null
      ? [
          {
            // Name the interval. "Flat" from 5 m contours is a weaker claim
            // than "flat" from 1 m, and the reader is entitled to know which.
            label: `Property est. fall: flat to within ${intervalMetres} m`,
          },
          {
            label: `Property elevation: ~${Math.round(elevation.highM)} m`,
            color: contourColorAt(at(elevation.highM)),
          },
        ]
      : [
          { label: `Property est. fall: ~${elevation.fallM} m` },
          {
            label: `Property high: ~${Math.round(elevation.highM)} m`,
            color: contourColorAt(at(elevation.highM)),
          },
          {
            label: `Property low: ~${Math.round(elevation.lowM)} m`,
            color: contourColorAt(at(elevation.lowM)),
          },
        ];
  return (
    <>
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          {r.color ? (
            <span
              className="h-1.5 w-3 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <span className="text-foreground/80">{r.label}</span>
        </li>
      ))}
      <li className="mt-1 flex items-stretch gap-2">
        <span
          className="w-3 shrink-0 rounded-full"
          style={{
            minHeight: "4.5rem",
            background: `linear-gradient(to top, ${CONTOUR_RAMP.join(", ")})`,
          }}
        />
        <span className="flex flex-col justify-between py-0.5 text-[11.5px] text-muted-foreground">
          <span>{Math.round(hi)} m</span>
          <span>{Math.round(lo)} m</span>
        </span>
      </li>
    </>
  );
}

export function ModuleSection({
  row,
  narrative,
  lat,
  lng,
  propertyPolygon = null,
  lotLines = null,
  reportId = null,
}: {
  row: ReportModuleRow;
  narrative: ModuleNarrative | undefined;
  lat: number;
  lng: number;
  /** When set, the map fetches its overlay geometry on demand from
   * /api/report/[id]/overlays/[module] instead of receiving it inline:
   * the RSC payload then carries only the legend, not every polygon of
   * every section. */
  reportId?: string | null;
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
  const legendItemsAll = splitLegendItems(mapOverlays, applicableOverlays);
  // A contour is a sample of elevation, not a legend category. Never show
  // the generic "Contour line" swatch; when elevation metadata is present,
  // the labelled gradient below explains the colours instead.
  const elevationLegend = (raw?.elevation ?? null) as ElevationLegendData | null;
  const dropContourRow = (items: { color: string; label: string }[]) =>
    items.filter((i) => i.label !== CONTOUR_LEGEND_LABEL);
  const legendItems = {
    applies: dropContourRow(legendItemsAll.applies),
    nearby: dropContourRow(legendItemsAll.nearby),
  };
  // ModuleFacts returns null for modules with nothing to tabulate: resolve
  // it first so we don't render an empty facts box around nothing.
  const factsContent = raw ? ModuleFacts({ module: row.module, raw }) : null;

  return (
    <section
      id={`module-${row.module}`}
      className="scroll-mt-24 overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm"
    >
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
          overlays={reportId ? [] : mapOverlays}
          overlaysUrl={reportId ? `/api/report/${reportId}/overlays/${row.module}` : null}
          // Legend-only features: the property-scoped pass carries labels
          // without geometry, so this stays small.
          applicableOverlays={applicableOverlays.map((f) => ({ ...f, geometry: null }))}
          propertyPolygon={propertyPolygon}
          // Lot boundary lines only add value on the zoning map (they make the
          // dissolved zone fill read per-lot). Other modules don't need them.
          // With on-demand overlays they arrive from the overlays route.
          lotLines={row.module === "zoning" && !reportId ? lotLines : null}
          // Transport is the one module whose features are POINTS spread up
          // to ~2 km out: frame them, or the map shows an empty lot.
          fitPoints={row.module === "transport" || row.module === "schools"}
          // Contours colour the entire viewport, so a tighter frame keeps
          // the lot legible inside the everywhere-layer.
          tightFrame={row.module === "steep_land" || row.module === "boundary"}
        />
      </div>

      {/* Status + source + AI summary */}
      <div className="flex flex-col gap-3 px-5 pt-5 sm:gap-4 sm:px-10 sm:pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
          <StatusPill
            hasConsideration={row.hasConsideration}
            risk={risk}
            failed={raw?.fetchFailed === true}
            unavailable={isUnavailable(raw)}
          />
        </div>

        {/* Unavailable modules: the pill is the whole finding. A stored
            narrative (even an older, wordier one) would only restate it. */}
        {narrative?.summary && !isUnavailable(raw) && !isNoSourceText(narrative.summary) && (
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
            {narrative?.detail && !isUnavailable(raw) && !isNoSourceText(narrative.detail) && (
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
                {/* Blank lines in the narrative are paragraph breaks — the
                    stubs use them to separate "what the data says" from
                    "what it means for you". */}
                <div className="flex flex-col gap-2.5">
                  {narrative.detail.split(/\n{2,}/).map((para, i) => (
                    <p
                      key={i}
                      className="text-[13.5px] leading-relaxed text-foreground/85 text-pretty"
                    >
                      {para}
                    </p>
                  ))}
                </div>
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
                  className="size-3 shrink-0 rounded-sm"
                  style={{
                    background: SELECTED_PROPERTY_STYLE.color,
                    boxShadow: "0 0 0 1.5px white",
                    outline: `1px solid color-mix(in oklab, ${SELECTED_PROPERTY_STYLE.color} 70%, transparent)`,
                  }}
                />
                <span className="leading-none text-foreground/80">{SELECTED_PROPERTY_STYLE.label}</span>
              </li>
              {elevationLegend && <ElevationLegend elevation={elevationLegend} />}
              {legendItems.applies.map((item) => (
                <li key={`applies-${item.color}-${item.label}`} className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-sm"
                    style={{
                      background: `color-mix(in oklab, ${item.color} 65%, transparent)`,
                      outline: `1px solid color-mix(in oklab, ${item.color} 70%, transparent)`,
                    }}
                  />
                  <span className="leading-none text-foreground/80">{item.label}</span>
                </li>
              ))}
              {legendItems.nearby.map((item) => (
                <li
                  key={`nearby-${item.color}-${item.label}`}
                  className="flex items-center gap-2"
                >
                  <span
                    className="size-3 shrink-0 rounded-sm"
                    style={{
                      background: `color-mix(in oklab, ${item.color} 65%, transparent)`,
                      outline: `1px solid color-mix(in oklab, ${item.color} 70%, transparent)`,
                    }}
                  />
                  <span className="leading-none text-foreground/80">{item.label}</span>
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
          ) : isUnavailable(raw) ? (
            // Say so explicitly rather than dropping the block: an absent
            // References list reads as an oversight, not as "nothing was
            // checked".
            <div className="min-w-0">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                References
              </h3>
              <p className="text-[12.5px] text-muted-foreground">{NO_SOURCE_LABEL}.</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
