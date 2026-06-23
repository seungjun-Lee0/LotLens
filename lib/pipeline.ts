// End-to-end DD pipeline.
//
// Two phases, both addressed by address_id:
//
//   1. fetchOverlaysForAddress() — hits 5 ArcGIS endpoints in parallel,
//      writes one council_data row per module.
//   2. generateReportForAddress() — reads the council_data rows back,
//      generates narrative per module (LLM stub in Task 4a), writes one
//      reports row.
//
// Both are idempotent: re-running deletes prior data for that address and
// rewrites. Route handlers and CLI scripts call these directly so we keep
// HTTP-vs-script behaviour identical.

import { fetchBushfireData } from "@/lib/modules/bushfire";
import { fetchEasementsData } from "@/lib/modules/easements";
import { fetchFloodingData } from "@/lib/modules/flooding";
import { fetchFloodPlanningData } from "@/lib/modules/flood-planning";
import { fetchHeritageData } from "@/lib/modules/heritage";
import { fetchNoiseData } from "@/lib/modules/noise";
import { fetchOverlandFlowData } from "@/lib/modules/overland-flow";
import { fetchSchoolsData } from "@/lib/modules/schools";
import { fetchStormTideData } from "@/lib/modules/storm-tide";
import { fetchVegetationData } from "@/lib/modules/vegetation";
import { fetchZoningData } from "@/lib/modules/zoning";

import { generateModuleNarrative, type ModuleNarrative } from "@/lib/anthropic";
import {
  getDb,
  type CouncilDataRow,
  type Module,
  type RiskLevel,
} from "@/lib/db";
import { fetchPropertyParcel, type ParcelInfo } from "@/lib/property";

type Address = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
  paid_at?: string | null;
};

// ── Phase 1: fetch + persist overlays ─────────────────────────────────────

type ModuleOverlay = {
  module: Module;
  riskLevel: RiskLevel;
  hasConsideration: boolean;
  sourceName: string;
  sourceUrl: string;
  raw: unknown;
};

export type FetchOverlaysSummary = {
  addressId: string;
  modules: Record<Module, { riskLevel: RiskLevel; hasConsideration: boolean }>;
  elapsedMs: number;
};

