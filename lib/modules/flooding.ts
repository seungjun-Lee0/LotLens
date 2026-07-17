// Flooding module — BCC Flood Awareness Mapping (FAM).
//
// ─── Endpoints (BCC Brisbane open data ArcGIS) ────────────────────────────
//
// 1) Overall flood risk (combined creek + river + storm tide), 4-tier:
//    Flood_Awareness_Flood_Risk_Overall/FeatureServer/0
//      Fields: OBJECTID, FLOOD_RISK ∈ {High, Medium, Low, Very Low},
//              FLOOD_TYPE = "Creek River Storm Tide" (constant in this layer),
//              Shape__Area, Shape__Length
//      Native SRID: EPSG:28356 (GDA94 / MGA Zone 56). We query with inSR=4326.
//      A point outside every polygon = "no consideration identified".
//
// 2) Historic February 2022 flood extents:
//    Flood_Awareness_Historic_Brisbane_River_and_Creek_Floods_Feb2022/FeatureServer/0
//      Fields: OBJECTID, SOURCE_TYPE (e.g. "RIVER", "CREEK"), SOURCE_NAME,
//              FLOOD_EVENT = "February 2022", STATUS, REF_NUMBER,
//              REF_DESCRIPTION, LAST_MODIFIED (epoch ms), ELEVATION_BASE,
//              COMMENTS, Shape__Area, Shape__Length
//
// 3) Historic January 2011 flood extents (same field shape as #2):
//    Flood_Awareness_Historic_Brisbane_River_Floods_Jan2011/FeatureServer/0
//
// Source catalogue: https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import {
  councilOf,
  FLOOD_ADAPTERS,
  overlayLabels,
  queryOverlayAdapter,
  type OverlayAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const FAM_OVERALL =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Flood_Risk_Overall/FeatureServer/0/query";
const HISTORIC_2022 =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Historic_Brisbane_River_and_Creek_Floods_Feb2022/FeatureServer/0/query";
const HISTORIC_2011 =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Historic_Brisbane_River_Floods_Jan2011/FeatureServer/0/query";

export type FloodingSource = {
  name: string;
  url: string;
  layer: string;
};

export type HistoricFloodEvent = {
  event: string; // e.g. "February 2022"
  sourceType: string | null; // e.g. "RIVER" | "CREEK"
  sourceName: string | null;
  status: string | null;
};

export type FloodingResult = {
  riskLevel: RiskLevel; // normalized from FLOOD_RISK
  floodType: string | null; // "Creek River Storm Tide" or null when outside
  historicEvents: HistoricFloodEvent[];
  hasConsideration: boolean;
  sources: FloodingSource[];
  /** Point-query GeoJSON — drives risk classification. */
  raw: {
    overall: unknown;
    historic2022: unknown;
    historic2011: unknown;
  };
  /** Envelope-query GeoJSON (~280 m around the property) — for the map
   * to show surrounding overlay context even when the property itself
   * isn't inside a polygon. */
  context: {
    overall: unknown;
    historic2022: unknown;
    historic2011: unknown;
  };
  /** False outside Brisbane LGA — detailed flood-risk bands are published
   * per-council; state FloodCheck extents are raster-only. Council flood
   * adapters for other LGAs land incrementally. */
  available: boolean;
  availabilityNote?: string;
};

const BCC_FAM_BASE = "https://www.brisbane.qld.gov.au/clean-and-green/natural-environment-and-water/flooding-in-brisbane/flood-awareness-map";

// Council flood-band vocabularies vary ("High risk flood hazard area",
// "Moderate Flood Risk Area", "High" …) — a forgiving keyword matcher
// normalises them onto our 5-tier scale.
function classifyCouncilFlood(label: string | null): RiskLevel {
  if (!label) return "none";
  const s = label.toLowerCase();
  if (s.includes("extreme") || s.includes("very high") || s.includes("high")) return "high";
  if (s.includes("moderate") || s.includes("medium")) return "medium";
  if (s.includes("very low")) return "very_low";
  if (s.includes("low")) return "low";
  // Presence in a flood overlay without a graded label (e.g. Redland's
  // constrained-land polygons) is still a real consideration.
  return "medium";
}

