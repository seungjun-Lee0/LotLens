// Per-council (LGA) overlay adapter registry.
//
// Statewide layers cover every Queensland address; the layers councils
// publish themselves: detailed flood risk bands, transport noise,
// planning-scheme zoning, landslide/steep land: live on per-LGA services
// with per-LGA schemas. This file is the single place that knows those
// URLs and field names. All endpoints verified live 2026-07 (point
// queries at Maroochydore / Narangba / Burpengary / Surfers / Cleveland).
//
// Adding a council = adding one entry here (plus nothing else, for the
// modules that use the generic adapter shape).

import type { FeatureCollection, Geometry } from "geojson";
import polygonClipping from "polygon-clipping";

import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import type { Region } from "@/lib/region";

export type CouncilId =
  | "brisbane"
  | "gold_coast"
  | "moreton_bay"
  | "sunshine_coast"
  | "redland"
  | "logan"
  | "noosa"
  | "townsville";

/** Match the DCDB `shire_name` to a council adapter id. */
export function councilFromLga(lga: string | null | undefined): CouncilId | null {
  if (!lga) return null;
  const s = lga.toLowerCase();
  if (s.includes("brisbane")) return "brisbane";
  if (s.includes("gold coast")) return "gold_coast";
  if (s.includes("moreton bay")) return "moreton_bay";
  if (s.includes("sunshine coast")) return "sunshine_coast";
  if (s.includes("redland")) return "redland";
  if (s.includes("logan")) return "logan";
  if (s.includes("noosa")) return "noosa";
  if (s.includes("townsville")) return "townsville";
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
  /** Candidate property names for the classification label: first
   * non-empty string wins. Defaults cover the common council schemas. */
  labelFields?: string[];
  /** Attribute filter for layers that back several adapters (Logan's
   * per-lot Property Report carries every overlay as flag columns). */
  where?: string;
  /** Point-query buffer override (degrees). Per-lot layers need a tiny
   * buffer: the default ~50 m envelope would pull the NEIGHBOUR'S lot
   * polygon in and flag an address with its neighbour's overlay. */
  pointBuffer?: number;
  /** Clip returned CONTEXT geometry to the context envelope. For layers
   * whose features are LGA-wide dissolved multipolygons (Logan's OM-12
   * corridors are four whole-of-city multiparts, ~900 KB even
   * generalised), an intersect query returns the ENTIRE feature; clipping
   * keeps only the part inside the map frame's fetch window. */
  clipContext?: boolean;
  /** Label stamped onto every returned feature whose label field is
   * empty. For single-category layers that carry no descriptive
   * attribute at all (BCC's NALL "Council Vegetation" layer publishes a
   * null CATEGORY): without it the hit would classify and paint as a
   * nameless polygon. */
  staticLabel?: string;
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
 * deterministic: callers that grade severity must rank ALL of these and
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

// ── Bbox clip ────────────────────────────────────────────────────────────
//
// ArcGIS intersect queries return WHOLE features, so a context query that
// touches an LGA-wide dissolved multipolygon gets the entire city back.
// Clipping to the fetch window keeps context payloads at map-frame size.
//
// Done with a proper polygon boolean (polygon-clipping, Martinez-Rueda)
// rather than a hand-rolled Sutherland-Hodgman: the latter returns nothing
// when the window sits entirely inside a ring, and on concave rings emits
// zero-width bridges along the window edge that even-odd fills then paint
// inside-out (the Logan airport surface rendered as its own complement).
// The library also ignores ring order, which ArcGIS's GeoJSON output does
// not guarantee (the nbn footprint lists a satellite ring before the main
// one).

type ClipBox = { xmin: number; ymin: number; xmax: number; ymax: number };

function clipGeometryToBox(g: Geometry | null, box: ClipBox): Geometry | null {
  if (!g) return g;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return g; // lines/points pass through
  const window: [number, number][][] = [[
    [box.xmin, box.ymin], [box.xmax, box.ymin], [box.xmax, box.ymax], [box.xmin, box.ymax], [box.xmin, box.ymin],
  ]];
  // GeoJSON says ring 0 is the exterior, and the library takes that at
  // its word; ArcGIS's output does not always honour it (the nbn 4SLA-61
  // footprint lists a 5-point satellite ring before its 142-point main
  // ring, which would make the whole footprint a hole). The largest ring
  // is the exterior: put it first.
  const area = (ring: [number, number][]) => {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return Math.abs(s) / 2;
  };
  const normalise = (poly: [number, number][][]) => [...poly].sort((a, b) => area(b) - area(a));
  const subject =
    g.type === "Polygon"
      ? normalise(g.coordinates as [number, number][][])
      : (g.coordinates as [number, number][][][]).map(normalise);
  let out: [number, number][][][];
  try {
    out = polygonClipping.intersection(subject, window);
  } catch {
    // Degenerate input (self-touching rings the library rejects): keep the
    // feature unclipped rather than lose it.
    return g;
  }
  if (out.length === 0) return null;
  return out.length === 1
    ? { type: "Polygon", coordinates: out[0] }
    : { type: "MultiPolygon", coordinates: out };
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
  const CTX_BUFFER = contextBuffer(lot, lat, lng);
  const [hit, ctx] = await Promise.all([
    queryWithRetry(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "*",
      returnGeometry: false,
      bufferDegrees: adapter.pointBuffer ?? 0.00045,
      lotPolygon: lot,
      where: adapter.where,
    }),
    queryWithRetry(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "*",
      returnGeometry: true,
      bufferDegrees: CTX_BUFFER,
      maxAllowableOffset: 0.00003,
      quantize: true,
      where: adapter.where,
    }),
  ]);
  if (adapter.clipContext) {
    const box: ClipBox = {
      xmin: lng - CTX_BUFFER,
      ymin: lat - CTX_BUFFER,
      xmax: lng + CTX_BUFFER,
      ymax: lat + CTX_BUFFER,
    };
    ctx.features = ctx.features
      .map((f) => ({ ...f, geometry: clipGeometryToBox(f.geometry, box) }))
      .filter((f) => f.geometry != null);
  }
  if (adapter.staticLabel) {
    const field = (adapter.labelFields ?? DEFAULT_LABEL_FIELDS)[0];
    for (const f of [...hit.features, ...ctx.features]) {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      if (typeof props[field] !== "string" || props[field] === "") {
        props[field] = adapter.staticLabel;
      }
      f.properties = props;
    }
  }
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
  /** Councils that publish the zone and its precinct as SEPARATE layers
   * (Logan's ZM-01.00 / ZM-02.00). Queried with the same geometry and
   * merged into the same props object before `parse` runs, so the
   * precinct fields must not collide with the zone layer's. */
  precinctUrl?: string;
  precinctOutFields?: string;
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

