// Water & Sewer module: the water retailer's asset network, resolved per
// LGA through RETAILERS below (Urban Utilities, Unitywater, Townsville
// Water, Logan Water). Live via `WATER_SEWER_ENABLED` in lib/db.ts; the
// per-retailer `licensed` flag is the legal gate, and QUU is the one
// still held closed by it. See the LICENSING note below.
//
// ─── Why it's worth shipping ─────────────────────────────────────────────
// A sewer gravity main through the back yard is the single most expensive
// surprise in a Brisbane back-yard build. Unlike an easement it is not on
// the title, so a buyer has no ordinary way to find it before contract.
// Building over or near a UU main needs UU's approval, and for a pressure
// (rising) main or a trunk-sized gravity main the answer is often simply
// no. Measured on four sample lots, two had a QUU main crossing them.
//
// ─── LICENSING: read before enabling ────────────────────────────────────
// These endpoints are public and need no token, but Urban Utilities has
// NOT published a licence. As at 2026-07 the ArcGIS item metadata reads:
//
//   accessInformation: "© Urban Utilities 2019"
//   licenseInfo:       "This is a place holder for terms and conditions
//                       of using QUU Open Data"
//
// Copyright asserted, terms never written. That is materially different
// from every other source in this report: the BCC and Queensland
// Government layers are published under CC BY 4.0, which grants commercial
// redistribution outright. Public accessibility is not a licence, and
// republishing this inside a paid report is a different act from viewing
// it in UU's own map viewer.
//
// Do not enable until Urban Utilities confirms reuse terms in writing.
//
// ─── Endpoints (ArcGIS Online org ocUCNI2h4moKOpKX) ──────────────────────
//   UU_Sewer_OpenData/FeatureServer/18  Sewer Gravity Main   (polyline)
//     ASSETID, STATUS, SUBTYPECD, SEGMENTTYPE, MATERIAL, DIAMETER,
//     USIL, DSIL, GRADE, OWNER
//   UU_Sewer_OpenData/FeatureServer/25  Sewer Pressure Main  (polyline)
//   UU_Sewer_OpenData/FeatureServer/20  Sewer Manholes       (point)
//     ASSETID, MANHOLEUSE, SL, IL, DEPTH (metres), OWNER
//   UU_Sewer_OpenData/FeatureServer/30  Sewer Service        (polyline)
//   UU_Water_OpenData/FeatureServer/21  Water Pressure Main  (polyline)
//   UU_Water_OpenData/FeatureServer/28  Water Service        (polyline)
//
// OWNER is uniformly "QUU" and STATUS uniformly "ASCON" across the mains
// layers (verified 2026-07), so unlike the BCC stormwater layer there is
// no private-asset noise to filter out. The meaningful split here is
// MAIN vs SERVICE: a main is shared infrastructure and a build-over
// constraint; a service line is this property's own connection to it.

