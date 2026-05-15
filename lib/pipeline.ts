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
import { fetchHeritageData } from "@/lib/modules/heritage";
import { fetchZoningData } from "@/lib/modules/zoning";

import { generateModuleNarrative, type ModuleNarrative } from "@/lib/anthropic";
import {
  getServerSupabase,
  type Module,
  type RiskLevel,
  type TypedSupabase,
} from "@/lib/supabase";

type Address = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
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

async function loadAddress(
  sb: TypedSupabase,
  addressId: string,
): Promise<Address> {
  const { data, error } = await sb
    .from("addresses")
    .select("id,address_text,lat,lng")
    .eq("id", addressId)
    .single();
  if (error || !data) {
    throw new Error(`address ${addressId} not found: ${error?.message ?? "no row"}`);
  }
  return data as Address;
}

export async function fetchOverlaysForAddress(
  addressId: string,
): Promise<FetchOverlaysSummary> {
  const t0 = performance.now();
  const sb = getServerSupabase();
  const addr = await loadAddress(sb, addressId);

  const [flood, fire, herit, ease, zone] = await Promise.all([
    fetchFloodingData(addr.lat, addr.lng),
    fetchBushfireData(addr.lat, addr.lng),
    fetchHeritageData(addr.lat, addr.lng),
    fetchEasementsData(addr.lat, addr.lng),
    fetchZoningData(addr.lat, addr.lng),
  ]);

  const overlays: ModuleOverlay[] = [
    {
      module: "flooding",
      riskLevel: flood.riskLevel,
      hasConsideration: flood.hasConsideration,
      sourceName: flood.sources[0].name,
      sourceUrl: flood.sources[0].url,
      raw: flood,
    },
    {
      module: "bushfire",
      riskLevel: fire.riskLevel,
      hasConsideration: fire.hasConsideration,
      sourceName: fire.sources[0].name,
      sourceUrl: fire.sources[0].url,
      raw: fire,
    },
    {
      module: "heritage",
      riskLevel: herit.riskLevel,
      hasConsideration: herit.hasConsideration,
      sourceName: herit.sources[0].name,
      sourceUrl: herit.sources[0].url,
      raw: herit,
    },
    {
      module: "easements",
      riskLevel: ease.riskLevel,
      hasConsideration: ease.hasConsideration,
      sourceName: ease.sources[0].name,
      sourceUrl: ease.sources[0].url,
      raw: ease,
    },
    {
      module: "zoning",
      riskLevel: zone.riskLevel,
      hasConsideration: zone.hasConsideration,
      sourceName: zone.sources[0].name,
      sourceUrl: zone.sources[0].url,
      raw: zone,
    },
  ];

  // Idempotent replace.
  const del = await sb.from("council_data").delete().eq("address_id", addressId);
  if (del.error) throw new Error(`failed to clear council_data: ${del.error.message}`);

  const ins = await sb.from("council_data").insert(
    overlays.map((o) => ({
      address_id: addressId,
      module: o.module,
      risk_level: o.riskLevel,
      has_consideration: o.hasConsideration,
      source_name: o.sourceName,
      source_url: o.sourceUrl,
      raw_response: o.raw,
    })),
  );
  if (ins.error) throw new Error(`failed to insert council_data: ${ins.error.message}`);

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
  /** GeoJSON Polygon/MultiPolygon of the cadastre lot the property sits on,
   * extracted from the zoning module's point-query result. null when no
   * parcel was matched (very rare in Brisbane LGA — every parcel is zoned).
   * Used as the yellow "selected property" outline on every module map. */
  propertyPolygon: unknown | null;
};

export async function loadReportPayload(
  reportId: string,
): Promise<ReportPayload | null> {
  const sb = getServerSupabase();
  const { data: report } = await sb
    .from("reports")
    .select("id,address_id,narrative,generated_at")
    .eq("id", reportId)
    .maybeSingle();
  if (!report || !report.address_id) return null;

  const [addrRes, dataRes] = await Promise.all([
    sb
      .from("addresses")
      .select("id,address_text,lat,lng")
      .eq("id", report.address_id)
      .single(),
    sb
      .from("council_data")
      .select(
        "module,risk_level,has_consideration,source_name,source_url,raw_response",
      )
      .eq("address_id", report.address_id),
  ]);
  if (addrRes.error || !addrRes.data) return null;
  if (dataRes.error) throw new Error(dataRes.error.message);

  const ordered: Module[] = [
    "flooding",
    "bushfire",
    "heritage",
    "easements",
    "zoning",
  ];
  const byModule = new Map(
    (dataRes.data ?? []).map((r) => [r.module as Module, r]),
  );
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

  // Extract the cadastre lot polygon from the zoning module's point-query
  // result. Zoning_opendata returns one feature per lot; the polygon IS
  // the lot outline.
  const zoning = modules.find((m) => m.module === "zoning");
  const zRaw =
    zoning?.raw && typeof zoning.raw === "object"
      ? (zoning.raw as Record<string, unknown>)
      : null;
  const zInner =
    zRaw?.raw && typeof zRaw.raw === "object"
      ? (zRaw.raw as { features?: Array<{ geometry?: unknown }> })
      : null;
  const propertyPolygon = zInner?.features?.[0]?.geometry ?? null;

  return {
    report: {
      id: report.id,
      generated_at: report.generated_at,
      narrative: (report.narrative ?? {}) as ReportNarrative,
    },
    address: addrRes.data as Address,
    modules,
    considerationCount: modules.filter((m) => m.hasConsideration).length,
    propertyPolygon,
  };
}

export async function generateReportForAddress(
  addressId: string,
): Promise<GenerateReportResult> {
  const t0 = performance.now();
  const sb = getServerSupabase();
  const addr = await loadAddress(sb, addressId);

  const { data: rows, error } = await sb
    .from("council_data")
    .select("*")
    .eq("address_id", addressId);
  if (error) throw new Error(`failed to load council_data: ${error.message}`);
  if (!rows || rows.length === 0) {
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

  const ins = await sb
    .from("reports")
    .insert({ address_id: addressId, narrative })
    .select("id")
    .single();
  if (ins.error) throw new Error(`failed to insert report: ${ins.error.message}`);

  return {
    reportId: ins.data.id,
    addressId,
    narrative,
    elapsedMs: Math.round(performance.now() - t0),
  };
}