const LOGAN_DOC =
  "https://www.logan.qld.gov.au/planning-and-development/logan-planning-scheme-2015";
// LoganHub planning-scheme map service (arcgis.lcc.wspdigital.com): the
// ACTUAL overlay polygons Logan's own interactive mapping draws.
//
// Every Logan adapter reads from here. They used to read Logan's per-lot
// "Property Report" layer, which carries each LPS2015 overlay as a flag
// column on the LOT (OM_0504A=1). That layer has two defects we hit in
// production: its context view painted whole flagged lots as hazard, and
// an intersect query against the subject lot also returns ADJOINING lots
// that share a boundary, so a `where OM_xxxx=1` filter could answer with
// the NEIGHBOUR's flags (verified 2026-09: Logan Central 1RP209405 came
// back flagged from 134CP827104, Park Ridge 74CP893316 from 1RP144541 -
// both subject lots carry no flood flag of their own). Overlay geometry
// has neither failure mode.
//
// Version-pinned path: when Logan releases a new scheme version it
// changes - the source-health-check catches it; the current path is on
// AGOL item 12cfd36ecb7540e093c22a64090a11b6.
export const LOGANHUB_ITEM_ID = "12cfd36ecb7540e093c22a64090a11b6";
export const LOGANHUB_BASE =
  "https://arcgis.lcc.wspdigital.com/server/rest/services/LoganHub/Logan_Planning_Scheme_v9_2_TLPI_No_1_2024_20250527/MapServer";
const LOGANHUB = (layer: number) => `${LOGANHUB_BASE}/${layer}/query`;

// Noosa council org (official jane.budgen_noosacouncil services).
const NOOSA = (svc: string) =>
  `https://services7.arcgis.com/T8mQYOrhFIr43s2O/arcgis/rest/services/${svc}/FeatureServer/0/query`;
const NOOSA_DOC =
  "https://www.noosa.qld.gov.au/planning-development/noosa-plan-2020";

// Townsville TCC_Publisher org.
const TCC = (svc: string, layer: number) =>
  `https://services6.arcgis.com/3VCE6mezZtwKJeIR/arcgis/rest/services/${svc}/FeatureServer/${layer}/query`;
const TCC_DOC =
  "https://www.townsville.qld.gov.au/building-planning-and-projects/townsville-city-plan";

