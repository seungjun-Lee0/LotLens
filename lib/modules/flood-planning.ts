// Flood Planning module: BCC City Plan 2014 statutory flood planning
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
//     N is 1-4: lower number = stricter controls.
//   Flood_overlay_Overland_flow
//     The overlay's third sub-category, unnumbered: "Overland flow flood
//     planning area". A statutory trigger in its own right.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import {
  councilOf,
  FLOOD_PLANNING_ADAPTERS,
  overlayLabels,
  queryOverlayAdapter,
  type OverlayAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";
import { RISK_RANK } from "@/lib/risk-style";

const RIVER_PLANNING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Brisbane_River_flood_planning_area/FeatureServer/0/query";
const CREEK_PLANNING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Creek_waterway_flood_planning_area/FeatureServer/0/query";
// Third statutory sub-category of the same overlay: one unnumbered class
// ("Overland flow flood planning area", FHA_OFP; verified live 2026-09).
// Develo counts it as a Flood Planning consideration; without it a lot on
// an overland flow path with no river/creek tier read "clear" here.
const OVERLAND_PLANNING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Overland_flow/FeatureServer/0/query";

const BCC_PLANNING_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Flood";

export type FloodPlanningResult = {
  riskLevel: RiskLevel;
  riverArea: string | null;   // OVL2_DESC for river
  creekArea: string | null;   // OVL2_DESC for creek
  /** "Overland flow flood planning area" when that unnumbered statutory
   * sub-category covers the lot (Brisbane only). */
  overlandArea: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { river: unknown; creek: unknown; overland?: unknown };
  context: { river: unknown; creek: unknown; overland?: unknown };
  /** False outside Brisbane LGA: statutory flood planning areas are
   * council planning-scheme instruments. */
  available: boolean;
  availabilityNote?: string;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// The numbered suffix (1-4): 1 = strictest controls, 4 = mildest.
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

/** Councils whose statutory flood instrument is a plain overlay layer.
 * BCC's river/creek split has no equivalent elsewhere, so everything
 * lands in the `creekArea` slot the UI already renders as the overlay
 * name. */
async function fetchAdapterFloodPlanning(
  lat: number,
  lng: number,
  adapters: OverlayAdapter[],
  lot?: Geometry | null,
): Promise<FloodPlanningResult> {
  const results = await Promise.all(
    adapters.map((a) => queryOverlayAdapter(a, lat, lng, lot)),
  );
  const merge = (key: "point" | "context") => ({
    type: "FeatureCollection" as const,
    features: results.flatMap((r) => r[key].features),
  });
  const labels = results.flatMap((r, i) =>
    overlayLabels(r.point, adapters[i].labelFields),
  );
  const area = labels[0] ?? null;
  // These layers carry no numbered severity tier: sitting inside a
  // statutory flood planning area is itself the trigger for assessment,
  // so grade the presence, not a band that isn't published.
  const riskLevel: RiskLevel = area ? "medium" : "none";
  return {
    riskLevel,
    riverArea: null,
    creekArea: area,
    overlandArea: null,
    hasConsideration: riskLevel !== "none",
    sources: adapters.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
    raw: { river: EMPTY_FC, creek: merge("point") },
    context: { river: EMPTY_FC, creek: merge("context") },
    available: true,
  };
}

export async function fetchFloodPlanningData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<FloodPlanningResult> {
  if (region && !region.isBrisbane) {
    // A council with its own SEPARATE statutory flood instrument (one
    // that is not already drawn by the Flooding module's hazard layer)
    // runs through FLOOD_PLANNING_ADAPTERS. Most councils publish a
    // single flood overlay which the Flooding module already shows, so
    // this table is deliberately sparse: listing the same layer twice
    // would draw the same polygons on two pages.
    const adapters = FLOOD_PLANNING_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapters?.length) {
      return fetchAdapterFloodPlanning(lat, lng, adapters, lot);
    }
    return {
      riskLevel: "none",
      riverArea: null,
      creekArea: null,
      overlandArea: null,
      hasConsideration: false,
      sources: [
        {
          name: "Council planning scheme: flood overlay",
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
    lotPolygon: lot,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: true,
    bufferDegrees: contextBuffer(lot, lat, lng),
    maxAllowableOffset: 0.00003,
    quantize: true,
  };

  const [river, creek, overland, riverCtx, creekCtx, overlandCtx] = await Promise.all([
    queryArcGIS(RIVER_PLANNING, pointParams),
    queryArcGIS(CREEK_PLANNING, pointParams),
    queryArcGIS(OVERLAND_PLANNING, pointParams),
    queryArcGIS(RIVER_PLANNING, contextParams),
    queryArcGIS(CREEK_PLANNING, contextParams),
    queryArcGIS(OVERLAND_PLANNING, contextParams),
  ]);

  // The lot can straddle two numbered tiers and feature order is not
  // stable: keep the strictest (lowest-numbered) area per layer.
  const strictest = (fc: { features: Feature<Geometry | null, GeoJsonProperties>[] }) =>
    fc.features
      .map((f) => attrs(f).OVL2_DESC)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort((a, b) => RISK_RANK[classify(b)] - RISK_RANK[classify(a)])[0] ?? null;
  const riverArea = strictest(river);
  const creekArea = strictest(creek);
  const overlandArea = strictest(overland);

  // Take the worst of the three if several apply. The overland flow area
  // carries no numbered tier: it grades as a mild statutory trigger, the
  // same footing as planning area 3.
  const candidates: RiskLevel[] = [
    classify(riverArea),
    classify(creekArea),
    overlandArea ? "low" : "none",
  ];
  const riskLevel = candidates.reduce<RiskLevel>(
    (a, b) => (RISK_RANK[b] > RISK_RANK[a] ? b : a),
    "none",
  );

  return {
    riskLevel,
    riverArea,
    creekArea,
    overlandArea,
    hasConsideration: riskLevel !== "none",
    sources: [
      { name: "BCC City Plan 2014: Brisbane River flood planning area", url: BCC_PLANNING_DOC, layer: RIVER_PLANNING },
      { name: "BCC City Plan 2014: Creek/waterway flood planning area", url: BCC_PLANNING_DOC, layer: CREEK_PLANNING },
      { name: "BCC City Plan 2014: Overland flow flood planning area", url: BCC_PLANNING_DOC, layer: OVERLAND_PLANNING },
    ],
    raw: { river, creek, overland },
    context: { river: riverCtx, creek: creekCtx, overland: overlandCtx },
    available: true,
  };
}
