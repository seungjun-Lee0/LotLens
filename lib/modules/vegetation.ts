// Vegetation / Biodiversity module — BCC City Plan 2014 Biodiversity
// areas overlay.
//
// Protects native vegetation that supports threatened species, wildlife
// corridors, and ecological communities. The overlay constrains
// renovation, demolition, and new building work that would remove
// significant trees or alter habitat. A common reason Brisbane buyers
// get a rude surprise mid-renovation.
//
// Endpoint:
//   .../Biodiversity_areas_overlay_Biodiversity_areas/FeatureServer/0
// Fields: CAT_DESC, OVL_CAT, OVL2_DESC ("Biodiversity area" etc.),
//   OVL2_CAT, DESCRIPTION. Same field shape as Bushfire / Heritage /
//   Easements.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const BIODIVERSITY =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Biodiversity_areas_overlay_Biodiversity_areas/FeatureServer/0/query";

const BCC_BIODIVERSITY_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Biodiversity";

export type VegetationResult = {
  riskLevel: RiskLevel;
  category: string | null;       // OVL2_DESC, e.g. "Biodiversity area"
  code: string | null;           // OVL2_CAT
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

function classify(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  if (s.includes("waterway") || s.includes("wetland")) return "high";
  if (s.includes("biodiversity") && s.includes("matter")) return "high"; // MSES
  if (s.includes("biodiversity")) return "medium";
  if (s.includes("ecological corridor")) return "medium";
  return "low";
}

export async function fetchVegetationData(
  lat: number,
  lng: number,
): Promise<VegetationResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const outFields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(BIODIVERSITY, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: false,
      bufferDegrees: 0.00045,
    }),
    queryArcGIS(BIODIVERSITY, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);

  const a = attrs(fc.features[0]);
  const category = typeof a.OVL2_DESC === "string" ? a.OVL2_DESC : null;
  const code = typeof a.OVL2_CAT === "string" ? a.OVL2_CAT : null;
  const riskLevel = classify(category);

  return {
    riskLevel,
    category,
    code,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "BCC City Plan 2014 — Biodiversity areas overlay",
        url: BCC_BIODIVERSITY_DOC,
        layer: BIODIVERSITY,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
