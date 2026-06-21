// Storm Tide module — BCC Flood Awareness Storm Tide.
//
// Coastal / tidal flooding driven by storm surge. Highly relevant for
// bayside Brisbane addresses (Wynnum / Manly / Sandgate). Same shape as
// the Overland Flow layer.
//
// Endpoint:
//   .../Flood_Awareness_Storm_Tide/FeatureServer/0
// Fields: FLOOD_RISK + FLOOD_TYPE. Native SRID: EPSG:28356.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const STORM_TIDE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Storm_Tide/FeatureServer/0/query";

const BCC_STORM_TIDE_DOC =
  "https://www.brisbane.qld.gov.au/clean-and-green/natural-environment-and-water/flooding-in-brisbane/flood-awareness-map";

export type StormTideResult = {
  riskLevel: RiskLevel;
  floodType: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
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

export async function fetchStormTideData(
  lat: number,
  lng: number,
): Promise<StormTideResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const outFields = "FLOOD_RISK,FLOOD_TYPE";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(STORM_TIDE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: false,
      bufferDegrees: 0.00045,
    }),
    queryArcGIS(STORM_TIDE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.0001,
    }),
  ]);

  const a = attrs(fc.features[0]);
  const riskLevel = normalizeRisk(
    typeof a.FLOOD_RISK === "string" ? a.FLOOD_RISK : null,
  );
  const floodType = typeof a.FLOOD_TYPE === "string" ? a.FLOOD_TYPE : null;

  return {
    riskLevel,
    floodType,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "BCC Flood Awareness — Storm Tide",
        url: BCC_STORM_TIDE_DOC,
        layer: STORM_TIDE,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
