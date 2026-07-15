// Steep land / landslide module — council landslide & steep-land overlays.
//
// Develo's "Steep Land" page. Landslide hazard is a council planning-scheme
// matter (there is NO statewide landslide REST layer — verified 2026-07),
// so this module runs through per-council adapters:
//   Brisbane        City Plan 2014 Landslide overlay (OVL2_DESC)
//   Moreton Bay     Landslide Hazard Overlay
//   Sunshine Coast  Landslide Hazard and Steep Land Overlay (slope classes)
//   Redland         Landslide Hazard Overlay (CLASS)
// Other LGAs report `available: false` until their adapters land.

import {
  councilOf,
  queryOverlayAdapter,
  STEEP_ADAPTERS,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

export type SteepLandResult = {
  riskLevel: RiskLevel;
  /** Overlay label at the point, e.g. "Landslide hazard area" / slope class. */
  category: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

function classifySteep(label: string | null, hit: boolean): RiskLevel {
  if (!hit) return "none";
  const s = (label ?? "").toLowerCase();
  if (s.includes("very high") || s.includes("high")) return "high";
  if (s.includes("moderate") || s.includes("medium")) return "medium";
  if (s.includes("low")) return "low";
  // Presence in a landslide/steep overlay without a graded label is a
  // geotech-report trigger either way.
  return "medium";
}

export async function fetchSteepLandData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<SteepLandResult> {
  // No `?? "brisbane"` fallback here — unlike the other adapter tables this
  // one HAS a brisbane entry, so an unknown LGA must not silently query
  // Brisbane's overlay and report a false "clear".
  const councilId = councilOf(region);
  const adapter = councilId ? STEEP_ADAPTERS[councilId] : undefined;
  if (!adapter) {
    return {
      riskLevel: "none",
      category: null,
      hasConsideration: false,
      sources: [
        {
          name: "Council planning scheme — landslide/steep land overlay",
          url: "https://planning.statedevelopment.qld.gov.au/planning-framework/mapping",
          layer: "",
        },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(
        region ?? { lga: null, isBrisbane: false },
        "The landslide / steep land overlay",
      ),
    };
  }

  const { point, context, label } = await queryOverlayAdapter(adapter, lat, lng);
  const hit = point.features.length > 0;
  const riskLevel = classifySteep(label, hit);

  return {
    riskLevel,
    category: label ?? (hit ? "Landslide / steep land overlay area" : null),
    hasConsideration: riskLevel !== "none",
    sources: [{ name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url }],
    raw: point,
    context,
    available: true,
  };
}
