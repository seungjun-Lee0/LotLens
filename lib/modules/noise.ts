// Noise module — BCC Transport noise corridor + ANEF aviation noise.
//
// Combines two BCC overlays into one report module so we mirror Develo's
// single "Noise" page. Layers:
//
//   Transport_noise_corridor_overlay — road + rail noise corridors.
//     OVL2_DESC e.g. "Transport noise corridor 1" through "4". Lower
//     number = tighter / louder. Triggers Council acoustic
//     attenuation requirements on new builds.
//
//   City_Plan_2014_Airport_environs_overlay_Australian_Noise_Exposure_Forecast_ANEF
//     OVL2_DESC e.g. "20 ANEF", "25 ANEF", "30 ANEF". Each step is
//     ~5 dB louder under regular flight paths.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const TRANSPORT_NOISE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Transport_noise_corridor_overlay/FeatureServer/0/query";
const ANEF =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/City_Plan_2014_Airport_environs_overlay_Australian_Noise_Exposure_Forecast_ANEF/FeatureServer/0/query";

const BCC_NOISE_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/TransportNoiseCorridor";

export type NoiseResult = {
  riskLevel: RiskLevel;
  transportCorridor: string | null; // e.g. "Transport noise corridor 1"
  anefCategory: string | null;       // e.g. "25 ANEF"
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { transport: unknown; anef: unknown };
  context: { transport: unknown; anef: unknown };
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// Transport corridor: "1" is loudest. ANEF: 30 louder than 20.
function classify(transport: string | null, anef: string | null): RiskLevel {
  // Aviation noise — anything 30 ANEF+ is "unacceptable for residential" by
  // Australian Standard AS2021. 25-30 is "conditionally acceptable", 20-25
  // is "acceptable with normal construction".
  if (anef) {
    const n = parseInt(anef.replace(/\D/g, ""), 10);
    if (n >= 30) return "high";
    if (n >= 25) return "medium";
    if (n >= 20) return "low";
  }
  if (transport) {
    const n = parseInt(transport.replace(/\D/g, ""), 10);
    if (n === 1) return "high";
    if (n === 2) return "medium";
    if (n >= 3) return "low";
  }
  return "none";
}

export async function fetchNoiseData(
  lat: number,
  lng: number,
): Promise<NoiseResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: false,
    // Transport corridors are thin strips along roads/rail — same
    // ~50 m buffer trick as historic flood so lot-edge matches work.
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

  const [transport, anef, transportCtx, anefCtx] = await Promise.all([
    queryArcGIS(TRANSPORT_NOISE, pointParams),
    queryArcGIS(ANEF, pointParams),
    queryArcGIS(TRANSPORT_NOISE, contextParams),
    queryArcGIS(ANEF, contextParams),
  ]);

  const tAttrs = attrs(transport.features[0]);
  const aAttrs = attrs(anef.features[0]);
  const transportCorridor =
    typeof tAttrs.OVL2_DESC === "string" ? tAttrs.OVL2_DESC : null;
  const anefCategory =
    typeof aAttrs.OVL2_DESC === "string" ? aAttrs.OVL2_DESC : null;
  const riskLevel = classify(transportCorridor, anefCategory);

  return {
    riskLevel,
    transportCorridor,
    anefCategory,
    hasConsideration: riskLevel !== "none",
    sources: [
      { name: "BCC City Plan 2014 — Transport noise corridor", url: BCC_NOISE_DOC, layer: TRANSPORT_NOISE },
      { name: "BCC City Plan 2014 — Airport ANEF noise", url: BCC_NOISE_DOC, layer: ANEF },
    ],
    raw: { transport, anef },
    context: { transport: transportCtx, anef: anefCtx },
  };
}
