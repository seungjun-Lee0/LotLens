// Overland Flow module — BCC Flood Awareness Overland Flow.
//
// Stormwater that runs over the ground when drainage is overwhelmed —
// distinct from creek / river flooding (which we cover separately in the
// Flooding module). Tingalpa-style streets with steep gutters and
// undersized stormwater see this regularly.
//
// Endpoint:
//   .../Flood_Awareness_Overland_Flow/FeatureServer/0
// Fields: FLOOD_RISK ∈ {High, Medium, Low, Very Low} + FLOOD_TYPE.
// Native SRID: EPSG:28356. Same point-buffer trick as the historic
// flooding layers — lot-edge cases need a ~50 m envelope.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import {
  councilOf,
  OVERLAND_ADAPTERS,
  queryOverlayAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const OVERLAND_FLOW =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Overland_Flow/FeatureServer/0/query";

const BCC_OVERLAND_DOC =
  "https://www.brisbane.qld.gov.au/clean-and-green/natural-environment-and-water/flooding-in-brisbane/flood-awareness-map";

export type OverlandFlowResult = {
  riskLevel: RiskLevel;
  floodType: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  /** False outside Brisbane LGA — overland-flow mapping is a council
   * flood-awareness product. */
  available: boolean;
  availabilityNote?: string;
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

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

export async function fetchOverlandFlowData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<OverlandFlowResult> {
  if (region && !region.isBrisbane) {
    const adapter = OVERLAND_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapter) {
      const { point, context, label } = await queryOverlayAdapter(adapter, lat, lng);
      const hit = point.features.length > 0;
      return {
        // Overland flow paths are presence overlays for most councils —
        // being on one is a real consideration but not a graded band.
        riskLevel: hit ? "medium" : "none",
        floodType: label ?? (hit ? "Overland flow path" : null),
        hasConsideration: hit,
        sources: [{ name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url }],
        raw: point,
        context,
        available: true,
      };
    }
    return {
      riskLevel: "none",
      floodType: null,
      hasConsideration: false,
      sources: [
        {
          name: "Council flood awareness mapping",
          url: "https://floodcheck.information.qld.gov.au/",
          layer: "",
        },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(region, "The overland flow overlay"),
    };
  }
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const outFields = "FLOOD_RISK,FLOOD_TYPE";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(OVERLAND_FLOW, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: false,
      bufferDegrees: 0.00045, // ~50 m, same lot-edge trick as historic flood
    }),
    queryArcGIS(OVERLAND_FLOW, {
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
        name: "BCC Flood Awareness — Overland Flow",
        url: BCC_OVERLAND_DOC,
        layer: OVERLAND_FLOW,
      },
    ],
    raw: fc,
    context: ctx,
    available: true,
  };
}