// Detailed council flood overlay via a per-council adapter (Gold Coast,
// Moreton Bay, Sunshine Coast, Redland). Mapped into the same raw shape
// as the Brisbane path so overlays/UI need no special-casing.
async function fetchCouncilFlooding(
  lat: number,
  lng: number,
  adapter: OverlayAdapter,
  lot?: Geometry | null,
): Promise<FloodingResult> {
  const { point, context } = await queryOverlayAdapter(adapter, lat, lng, lot);
  // The lot can straddle several flood bands and feature order isn't
  // deterministic — grade every returned band and keep the worst.
  const RANK: Record<RiskLevel, number> = { high: 4, medium: 3, low: 2, very_low: 1, none: 0 };
  const label = overlayLabels(point, adapter.labelFields).reduce<string | null>(
    (worst, l) =>
      RANK[classifyCouncilFlood(l)] > RANK[classifyCouncilFlood(worst)] ? l : worst,
    null,
  );
  const riskLevel = classifyCouncilFlood(label);
  return {
    riskLevel,
    floodType: label,
    historicEvents: [],
    hasConsideration: riskLevel !== "none",
    sources: [{ name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url }],
    raw: { overall: point, historic2022: EMPTY_FC, historic2011: EMPTY_FC },
    context: { overall: context, historic2022: EMPTY_FC, historic2011: EMPTY_FC },
    available: true,
  };
}

function normalizeRisk(s: string | null | undefined): RiskLevel {
  switch ((s ?? "").trim().toLowerCase()) {
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    case "very low": return "very_low";
    default: return "none";
  }
}

function asAttrs(
  feature: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (feature?.properties ?? {}) as Record<string, unknown>;
}

function pickHistoric(
  fc: { features: Feature<Geometry | null, GeoJsonProperties>[] },
  fallbackEvent: string,
): HistoricFloodEvent | null {
  const f = fc.features[0];
  if (!f) return null;
  const a = asAttrs(f);
  return {
    event: typeof a.FLOOD_EVENT === "string" ? a.FLOOD_EVENT : fallbackEvent,
    sourceType: typeof a.SOURCE_TYPE === "string" ? a.SOURCE_TYPE : null,
    sourceName: typeof a.SOURCE_NAME === "string" ? a.SOURCE_NAME : null,
    status: typeof a.STATUS === "string" ? a.STATUS : null,
  };
}

/**
 * Fetch flooding data for a single point.
 *
 * Queries the FAM Overall layer plus the 2022 and 2011 historic layers in
 * parallel. Returns a normalized result plus the raw GeoJSON for each layer
 * so the LLM step can cite specific fields.
 *
 * No-feature responses are valid — they mean "no consideration identified",
 * which we surface as riskLevel='none', hasConsideration=false.
 */
const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

