// Acid sulfate soils module: statewide QLD ASS mapping.
//
// Acid sulfate soils are coastal-lowland soils (typically below ~5 m AHD)
// that release sulfuric acid when excavated or drained: a real cost on
// pools, basements, canal-estate builds and civil works. Councils apply
// ASS overlay codes; the underlying state mapping is what we query.
//
// Endpoint (QSpatial, verified live 2026-07):
//   GeoscientificInformation/SoilsAndLandResource/MapServer
//     1902  Project polygons: 1:25 000 scale  (best resolution)
//     1952  Project polygons: 1:50 000 scale
//     2002  Project polygons: 1:100 000 scale
//   Fields: map_code, map_code_meaning, dominant_entity_meaning, …
//
// Coverage is coastal lowlands only: inland lots simply return no
// features ("no consideration identified"), which is correct.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import type { RiskLevel } from "@/lib/db";

const SOILS =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/SoilsAndLandResource/MapServer";
const ASS_25K = `${SOILS}/1902/query`;
const ASS_50K = `${SOILS}/1952/query`;
const ASS_100K = `${SOILS}/2002/query`;

const ASS_DOC =
  "https://www.qld.gov.au/environment/land/management/soil/soil-testing/acid-sulfate";

export type AcidSulfateResult = {
  riskLevel: RiskLevel;
  /** map_code at the finest scale that hits, e.g. "A0S1". */
  mapCode: string | null;
  /** Every distinct map_code on the lot at that scale, classifying code
   * first. One entry for the usual single-class lot. */
  mapCodes: string[];
  /** map_code_meaning: plain-English description of the ASS class. */
  meaning: string | null;
  /** Which mapping scale produced the hit ("1:25 000" etc.). */
  scale: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { k25: unknown; k50: unknown; k100: unknown };
  context: { k25: unknown; k50: unknown; k100: unknown };
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchAcidSulfateData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<AcidSulfateResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "map_code,map_code_meaning,dominant_entity_meaning";
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

  const [k25, k50, k100, k25Ctx, k50Ctx, k100Ctx] = await Promise.all([
    queryArcGIS(ASS_25K, pointParams),
    queryArcGIS(ASS_50K, pointParams),
    queryArcGIS(ASS_100K, pointParams),
    queryArcGIS(ASS_25K, contextParams),
    queryArcGIS(ASS_50K, contextParams),
    queryArcGIS(ASS_100K, contextParams),
  ]);

  // Prefer the finest-scale layer that hits for classification.
  const layer =
    k25.features.length > 0
      ? { features: k25.features, scale: "1:25 000" }
      : k50.features.length > 0
        ? { features: k50.features, scale: "1:50 000" }
        : k100.features.length > 0
          ? { features: k100.features, scale: "1:100 000" }
          : null;

  // ASS presence is a management/cost consideration rather than a hazard
  // band. Codes containing S (sulfidic material at shallow depth) rate
  // medium: that's the case that actually costs money on excavation.
  // Anything else mapped is informational: the state layer covers every
  // coastal lowland, so most riverside and bayside lots are inside it with
  // no obligation attached unless you dig.
  const grade = (f: Feature<Geometry | null, GeoJsonProperties>): RiskLevel => {
    const p = attrs(f);
    const meaningOf = str(p.map_code_meaning) ?? str(p.dominant_entity_meaning);
    return /s[0-2]/i.test(str(p.map_code) ?? "") || /sulfid/i.test(meaningOf ?? "")
      ? "medium"
      : "informational";
  };
  // A lot can straddle several soil classes and feature order is not
  // stable: classify on the worst one, and keep every distinct code so the
  // facts panel names them all.
  const worst = layer
    ? (layer.features.find((f) => grade(f) === "medium") ?? layer.features[0])
    : undefined;
  const hit = layer && worst ? { f: worst, scale: layer.scale } : null;

  const a = attrs(hit?.f);
  const mapCode = str(a.map_code);
  const meaning = str(a.map_code_meaning) ?? str(a.dominant_entity_meaning);
  const mapCodes = layer
    ? [...new Set(layer.features.map((f) => str(attrs(f).map_code)).filter((c): c is string => c !== null))]
    : [];
  // The classifying code leads.
  if (mapCode) mapCodes.sort((x, y) => (x === mapCode ? -1 : y === mapCode ? 1 : 0));

  const riskLevel: RiskLevel = !hit ? "none" : grade(hit.f);

  return {
    riskLevel,
    mapCode,
    mapCodes,
    meaning,
    scale: hit?.scale ?? null,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "QLD Acid Sulfate Soils mapping (Department of Resources)",
        url: ASS_DOC,
        layer: ASS_25K,
      },
    ],
    raw: { k25, k50, k100 },
    context: { k25: k25Ctx, k50: k50Ctx, k100: k100Ctx },
  };
}