// NOTE: Brisbane zoning stays in lib/modules/zoning.ts (its polygon doubles
// as the parcel fallback and it has extra precinct handling).
export const ZONING_ADAPTERS: Partial<Record<CouncilId, ZoningAdapter>> = {
  gold_coast: {
    url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 4),
    outFields: "ZONE,ZONE_PRECINCT,LVL1_ZONE,Building_height",
    sourceName: "City of Gold Coast: City Plan v13 Zoning",
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
    sourceName: "City of Moreton Bay: Planning Scheme Zones",
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
    sourceName: "Sunshine Coast Council: Planning Scheme Zones",
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
    sourceName: "Redland City Council: Planning Scheme Zoning",
    docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
    parse: (p) => ({
      zoneCode: str(p.ZONECODE),
      zonePrecinct: str(p.ZONEDESC),
      lvl1Zone: str(p.ZONEDESC),
      lvl2Zone: str(p.SUBAREADESC) !== str(p.ZONEDESC) ? str(p.SUBAREADESC) : null,
    }),
  },
  // LoganHub ZM-01.00 (zone) + ZM-02.00 (precinct): the zone polygons
  // themselves. This previously read the per-lot Property Report, whose
  // lot-polygon intersect returns ADJOINING lots on a shared boundary and
  // so could report the neighbour's zone (verified 2026-09 at Logan
  // Central and Park Ridge). The zone map has no such failure mode.
  logan: {
    url: LOGANHUB(368),
    outFields: "Zone",
    precinctUrl: LOGANHUB(367),
    precinctOutFields: "Precinct,Precinct_Code",
    sourceName: "Logan City Council: LPS2015 ZM-01.00 Zone map",
    docUrl: LOGAN_DOC,
    parse: (p) => ({
      zoneCode: str(p.Precinct_Code),
      zonePrecinct: str(p.Precinct) ? `${p.Zone} - ${p.Precinct}` : str(p.Zone),
      lvl1Zone: str(p.Zone),
      lvl2Zone: str(p.Precinct),
    }),
  },
  townsville: {
    url: TCC("TCC_City_Planning_Scheme_Zoning_GDA2020", 0),
    outFields: "ZONE_PREC,LVL1_ZONE,LVL2_ZONE",
    sourceName: "Townsville City Council: City Plan Zoning",
    docUrl: TCC_DOC,
    parse: (p) => ({
      zoneCode: null,
      zonePrecinct: str(p.ZONE_PREC) ?? str(p.LVL2_ZONE),
      lvl1Zone: str(p.LVL1_ZONE),
      lvl2Zone: str(p.LVL2_ZONE),
    }),
  },
};

// ── Flood adapters (detailed council flood risk bands) ──────────────────

// Brisbane's flood module keeps its richer three-layer implementation in
// lib/modules/flooding.ts; these adapters cover the other councils.
export const FLOOD_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  gold_coast: [
    {
      url: AP1(GC_ORG, "Flood_Risk_Overlay_2024_update01", 0),
      sourceName: "City of Gold Coast: Flood Risk Overlay 2024",
      docUrl: "https://www.goldcoast.qld.gov.au/Services/Flooding-stormwater",
      labelFields: ["Flood_Risk"],
    },
  ],
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "OM_Flood_Hazard_WebMercator_OpenData", 0),
      sourceName: "City of Moreton Bay: Flood Hazard Overlay",
      docUrl: "https://www.moretonbay.qld.gov.au/Services/Disaster-Management/Flooding",
      labelFields: ["OVL2_DESC"],
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Flood_Hazard_Overlay_i_Flood_Risk_Area", 0),
      sourceName: "Sunshine Coast Council: Flood Hazard Overlay",
      docUrl: "https://www.sunshinecoast.qld.gov.au/living-and-community/natural-hazards/flooding",
      labelFields: ["LABEL"],
    },
  ],
  redland: [
    {
      url: `${REDLAND}/8/query`,
      sourceName: "Redland City Council: Flood Prone, Storm Tide and Drainage Constrained Land",
      docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
      labelFields: ["CLASS"],
    },
  ],
  // Logan's OM-05 sub-layers from LoganHub: the real flood-extent
  // geometry Logan's own viewer draws. Previously this read the per-lot
  // Property Report's OM_05xx flag columns, which made the map paint
  // whole flagged LOTS as flood extent (same defect fixed for OM-08
  // steep land). `Description` carries the band ("High Flood Risk
  // Area", "Flood Investigation Area") that classifyCouncilFlood grades.
  logan: [
    [39, "flood risk areas"],
    [31, "flood assessment area"],
    [33, "isolated islands"],
    [35, "high flow area"],
    [37, "Meadowbrook flood assessment area"],
    [40, "flood investigation area"],
  ].map(([layer, label]) => ({
    url: LOGANHUB(layer as number),
    sourceName: `Logan City Council: OM-05 Flood hazard overlay (${label})`,
    docUrl: LOGAN_DOC,
    labelFields: ["Description", "Ovl2_Desc"],
  })),
  noosa: [
    {
      url: NOOSA("Flooding_and_Inundation_Extent_region"),
      sourceName: "Noosa Council: Flood Hazard Overlay (OM-FH)",
      docUrl: NOOSA_DOC,
      // The extent is ungraded (no severity bands); `Type` carries the
      // buyer-readable label. `Descriptio` is internal model naming ("Kin
      // Kin Creek Smoothed 2m Buffer") and must not surface.
      labelFields: ["Type"],
    },
  ],
};

// ── Overland flow adapters ───────────────────────────────────────────────

export const OVERLAND_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter>> = {
  moreton_bay: {
    url: AP1(MBRC_ORG, "OM_Overland_Flow_Path_WebMercator_OpenData", 0),
    sourceName: "City of Moreton Bay: Overland Flow Path Overlay",
    docUrl: "https://www.moretonbay.qld.gov.au/Services/Disaster-Management/Flooding",
  },
};

// ── Transport noise adapters ─────────────────────────────────────────────