export async function fetchFloodingData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<FloodingResult> {
  if (region && !region.isBrisbane) {
    const adapter = FLOOD_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapter) return fetchCouncilFlooding(lat, lng, adapter, lot);
    const empty = { overall: EMPTY_FC, historic2022: EMPTY_FC, historic2011: EMPTY_FC };
    return {
      riskLevel: "none",
      floodType: null,
      historicEvents: [],
      hasConsideration: false,
      sources: [
        {
          name: "FloodCheck Queensland",
          url: "https://floodcheck.information.qld.gov.au/",
          layer: "",
        },
      ],
      raw: empty,
      context: empty,
      ...unavailableForLga(region, "The detailed flood-risk overlay"),
    };
  }
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    // Classify against the actual lot polygon when we have it — the
    // geocoded point can sit on the one corner of a lot the flood band
    // misses.
    lotPolygon: lot,
  };
  // Historic flood polygons are based on the actual lot footprint while we
  // only have the geocoded street-centre point. Typical Brisbane lots run
  // 30-50 m deep from the road edge, so a ~50 m half-width envelope
  // (0.00045°) is the smallest buffer that reliably catches lot-edge
  // matches — verified against Develo's report for 61 Tingalpa Street
  // where Feb 2022 sits ~50 m from the geocoded coord on the back fence
  // line. False positives are rare in practice because historic flood
  // polygons are large and contiguous: if a neighbour's lot is in the
  // polygon yours almost certainly is too.
  const histPointParams = { ...pointParams, bufferDegrees: 0.00045 };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: true,
    // ~280m envelope around the property — wide enough for street-level
    // context, tight enough to keep payload bounded.
    bufferDegrees: 0.0025,
    // Polygon vertex simplification ~10m — invisible at the map zoom we
    // use but keeps the envelope payload to ~10s of KB.
    maxAllowableOffset: 0.00003,
  };

  const fieldsOverall = "FLOOD_RISK,FLOOD_TYPE";
  const fieldsHist = "FLOOD_EVENT,SOURCE_TYPE,SOURCE_NAME,STATUS";

  const [overall, h2022, h2011, overallCtx, h2022Ctx, h2011Ctx] =
    await Promise.all([
      queryArcGIS(FAM_OVERALL,   { ...pointParams,     outFields: fieldsOverall }),
      queryArcGIS(HISTORIC_2022, { ...histPointParams, outFields: fieldsHist }),
      queryArcGIS(HISTORIC_2011, { ...histPointParams, outFields: fieldsHist }),
      queryArcGIS(FAM_OVERALL,   { ...contextParams, outFields: fieldsOverall }),
      queryArcGIS(HISTORIC_2022, { ...contextParams, outFields: fieldsHist }),
      queryArcGIS(HISTORIC_2011, { ...contextParams, outFields: fieldsHist }),
    ]);

  // A lot-polygon query can straddle several risk bands — report the worst.
  const RISK_RANK: Record<RiskLevel, number> = { high: 4, medium: 3, low: 2, very_low: 1, none: 0 };
  const worstOverall = [...overall.features].sort(
    (a, b) =>
      RISK_RANK[normalizeRisk(String(asAttrs(b).FLOOD_RISK ?? ""))] -
      RISK_RANK[normalizeRisk(String(asAttrs(a).FLOOD_RISK ?? ""))],
  )[0];
  const overallAttrs = asAttrs(worstOverall);
  const riskLevel = normalizeRisk(
    typeof overallAttrs.FLOOD_RISK === "string" ? overallAttrs.FLOOD_RISK : null,
  );
  const floodType =
    typeof overallAttrs.FLOOD_TYPE === "string" ? overallAttrs.FLOOD_TYPE : null;

  const historicEvents: HistoricFloodEvent[] = [];
  const ev22 = pickHistoric(h2022, "February 2022");
  if (ev22) historicEvents.push(ev22);
  const ev11 = pickHistoric(h2011, "January 2011");
  if (ev11) historicEvents.push(ev11);

  const hasConsideration = riskLevel !== "none" || historicEvents.length > 0;

  return {
    riskLevel,
    floodType,
    historicEvents,
    hasConsideration,
    sources: [
      {
        name: "BCC Flood Awareness Map (Overall)",
        url: BCC_FAM_BASE,
        layer: FAM_OVERALL,
      },
      {
        name: "BCC Historic Floods — February 2022",
        url: BCC_FAM_BASE,
        layer: HISTORIC_2022,
      },
      {
        name: "BCC Historic Floods — January 2011",
        url: BCC_FAM_BASE,
        layer: HISTORIC_2011,
      },
    ],
    raw: {
      overall,
      historic2022: h2022,
      historic2011: h2011,
    },
    context: {
      overall: overallCtx,
      historic2022: h2022Ctx,
      historic2011: h2011Ctx,
    },
    available: true,
  };
}
