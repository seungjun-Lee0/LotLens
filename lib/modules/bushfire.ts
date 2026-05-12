// Bushfire module — BCC City Plan 2014 Bushfire overlay.
//
// We use BCC's own Bushfire_overlay rather than the statewide QFES/QSpatial
// "Bushfire Prone Area" mapping. Reasons:
//   - QFES's official BPA is published only as a cached tile MapService
//     (no /query capability) → not point-queryable.
//   - QSpatial publishes the BPA only as regional shapefile downloads.
//   - BCC's Bushfire_overlay is the layer Develo and conveyancers actually
//     cite for Brisbane LGA addresses, since it sits inside the City Plan
//     2014 statutory mapping.
//
// Endpoint:
//   https://services2.arcgis.com/dEKgZETqwmDAh1rP/.../Bushfire_overlay/FeatureServer/0
//   Native SRID: EPSG:28356.
//
// Fields:
//   CAT_DESC    e.g. "Development constraints"
//   OVL_CAT     e.g. "DEV"
//   OVL2_DESC   e.g. "High hazard buffer area"   ← the meaningful label
//   OVL2_CAT    e.g. "BHR_HRB"                   ← coded shorthand
//   DESCRIPTION usually null
//
// Verified at Moggill (-27.575, 152.870) → "High hazard buffer area".
// 0 features = "no consideration identified" (riskLevel='none').

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/supabase";

const BUSHFIRE_OVERLAY =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Bushfire_overlay/FeatureServer/0/query";

const BCC_BUSHFIRE_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Bushfire";

export type BushfireSource = { name: string; url: string; layer: string };

export type BushfireResult = {
  riskLevel: RiskLevel;
  /** Raw OVL2_DESC string, e.g. "High hazard buffer area". */
  hazardCategory: string | null;
  /** Short code, e.g. "BHR_HRB". */
  hazardCode: string | null;
  hasConsideration: boolean;
  sources: BushfireSource[];
  raw: unknown;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// Map the BCC vocabulary to our 5-tier RiskLevel. The exact OVL2_DESC values
// vary; this matcher is forgiving and falls back to 'medium' when a hazard
// area is present but the wording is novel.
function classifyHazard(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  if (s.includes("very high")) return "high";
  if (s.includes("high hazard area")) return "high";
  if (s.includes("high hazard")) return "high"; // includes "High hazard buffer area"
  if (s.includes("medium hazard")) return "medium";
  if (s.includes("low hazard") || s.includes("potential impact")) return "low";
  return "medium";
}

export async function fetchBushfireData(
  lat: number,
  lng: number,
): Promise<BushfireResult> {
  const fc = await queryArcGIS(BUSHFIRE_OVERLAY, {
    geometry: { x: lng, y: lat, spatialReference: 4326 },
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outFields: "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION",
    returnGeometry: true,
    maxAllowableOffset: 0.0001,
  });
  const a = attrs(fc.features[0]);
  const hazardCategory =
    typeof a.OVL2_DESC === "string" ? a.OVL2_DESC : null;
  const hazardCode = typeof a.OVL2_CAT === "string" ? a.OVL2_CAT : null;
  const riskLevel = classifyHazard(hazardCategory);

  return {
    riskLevel,
    hazardCategory,
    hazardCode,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "BCC City Plan 2014 — Bushfire overlay",
        url: BCC_BUSHFIRE_DOC,
        layer: BUSHFIRE_OVERLAY,
      },
    ],
    raw: fc,
  };
}