export const NOISE_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  gold_coast: [
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 120),
      sourceName: "City of Gold Coast: Transport Noise Corridor (state-controlled road)",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      // SUMMARY reads "Category 1: 58 dB(A) =< Noise Level < 63 dB(A)" -
      // the shared classifier's QDC category regex grades it directly.
      labelFields: ["SUMMARY", "CATEGORY"],
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 121),
      sourceName: "City of Gold Coast: Transport Noise Corridor (railway)",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      labelFields: ["SUMMARY", "CATEGORY"],
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 94),
      sourceName: "City of Gold Coast: Airport Noise Exposure Area",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      labelFields: ["SENSITIVE_USE_TYPE"],
    },
  ],
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_TransportNoiseOverlay", 0),
      sourceName: "City of Moreton Bay: Transport Noise Overlay",
      docUrl: "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes",
      labelFields: ["OVL2_DESC"],
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Regional_Infrastructure_Overlay_vi_Transport_Noise_Corridors", 0),
      sourceName: "Sunshine Coast Council: Transport Noise Corridor (road, mandatory)",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      labelFields: ["LABEL"],
    },
    {
      url: AP1(SCC_ORG, "Regional_Infrastructure_Overlay_vi_Transport_Noise_Corridors", 4),
      sourceName: "Sunshine Coast Council: Transport Noise Corridor (railway)",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      labelFields: ["LABEL"],
    },
  ],
  redland: [
    {
      url: `${REDLAND}/21/query`,
      sourceName: "Redland City Council: Road and Rail Noise Impacts Overlay",
      docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
      labelFields: ["CLASS"],
    },
  ],
  // Logan: the actual OM-12 corridor polygons from the LoganHub map service
  // Logan's own interactive mapping draws — NOT the per-lot Property Report.
  // The report's OM_1200A/B/C flags matched these corridors when checked,
  // but its context view drew flagged LOTS (not corridor bands) and the
  // flags carry no noise category. Noise_Category here reads e.g.
  // "Local - Category 1 - Roads": QDC scale, higher = louder, which the
  // shared classifier grades directly. clipContext because layers 73/74
  // carry whole-of-LGA dissolved multipolygons (~900 KB per fetch
  // otherwise). Version-pinned URL: when Logan releases a new scheme
  // version this path changes — the source-health-check catches it; the
  // current path is on the AGOL item backing Logan's open-data "Transport
  // noise corridor" datasets (item 12cfd36ecb7540e093c22a64090a11b6).
  logan: [73, 74, 75].map((layer) => ({
    url: LOGANHUB(layer),
    sourceName: `Logan City Council: OM-12 Transport noise corridor (${
      layer === 73 ? "local government road" : layer === 74 ? "state-controlled road" : "railway"
    })`,
    docUrl: LOGAN_DOC,
    labelFields: ["Noise_Category"],
    clipContext: true,
  })),
};

// ── Strategic airport environs adapters ─────────────────────────────────
//
// Feeds the NOISE module's airport slot for councils whose scheme carries
// an airport-environs overlay that is NOT a noise contour: obstacle
// limitation surfaces (building height caps under flight paths) and
// wildlife-strike zones. These are development constraints, not exposure,
// so the module reports them as informational unless a real ANEF band
// also applies.
export const AIRPORT_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  // Logan OM-11.01 (LoganHub): almost all of Logan sits under Brisbane
  // Airport's obstacle limitation surface, so this fires on most lots. It
  // is still a genuine planning-scheme trigger (verified against Logan's
  // PD Hub property report for 10 Burgallby Rd), hence informational.
  logan: [
    {
      url: LOGANHUB(69),
      sourceName: "Logan City Council: OM-11 Strategic airport environs (obstacle limitation surface)",
      docUrl: LOGAN_DOC,
      labelFields: ["Ovl2_Desc"],
      clipContext: true,
    },
    {
      url: LOGANHUB(70),
      sourceName: "Logan City Council: OM-11 Strategic airport environs (bird and bat strike area)",
      docUrl: LOGAN_DOC,
      labelFields: ["Ovl2_Desc"],
      clipContext: true,
    },
  ],
};

