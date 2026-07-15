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
import {
  councilOf,
  NOISE_ADAPTERS,
  queryOverlayAdapter,
  type OverlayAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

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
  /** False outside Brisbane LGA — transport-noise corridors are published
   * per-council (the statewide QDC MP4.4 dataset is download-only). */
  available: boolean;
  availabilityNote?: string;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// Two corridor vocabularies exist with OPPOSITE scales:
//   QDC MP4.4:   "… noise category N …" — HIGHER category = louder (0–4).
//   BCC legacy:  "Transport noise corridor N" — LOWER number = louder (1–4).
// ANEF: 30 louder than 20 (AS2021: 30+ unacceptable for residential,
// 25-30 conditionally acceptable, 20-25 acceptable with construction).
function classify(transport: string | null, anef: string | null): RiskLevel {
  if (anef) {
    const n = parseInt(anef.replace(/\D/g, ""), 10);
    if (n >= 30) return "high";
    if (n >= 25) return "medium";
    if (n >= 20) return "low";
  }
  if (transport) {
    const qdc = /categor(?:y|ies)\s*(\d)/i.exec(transport);
    if (qdc) {
      const n = Number(qdc[1]);
      if (n >= 3) return "high";
      if (n === 2) return "medium";
      return "low";
    }
    const corridor = /corridor\s*(\d)/i.exec(transport);
    if (corridor) {
      const n = Number(corridor[1]);
      if (n === 1) return "high";
      if (n === 2) return "medium";
      return "low";
    }
    // Un-numbered corridor presence still triggers QDC acoustic rules.
    return "low";
  }
  return "none";
}

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

// Council transport-noise overlays via per-council adapters (Moreton Bay,
// Sunshine Coast, Redland). Labels vary by council; the shared classify()
// handles numbered corridors, and any un-numbered corridor presence rates
// at least 'low'.
async function fetchCouncilNoise(
  lat: number,
  lng: number,
  adapters: OverlayAdapter[],
): Promise<NoiseResult> {
  const results = await Promise.all(
    adapters.map((a) => queryOverlayAdapter(a, lat, lng)),
  );
  const label = results.map((r) => r.label).find(Boolean) ?? null;
  const merged = (key: "point" | "context") => ({
    type: "FeatureCollection" as const,
    features: results.flatMap((r) => r[key].features),
  });
  const classified = classify(label, null);
  const riskLevel = classified !== "none" ? classified : label ? "low" : "none";

  return {
    riskLevel,
    transportCorridor: label,
    anefCategory: null,
    hasConsideration: riskLevel !== "none",
    sources: adapters.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
    raw: { transport: merged("point"), anef: EMPTY_FC },
    context: { transport: merged("context"), anef: EMPTY_FC },
    available: true,
  };
}

export async function fetchNoiseData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<NoiseResult> {
  if (region && !region.isBrisbane) {
    const adapters = NOISE_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapters && adapters.length > 0) return fetchCouncilNoise(lat, lng, adapters);
    return {
      riskLevel: "none",
      transportCorridor: null,
      anefCategory: null,
      hasConsideration: false,
      sources: [
        {
          name: "QLD Transport noise corridors (QDC MP4.4)",
          url: "https://www.business.qld.gov.au/industries/building-property-development/building-construction/laws-codes-standards/queensland-development-code/transport-noise-corridors",
          layer: "",
        },
      ],
      raw: { transport: EMPTY_FC, anef: EMPTY_FC },
      context: { transport: EMPTY_FC, anef: EMPTY_FC },
      ...unavailableForLga(region, "The transport noise corridor overlay"),
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
    available: true,
  };
}
