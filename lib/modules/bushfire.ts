// Bushfire module — statewide Bushfire Prone Area (BPA).
//
// Source: the Queensland Fire Department / State Planning Policy Bushfire
// Prone Area mapping, published as a queryable hosted FeatureServer. This
// replaces the old BCC-only City Plan Bushfire overlay so ANY Queensland
// address classifies, not just Brisbane LGA.
//
// Endpoint (verified live 2026-07):
//   https://utility.arcgis.com/usrsvcs/servers/8ac1ba8eccee472fbd0e7a57bf3ad320/
//     rest/services/Hosted/BPA/FeatureServer/0
// Fields:
//   class   e.g. "Very High Potential Intensity" / "High Potential Intensity"
//           / "Medium Potential Intensity" / "Potential Impact Buffer"
//   region  e.g. "South East Queensland"
//   lga     e.g. "Moreton"
//
// 0 features = "no consideration identified" (riskLevel='none').

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const BPA_LAYER =
  "https://utility.arcgis.com/usrsvcs/servers/8ac1ba8eccee472fbd0e7a57bf3ad320/rest/services/Hosted/BPA/FeatureServer/0/query";

const QLD_BUSHFIRE_DOC =
  "https://www.qld.gov.au/emergency/dealing-disasters/map-hazards/bushfire-prone-areas";

export type BushfireSource = { name: string; url: string; layer: string };

export type BushfireResult = {
  riskLevel: RiskLevel;
  /** Raw BPA class string, e.g. "High Potential Intensity". */
  hazardCategory: string | null;
  /** BPA region label, e.g. "South East Queensland". */
  hazardCode: string | null;
  hasConsideration: boolean;
  sources: BushfireSource[];
  /** Point-query GeoJSON — drives classification. */
  raw: unknown;
  /** Envelope-query GeoJSON (~280 m around property) for map context. */
  context: unknown;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// Map the BPA vocabulary to our 5-tier RiskLevel. Forgiving matcher — falls
// back to 'medium' when a hazard polygon is present but the wording is novel.
function classifyHazard(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  if (s.includes("very high")) return "high";
  if (s.includes("high")) return "high";
  if (s.includes("medium")) return "medium";
  if (s.includes("buffer") || s.includes("impact")) return "low";
  return "medium";
}

/** Prefer the worst class when the point sits under stacked polygons. */
function worstFeature(
  features: Feature<Geometry | null, GeoJsonProperties>[],
): Feature<Geometry | null, GeoJsonProperties> | undefined {
  const rank = (f: Feature<Geometry | null, GeoJsonProperties>) => {
    const c = String(attrs(f).class ?? "").toLowerCase();
    if (c.includes("very high")) return 4;
    if (c.includes("high")) return 3;
    if (c.includes("medium")) return 2;
    return 1;
  };
  return [...features].sort((a, b) => rank(b) - rank(a))[0];
}

export async function fetchBushfireData(
  lat: number,
  lng: number,
): Promise<BushfireResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "class,region,lga";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(BPA_LAYER, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: false,
    }),
    queryArcGIS(BPA_LAYER, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);
  const a = attrs(worstFeature(fc.features));
  const hazardCategory = typeof a.class === "string" ? a.class : null;
  const hazardCode = typeof a.region === "string" ? a.region : null;
  const riskLevel = classifyHazard(hazardCategory);

  return {
    riskLevel,
    hazardCategory,
    hazardCode,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Queensland Bushfire Prone Area (State Planning Policy)",
        url: QLD_BUSHFIRE_DOC,
        layer: BPA_LAYER,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