// ── High-voltage / major electricity corridor adapters ──────────────────
//
// Feeds the EASEMENTS module's HV half. These are COUNCIL planning-scheme
// overlays, so unlike the raw Energex network extract they carry the
// council's open licence: usable in paid reports today.
export const HV_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  brisbane: [
    {
      url: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements/FeatureServer/0/query",
      sourceName: "BCC City Plan 2014: High voltage easements overlay",
      docUrl: "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Easements",
      labelFields: ["OVL2_DESC"],
      pointBuffer: 0.00005,
    },
  ],
  gold_coast: [
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 113),
      sourceName: "City of Gold Coast: Major electricity infrastructure (Powerlink)",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      labelFields: ["OVL2_DESC"],
      pointBuffer: 0.00005,
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 114),
      sourceName: "City of Gold Coast: Major electricity infrastructure (Energex)",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      labelFields: ["OVL2_DESC"],
      pointBuffer: 0.00005,
    },
  ],
  // Logan OM-09.01: real corridor / substation geometry from LoganHub.
  // (Was the per-lot Property Report's OM_0901x flags, which painted
  // whole lots.) Layer 60's Ovl2_Desc names the voltage directly
  // ("Powerline corridor 275kv"), which the HV classifier reads.
  logan: [
    [60, "powerline corridor and buffer"],
    [59, "electricity substation"],
    [61, "petroleum pipeline corridor"],
    [62, "water pipeline corridor"],
  ].map(([layer, label]) => ({
    url: LOGANHUB(layer as number),
    sourceName: `Logan City Council: OM-09 Regional infrastructure corridors (${label})`,
    docUrl: LOGAN_DOC,
    labelFields: ["Ovl2_Desc", "OVL2_Desc", "Description", "Label"],
  })),
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Regional_Infrastructure_Overlay_ii__Electricity", 0),
      sourceName: "Sunshine Coast Council: Regional Infrastructure Overlay (electricity)",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      // LABEL e.g. "Major Electricity Infrastructure - Distribution
      // (Energex) (State layer)". Polyline layer: centrelines, not
      // easement polygons, so keep the ~5 m buffer the other HV
      // adapters use rather than relying on lot intersection alone.
      labelFields: ["LABEL", "DESCRIPT"],
      pointBuffer: 0.00005,
    },
  ],
  redland: [
    {
      url: `${REDLAND}/4/query`,
      sourceName: "Redland City Council: Electricity Infrastructure Overlay",
      docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
      // These are the easement PARCELS themselves (LOT/PLAN_/TENURE=EA),
      // so there is no descriptive label field: the overlay name is the
      // description. TENURE keeps the parcel tenure code visible.
      labelFields: ["TENURE"],
      pointBuffer: 0.00005,
    },
  ],
};

// ── Landslide / steep land adapters ──────────────────────────────────────

export const STEEP_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  gold_coast: [
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 95),
      sourceName: "City of Gold Coast: City Plan v13 Landslide Hazard Overlay",
      docUrl: "https://cityplan.goldcoast.qld.gov.au/",
      // SMEC_2010 carries the graded severity ("Very High"); OVL2_DESC is
      // the bare overlay name as fallback.
      labelFields: ["SMEC_2010", "OVL2_DESC"],
    },
  ],
  brisbane: [
    {
      url: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Landslide_overlay/FeatureServer/0/query",
      sourceName: "BCC City Plan 2014: Landslide overlay",
      docUrl: "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Landslide",
      labelFields: ["OVL2_DESC"],
    },
  ],
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_LandslideHazardOverlay", 0),
      sourceName: "City of Moreton Bay: Landslide Hazard Overlay",
      docUrl: "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes",
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Landslide_Hazard_and_Steep_Land_Overlay_ii_Slope", 0),
      sourceName: "Sunshine Coast Council: Landslide Hazard and Steep Land Overlay",
      docUrl: "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014",
      labelFields: ["LABEL", "Class"],
    },
  ],
  redland: [
    {
      url: `${REDLAND}/17/query`,
      sourceName: "Redland City Council: Landslide Hazard Overlay",
      docUrl: "https://www.redland.qld.gov.au/info/20292/redland_city_plan",
      labelFields: ["CLASS"],
    },
  ],
  // Logan: the OM-08.01 hazard-class polygons from the LoganHub map
  // service - the actual sub-lot patches Logan's interactive mapping
  // draws. The per-lot Property Report flags (OM_0801A-D) matched these
  // for classification, but its context view painted whole flagged LOTS
  // as hazard, where the official viewer shows only the slope patches.
  // Lot-intersect point queries keep the verdict semantics identical
  // ("overlay intersects this lot"), and Ovl2_Desc carries the class
  // ("Landslide slope 15% plus", verified 889RP139752 Springwood).
  // OM-08.00 (layer 46, the trigger map) is skipped: it is the union of
  // these four classes with a generic label, and would double-draw.
  logan: [
    [48, "Historical landslide area"],
    [49, "12% slope investigation area"],
    [50, "12% plus slope hazard area"],
    [51, "15% plus slope hazard area"],
  ].map(([layer, label]) => ({
    url: LOGANHUB(layer as number),
    sourceName: `Logan City Council: OM-08.01 Landslide hazard (${label})`,
    docUrl: LOGAN_DOC,
    labelFields: ["Ovl2_Desc"],
  })),
  noosa: [
    {
      url: NOOSA("Landslide_Hazard_region"),
      sourceName: "Noosa Council: Landslide Hazard Overlay",
      docUrl: NOOSA_DOC,
      // "Very High / High / Moderate Hazard Area": classifySteep's keyword
      // grading maps these directly.
      labelFields: ["LABEL"],
    },
  ],
};

// ── Bushfire adapters ────────────────────────────────────────────────────
//
// The statewide Bushfire Prone Area is the backbone (queried directly by
// the module). Councils layer their own planning-scheme bushfire overlay
// on top, and it is the council overlay, not the SPP layer, that Develo
// reports and that a certifier reads: BCC's OM-002.3 maps hazard areas,
// hazard buffers and potential-intensity classes that the state layer
// leaves blank across whole suburbs (Fig Tree Pocket, Tarragindi).
export const BUSHFIRE_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  brisbane: [
    {
      url: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Bushfire_overlay/FeatureServer/0/query",
      sourceName: "BCC City Plan 2014: Bushfire overlay",
      docUrl: "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Bushfire",
      labelFields: ["OVL2_DESC"],
    },
  ],
};

