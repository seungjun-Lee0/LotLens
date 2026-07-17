// Per-council (LGA) overlay adapter registry.
//
// Statewide layers cover every Queensland address; the layers councils
// publish themselves — detailed flood risk bands, transport noise,
// planning-scheme zoning, landslide/steep land — live on per-LGA services
// with per-LGA schemas. This file is the single place that knows those
// URLs and field names. All endpoints verified live 2026-07 (point
// queries at Maroochydore / Narangba / Burpengary / Surfers / Cleveland).
//
// Adding a council = adding one entry here (plus nothing else, for the
// modules that use the generic adapter shape).

import type { FeatureCollection, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { Region } from "@/lib/region";

export type CouncilId =
  | "brisbane"
  | "gold_coast"
  | "moreton_bay"
  | "sunshine_coast"
  | "redland";

/** Match the DCDB `shire_name` to a council adapter id. */
export function councilFromLga(lga: string | null | undefined): CouncilId | null {
  if (!lga) return null;
  const s = lga.toLowerCase();
  if (s.includes("brisbane")) return "brisbane";
  if (s.includes("gold coast")) return "gold_coast";
  if (s.includes("moreton bay")) return "moreton_bay";
  if (s.includes("sunshine coast")) return "sunshine_coast";
  if (s.includes("redland")) return "redland";
  return null;
}

export function councilOf(region: Region | undefined): CouncilId | null {
  if (!region) return "brisbane"; // legacy callers without a region
  return councilFromLga(region.lga) ?? (region.isBrisbane ? "brisbane" : null);
}

// ── Generic single-layer overlay adapter ────────────────────────────────

export type OverlayAdapter = {
  /** ArcGIS /query URL. */
  url: string;
  sourceName: string;
  docUrl: string;
  /** Candidate property names for the classification label — first
   * non-empty string wins. Defaults cover the common council schemas. */
  labelFields?: string[];
};

const DEFAULT_LABEL_FIELDS = [
  "OVL2_DESC",
  "LABEL",
  "CLASS",
  "Flood_Risk",
  "FLOOD_RISK",
  "DESCRIPT",
  "Class",
];

export function overlayLabel(
  fc: FeatureCollection<Geometry | null>,
  labelFields: string[] = DEFAULT_LABEL_FIELDS,
): string | null {
  for (const f of fc.features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    for (const field of labelFields) {
      const v = props[field];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return null;
}

/** One label per feature (first matching field). A lot-polygon query can
 * straddle several overlay bands, and ArcGIS feature order is NOT
 * deterministic — callers that grade severity must rank ALL of these and
 * take the worst, never just the first. */
export function overlayLabels(
  fc: FeatureCollection<Geometry | null>,
  labelFields: string[] = DEFAULT_LABEL_FIELDS,
): string[] {
  const labels: string[] = [];
  for (const f of fc.features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    for (const field of labelFields) {
      const v = props[field];
      if (typeof v === "string" && v.length > 0) {
        labels.push(v);
        break;
      }
    }
  }
  return labels;
}

// AGOL-hosted council services throw occasional transient network errors;
// one quick retry keeps a single hiccup from failing the whole report run.
async function queryWithRetry(
  url: string,
  params: Parameters<typeof queryArcGIS>[1],
): Promise<FeatureCollection<Geometry | null>> {
  try {
    return await queryArcGIS(url, params);
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return queryArcGIS(url, params);
  }
}

/** Point + context envelope query pair for a generic overlay layer.
 * When `lot` (the cadastre polygon) is provided, the classification query
 * intersects the actual lot instead of a ±50 m point envelope. */
export async function queryOverlayAdapter(
  adapter: OverlayAdapter,
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<{
  point: FeatureCollection<Geometry | null>;
  context: FeatureCollection<Geometry | null>;
  label: string | null;
}> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const [hit, ctx] = await Promise.all([
    queryWithRetry(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "*",
      returnGeometry: false,
      bufferDegrees: 0.00045,
      lotPolygon: lot,
    }),
    queryWithRetry(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "*",
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);
  return { point: hit, context: ctx, label: overlayLabel(hit, adapter.labelFields) };
}

// ── Zoning adapters ──────────────────────────────────────────────────────

export type ZoningParsed = {
  zoneCode: string | null;
  zonePrecinct: string | null;
  lvl1Zone: string | null;
  lvl2Zone: string | null;
};

export type ZoningAdapter = {
  url: string;
  outFields: string;
  sourceName: string;
  docUrl: string;
  parse: (props: Record<string, unknown>) => ZoningParsed;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const AP1 = (org: string, svc: string, layer: number) =>
  `https://services-ap1.arcgis.com/${org}/ArcGIS/rest/services/${svc}/FeatureServer/${layer}/query`;
const SCC_ORG = "YQyt7djuXN7rQyg4";
const MBRC_ORG = "152ojN3Ts9H3cdtl";
const GC_ORG = "lnVW0dLI3fvST2hd";
const REDLAND = "https://gis.redland.qld.gov.au/arcgis/rest/services/planning/rps/MapServer";

// NOTE: Brisbane zoning stays in lib/modules/zoning.ts (its polygon doubles
// as the parcel fallback and it has extra precinct handling).
export const ZONING_ADAPTERS: Partial<Record<CouncilId, ZoningAdapter>> = {
  gold_coast: {
    url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 4),
    outFields: "ZONE,ZONE_PRECINCT,LVL1_ZONE,Building_height",
    sourceName: "City of Gold Coast — City Plan v13 Zoning",
    docUrl: "https://cityplan.goldcoast.qld.gov.au/",
    parse: (p) => ({
      zoneCode: null,
      zonePrecinct: str(p.ZONE) ?? str(p.ZONE_PRECINCT),
      lvl1Zone: str(p.LVL1_ZONE),
      lvl2Zone: str(p.Building_height) ? `Building height ${p.Building_height}` : null,
    }),
  },
  moreton_bay: {
    url: AP1(MBRC_ORG, "ZM_Zones_Precincts_WebMercator_OpenData", 0),
    outFields: "ZONE_PREC",
    sourceName: "City of Moreton Bay — Planning Scheme Zones",
    docUrl: "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes",
    parse: (p) => ({
      zoneCode: null,
      zonePrecinct: str(p.ZONE_PREC),
      lvl1Zone: str(p.ZONE_PREC),
      lvl2Zone: null,
    }),
  },
  sunshine_coast: {
    url: AP1(SCC_ORG, "PlanningScheme_Zoning_SCC", 5),
    outFields: "LABEL,HEADING,DESCRIPT",
    sourceName: "Sunshine Coast Council — Planning Scheme Zones",
    docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
    parse: (p) => ({
      zoneCode: null,
      zonePrecinct: str(p.LABEL),
      lvl1Zone: str(p.HEADING),
      lvl2Zone: null,
    }),
  },
  redland: {
    url: `${REDLAND}/36/query`,
    outFields: "ZONECODE,ZONEDESC,SUBAREA,SUBAREADESC",
    sourceName: "Redland City Council — Planning Scheme Zoning",
    docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
    parse: (p) => ({
      zoneCode: str(p.ZONECODE),
      zonePrecinct: str(p.ZONEDESC),
      lvl1Zone: str(p.ZONEDESC),
      lvl2Zone: str(p.SUBAREADESC) !== str(p.ZONEDESC) ? str(p.SUBAREADESC) : null,
    }),
  },
};

// ── Flood adapters (detailed council flood risk bands) ──────────────────

// Brisbane's flood module keeps its richer three-layer implementation in
// lib/modules/flooding.ts; these adapters cover the other councils.
export const FLOOD_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter>> = {
  gold_coast: {
    url: AP1(GC_ORG, "Flood_Risk_Overlay_2024_update01", 0),
    sourceName: "City of Gold Coast — Flood Risk Overlay 2024",
    docUrl: "https://www.goldcoast.qld.gov.au/Services/Flooding-stormwater",
    labelFields: ["Flood_Risk"],
  },
  moreton_bay: {
    url: AP1(MBRC_ORG, "OM_Flood_Hazard_WebMercator_OpenData", 0),
    sourceName: "City of Moreton Bay — Flood Hazard Overlay",
    docUrl: "https://www.moretonbay.qld.gov.au/Services/Disaster-Management/Flooding",
    labelFields: ["OVL2_DESC"],
  },
  sunshine_coast: {
    url: AP1(SCC_ORG, "Flood_Hazard_Overlay_i_Flood_Risk_Area", 0),
    sourceName: "Sunshine Coast Council — Flood Hazard Overlay",
    docUrl: "https://www.sunshinecoast.qld.gov.au/living-and-community/natural-hazards/flooding",
    labelFields: ["LABEL"],
  },
  redland: {
    url: `${REDLAND}/8/query`,
    sourceName: "Redland City Council — Flood Prone, Storm Tide and Drainage Constrained Land",
    docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
    labelFields: ["CLASS"],
  },
};

// ── Overland flow adapters ───────────────────────────────────────────────

export const OVERLAND_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter>> = {
  moreton_bay: {
    url: AP1(MBRC_ORG, "OM_Overland_Flow_Path_WebMercator_OpenData", 0),
    sourceName: "City of Moreton Bay — Overland Flow Path Overlay",
    docUrl: "https://www.moretonbay.qld.gov.au/Services/Disaster-Management/Flooding",
  },
};

// ── Transport noise adapters ─────────────────────────────────────────────

export const NOISE_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_TransportNoiseOverlay", 0),
      sourceName: "City of Moreton Bay — Transport Noise Overlay",
      docUrl: "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes",
      labelFields: ["OVL2_DESC"],
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Regional_Infrastructure_Overlay_vi_Transport_Noise_Corridors", 0),
      sourceName: "Sunshine Coast Council — Transport Noise Corridor (road, mandatory)",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      labelFields: ["LABEL"],
    },
    {
      url: AP1(SCC_ORG, "Regional_Infrastructure_Overlay_vi_Transport_Noise_Corridors", 4),
      sourceName: "Sunshine Coast Council — Transport Noise Corridor (railway)",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      labelFields: ["LABEL"],
    },
  ],
  redland: [
    {
      url: `${REDLAND}/21/query`,
      sourceName: "Redland City Council — Road and Rail Noise Impacts Overlay",
      docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
      labelFields: ["CLASS"],
    },
  ],
};

// ── Landslide / steep land adapters ──────────────────────────────────────

export const STEEP_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter>> = {
  brisbane: {
    url: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Landslide_overlay/FeatureServer/0/query",
    sourceName: "BCC City Plan 2014 — Landslide overlay",
    docUrl: "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Landslide",
    labelFields: ["OVL2_DESC"],
  },
  moreton_bay: {
    url: AP1(MBRC_ORG, "MBRC_PlanningScheme_LandslideHazardOverlay", 0),
    sourceName: "City of Moreton Bay — Landslide Hazard Overlay",
    docUrl: "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes",
  },
  sunshine_coast: {
    url: AP1(SCC_ORG, "Landslide_Hazard_and_Steep_Land_Overlay_ii_Slope", 0),
    sourceName: "Sunshine Coast Council — Landslide Hazard and Steep Land Overlay",
    docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
    labelFields: ["LABEL", "Class"],
  },
  redland: {
    url: `${REDLAND}/17/query`,
    sourceName: "Redland City Council — Landslide Hazard Overlay",
    docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
    labelFields: ["CLASS"],
  },
};
