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
import type { RiskLevel } from "@/lib/supabase";

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
};

const BCC_FAM_BASE = "https://www.brisbane.qld.gov.au/clean-and-green/natural-environment-and-water/flooding-in-brisbane/flood-awareness-map";

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
export async function fetchFloodingData(
  lat: number,
  lng: number,
): Promise<FloodingResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
  };
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
    maxAllowableOffset: 0.0001,
  };

  const fieldsOverall = "FLOOD_RISK,FLOOD_TYPE";
  const fieldsHist = "FLOOD_EVENT,SOURCE_TYPE,SOURCE_NAME,STATUS";

  const [overall, h2022, h2011, overallCtx, h2022Ctx, h2011Ctx] =
    await Promise.all([
      queryArcGIS(FAM_OVERALL,   { ...pointParams,   outFields: fieldsOverall }),
      queryArcGIS(HISTORIC_2022, { ...pointParams,   outFields: fieldsHist }),
      queryArcGIS(HISTORIC_2011, { ...pointParams,   outFields: fieldsHist }),
      queryArcGIS(FAM_OVERALL,   { ...contextParams, outFields: fieldsOverall }),
      queryArcGIS(HISTORIC_2022, { ...contextParams, outFields: fieldsHist }),
      queryArcGIS(HISTORIC_2011, { ...contextParams, outFields: fieldsHist }),
    ]);

  const overallAttrs = asAttrs(overall.features[0]);
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
  };
}