// ── Heritage / character adapters ────────────────────────────────────────
//
// The statewide Queensland Heritage Register is queried directly by the
// module and covers every address. These are the COUNCIL instruments on
// top: local heritage registers and character/pre-1947 controls, which
// only exist where a council publishes them.
//
// `entryType` maps a layer onto the module's entry kinds: "local" grades
// high (a listing constrains demolition/renovation), "character" grades
// medium (form controls, no listing).
export type HeritageAdapter = OverlayAdapter & {
  entryType: "local" | "character" | "dwelling_character";
};

// BCC's published URL contains the typo "Hertiage": keep verbatim.
const BCC_LOCAL_HERITAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Hertiage_overlay_Local_heritage_area/FeatureServer/0/query";
const BCC_CHARACTER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Traditional_building_character_overlay/FeatureServer/0/query";
const BCC_DWELLING_CHARACTER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Dwelling_house_character_overlay/FeatureServer/0/query";
const BCC_HERITAGE_DOC = "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Heritage";
const SCC_DOC =
  "https://www.sunshinecoast.qld.gov.au/development/planning-documents/sunshine-coast-planning-scheme-2014";
const MBRC_DOC =
  "https://www.moretonbay.qld.gov.au/Services/Building-Development/Planning-Schemes";
const GC_DOC = "https://cityplan.goldcoast.qld.gov.au/";
const REDLAND_DOC = "https://www.redland.qld.gov.au/info/20292/redland_city_plan";

export const HERITAGE_ADAPTERS: Partial<Record<CouncilId, HeritageAdapter[]>> = {
  brisbane: [
    {
      url: BCC_LOCAL_HERITAGE,
      sourceName: "BCC City Plan 2014: Local heritage area",
      docUrl: BCC_HERITAGE_DOC,
      entryType: "local",
    },
    {
      url: BCC_CHARACTER,
      sourceName: "BCC City Plan 2014: Traditional building character overlay",
      docUrl: BCC_HERITAGE_DOC,
      entryType: "character",
    },
    {
      // City Plan 2014 Part 9: height/form controls on houses to protect
      // an area's residential character. Distinct from the pre-1947
      // traditional building character overlay above.
      url: BCC_DWELLING_CHARACTER,
      sourceName: "BCC City Plan 2014: Dwelling house character overlay",
      docUrl: BCC_HERITAGE_DOC,
      entryType: "dwelling_character",
    },
  ],
  gold_coast: [
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 83),
      sourceName: "City of Gold Coast: City Plan v13 Local heritage place",
      docUrl: GC_DOC,
      entryType: "local",
    },
    {
      // "Areas Adjoining Local Heritage": proximity triggers assessment
      // but is NOT a listing, so it grades as character, not local.
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 84),
      sourceName: "City of Gold Coast: Place in proximity to a local heritage place",
      docUrl: GC_DOC,
      entryType: "character",
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 102),
      sourceName: "City of Gold Coast: Mudgeeraba village character",
      docUrl: GC_DOC,
      entryType: "character",
    },
  ],
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_HeritageAreas", 0),
      sourceName: "City of Moreton Bay: Heritage Areas Overlay",
      docUrl: MBRC_DOC,
      entryType: "local",
    },
    {
      // Point layer: a protected tree on or beside the lot. Landscape
      // heritage, so character rather than a building listing.
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_HeritageLandscape_SignificantTree", 0),
      sourceName: "City of Moreton Bay: Landscape heritage (significant tree)",
      docUrl: MBRC_DOC,
      entryType: "character",
      pointBuffer: 0.0002, // ~20 m: a tree next door still constrains works
    },
  ],
  sunshine_coast: [
    {
      // Point layer (place centroids), so a lot-polygon intersect would
      // miss a place whose point sits just off the parcel.
      //
      // NOTE: this is the council's only published heritage overlay and
      // it currently holds 6 features, ALL offshore shipwrecks (verified
      // 2026-09). Sunshine Coast land heritage places are not published
      // as open data, so a clear result here is not proof of "no local
      // heritage listing": the statewide QHR still carries state
      // listings, and the module's availability copy stays accurate.
      url: AP1(SCC_ORG, "Heritage_and_Character_Areas_Overlay", 0),
      sourceName: "Sunshine Coast Council: Heritage and Character Areas Overlay",
      docUrl: SCC_DOC,
      labelFields: ["LABEL", "PS_Policy_Name", "DESCRIPT"],
      entryType: "local",
      pointBuffer: 0.0002,
    },
  ],
  redland: [
    // Layer 10 is a GROUP layer (400s on /query): use the leaves.
    {
      url: `${REDLAND}/13/query`,
      sourceName: "Redland City Council: Heritage Places",
      docUrl: REDLAND_DOC,
      labelFields: ["Significance", "CLASS"],
      entryType: "local",
    },
    {
      url: `${REDLAND}/12/query`,
      sourceName: "Redland City Council: Character Precinct",
      docUrl: REDLAND_DOC,
      labelFields: ["CLASS"],
      entryType: "character",
    },
    {
      url: `${REDLAND}/11/query`,
      sourceName: "Redland City Council: Heritage Trees",
      docUrl: REDLAND_DOC,
      labelFields: ["CLASS"],
      entryType: "character",
      pointBuffer: 0.0002,
    },
  ],
  // Logan OM-07.01 from LoganHub: the heritage-area polygons themselves.
  // (Was the per-lot Property Report's OM_0701A/B flags.)
  // Heritage_Reference reads "LHR - Park Ridge - 1" (Local Heritage
  // Register entry), which is the buyer-facing identifier.
  logan: [
    {
      url: LOGANHUB(44),
      sourceName: "Logan City Council: OM-07.01 Heritage areas",
      docUrl: LOGAN_DOC,
      labelFields: ["Heritage_Reference", "Heritage_Reference_Code"],
      entryType: "local",
    },
  ],
};

