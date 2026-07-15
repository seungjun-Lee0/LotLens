// Flood Planning module — BCC City Plan 2014 statutory flood planning
// overlays. Distinct from the Flood Awareness Mapping we cover in the
// Flooding module: planning overlays are the legally-binding controls
// that gate development approval (build floor levels, fill volumes,
// excluded structures, etc.).
//
// Endpoints:
//   Flood_overlay_Brisbane_River_flood_planning_area
//     Brisbane River + tidal influence. Triggered on bayside / riverside
//     properties for development assessment.
//   Flood_overlay_Creek_waterway_flood_planning_area
//     Catchment creeks (Bulimba, Norman, Wynnum, Tingalpa etc.). Each
//     polygon is labelled "Creek/waterway flood planning area N" where
//     N is 1-4 — lower number = stricter controls.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const RIVER_PLANNING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Brisbane_River_flood_planning_area/FeatureServer/0/query";
const CREEK_PLANNING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Creek_waterway_flood_planning_area/FeatureServer/0/query";

const BCC_PLANNING_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Flood";

export type FloodPlanningResult = {
  riskLevel: RiskLevel;
  riverArea: string | null;   // OVL2_DESC for river
  creekArea: string | null;   // OVL2_DESC for creek
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { river: unknown; creek: unknown };
  context: { river: unknown; creek: unknown };
  /** False outside Brisbane LGA — statutory flood planning areas are
   * council planning-scheme instruments. */
  available: boolean;
  availabilityNote?: string;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// The numbered suffix (1-4) — 1 = strictest controls, 4 = mildest.
function classify(area: string | null): RiskLevel {
  if (!area) return "none";
  const n = parseInt(area.replace(/\D/g, ""), 10);
  if (n === 1) return "high";
  if (n === 2) return "medium";
  if (n === 3) return "low";
  if (n >= 4) return "very_low";
  return "medium"; // unrecognised but classified
}

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

export async function fetchFloodPlanningData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<FloodPlanningResult> {
  if (region && !region.isBrisbane) {
    return {
      riskLevel: "none",
      riverArea: null,
      creekArea: null,
      hasConsideration: false,
      sources: [
        {
          name: "Council planning scheme — flood overlay",
          url: "https://planning.statedevelopment.qld.gov.au/planning-framework/mapping",
          layer: "",
        },
      ],
      raw: { river: EMPTY_FC, creek: EMPTY_FC },
      context: { river: EMPTY_FC, creek: EMPTY_FC },
      ...unavailableForLga(region, "The statutory flood planning overlay"),
    };
  }
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: false,
    bufferDegrees: 0.00045,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  };

  const [river, creek, riverCtx, creekCtx] = await Promise.all([
    queryArcGIS(RIVER_PLANNING, pointParams),
    queryArcGIS(CREEK_PLANNING, pointParams),
    queryArcGIS(RIVER_PLANNING, contextParams),
    queryArcGIS(CREEK_PLANNING, contextParams),
  ]);

  const riverArea = typeof attrs(river.features[0]).OVL2_DESC === "string"
    ? (attrs(river.features[0]).OVL2_DESC as string)
    : null;
  const creekArea = typeof attrs(creek.features[0]).OVL2_DESC === "string"
    ? (attrs(creek.features[0]).OVL2_DESC as string)
    : null;

  // Take the worst of the two if both apply.
  const riskRiver = classify(riverArea);
  const riskCreek = classify(creekArea);
  const order: RiskLevel[] = ["high", "medium", "low", "very_low", "none"];
  const riskLevel = order[Math.min(order.indexOf(riskRiver), order.indexOf(riskCreek))];

  return {
    riskLevel,
    riverArea,
    creekArea,
    hasConsideration: riskLevel !== "none",
    sources: [
      { name: "BCC City Plan 2014 — Brisbane River flood planning area", url: BCC_PLANNING_DOC, layer: RIVER_PLANNING },
      { name: "BCC City Plan 2014 — Creek/waterway flood planning area", url: BCC_PLANNING_DOC, layer: CREEK_PLANNING },
    ],
    raw: { river, creek },
    context: { river: riverCtx, creek: creekCtx },
    available: true,
  };
}
