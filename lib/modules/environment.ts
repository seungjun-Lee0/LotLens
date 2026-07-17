// Environment module — koala habitat + state wildlife habitat (MSES).
//
// Develo's "Environment" page covers exactly this: Core Koala Habitat
// Area, Koala Priority Area, and MSES wildlife habitat. All statewide
// (koala layers are SEQ — the regulatory scope of the Nature
// Conservation (Koala) Plan 2020; MSES wildlife habitat is statewide).
//
// Endpoints (QSpatial, verified live 2026-07):
//   Environment/KoalaPlan/MapServer
//     1  Koala priority area           (field `kpa`)
//     3  Core koala habitat area
//     5  Locally refined koala habitat area
//   Environment/MattersOfStateEnvironmentalSignificance/MapServer
//     21 MSES wildlife habitat [endangered or vulnerable]
//
// Being inside a core koala habitat area makes interfering with koala
// habitat trees assessable development in the SEQ koala protection
// framework — a real constraint on clearing/building envelopes.

import type { Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const KOALA =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/KoalaPlan/MapServer";
const KOALA_PRIORITY = `${KOALA}/1/query`;
const KOALA_CORE = `${KOALA}/3/query`;
const KOALA_LOCAL = `${KOALA}/5/query`;
const MSES_WILDLIFE =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/MattersOfStateEnvironmentalSignificance/MapServer/21/query";

const KOALA_DOC =
  "https://environment.qld.gov.au/wildlife/animals/living-with/koalas/mapping/koalamaps";
const MSES_DOC =
  "https://environment.qld.gov.au/management/planning-guidelines/method-mapping-mses";

export type EnvironmentResult = {
  riskLevel: RiskLevel;
  /** True when the lot sits inside a Koala Priority Area (SEQ). */
  inKoalaPriorityArea: boolean;
  /** True when core / locally refined koala habitat covers the lot. */
  hasKoalaHabitat: boolean;
  /** True when MSES endangered/vulnerable wildlife habitat covers the lot. */
  hasWildlifeHabitat: boolean;
  /** Human summary, e.g. "Core koala habitat area (Koala Priority Area)". */
  category: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: {
    priority: unknown;
    core: unknown;
    local: unknown;
    wildlife: unknown;
  };
  context: {
    priority: unknown;
    core: unknown;
    local: unknown;
    wildlife: unknown;
  };
};

export async function fetchEnvironmentData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<EnvironmentResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: "objectid",
    returnGeometry: false,
    bufferDegrees: 0.00045,
    lotPolygon: lot,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields: "objectid",
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  };

  const [
    priority, core, local, wildlife,
    priorityCtx, coreCtx, localCtx, wildlifeCtx,
  ] = await Promise.all([
    queryArcGIS(KOALA_PRIORITY, pointParams),
    queryArcGIS(KOALA_CORE, pointParams),
    queryArcGIS(KOALA_LOCAL, pointParams),
    queryArcGIS(MSES_WILDLIFE, pointParams),
    queryArcGIS(KOALA_PRIORITY, contextParams),
    queryArcGIS(KOALA_CORE, contextParams),
    queryArcGIS(KOALA_LOCAL, contextParams),
    queryArcGIS(MSES_WILDLIFE, contextParams),
  ]);

  const inKoalaPriorityArea = priority.features.length > 0;
  const hasKoalaHabitat =
    core.features.length > 0 || local.features.length > 0;
  const hasWildlifeHabitat = wildlife.features.length > 0;

  // Core habitat inside a priority area is the strongest regulatory
  // trigger; habitat or MSES wildlife alone is a medium consideration;
  // priority-area-only (no mapped habitat on the lot) is informational.
  const riskLevel: RiskLevel =
    hasKoalaHabitat && inKoalaPriorityArea
      ? "high"
      : hasKoalaHabitat || hasWildlifeHabitat
        ? "medium"
        : inKoalaPriorityArea
          ? "low"
          : "none";

  const parts: string[] = [];
  if (core.features.length > 0) parts.push("Core koala habitat area");
  else if (local.features.length > 0) parts.push("Locally refined koala habitat");
  if (inKoalaPriorityArea) parts.push("Koala Priority Area");
  if (hasWildlifeHabitat) parts.push("MSES wildlife habitat (endangered/vulnerable)");

  return {
    riskLevel,
    inKoalaPriorityArea,
    hasKoalaHabitat,
    hasWildlifeHabitat,
    category: parts.length > 0 ? parts.join(" · ") : null,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "QLD Koala Plan mapping (Nature Conservation (Koala) Plan 2020)",
        url: KOALA_DOC,
        layer: KOALA_CORE,
      },
      {
        name: "Matters of State Environmental Significance — wildlife habitat",
        url: MSES_DOC,
        layer: MSES_WILDLIFE,
      },
    ],
    raw: { priority, core, local, wildlife },
    context: {
      priority: priorityCtx,
      core: coreCtx,
      local: localCtx,
      wildlife: wildlifeCtx,
    },
  };
}