async function loadAddress(addressId: string): Promise<Address> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, address_text, lat, lng
    FROM addresses
    WHERE id = ${addressId}
    LIMIT 1
  `) as Address[];
  if (rows.length === 0) {
    throw new Error(`address ${addressId} not found`);
  }
  return rows[0];
}

export async function fetchOverlaysForAddress(
  addressId: string,
): Promise<FetchOverlaysSummary> {
  const t0 = performance.now();
  const sql = getDb();
  const addr = await loadAddress(addressId);

  const [flood, floodPlan, overland, stormTide, fire, veg, herit, ease, noise, schools, zone] =
    await Promise.all([
      fetchFloodingData(addr.lat, addr.lng),
      fetchFloodPlanningData(addr.lat, addr.lng),
      fetchOverlandFlowData(addr.lat, addr.lng),
      fetchStormTideData(addr.lat, addr.lng),
      fetchBushfireData(addr.lat, addr.lng),
      fetchVegetationData(addr.lat, addr.lng),
      fetchHeritageData(addr.lat, addr.lng),
      fetchEasementsData(addr.lat, addr.lng),
      fetchNoiseData(addr.lat, addr.lng),
      fetchSchoolsData(addr.lat, addr.lng),
      fetchZoningData(addr.lat, addr.lng),
    ]);

  const overlays: ModuleOverlay[] = [
    { module: "flooding",       riskLevel: flood.riskLevel,     hasConsideration: flood.hasConsideration,     sourceName: flood.sources[0].name,     sourceUrl: flood.sources[0].url,     raw: flood },
    { module: "flood_planning", riskLevel: floodPlan.riskLevel, hasConsideration: floodPlan.hasConsideration, sourceName: floodPlan.sources[0].name, sourceUrl: floodPlan.sources[0].url, raw: floodPlan },
    { module: "overland_flow",  riskLevel: overland.riskLevel,  hasConsideration: overland.hasConsideration,  sourceName: overland.sources[0].name,  sourceUrl: overland.sources[0].url,  raw: overland },
    { module: "storm_tide",     riskLevel: stormTide.riskLevel, hasConsideration: stormTide.hasConsideration, sourceName: stormTide.sources[0].name, sourceUrl: stormTide.sources[0].url, raw: stormTide },
    { module: "bushfire",       riskLevel: fire.riskLevel,      hasConsideration: fire.hasConsideration,      sourceName: fire.sources[0].name,      sourceUrl: fire.sources[0].url,      raw: fire },
    { module: "vegetation",     riskLevel: veg.riskLevel,       hasConsideration: veg.hasConsideration,       sourceName: veg.sources[0].name,       sourceUrl: veg.sources[0].url,       raw: veg },
    { module: "heritage",       riskLevel: herit.riskLevel,     hasConsideration: herit.hasConsideration,     sourceName: herit.sources[0].name,     sourceUrl: herit.sources[0].url,     raw: herit },
    { module: "easements",      riskLevel: ease.riskLevel,      hasConsideration: ease.hasConsideration,      sourceName: ease.sources[0].name,      sourceUrl: ease.sources[0].url,      raw: ease },
    { module: "noise",          riskLevel: noise.riskLevel,     hasConsideration: noise.hasConsideration,     sourceName: noise.sources[0].name,     sourceUrl: noise.sources[0].url,     raw: noise },
    { module: "schools",        riskLevel: schools.riskLevel,   hasConsideration: schools.hasConsideration,   sourceName: schools.sources[0].name,   sourceUrl: schools.sources[0].url,   raw: schools },
    { module: "zoning",         riskLevel: zone.riskLevel,      hasConsideration: zone.hasConsideration,      sourceName: zone.sources[0].name,      sourceUrl: zone.sources[0].url,      raw: zone },
  ];

  // Idempotent replace. Each invocation drops the address's previous rows
  // and rewrites the five fresh ones.
  await sql`DELETE FROM council_data WHERE address_id = ${addressId}`;

  // 5 small inserts — fast enough sequentially on Neon's HTTP driver
  // (~30 ms each). Avoiding multi-row INSERT lets us serialise jsonb
  // through the tagged-template binding without manual escaping.
  for (const o of overlays) {
    await sql`
      INSERT INTO council_data
        (address_id, module, risk_level, has_consideration,
         source_name, source_url, raw_response)
      VALUES
        (${addressId}, ${o.module}, ${o.riskLevel}, ${o.hasConsideration},
         ${o.sourceName}, ${o.sourceUrl}, ${JSON.stringify(o.raw)}::jsonb)
    `;
  }

  const modules = Object.fromEntries(
    overlays.map((o) => [
      o.module,
      { riskLevel: o.riskLevel, hasConsideration: o.hasConsideration },
    ]),
  ) as FetchOverlaysSummary["modules"];

  return {
    addressId,
    modules,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

// ── Phase 2: generate narrative + persist report ──────────────────────────

export type ReportNarrative = Partial<Record<Module, ModuleNarrative>>;

export type GenerateReportResult = {
  reportId: string;
  addressId: string;
  narrative: ReportNarrative;
  elapsedMs: number;
};

// ── Report payload loader (consumed by /report/[id]/page.tsx + PDF) ─────

export type ReportModuleRow = {
  module: Module;
  riskLevel: RiskLevel | null;
  hasConsideration: boolean;
  sourceName: string;
  sourceUrl: string;
  raw: unknown;
};

export type ReportPayload = {
  report: { id: string; generated_at: string; narrative: ReportNarrative };
  address: Address;
  modules: ReportModuleRow[];
  considerationCount: number;
  /** GeoJSON Polygon/MultiPolygon of the actual cadastre lot the property
   * sits on — fetched from BCC's property_boundaries_parcel layer. Used
   * as the yellow "selected property" outline on every map. Falls back to
   * the zoning module polygon when the parcel lookup fails. */
  propertyPolygon: unknown | null;
  /** Per-lot cadastre metadata (lot/plan, area, freehold tenure, suburb).
   * Surfaced in the At a glance sidebar so the report mirrors Develo's
   * sidebar facts. null when the parcel lookup returned nothing. */
  parcel: ParcelInfo | null;
  /** True if the user has paid for the report. When false the report page
   * shows Flooding as a free preview and paywalls the other 7 modules. */
  paid: boolean;
};

export async function loadReportPayload(
  reportId: string,
): Promise<ReportPayload | null> {
  const sql = getDb();

  const reportRows = (await sql`
    SELECT id, address_id, narrative, generated_at
    FROM reports
    WHERE id = ${reportId}
    LIMIT 1
  `) as Array<{
    id: string;
    address_id: string;
    narrative: unknown;
    generated_at: string;
  }>;
  if (reportRows.length === 0) return null;
  const report = reportRows[0];

  const [addrRows, dataRows] = await Promise.all([
    sql`
      SELECT id, address_text, lat, lng, paid_at
      FROM addresses
      WHERE id = ${report.address_id}
      LIMIT 1
    `,
    sql`
      SELECT module, risk_level, has_consideration,
             source_name, source_url, raw_response
      FROM council_data
      WHERE address_id = ${report.address_id}
    `,
  ]);
  if ((addrRows as unknown[]).length === 0) return null;
  const address = (addrRows as Address[])[0];
  const rows = dataRows as Pick<
    CouncilDataRow,
    "module" | "risk_level" | "has_consideration" | "source_name" | "source_url" | "raw_response"
  >[];

  const ordered: Module[] = [
    "flooding",
    "flood_planning",
    "overland_flow",
    "storm_tide",
    "bushfire",
    "vegetation",
    "heritage",
    "easements",
    "noise",
    "schools",
    "zoning",
  ];
  const byModule = new Map(rows.map((r) => [r.module as Module, r]));
  const modules: ReportModuleRow[] = ordered
    .filter((m) => byModule.has(m))
    .map((m) => {
      const r = byModule.get(m)!;
      return {
        module: m,
        riskLevel: r.risk_level,
        hasConsideration: r.has_consideration,
        sourceName: r.source_name,
        sourceUrl: r.source_url,
        raw: r.raw_response,
      };
    });

  // Fetch the actual cadastre lot polygon + metadata from BCC's
  // property_boundaries_parcel layer. ~150 ms extra per page load,
  // dwarfed by the rest of the pipeline. Cleanly replaces our previous
  // hack of using the zoning module's polygon (which actually spans
  // the whole zone-precinct area — hundreds of metres across).
  const parcel = await fetchPropertyParcel(address.lat, address.lng);

  // Zoning polygon as the final fallback when the parcel lookup misses
  // (e.g. geocoded coord on a road centreline).
  const zoning = modules.find((m) => m.module === "zoning");
  const zRaw =
    zoning?.raw && typeof zoning.raw === "object"
      ? (zoning.raw as Record<string, unknown>)
      : null;
  const zInner =
    zRaw?.raw && typeof zRaw.raw === "object"
      ? (zRaw.raw as { features?: Array<{ geometry?: unknown }> })
      : null;
  const propertyPolygon =
    parcel.polygon ?? zInner?.features?.[0]?.geometry ?? null;

  return {
    report: {
      id: report.id,
      generated_at: report.generated_at,
      narrative: (report.narrative ?? {}) as ReportNarrative,
    },
    address,
    modules,
    considerationCount: modules.filter((m) => m.hasConsideration).length,
    propertyPolygon,
    parcel: parcel.polygon ? parcel : null,
    paid: Boolean(address.paid_at),
  };
}

export async function generateReportForAddress(
  addressId: string,
): Promise<GenerateReportResult> {
  const t0 = performance.now();
  const sql = getDb();
  const addr = await loadAddress(addressId);

  const rows = (await sql`
    SELECT id, address_id, module, source_url, source_name, raw_response,
           risk_level, has_consideration, retrieved_at
    FROM council_data
    WHERE address_id = ${addressId}
  `) as CouncilDataRow[];
  if (rows.length === 0) {
    throw new Error(
      `no council_data rows for address ${addressId}. Run fetchOverlaysForAddress first.`,
    );
  }

  const narrative: ReportNarrative = {};
  await Promise.all(
    rows.map(async (row) => {
      narrative[row.module as Module] = await generateModuleNarrative({
        module: row.module as Module,
        address: addr.address_text,
        councilData: row,
      });
    }),
  );

  const inserted = (await sql`
    INSERT INTO reports (address_id, narrative)
    VALUES (${addressId}, ${JSON.stringify(narrative)}::jsonb)
    RETURNING id
  `) as Array<{ id: string }>;

  return {
    reportId: inserted[0].id,
    addressId,
    narrative,
    elapsedMs: Math.round(performance.now() - t0),
  };
}