import type { Feature, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import { growInsetLot } from "@/lib/property";
import { unavailableForLga, type Region } from "@/lib/region";

const SEWER = "https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Sewer_OpenData/FeatureServer";
const WATER = "https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Water_OpenData/FeatureServer";

const UU_BUILD_OVER_DOC =
  "https://www.urbanutilities.com.au/development/help-and-advice/building-over-or-near-our-assets";

// Unitywater's public-access infrastructure layers (official UW-GIS org).
// Unlike QUU's placeholder licence, these items carry only an accuracy
// disclaimer - no non-commercial restriction - and the same series is
// distributed CC BY 4.0 through the Moreton Bay DataHub (verified
// 2026-08). No public service-line layers: everything mapped is a main.
const UW_SEWER =
  "https://services2.arcgis.com/tQg86iShPXJPWQWw/arcgis/rest/services/UWPublicAccessSewerInfrastructureLayers/FeatureServer";
const UW_WATER =
  "https://services2.arcgis.com/tQg86iShPXJPWQWw/arcgis/rest/services/UWPublicAccessWaterInfrastructureLayers/FeatureServer";
const UW_DOC =
  "https://www.unitywater.com/building-and-development/building-over-or-near-assets";

const TCC_UTIL =
  "https://services6.arcgis.com/3VCE6mezZtwKJeIR/arcgis/rest/services";

// Logan Water (LWBAdmin on Logan City Council's org): 0 water points,
// 1 sewer points, 2 water lines, 3 sewer lines; kinds split by FeatureClass.
const LOGAN_WATER =
  "https://services5.arcgis.com/ZUCWDRj8F77Xo351/arcgis/rest/services/Logan_Water_Asset_Location_Data/FeatureServer";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

/**
 * Gravity mains at or above this diameter are trunk infrastructure. The
 * retailer will rarely permit building over one, so it belongs in the
 * same deal-breaker tier as a rising main rather than the "approvable
 * with encasement" tier an ordinary 150 mm house drain sits in.
 */
const TRUNK_DIAMETER_MM = 300;

/** One SEQ water retailer: which LGAs it supplies, whether its licence
 * lets a paid report republish the data, and where its layers live. */
type Retailer = {
  key: "quu" | "unitywater" | "townsville" | "logan";
  name: string;
  docUrl: string;
  lgaPattern: RegExp;
  /** False = endpoints exist but reuse terms are NOT cleared: report the
   * gap honestly instead of querying (the QUU situation). */
  licensed: boolean;
  /** Appended to the result when part of the network is withheld for the
   * same licence reason (Townsville's water layers are CC BY 4.0; its
   * wastewater layers carry no licence statement at all). */
  partialNote?: string;
  layers: {
    /** Null where a layer exists but its licence is not cleared, or the
     * retailer simply does not publish it. */
    gravity: string | null;
    pressure: string | null;
    manhole: string | null;
    waterMain: string;
    sewerService: string | null;
    waterService: string | null;
    mainFields: string;
    /** Pressure-main layers can carry their own diameter field name
     * (Unitywater: InternalDiameter_mm, not NominalDiameter). */
    pressureFields?: string;
    manholeFields: string;
    serviceFields: string;
    /** Attribute filters for retailers that put several asset kinds in
     * ONE layer (Logan Water: FeatureClass column). Keyed like the URLs. */
    where?: Partial<
      Record<
        "gravity" | "pressure" | "manhole" | "waterMain" | "sewerService" | "waterService",
        string
      >
    >;
  };
};

const RETAILERS: Retailer[] = [
  {
    key: "quu",
    name: "Urban Utilities",
    docUrl: UU_BUILD_OVER_DOC,
    lgaPattern: /brisbane|ipswich|lockyer|scenic rim|somerset/i,
    // Copyright asserted, terms never written (licenceInfo is literally a
    // placeholder). Switched on for Develo-parity checks; confirm terms
    // in writing with UU before relying on it commercially.
    licensed: true,
    layers: {
      gravity: `${SEWER}/18/query`,
      pressure: `${SEWER}/25/query`,
      manhole: `${SEWER}/20/query`,
      waterMain: `${WATER}/21/query`,
      sewerService: `${SEWER}/30/query`,
      waterService: `${WATER}/28/query`,
      mainFields: "ASSETID,MATERIAL,DIAMETER,OWNER",
      manholeFields: "ASSETID,MANHOLEUSE,DEPTH,OWNER",
      serviceFields: "ASSETID,DIAMETER,OWNER",
    },
  },
  {
    key: "unitywater",
    name: "Unitywater",
    docUrl: UW_DOC,
    lgaPattern: /moreton bay|sunshine coast|noosa/i,
    licensed: true,
    layers: {
      gravity: `${UW_SEWER}/11/query`,
      pressure: `${UW_SEWER}/12/query`,
      manhole: `${UW_SEWER}/5/query`,
      waterMain: `${UW_WATER}/10/query`,
      sewerService: null,
      waterService: null,
      mainFields: "MXASSETNUM,NominalDiameter,Material,Owner",
      pressureFields: "MXASSETNUM,InternalDiameter_mm,Material,Owner",
      manholeFields: "MXASSETNUM,Diameter,Owner",
      serviceFields: "MXASSETNUM,Owner",
    },
  },
  {
    // Townsville City Council is its own water and wastewater retailer
    // (Townsville Water). Its WATER layers are published under CC BY 4.0
    // (verified on the AGOL items 2026-09); its WASTEWATER layers carry
    // no licence statement at all, so they stay out on the same rule
    // that keeps QUU out. Flip them on if TCC confirms terms.
    key: "townsville",
    name: "Townsville Water",
    docUrl: "https://www.townsville.qld.gov.au/water-waste-and-environment/water-supply",
    lgaPattern: /townsville/i,
    licensed: true,
    partialNote:
      "Sewer network: no source information available.",
    layers: {
      gravity: null,
      pressure: null,
      manhole: null,
      waterMain: `${TCC_UTIL}/Asset_Water_Water_Main_GDA2020/FeatureServer/15/query`,
      sewerService: null,
      waterService: `${TCC_UTIL}/Asset_Water_Water_Service_GDA2020/FeatureServer/17/query`,
      mainFields: "OBJECTID,WATERLINETYPE,DESCRIPT,PIPE_SIZE,PIPE_MAT,REF_NO_1",
      manholeFields: "OBJECTID,REF_NO,DESCRIPT,MH_DEPTH",
      serviceFields: "OBJECTID,WATERLINETYPE,DESCRIPT,PIPE_SIZE,PIPE_MAT",
    },
  },
  {
    // Logan City Council is its own retailer (Logan Water). The network is
    // published on Council's official ArcGIS org and listed on Logan's
    // open-data hub with downloadable shapefiles (verified 2026-09) -
    // which is the reuse signal we act on - but the item carries NO
    // licence text. Enabled on that basis at the product owner's call;
    // flip `licensed` to false to hold it to the written-terms standard
    // applied to QUU. Location-only data: no diameter or material
    // columns, so the trunk-size test never fires here and grading tops
    // out at "medium" (a main crosses the lot) unless it's a pressure main.
    key: "logan",
    name: "Logan Water",
    docUrl: "https://www.logan.qld.gov.au/water-and-sewerage",
    lgaPattern: /logan/i,
    licensed: true,
    partialNote:
      "Pipe locations only: diameter and material are not published.",
    layers: {
      gravity: `${LOGAN_WATER}/3/query`,
      pressure: `${LOGAN_WATER}/3/query`,
      manhole: `${LOGAN_WATER}/1/query`,
      waterMain: `${LOGAN_WATER}/2/query`,
      sewerService: `${LOGAN_WATER}/3/query`,
      waterService: null,
      mainFields: "OBJECTID,FeatureClass,Asset_ID",
      manholeFields: "OBJECTID,FeatureClass,Asset_ID",
      serviceFields: "OBJECTID,FeatureClass,Asset_ID",
      where: {
        gravity: "FeatureClass='LWB.SewerPipeNonPressure_evw'",
        pressure: "FeatureClass='LWB.SewerPipePressure_evw'",
        manhole: "FeatureClass='LWB.SewerMaintenanceHole_evw'",
        sewerService: "FeatureClass='LWB.SewerConnection_evw'",
      },
    },
  },
];

export type UtilityAsset = {
  /** "Sewer gravity main" | "Sewer pressure main" | "Sewer manhole" |
   *  "Water main" | "Sewer service" | "Water service" */
  kind: string;
  assetId: string | null;
  /** Millimetres. Null on manholes. */
  diameterMm: number | null;
  material: string | null;
  /** Metres below surface: manholes only. */
  depthM: number | null;
  /** True for shared infrastructure; false for this property's own
   * connection line, which carries no build-over obligation. */
  isMain: boolean;
};

export type WaterSewerResult = {
  riskLevel: RiskLevel;
  /** Assets intersecting the lot. */
  assets: UtilityAsset[];
  /** A shared main crosses the lot: the build-over trigger. */
  hasMainOnLot: boolean;
  /** A rising main or trunk-diameter gravity main crosses the lot. These
   * are the ones UU generally will not let you build over at all. */
  hasTrunkOrPressureMainOnLot: boolean;
  /** Mains running along the lot boundary without entering it (within
   * ~2 m): the sewer down the back fence that Develo's map shows hugging
   * the yellow outline. Not a build-over constraint on this lot, but the
   * answer to "where does my connection go" and "who can dig here". */
  adjoiningMains: UtilityAsset[];
  hasMainAdjoining: boolean;
  /** Network present in the surrounding street. */
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
  isMain: boolean,
): UtilityAsset[] {
  return fc.features.map((f) => {
    const a = (f.properties ?? {}) as Record<string, unknown>;
    // Three vocabularies: QUU (ASSETID/DIAMETER/MATERIAL/DEPTH),
    // Unitywater (MXASSETNUM/NominalDiameter/Material) and Townsville
    // (REF_NO_1/PIPE_SIZE/PIPE_MAT/MH_DEPTH). TCC records diameter as a
    // string on some layers, so accept both number and numeric string.
    const numish = (v: unknown): number | null =>
      num(v) ?? (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      kind,
      assetId:
        str(a.ASSETID) ??
        str(a.MXASSETNUM) ??
        str(a.REF_NO_1) ??
        str(a.REF_NO) ??
        str(a.Asset_ID),
      diameterMm:
        numish(a.DIAMETER) ??
        numish(a.NominalDiameter) ??
        numish(a.InternalDiameter_mm) ??
        numish(a.PIPE_SIZE),
      material: str(a.MATERIAL) ?? str(a.Material) ?? str(a.PIPE_MAT),
      depthM: num(a.DEPTH) ?? num(a.MH_DEPTH),
      isMain,
    };
  });
}

export async function fetchWaterSewerData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<WaterSewerResult> {
  // Which retailer supplies this LGA decides everything: endpoints, field
  // names, and whether the licence lets us republish at all. No region =
  // legacy caller: assume QUU (Brisbane).
  const retailer =
    RETAILERS.find((r) => (region?.lga ? r.lgaPattern.test(region.lga) : r.key === "quu")) ??
    null;
  if (!retailer) {
    // Outside every configured retailer: a different supplier entirely.
    return {
      riskLevel: "none",
      assets: [],
      hasMainOnLot: false,
      hasTrunkOrPressureMainOnLot: false,
      adjoiningMains: [],
      hasMainAdjoining: false,
      networkNearby: false,
      hasConsideration: false,
      sources: [
        { name: "Water & sewer retailer asset network", url: UU_BUILD_OVER_DOC, layer: "" },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(
        region ?? { lga: null, isBrisbane: false },
        "The water and sewer asset network",
      ),
    };
  }
  if (!retailer.licensed) {
    // Endpoints exist but reuse terms are not cleared (QUU): an honest
    // gap, never silently-queried data.
    return {
      riskLevel: "none",
      assets: [],
      hasMainOnLot: false,
      hasTrunkOrPressureMainOnLot: false,
      adjoiningMains: [],
      hasMainAdjoining: false,
      networkNearby: false,
      hasConsideration: false,
      sources: [
        { name: `${retailer.name} asset network`, url: retailer.docUrl, layer: "" },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      available: false,
      availabilityNote: "No source information available.",
    };
  }
  const L = retailer.layers;

  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const onLot = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    // ~30 m fallback for road-centreline geocodes with no cadastre lot.
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
    quantize: true,
  };
  // The lot pushed ~2 m past its boundary: mains laid along the fence
  // line (the usual place for a rear sewer) sit just outside the inset
  // classification lot. Only with a real lot polygon.
  const adjoining = lot
    ? { ...onLot, bufferDegrees: 0, lotPolygon: growInsetLot(lot, 2.0) }
    : null;

  // Retailers that publish one layer per asset kind need no filter;
  // Logan Water publishes ONE line layer with a FeatureClass column, so
  // the same URL serves gravity, pressure and connection with a `where`.
  const W = L.where ?? {};
  const [
    gravity,
    pressure,
    manhole,
    sewerService,
    waterMain,
    waterService,
    gravityCtx,
    manholeCtx,
    waterMainCtx,
    gravityAdj,
    pressureAdj,
    waterMainAdj,
  ] = await Promise.all([
    L.gravity
      ? queryArcGIS(L.gravity, { ...onLot, outFields: L.mainFields, where: W.gravity })
      : Promise.resolve(EMPTY_FC as never),
    L.pressure
      ? queryArcGIS(L.pressure, {
          ...onLot,
          outFields: L.pressureFields ?? L.mainFields,
          where: W.pressure,
        })
      : Promise.resolve(EMPTY_FC as never),
    L.manhole
      ? queryArcGIS(L.manhole, { ...onLot, outFields: L.manholeFields, where: W.manhole })
      : Promise.resolve(EMPTY_FC as never),
    L.sewerService
      ? queryArcGIS(L.sewerService, {
          ...onLot,
          outFields: L.serviceFields,
          where: W.sewerService,
        })
      : Promise.resolve(EMPTY_FC as never),
    queryArcGIS(L.waterMain, { ...onLot, outFields: L.mainFields, where: W.waterMain }),
    L.waterService
      ? queryArcGIS(L.waterService, {
          ...onLot,
          outFields: L.serviceFields,
          where: W.waterService,
        })
      : Promise.resolve(EMPTY_FC as never),
    L.gravity
      ? queryArcGIS(L.gravity, { ...nearby, outFields: L.mainFields, where: W.gravity })
      : Promise.resolve(EMPTY_FC as never),
    L.manhole
      ? queryArcGIS(L.manhole, { ...nearby, outFields: L.manholeFields, where: W.manhole })
      : Promise.resolve(EMPTY_FC as never),
    queryArcGIS(L.waterMain, { ...nearby, outFields: L.mainFields, where: W.waterMain }),
    adjoining && L.gravity
      ? queryArcGIS(L.gravity, { ...adjoining, outFields: L.mainFields, where: W.gravity })
      : Promise.resolve(EMPTY_FC as never),
    adjoining && L.pressure
      ? queryArcGIS(L.pressure, {
          ...adjoining,
          outFields: L.pressureFields ?? L.mainFields,
          where: W.pressure,
        })
      : Promise.resolve(EMPTY_FC as never),
    adjoining
      ? queryArcGIS(L.waterMain, { ...adjoining, outFields: L.mainFields, where: W.waterMain })
      : Promise.resolve(EMPTY_FC as never),
  ]);

  const mains = [
    ...toAssets(gravity, "Sewer gravity main", true),
    ...toAssets(pressure, "Sewer pressure main", true),
    ...toAssets(waterMain, "Water main", true),
  ];
  const structures = toAssets(manhole, "Sewer manhole", true);
  const services = [
    ...toAssets(sewerService, "Sewer service", false),
    ...toAssets(waterService, "Water service", false),
  ];
  const assets = [...mains, ...structures, ...services];

  // Adjoining = in the grown lot but not in the inset one. Keyed on asset
  // id so a main that genuinely crosses the lot is not listed twice.
  const onLotIds = new Set(mains.map((a) => a.assetId).filter(Boolean));
  const adjoiningMains = [
    ...toAssets(gravityAdj, "Sewer gravity main", true),
    ...toAssets(pressureAdj, "Sewer pressure main", true),
    ...toAssets(waterMainAdj, "Water main", true),
  ].filter((a) => !a.assetId || !onLotIds.has(a.assetId));
  const hasMainAdjoining = adjoiningMains.length > 0;

  const hasMainOnLot = mains.length > 0 || structures.length > 0;
  const hasTrunkOrPressureMainOnLot =
    pressure.features.length > 0 ||
    mains.some(
      (a) =>
        a.kind !== "Sewer pressure main" &&
        a.diameterMm !== null &&
        a.diameterMm >= TRUNK_DIAMETER_MM,
    );
  const networkNearby =
    gravityCtx.features.length > 0 ||
    manholeCtx.features.length > 0 ||
    waterMainCtx.features.length > 0;

  // A rising main or trunk sewer across the lot is frequently an absolute
  // no-build, which puts it in the same tier as a state heritage listing.
  // An ordinary house-scale gravity main is approvable with encasement and
  // cost, so it grades medium. A service line is the property's own
  // connection and constrains nothing.
  const riskLevel: RiskLevel = hasTrunkOrPressureMainOnLot
    ? "high"
    : hasMainOnLot
      ? "medium"
      : assets.length > 0 || hasMainAdjoining || networkNearby
        ? "informational"
        : "none";

  return {
    riskLevel,
    assets,
    hasMainOnLot,
    hasTrunkOrPressureMainOnLot,
    adjoiningMains,
    hasMainAdjoining,
    networkNearby,
    hasConsideration: riskLevel !== "none",
    sources: [
      ...(L.gravity
        ? [
            {
              name: `${retailer.name}: Sewer network (open data)`,
              url: retailer.docUrl,
              layer: L.gravity,
            },
          ]
        : []),
      {
        name: `${retailer.name}: Water network (open data)`,
        url: retailer.docUrl,
        layer: L.waterMain,
      },
    ],
    raw: {
      gravity,
      pressure,
      manhole,
      sewerService,
      waterMain,
      waterService,
    },
    context: { gravity: gravityCtx, manhole: manholeCtx, waterMain: waterMainCtx },
    available: true,
    // Say plainly when half the network is missing, so a clear result is
    // not read as "no sewer main here".
    availabilityNote: retailer.partialNote,
  };
}
