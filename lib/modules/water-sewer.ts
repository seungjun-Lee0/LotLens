// Water & Sewer module — Urban Utilities' asset network.
//
// ⚠ DARK MODULE. Built, tested and wired, but switched OFF at
// `WATER_SEWER_ENABLED` in lib/db.ts. See the LICENSING note below before
// turning it on — this is a legal gate, not a technical one.
//
// ─── Why it's worth shipping ─────────────────────────────────────────────
// A sewer gravity main through the back yard is the single most expensive
// surprise in a Brisbane back-yard build. Unlike an easement it is not on
// the title, so a buyer has no ordinary way to find it before contract.
// Building over or near a UU main needs UU's approval, and for a pressure
// (rising) main or a trunk-sized gravity main the answer is often simply
// no. Measured on four sample lots, two had a QUU main crossing them.
//
// ─── LICENSING — read before enabling ────────────────────────────────────
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
import { unavailableForLga, type Region } from "@/lib/region";

const SEWER = "https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Sewer_OpenData/FeatureServer";
const WATER = "https://services3.arcgis.com/ocUCNI2h4moKOpKX/arcgis/rest/services/UU_Water_OpenData/FeatureServer";

const UU_BUILD_OVER_DOC =
  "https://www.urbanutilities.com.au/development/help-and-advice/building-over-or-near-our-assets";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

/**
 * Gravity mains at or above this diameter are trunk infrastructure. UU
 * will rarely permit building over one, so it belongs in the same
 * deal-breaker tier as a rising main rather than the "approvable with
 * encasement" tier an ordinary 150 mm house drain sits in.
 */
const TRUNK_DIAMETER_MM = 300;

/** Urban Utilities' service area — the SEQ councils it supplies. Outside
 * these, water and sewer belong to a different retailer entirely. */
const UU_LGA_PATTERN =
  /brisbane|ipswich|lockyer|scenic rim|somerset/i;

export type UtilityAsset = {
  /** "Sewer gravity main" | "Sewer pressure main" | "Sewer manhole" |
   *  "Water main" | "Sewer service" | "Water service" */
  kind: string;
  assetId: string | null;
  /** Millimetres. Null on manholes. */
  diameterMm: number | null;
  material: string | null;
  /** Metres below surface — manholes only. */
  depthM: number | null;
  /** True for shared infrastructure; false for this property's own
   * connection line, which carries no build-over obligation. */
  isMain: boolean;
};

export type WaterSewerResult = {
  riskLevel: RiskLevel;
  /** Assets intersecting the lot. */
  assets: UtilityAsset[];
  /** A shared main crosses the lot — the build-over trigger. */
  hasMainOnLot: boolean;
  /** A rising main or trunk-diameter gravity main crosses the lot. These
   * are the ones UU generally will not let you build over at all. */
  hasTrunkOrPressureMainOnLot: boolean;
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
    return {
      kind,
      assetId: str(a.ASSETID),
      diameterMm: num(a.DIAMETER),
      material: str(a.MATERIAL),
      depthM: num(a.DEPTH),
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
  // Outside UU's service area these layers are simply empty, which would
  // read as a false "nothing here" rather than "different retailer".
  const inServiceArea = region?.lga ? UU_LGA_PATTERN.test(region.lga) : true;
  if (!inServiceArea) {
    return {
      riskLevel: "none",
      assets: [],
      hasMainOnLot: false,
      hasTrunkOrPressureMainOnLot: false,
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
  };

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
  ] = await Promise.all([
    queryArcGIS(`${SEWER}/18/query`, { ...onLot, outFields: "ASSETID,SEGMENTTYPE,MATERIAL,DIAMETER,USIL,DSIL,OWNER" }),
    queryArcGIS(`${SEWER}/25/query`, { ...onLot, outFields: "ASSETID,MATERIAL,DIAMETER,OWNER" }),
    queryArcGIS(`${SEWER}/20/query`, { ...onLot, outFields: "ASSETID,MANHOLEUSE,DEPTH,OWNER" }),
    queryArcGIS(`${SEWER}/30/query`, { ...onLot, outFields: "ASSETID,DIAMETER,OWNER" }),
    queryArcGIS(`${WATER}/21/query`, { ...onLot, outFields: "ASSETID,WATERTYPE,MATERIAL,DIAMETER,OWNER" }),
    queryArcGIS(`${WATER}/28/query`, { ...onLot, outFields: "ASSETID,SERVICETYPE,DIAMETER,OWNER" }),
    queryArcGIS(`${SEWER}/18/query`, { ...nearby, outFields: "ASSETID,DIAMETER" }),
    queryArcGIS(`${SEWER}/20/query`, { ...nearby, outFields: "ASSETID" }),
    queryArcGIS(`${WATER}/21/query`, { ...nearby, outFields: "ASSETID,DIAMETER" }),
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
      : assets.length > 0 || networkNearby
        ? "informational"
        : "none";

  return {
    riskLevel,
    assets,
    hasMainOnLot,
    hasTrunkOrPressureMainOnLot,
    networkNearby,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Urban Utilities — Sewer network (open data)",
        url: UU_BUILD_OVER_DOC,
        layer: `${SEWER}/18`,
      },
      {
        name: "Urban Utilities — Water network (open data)",
        url: UU_BUILD_OVER_DOC,
        layer: `${WATER}/21`,
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
  };
}
