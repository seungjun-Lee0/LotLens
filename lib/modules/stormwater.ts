// Stormwater module: BCC's existing stormwater asset network.
//
// Why this earns a page: you need Council approval to build over or near a
// Council stormwater main, and the answer routinely kills a pool, a shed or
// a rear extension after contract. It's the same class of nasty surprise as
// an easement, and unlike an easement it isn't on the title.
//
// (Brisbane's water and sewer mains transferred to Urban Utilities in 2010
// and are NOT published as open data: that's why this module covers
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
// ⚠ The pipe layer carries PRIVATE assets as well as public mains: a
// house's own roof-water downpipe run is in here with OWNER='PRIVATE'.
// Grading those as a consideration would flag practically every lot in
// Brisbane for owning gutters. Only a publicly-owned asset is a
// build-over constraint; see classifyOwner below.
//
// Verified live 2026-07 (East Brisbane point query returned 5 pipes).

import type { Feature, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import { councilOf, type CouncilId } from "@/lib/councils";
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
  "LOGAN CITY COUNCIL",
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
  /** e.g. "DRAIN", "ROOF WATER": null on structures. */
  pipeType: string | null;
  owner: string | null;
  /** e.g. "600 MM": BCC stores this as a string with units. */
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
  /** True when at least one on-lot asset is publicly owned: the case
   * that actually triggers a build-over/build-near application. */
  hasPublicAssetOnLot: boolean;
  /** Network exists in the surrounding street even if not on the lot -
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
    // Two field vocabularies: BCC (OWNER/ASSETID/DIAMETER "600 MM") and
    // Logan (Owner/Asset_ID/Diameter_mm numeric).
    const owner = str(a.OWNER) ?? str(a.Owner);
    const dmm = num(a.Diameter_mm);
    return {
      kind,
      assetId: str(a.ASSETID) ?? str(a.Asset_ID),
      pipeType: str(a.PIPETYPE) ?? str(a.Culvert_Use),
      owner,
      diameter: str(a.DIAMETER) ?? (dmm && dmm > 0 ? `${dmm} MM` : null),
      material: str(a.MATERIAL_ABB) ?? str(a.PREDOMINANTMATERIAL) ?? str(a.Material),
      averageDepth: num(a.AVERAGEDEPTH) ?? num(a.DEPTH),
      public: isPublicOwner(owner),
    };
  });
}

// ── Per-council asset endpoints ─────────────────────────────────────────
//
// Same result shape everywhere; councils differ in which layers exist and
// what their fields are called. `gully` is optional (Logan folds gullies
// into Pits). ArcGIS 400s on unknown outFields, so lists are per-council.
type StormwaterCouncil = {
  pipe: string;
  manhole: string;
  gully: string | null;
  endStructure: string;
  pipeFields: string;
  structureFields: string;
  endStructureFields: string;
  sourceName: string;
  docUrl: string;
};

const LOGAN_SW =
  "https://services5.arcgis.com/ZUCWDRj8F77Xo351/arcgis/rest/services/LCC_Stormwater_Infrastructure/FeatureServer";

const STORMWATER_COUNCILS: Partial<Record<CouncilId, StormwaterCouncil>> = {
  brisbane: {
    pipe: PIPE,
    manhole: MANHOLE,
    gully: GULLY,
    endStructure: END_STRUCTURE,
    pipeFields: "ASSETID,SUBTYPECD,PIPETYPE,OWNER,DIAMETER,MATERIAL_ABB,AVERAGEDEPTH,STATUS",
    structureFields: "ASSETID,SUBTYPECD,OWNER,DIAMETER,STATUS",
    endStructureFields: "ASSETID,SUBTYPECD,OWNER,DEPTH,PREDOMINANTMATERIAL,STATUS",
    sourceName: "Brisbane City Council: Stormwater assets (existing)",
    docUrl: BCC_STORMWATER_DOC,
  },
  logan: {
    pipe: `${LOGAN_SW}/15/query`, // Drains (polyline network)
    manhole: `${LOGAN_SW}/12/query`, // Pits
    gully: null,
    endStructure: `${LOGAN_SW}/11/query`, // Headwalls
    pipeFields: "Asset_ID,Owner,Culvert_Use,Diameter_mm,Material",
    structureFields: "Asset_ID,Owner",
    endStructureFields: "Asset_ID,Owner,Type",
    sourceName: "Logan City Council: Stormwater infrastructure",
    docUrl: "https://www.logan.qld.gov.au/planning-and-development",
  },
};

export async function fetchStormwaterData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<StormwaterResult> {
  // Councils each publish their own asset network (or don't): resolved
  // through the per-council endpoint table above.
  const councilId = region ? councilOf(region) : "brisbane";
  const council = councilId ? STORMWATER_COUNCILS[councilId] : undefined;
  if (!council) {
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
  // main: the same trade-off the easements module makes.
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
  const { pipeFields, structureFields, endStructureFields } = council;

  const [pipe, manhole, gully, endStruct, pipeCtx, manholeCtx, gullyCtx] =
    await Promise.all([
      queryArcGIS(council.pipe, { ...onLot, outFields: pipeFields }),
      queryArcGIS(council.manhole, { ...onLot, outFields: structureFields }),
      council.gully
        ? queryArcGIS(council.gully, { ...onLot, outFields: structureFields })
        : Promise.resolve(EMPTY_FC as never),
      queryArcGIS(council.endStructure, { ...onLot, outFields: endStructureFields }),
      queryArcGIS(council.pipe, { ...nearby, outFields: pipeFields }),
      queryArcGIS(council.manhole, { ...nearby, outFields: structureFields }),
      council.gully
        ? queryArcGIS(council.gully, { ...nearby, outFields: structureFields })
        : Promise.resolve(EMPTY_FC as never),
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
  //       stays in the payload for the narrative: it just doesn't earn
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
        name: council.sourceName,
        url: council.docUrl,
        layer: council.pipe,
      },
    ],
    raw: { pipe, manhole, gully, endStructure: endStruct },
    context: { pipe: pipeCtx, manhole: manholeCtx, gully: gullyCtx },
    available: true,
  };
}
