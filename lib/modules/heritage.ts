// Heritage / Character module — combines BCC overlays per TASKS.md Task 3
// #3: "BCC Heritage Register + Character Protection. These are two separate
// layers; combine them into one module with a `type` field."
//
// Endpoints:
//   State heritage area:
//     .../Heritage_overlay_State_heritage_area/FeatureServer/0   (545 features)
//   Local heritage area (note BCC's typo "Hertiage" in the URL):
//     .../Hertiage_overlay_Local_heritage_area/FeatureServer/0   (1857 features)
//   Traditional building character — pre-1947 Brisbane character protection:
//     .../Traditional_building_character_overlay/FeatureServer/0
//
// We probed `Heritage_overlay` first (the obvious name) and found it empty
// (count=0). The real heritage geometry lives in the two more specific
// layers above. Field shape across all three: CAT_DESC, OVL_CAT, OVL2_DESC,
// OVL2_CAT, DESCRIPTION. Native SRID: EPSG:28356.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/supabase";

const STATE_HERITAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Heritage_overlay_State_heritage_area/FeatureServer/0/query";
// BCC's published URL contains the typo "Hertiage" — keep verbatim.
const LOCAL_HERITAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Hertiage_overlay_Local_heritage_area/FeatureServer/0/query";
const CHARACTER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Traditional_building_character_overlay/FeatureServer/0/query";

const BCC_HERITAGE_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Heritage";

export type HeritageEntry = {
  /** "state" = state heritage area, "local" = local heritage area,
   * "character" = traditional building character (pre-1947) protection. */
  type: "state" | "local" | "character";
  category: string | null; // CAT_DESC, e.g. "Heritage"/"Character"
  description: string | null; // OVL2_DESC, e.g. "Local heritage area" / "Neighbourhood character"
  code: string | null; // OVL2_CAT
  notes: string | null; // DESCRIPTION (often null)
};

export type HeritageSource = { name: string; url: string; layer: string };

export type HeritageResult = {
  /** 'high' = on heritage register (renovation/demo constrained), 'medium'
   * = character only, 'none' = neither. */
  riskLevel: RiskLevel;
  entries: HeritageEntry[];
  hasConsideration: boolean;
  sources: HeritageSource[];
  raw: { state: unknown; local: unknown; character: unknown };
  context: { state: unknown; local: unknown; character: unknown };
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function toEntry(
  type: HeritageEntry["type"],
  f: Feature<Geometry | null, GeoJsonProperties>,
): HeritageEntry {
  const a = attrs(f);
  return {
    type,
    category: typeof a.CAT_DESC === "string" ? a.CAT_DESC : null,
    description: typeof a.OVL2_DESC === "string" ? a.OVL2_DESC : null,
    code: typeof a.OVL2_CAT === "string" ? a.OVL2_CAT : null,
    notes: typeof a.DESCRIPTION === "string" ? a.DESCRIPTION : null,
  };
}

export async function fetchHeritageData(
  lat: number,
  lng: number,
): Promise<HeritageResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: false,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: fields,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.0001,
  };
  const [state, local, character, stateCtx, localCtx, characterCtx] =
    await Promise.all([
      queryArcGIS(STATE_HERITAGE, pointParams),
      queryArcGIS(LOCAL_HERITAGE, pointParams),
      queryArcGIS(CHARACTER, pointParams),
      queryArcGIS(STATE_HERITAGE, contextParams),
      queryArcGIS(LOCAL_HERITAGE, contextParams),
      queryArcGIS(CHARACTER, contextParams),
    ]);

  const entries: HeritageEntry[] = [
    ...state.features.map((f) => toEntry("state", f)),
    ...local.features.map((f) => toEntry("local", f)),
    ...character.features.map((f) => toEntry("character", f)),
  ];
  const hasState = entries.some((e) => e.type === "state");
  const hasLocal = entries.some((e) => e.type === "local");
  const hasCharacter = entries.some((e) => e.type === "character");
  const riskLevel: RiskLevel = hasState || hasLocal
    ? "high"
    : hasCharacter
      ? "medium"
      : "none";

  return {
    riskLevel,
    entries,
    hasConsideration: entries.length > 0,
    sources: [
      {
        name: "BCC City Plan 2014 — State heritage area",
        url: BCC_HERITAGE_DOC,
        layer: STATE_HERITAGE,
      },
      {
        name: "BCC City Plan 2014 — Local heritage area",
        url: BCC_HERITAGE_DOC,
        layer: LOCAL_HERITAGE,
      },
      {
        name: "BCC City Plan 2014 — Traditional building character overlay",
        url: BCC_HERITAGE_DOC,
        layer: CHARACTER,
      },
    ],
    raw: { state, local, character },
    context: { state: stateCtx, local: localCtx, character: characterCtx },
  };
}
