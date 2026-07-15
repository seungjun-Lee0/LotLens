// Coastal hazards module (key: storm_tide) — statewide DETSI coastal
// hazard area mapping: storm tide inundation + erosion prone areas.
//
// Source: QSpatial PlanningCadastre/CoastalManagement MapServer (verified
// live 2026-07). Replaces the old BCC-only Flood Awareness Storm Tide
// layer so bayside AND coastal addresses anywhere in Queensland classify.
//
// Layers:
//   11  Storm tide — High hazard area   (inundation > 1.0 m, to 2100)
//   12  Storm tide — Medium hazard area
//    7  Erosion prone area — component 2: calculated erosion distance
//    8  Erosion prone area — component 3: sea level rise
//    9  Erosion prone area — component 1: 40 m buffer from HAT
// The storm-tide layers carry no classification attributes — hazard tier
// comes from WHICH layer intersects.

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const CM =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/CoastalManagement/MapServer";
const STORM_HIGH = `${CM}/11/query`;
const STORM_MEDIUM = `${CM}/12/query`;
const EROSION_CALC = `${CM}/7/query`;
const EROSION_SLR = `${CM}/8/query`;
const EROSION_HAT = `${CM}/9/query`;

const QLD_COASTAL_DOC =
  "https://www.qld.gov.au/environment/coasts-waterways/plans/hazards";

export type StormTideResult = {
  riskLevel: RiskLevel;
  /** "storm tide" / "erosion" / combined summary of what intersects. */
  floodType: string | null;
  /** True when any erosion prone area component covers the lot. */
  erosionProne: boolean;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { stormHigh: unknown; stormMedium: unknown; erosion: unknown };
  context: { stormHigh: unknown; stormMedium: unknown; erosion: unknown };
};

export async function fetchStormTideData(
  lat: number,
  lng: number,
): Promise<StormTideResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: "objectid",
    returnGeometry: false,
    bufferDegrees: 0.00045,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: "objectid",
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  };

  const [
    high, medium, eroCalc, eroSlr, eroHat,
    highCtx, mediumCtx, eroCalcCtx, eroSlrCtx, eroHatCtx,
  ] = await Promise.all([
    queryArcGIS(STORM_HIGH, pointParams),
    queryArcGIS(STORM_MEDIUM, pointParams),
    queryArcGIS(EROSION_CALC, pointParams),
    queryArcGIS(EROSION_SLR, pointParams),
    queryArcGIS(EROSION_HAT, pointParams),
    queryArcGIS(STORM_HIGH, contextParams),
    queryArcGIS(STORM_MEDIUM, contextParams),
    queryArcGIS(EROSION_CALC, contextParams),
    queryArcGIS(EROSION_SLR, contextParams),
    queryArcGIS(EROSION_HAT, contextParams),
  ]);

  const inHigh = high.features.length > 0;
  const inMedium = medium.features.length > 0;
  const erosionProne =
    eroCalc.features.length > 0 ||
    eroSlr.features.length > 0 ||
    eroHat.features.length > 0;

  const riskLevel: RiskLevel = inHigh
    ? "high"
    : inMedium
      ? "medium"
      : erosionProne
        ? "low"
        : "none";

  const parts: string[] = [];
  if (inHigh) parts.push("Storm tide — high hazard area");
  else if (inMedium) parts.push("Storm tide — medium hazard area");
  if (erosionProne) parts.push("Erosion prone area");

  // Merge erosion components into one FC per scope for map painting.
  const mergeFC = (a: typeof eroCalc, b: typeof eroSlr, c: typeof eroHat) => ({
    type: "FeatureCollection" as const,
    features: [...a.features, ...b.features, ...c.features],
  });

  return {
    riskLevel,
    floodType: parts.length > 0 ? parts.join(" + ") : null,
    erosionProne,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "QLD Coastal Hazard Area — Storm tide inundation",
        url: QLD_COASTAL_DOC,
        layer: STORM_HIGH,
      },
      {
        name: "QLD Coastal Hazard Area — Erosion prone area",
        url: QLD_COASTAL_DOC,
        layer: EROSION_CALC,
      },
    ],
    raw: {
      stormHigh: high,
      stormMedium: medium,
      erosion: mergeFC(eroCalc, eroSlr, eroHat),
    },
    context: {
      stormHigh: highCtx,
      stormMedium: mediumCtx,
      erosion: mergeFC(eroCalcCtx, eroSlrCtx, eroHatCtx),
    },
  };
}
