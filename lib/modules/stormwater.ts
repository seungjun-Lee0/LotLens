// Stormwater module — BCC's existing stormwater asset network.
//
// Why this earns a page: you need Council approval to build over or near a
// Council stormwater main, and the answer routinely kills a pool, a shed or
// a rear extension after contract. It's the same class of nasty surprise as
// an easement, and unlike an easement it isn't on the title.
//
// (Brisbane's water and sewer mains transferred to Urban Utilities in 2010
// and are NOT published as open data — that's why this module covers
// stormwater only. Urban Utilities access would need a data agreement.)
//
// Endpoints (BCC open data, ArcGIS Online org dEKgZETqwmDAh1rP):
//   Stormwater_Pipe_Existing/FeatureServer/0          (polyline)
//     ASSETID, SUBTYPECD, PIPETYPE, OWNER, DIAMETER, MATERIAL_ABB,
//     AVERAGEDEPTH, STATUS
//   Stormwater_Manhole_Existing/FeatureServer/0       (point)
//   Stormwater_Gully_Existing/FeatureServer/0         (point)
//   Stormwater_End_Structure_Existing/FeatureServer/0 (point)
//
// ⚠ The pipe layer carries PRIVATE assets as well as public mains — a
// house's own roof-water downpipe run is in here with OWNER='PRIVATE'.
// Grading those as a consideration would flag practically every lot in
// Brisbane for owning gutters. Only a publicly-owned asset is a
// build-over constraint; see classifyOwner below.
//
// Verified live 2026-07 (East Brisbane point query returned 5 pipes).