// ── Council vegetation / biodiversity adapters ───────────────────────────
//
// On top of the statewide regulated vegetation map (VM Act) the module
// already queries. These are the council biodiversity instruments a
// conveyancer cites for clearing approval.
// BCC's Natural Assets Local Law 2003 protected-vegetation series: four
// layers, one category each (CATEGORY is the only attribute; the Council
// Vegetation layer leaves even that null). NALL is what stops a buyer
// felling a tree on an ordinary suburban block: the City Plan biodiversity
// overlay alone misses most of the lots Develo flags as "Vegetation Y".
const BCC_NALL = (name: string) =>
  `https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Protected_Vegetation_Natural_Assets_Local_Law_2003_${name}/FeatureServer/0/query`;
const BCC_NALL_DOC =
  "https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/natural-assets-local-law";

export const VEGETATION_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  brisbane: [
    {
      url: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Biodiversity_areas_overlay_Biodiversity_areas/FeatureServer/0/query",
      sourceName: "BCC City Plan 2014: Biodiversity areas overlay",
      docUrl: "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Biodiversity",
      labelFields: ["OVL2_DESC"],
    },
    {
      url: BCC_NALL("Waterway_and_Wetland_Vegetation"),
      sourceName: "BCC Natural Assets Local Law: Waterway and wetland vegetation",
      docUrl: BCC_NALL_DOC,
      labelFields: ["CATEGORY"],
      staticLabel: "NALL Waterway Wetland Vegetation",
    },
    {
      url: BCC_NALL("Significant_Native_Vegetation"),
      sourceName: "BCC Natural Assets Local Law: Significant native vegetation",
      docUrl: BCC_NALL_DOC,
      labelFields: ["CATEGORY"],
      staticLabel: "NALL Significant Native Vegetation",
    },
    {
      url: BCC_NALL("Significant_Urban_Vegetation"),
      sourceName: "BCC Natural Assets Local Law: Significant urban vegetation",
      docUrl: BCC_NALL_DOC,
      labelFields: ["CATEGORY"],
      staticLabel: "NALL Significant Urban Vegetation",
    },
    {
      url: BCC_NALL("Council_Vegetation"),
      sourceName: "BCC Natural Assets Local Law: Council vegetation",
      docUrl: BCC_NALL_DOC,
      labelFields: ["CATEGORY"],
      staticLabel: "NALL Council Vegetation",
    },
  ],
  gold_coast: [
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 60),
      sourceName: "City of Gold Coast: Regulated vegetation",
      docUrl: GC_DOC,
      labelFields: ["OVL2_DESC"],
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 63),
      sourceName: "City of Gold Coast: Vegetation management",
      docUrl: GC_DOC,
      labelFields: ["OVL2_DESC"],
    },
    {
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 54),
      sourceName: "City of Gold Coast: State significant species habitat",
      docUrl: GC_DOC,
      labelFields: ["OVL2_DESC"],
    },
    {
      // One dissolved LGA-wide multipolygon: an intersect query returns
      // the whole city, so clip the context to the map frame.
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 55),
      sourceName: "City of Gold Coast: Koala habitat areas",
      docUrl: GC_DOC,
      labelFields: ["OVL2_DESC"],
      clipContext: true,
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Biodiversity_Waterways_and_Wetlands_Overlay_ii_MSES", 0),
      sourceName: "Sunshine Coast Council: Biodiversity overlay (MSES)",
      docUrl: SCC_DOC,
      labelFields: ["LABEL", "HEADING"],
    },
    {
      url: AP1(SCC_ORG, "Biodiversity_Waterways_and_Wetlands_Overlay_iii_MLES", 0),
      sourceName: "Sunshine Coast Council: Biodiversity overlay (MLES)",
      docUrl: SCC_DOC,
      labelFields: ["LABEL", "HEADING"],
    },
    {
      url: AP1(SCC_ORG, "Biodiversity_Waterways_and_Wetlands_Overlay_i_MNES", 0),
      sourceName: "Sunshine Coast Council: Biodiversity overlay (MNES)",
      docUrl: SCC_DOC,
      labelFields: ["LABEL", "HEADING"],
    },
  ],
  redland: [
    {
      // Leaf of the Habitat Protection group layer.
      url: `${REDLAND}/9/query`,
      sourceName: "Redland City Council: Bushland Habitat Overlay",
      docUrl: REDLAND_DOC,
      labelFields: ["CLASS"],
    },
  ],
  // Logan OM-02 leaves from LoganHub (real geometry; the Property Report
  // flag path painted whole lots). 7 is a group layer, so use its
  // children 8/9; 11 and 16 likewise.
  logan: [
    [6, "vegetation management areas"],
    [8, "biodiversity corridor"],
    [9, "koala corridor"],
    [12, "locally significant vegetation"],
    [18, "matters of state and local environmental significance"],
  ].map(([layer, label]) => ({
    url: LOGANHUB(layer as number),
    sourceName: `Logan City Council: OM-02 Biodiversity areas overlay (${label})`,
    docUrl: LOGAN_DOC,
    labelFields: ["OVL2_DESC", "Ovl2_Desc", "Classification"],
  })),
};

