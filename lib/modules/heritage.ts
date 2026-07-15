// Heritage / Character module.
//
// Statewide backbone: the Queensland Heritage Register boundaries
// (QSpatial AdminBoundariesFramework layer 78 — verified live 2026-07,
// fields: placename, place_id, entrydate, status). Works for any QLD
// address.
//
// Brisbane enhancement: when the lot is inside Brisbane LGA we ALSO query
// the BCC City Plan 2014 Local heritage area + Traditional building
// character overlays (local heritage listings and pre-1947 character
// controls are council instruments — other LGAs' equivalents land with
// their council adapters).

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import type { Region } from "@/lib/region";

const QHR_LAYER =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdminBoundariesFramework/MapServer/78/query";
// BCC's published URL contains the typo "Hertiage" — keep verbatim.
const LOCAL_HERITAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Hertiage_overlay_Local_heritage_area/FeatureServer/0/query";
const CHARACTER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Traditional_building_character_overlay/FeatureServer/0/query";

const QHR_DOC = "https://qhr.detsi.qld.gov.au/";
const BCC_HERITAGE_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Heritage";

export type HeritageEntry = {
  /** "state" = QLD Heritage Register place, "local" = council local
   * heritage area, "character" = traditional building character
   * (pre-1947) protection. */
  type: "state" | "local" | "character";
  category: string | null;
  description: string | null;
  code: string | null;
  notes: string | null;
};

export type HeritageSource = { name: string; url: string; layer: string };

export type HeritageResult = {
  /** 'high' = on a heritage register (renovation/demo constrained),
   * 'medium' = character only, 'none' = neither. */
  riskLevel: RiskLevel;
  entries: HeritageEntry[];
  hasConsideration: boolean;
  sources: HeritageSource[];
  raw: { state: unknown; local: unknown; character: unknown };
  context: { state: unknown; local: unknown; character: unknown };
};

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function bccEntry(
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

function qhrEntry(f: Feature<Geometry | null, GeoJsonProperties>): HeritageEntry {
  const a = attrs(f);
  return {
    type: "state",
    category: typeof a.status === "string" ? a.status : "State heritage place",
    description: typeof a.placename === "string" ? a.placename : null,
    code: a.place_id != null ? String(a.place_id) : null,
    notes: null,
  };
}

export async function fetchHeritageData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<HeritageResult> {
  const isBrisbane = region?.isBrisbane ?? true;
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const bccFields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const qhrFields = "placename,place_id,entrydate,status";
  const pointParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: false,
  });
  const contextParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  });

  const [state, stateCtx, local, character, localCtx, characterCtx] =
    await Promise.all([
      queryArcGIS(QHR_LAYER, pointParams(qhrFields)),
      queryArcGIS(QHR_LAYER, contextParams(qhrFields)),
      isBrisbane ? queryArcGIS(LOCAL_HERITAGE, pointParams(bccFields)) : EMPTY_FC,
      isBrisbane ? queryArcGIS(CHARACTER, pointParams(bccFields)) : EMPTY_FC,
      isBrisbane ? queryArcGIS(LOCAL_HERITAGE, contextParams(bccFields)) : EMPTY_FC,
      isBrisbane ? queryArcGIS(CHARACTER, contextParams(bccFields)) : EMPTY_FC,
    ]);

  const entries: HeritageEntry[] = [
    ...state.features.map(qhrEntry),
    ...local.features.map((f) => bccEntry("local", f)),
    ...character.features.map((f) => bccEntry("character", f)),
  ];
  const hasState = entries.some((e) => e.type === "state");
  const hasLocal = entries.some((e) => e.type === "local");
  const hasCharacter = entries.some((e) => e.type === "character");
  const riskLevel: RiskLevel =
    hasState || hasLocal ? "high" : hasCharacter ? "medium" : "none";

  const sources: HeritageSource[] = [
    {
      name: "Queensland Heritage Register",
      url: QHR_DOC,
      layer: QHR_LAYER,
    },
  ];
  if (isBrisbane) {
    sources.push(
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
    );
  }

  return {
    riskLevel,
    entries,
    hasConsideration: entries.length > 0,
    sources,
    raw: { state, local, character },
    context: { state: stateCtx, local: localCtx, character: characterCtx },
  };
}