import type { Feature, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const BASE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services";
const PIPE = `${BASE}/Stormwater_Pipe_Existing/FeatureServer/0/query`;
const MANHOLE = `${BASE}/Stormwater_Manhole_Existing/FeatureServer/0/query`;
const GULLY = `${BASE}/Stormwater_Gully_Existing/FeatureServer/0/query`;
const END_STRUCTURE = `${BASE}/Stormwater_End_Structure_Existing/FeatureServer/0/query`;

const BCC_STORMWATER_DOC =
  "https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/building-and-renovating/building-over-or-near-council-infrastructure";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

/** OWNER values that make an asset a public build-over constraint. The
 * rest ('PRIVATE', 'UNKNOWN') are the property's own drainage. */
const PUBLIC_OWNERS = [
  "BRISBANE CITY COUNCIL",
  "IPSWICH CITY COUNCIL",
  "REDLAND CITY COUNCIL",
  "DEPT OF TRANSPORT & MAIN ROADS",
  "STATE GOVERNMENT",
  "FEDERAL GOVERNMENT",
  "QLD RAIL",
];

function isPublicOwner(owner: string | null): boolean {
  if (!owner) return false;
  return PUBLIC_OWNERS.includes(owner.trim().toUpperCase());
}

export type StormwaterAsset = {
  /** "Pipe" | "Manhole" | "Gully" | "End structure" */
  kind: string;
  assetId: string | null;
  /** e.g. "DRAIN", "ROOF WATER" — null on structures. */
  pipeType: string | null;
  owner: string | null;
  /** e.g. "600 MM" — BCC stores this as a string with units. */
  diameter: string | null;
  material: string | null;
  /** Metres below surface, when recorded. */
  averageDepth: number | null;
  public: boolean;
};

export type StormwaterResult = {
  riskLevel: RiskLevel;
  /** Assets intersecting the lot itself. */
  assets: StormwaterAsset[];
  /** True when at least one on-lot asset is publicly owned — the case
   * that actually triggers a build-over/build-near application. */
  hasPublicAssetOnLot: boolean;
  /** Network exists in the surrounding street even if not on the lot —
   * relevant to "is there a lawful point of discharge". */
  networkNearby: boolean;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toAssets(
  fc: { features: Feature<Geometry | null, unknown>[] },
  kind: string,
): StormwaterAsset[] {
  return fc.features.map((f) => {
    const a = (f.properties ?? {}) as Record<string, unknown>;
    const owner = str(a.OWNER);
    return {
      kind,
      assetId: str(a.ASSETID),
      pipeType: str(a.PIPETYPE),
      owner,
      diameter: str(a.DIAMETER),
      material: str(a.MATERIAL_ABB) ?? str(a.PREDOMINANTMATERIAL),
      averageDepth: num(a.AVERAGEDEPTH) ?? num(a.DEPTH),
      public: isPublicOwner(owner),
    };
  });
}

export async function fetchStormwaterData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<StormwaterResult> {
  // Councils each publish their own asset network (or don't). Brisbane's
  // is the open one; other LGAs land as adapters.
  const isBrisbane = region?.isBrisbane ?? true;
  if (!isBrisbane) {
    return {
      riskLevel: "none",
      assets: [],
      hasPublicAssetOnLot: false,
      networkNearby: false,
      hasConsideration: false,
      sources: [
        { name: "Council stormwater asset network", url: BCC_STORMWATER_DOC, layer: "" },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(
        region ?? { lga: null, isBrisbane: false },
        "The stormwater asset network",
      ),
    };
  }

  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  // With a cadastre lot polygon this is exact. Without one (road-centreline
  // geocode) fall back to a ~30 m envelope, which can pick up the street
  // main — the same trade-off the easements module makes.
  const onLot = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    bufferDegrees: 0.00027,
    lotPolygon: lot,
  };
  const nearby = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  };
  // Field lists differ per layer and ArcGIS 400s on an unknown name rather
  // than ignoring it — end structures have no DIAMETER, they have DEPTH and
  // PREDOMINANTMATERIAL instead.
  const pipeFields = "ASSETID,SUBTYPECD,PIPETYPE,OWNER,DIAMETER,MATERIAL_ABB,AVERAGEDEPTH,STATUS";
  const structureFields = "ASSETID,SUBTYPECD,OWNER,DIAMETER,STATUS";
  const endStructureFields = "ASSETID,SUBTYPECD,OWNER,DEPTH,PREDOMINANTMATERIAL,STATUS";

  const [pipe, manhole, gully, endStruct, pipeCtx, manholeCtx, gullyCtx] =
    await Promise.all([
      queryArcGIS(PIPE, { ...onLot, outFields: pipeFields }),
      queryArcGIS(MANHOLE, { ...onLot, outFields: structureFields }),
      queryArcGIS(GULLY, { ...onLot, outFields: structureFields }),
      queryArcGIS(END_STRUCTURE, { ...onLot, outFields: endStructureFields }),
      queryArcGIS(PIPE, { ...nearby, outFields: "ASSETID,PIPETYPE,OWNER,DIAMETER" }),
      queryArcGIS(MANHOLE, { ...nearby, outFields: "ASSETID,OWNER" }),
      queryArcGIS(GULLY, { ...nearby, outFields: "ASSETID,OWNER" }),
    ]);

  const assets = [
    ...toAssets(pipe, "Pipe"),
    ...toAssets(manhole, "Manhole"),
    ...toAssets(gully, "Gully"),
    ...toAssets(endStruct, "End structure"),
  ];
  const hasPublicAssetOnLot = assets.some((a) => a.public);
  const networkNearby =
    pipeCtx.features.length > 0 ||
    manholeCtx.features.length > 0 ||
    gullyCtx.features.length > 0;

  // Grading turns on ONE question: is there anything on this lot?
  //
  //   public asset on the lot → medium. Build-over/near application.
  //   private asset on the lot → informational. The property's own
  //       drainage: no obligation, but worth knowing where it runs.
  //   nothing on the lot      → none, even when the street main is metres
  //       away. Practically every urban Brisbane lot has a main in the
  //       street, so grading that informational would spend a full report
  //       page on "there is stormwater in your suburb". `networkNearby`
  //       stays in the payload for the narrative — it just doesn't earn
  //       a section on its own.
  const riskLevel: RiskLevel = hasPublicAssetOnLot
    ? "medium"
    : assets.length > 0
      ? "informational"
      : "none";

  return {
    riskLevel,
    assets,
    hasPublicAssetOnLot,
    networkNearby,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Brisbane City Council — Stormwater assets (existing)",
        url: BCC_STORMWATER_DOC,
        layer: PIPE,
      },
    ],
    raw: { pipe, manhole, gully, endStructure: endStruct },
    context: { pipe: pipeCtx, manhole: manholeCtx, gully: gullyCtx },
    available: true,
  };
}
