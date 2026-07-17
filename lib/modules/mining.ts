// Mining & resources module — statewide resource authorities + key
// resource areas.
//
// Two statewide QSpatial sources (verified live 2026-07):
//
//   Economy/MineralTenement/MapServer/0 — current resource authorities
//     (mining leases, exploration permits, mineral development licences).
//     Fields: tenid, tenname, tentype, tenmineral, tenowner, tenstatus,
//     appdate, grantdate, expiredate.
//     An exploration permit over a suburb is common and low-impact; a
//     granted mining lease on/next to the lot is a serious flag.
//
//   GeoscientificInformation/MiningResources/MapServer — Key Resource
//     Areas (extractive industry protection under the SPP):
//       9  KRA resource/processing area   (quarry / extraction footprint)
//      10  KRA separation area            (buffer where sensitive uses are
//                                          constrained — dust/noise/blast)
//
// Neither replaces a GeoResGlobe search, but they answer the buyer
// question "is there a quarry buffer or mining tenement over this lot?".

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const TENEMENT =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Economy/MineralTenement/MapServer/0/query";
const MR =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/MiningResources/MapServer";
const KRA_RESOURCE = `${MR}/9/query`;
const KRA_SEPARATION = `${MR}/10/query`;

const GEORESGLOBE_DOC = "https://georesglobe.information.qld.gov.au/";

export type MiningTenement = {
  id: string | null;
  type: string | null; // "Mining lease" / "Exploration permit for minerals" …
  mineral: string | null;
  owner: string | null;
  status: string | null; // "Granted" / "Application"
};

export type MiningResult = {
  riskLevel: RiskLevel;
  tenements: MiningTenement[];
  /** True when the lot is inside a KRA quarry/extraction footprint. */
  inKraResourceArea: boolean;
  /** True when the lot is inside a KRA separation (buffer) area. */
  inKraSeparationArea: boolean;
  /** Human summary of the worst finding. */
  category: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { tenements: unknown; kraResource: unknown; kraSeparation: unknown };
  context: { tenements: unknown; kraResource: unknown; kraSeparation: unknown };
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchMiningData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<MiningResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const tenFields = "tenid,tenname,tentype,tenmineral,tenowner,tenstatus";
  const pointParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: false,
    lotPolygon: lot,
  });
  const contextParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00005,
  });

  const [ten, kraRes, kraSep, tenCtx, kraResCtx, kraSepCtx] =
    await Promise.all([
      queryArcGIS(TENEMENT, pointParams(tenFields)),
      queryArcGIS(KRA_RESOURCE, pointParams("*")),
      queryArcGIS(KRA_SEPARATION, pointParams("*")),
      queryArcGIS(TENEMENT, contextParams(tenFields)),
      queryArcGIS(KRA_RESOURCE, contextParams("*")),
      queryArcGIS(KRA_SEPARATION, contextParams("*")),
    ]);

  const tenements: MiningTenement[] = ten.features.map((f) => {
    const a = attrs(f);
    return {
      id: str(a.tenid) ?? str(a.tenname),
      type: str(a.tentype),
      mineral: str(a.tenmineral),
      owner: str(a.tenowner),
      status: str(a.tenstatus),
    };
  });

  const inKraResourceArea = kraRes.features.length > 0;
  const inKraSeparationArea = kraSep.features.length > 0;

  const grantedLease = tenements.some(
    (t) =>
      /granted/i.test(t.status ?? "") && /mining lease|mineral development/i.test(t.type ?? ""),
  );
  const anyGranted = tenements.some((t) => /granted/i.test(t.status ?? ""));

  // A quarry footprint or granted mining lease over the lot is a serious
  // flag; a separation buffer or granted exploration permit is a medium
  // consideration; applications only are informational.
  const riskLevel: RiskLevel =
    inKraResourceArea || grantedLease
      ? "high"
      : inKraSeparationArea || anyGranted
        ? "medium"
        : tenements.length > 0
          ? "low"
          : "none";

  const parts: string[] = [];
  if (inKraResourceArea) parts.push("Key Resource Area — resource/processing area");
  if (inKraSeparationArea) parts.push("Key Resource Area — separation buffer");
  if (tenements.length > 0) {
    const t = tenements[0];
    parts.push(`${t.type ?? "Resource authority"}${t.status ? ` (${t.status.toLowerCase()})` : ""}`);
  }

  return {
    riskLevel,
    tenements,
    inKraResourceArea,
    inKraSeparationArea,
    category: parts.length > 0 ? parts.join(" · ") : null,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "QLD Mineral & resource tenures (GeoResGlobe)",
        url: GEORESGLOBE_DOC,
        layer: TENEMENT,
      },
      {
        name: "QLD Key Resource Areas (State Planning Policy)",
        url: GEORESGLOBE_DOC,
        layer: KRA_RESOURCE,
      },
    ],
    raw: { tenements: ten, kraResource: kraRes, kraSeparation: kraSep },
    context: {
      tenements: tenCtx,
      kraResource: kraResCtx,
      kraSeparation: kraSepCtx,
    },
  };
}