// ── Local plan / neighbourhood plan adapters ─────────────────────────────
//
// The plan that overrides the zone's height/density rules for THIS
// suburb. Every council names the fields differently, so the adapter
// carries the two field lists instead of a shared guess.
export type LocalPlanAdapter = {
  url: string;
  sourceName: string;
  docUrl: string;
  /** Candidate fields for the plan name. */
  planFields: string[];
  /** Candidate fields for the precinct within the plan (optional). */
  precinctFields?: string[];
};

export const LOCAL_PLAN_ADAPTERS: Partial<Record<CouncilId, LocalPlanAdapter[]>> = {
  moreton_bay: [
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_ZM_LocalPlanBoundary", 0),
      sourceName: "City of Moreton Bay: Local Plan boundary",
      docUrl: MBRC_DOC,
      planFields: ["LP", "OM_Label"],
    },
    {
      url: AP1(MBRC_ORG, "MBRC_PlanningScheme_ZM_LocalPlanPrecincts", 0),
      sourceName: "City of Moreton Bay: Local Plan precincts",
      docUrl: MBRC_DOC,
      planFields: ["LP"],
      precinctFields: ["LP_PREC"],
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Local_Plan_Area_Boundaries", 0),
      sourceName: "Sunshine Coast Council: Local Plan Area boundaries",
      docUrl: SCC_DOC,
      planFields: ["label", "lpa_label"],
    },
    {
      url: AP1(SCC_ORG, "Local_Plan_Precincts_and_Sub_Precincts", 0),
      sourceName: "Sunshine Coast Council: Local Plan precincts and sub-precincts",
      docUrl: SCC_DOC,
      planFields: ["heading"],
      precinctFields: ["label"],
    },
  ],
  redland: [
    {
      // Redland has no city-wide local plan layer: it publishes two
      // structure-plan areas instead (layer 14 is a GROUP, use leaf 16).
      url: `${REDLAND}/16/query`,
      sourceName: "Redland City Council: Kinross Road Structure Plan",
      docUrl: REDLAND_DOC,
      planFields: ["STRUCTPLAN", "CLASS"],
    },
    {
      url: `${REDLAND}/22/query`,
      sourceName: "Redland City Council: Southeast Thornlands Structure Plan",
      docUrl: REDLAND_DOC,
      planFields: ["STRUCTPLAN", "CLASS"],
    },
  ],
  logan: [
    {
      url: LOGANHUB(129),
      sourceName: "Logan City Council: Local plan boundary (Part 7)",
      docUrl: LOGAN_DOC,
      planFields: ["Local_Plan"],
    },
    {
      url: LOGANHUB(130),
      sourceName: "Logan City Council: Local plan precinct area (Part 7)",
      docUrl: LOGAN_DOC,
      planFields: ["Local_Plan"],
      precinctFields: ["Local_Plan_Precinct", "Precinct_Code"],
    },
  ],
};

// ── Statutory flood-planning adapters ────────────────────────────────────
//
// Distinct from FLOOD_ADAPTERS: those carry the council's flood HAZARD
// mapping (where water goes), these carry the separate statutory control
// layer that gates development approval. Most councils publish ONE flood
// overlay which already serves as their hazard layer - listing it here
// too would draw the same polygons twice - so this table only holds
// genuinely separate instruments.
export const FLOOD_PLANNING_ADAPTERS: Partial<Record<CouncilId, OverlayAdapter[]>> = {
  gold_coast: [
    {
      // Single dissolved city-wide polygon: clip context to the frame.
      url: AP1(GC_ORG, "City_Plan_Version_13_Open_Data", 81),
      sourceName: "City of Gold Coast: City Plan v13 Flood assessment required",
      docUrl: GC_DOC,
      labelFields: ["OVL2_DESC"],
      clipContext: true,
    },
  ],
  sunshine_coast: [
    {
      url: AP1(SCC_ORG, "Flood_Hazard_Overlay_ii_Flood_Storage", 0),
      sourceName: "Sunshine Coast Council: Flood Storage Preservation Area",
      docUrl: SCC_DOC,
      labelFields: ["LABEL", "HEADING"],
    },
  ],
};
