// Zoning module.
//
// Brisbane LGA: BCC City Plan 2014 Zoning (detailed zone + precinct).
// Rest of SEQ: ShapingSEQ 2023 regional land use category (QSpatial
//   StatePlanning layer 140, field `rluc2023` — Urban Footprint / Rural
//   Living Area / Regional Landscape and Rural Production Area). There is
//   NO public statewide merged council-zoning service — each LGA publishes
//   its own scheme, so detailed zoning for other councils arrives with
//   their per-council adapters. The regional category is the honest
//   statewide baseline until then.
//
// BCC endpoint:
//   https://services2.arcgis.com/dEKgZETqwmDAh1rP/.../Zoning_opendata/FeatureServer/0
//   Native SRID: EPSG:28356.
//
// Fields (the ones we care about):
//   ZONE_CODE        e.g. "PC" / "OS" / "MU"
//   ZONE_PREC_DESC   e.g. "PC1 - Principal centre (City centre)" ← display label
//   ZONE_PREC        e.g. "City centre"
//   LVL1_ZONE        e.g. "Centre" / "Recreation and open space"
//   LVL2_ZONE        e.g. "Principal centre (City centre)"
//   LGA_CODE         1000 = Brisbane
//
// Every Brisbane parcel sits inside exactly one zone polygon — so the
// query effectively never returns 0 features for a valid Brisbane LGA
// point. We surface 'low' riskLevel when there *is* a zone (informational
// only — not a real risk axis) and 'none' as a "couldn't resolve" fallback.
//
// Verified: CBD → PC1; Rocklea Markets → OS Open space; Chermside → MU2
// Mixed use (Centre frame).

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import { councilOf, ZONING_ADAPTERS, type ZoningAdapter } from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { councilDisplayName, type Region } from "@/lib/region";

const ZONING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Zoning_opendata/FeatureServer/0/query";
const SEQ_RLUC =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/140/query";

const BCC_ZONING_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Zones";
const SEQ_PLAN_DOC =
  "https://planning.statedevelopment.qld.gov.au/planning-framework/plan-making/regional-planning/south-east-queensland-regional-plan";

export type ZoningSource = { name: string; url: string; layer: string };

export type ZoningResult = {
  /** Always 'low' when a zone is resolved (zoning is a context fact, not a
   * risk). 'none' only if the query somehow returns no feature. */
  riskLevel: RiskLevel;
  zoneCode: string | null;
  /** Human-readable precinct, e.g. "PC1 - Principal centre (City centre)". */
  zonePrecinct: string | null;
  /** Top-level zone family, e.g. "Centre". */
  lvl1Zone: string | null;
  /** Specific zone, e.g. "Principal centre (City centre)". */
  lvl2Zone: string | null;
  hasConsideration: boolean;
  sources: ZoningSource[];
  /** Point-query GeoJSON — drives classification. */
  raw: unknown;
  /** Envelope-query GeoJSON (~280 m around property) for map context. */
  context: unknown;
  /** Which scheme resolved: detailed council zoning or the SEQ regional
   * land use category baseline. */
  scheme: "bcc" | "council" | "seq_rluc";
  /** False when neither a council adapter nor the regional plan covers
   * this LGA (e.g. outside SEQ, pending other regional plans). */
  available: boolean;
  availabilityNote?: string;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchZoningData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<ZoningResult> {
  const isBrisbane = region?.isBrisbane ?? true;
  if (!isBrisbane) {
    const adapter = ZONING_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapter) {
      const result = await fetchCouncilZoning(lat, lng, adapter);
      // Council layers occasionally miss (unzoned strategic land, layer
      // gaps) — fall back to the regional-plan category rather than
      // reporting nothing.
      if (result.hasConsideration) return result;
    }
    return fetchSeqRegionalZoning(lat, lng, region);
  }
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "ZONE_CODE,ZONE_PREC_DESC,LVL1_ZONE,LVL2_ZONE";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(ZONING, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      // Zoning polygons follow cadastre lot boundaries 1:1 in BCC's data —
      // so the point-query polygon IS the property's lot outline. We use
      // this as the Develo-style yellow "selected property" highlight.
      returnGeometry: true,
      maxAllowableOffset: 0.00002, // ~2m — sharp parcel edges
    }),
    queryArcGIS(ZONING, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      // Zone polygons follow cadastre lots — smaller than flood/heritage
      // polygons and want sharper boundaries. ~3 m simplification.
      maxAllowableOffset: 0.00003,
    }),
  ]);
  const a = attrs(fc.features[0]);
  const zoneCode = str(a.ZONE_CODE);
  const zonePrecinct = str(a.ZONE_PREC_DESC);
  const lvl1Zone = str(a.LVL1_ZONE);
  const lvl2Zone = str(a.LVL2_ZONE);
  const resolved = Boolean(zoneCode ?? lvl1Zone);

  return {
    riskLevel: resolved ? "low" : "none",
    zoneCode,
    zonePrecinct,
    lvl1Zone,
    lvl2Zone,
    hasConsideration: resolved,
    sources: [
      {
        name: "BCC City Plan 2014 — Zoning",
        url: BCC_ZONING_DOC,
        layer: ZONING,
      },
    ],
    raw: fc,
    context: ctx,
    scheme: "bcc",
    available: true,
  };
}

// Detailed planning-scheme zoning via a per-council adapter (Gold Coast,
// Moreton Bay, Sunshine Coast, Redland — see lib/councils.ts).
async function fetchCouncilZoning(
  lat: number,
  lng: number,
  adapter: ZoningAdapter,
): Promise<ZoningResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const [fc, ctx] = await Promise.all([
    queryArcGIS(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: adapter.outFields,
      returnGeometry: true,
      maxAllowableOffset: 0.00002,
    }),
    queryArcGIS(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: adapter.outFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);
  const parsed = adapter.parse(attrs(fc.features[0]));
  const resolved = Boolean(parsed.zonePrecinct ?? parsed.lvl1Zone ?? parsed.zoneCode);

  return {
    riskLevel: resolved ? "low" : "none",
    ...parsed,
    hasConsideration: resolved,
    sources: [{ name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url }],
    raw: fc,
    context: ctx,
    scheme: "council",
    available: true,
  };
}

// SEQ regional land use category — the statewide baseline outside the
// council adapters. One dissolved polygon per category, so no lot-scale
// context map value; we still fetch a context envelope for the overlay wash.
async function fetchSeqRegionalZoning(
  lat: number,
  lng: number,
  region?: Region,
): Promise<ZoningResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const [fc, ctx] = await Promise.all([
    queryArcGIS(SEQ_RLUC, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "rluc2023",
      returnGeometry: false,
    }),
    queryArcGIS(SEQ_RLUC, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "rluc2023",
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00005,
    }),
  ]);
  const a = attrs(fc.features[0]);
  const rluc = str(a.rluc2023);
  const council = region ? councilDisplayName(region) : "the local council";

  return {
    riskLevel: rluc ? "low" : "none",
    zoneCode: null,
    zonePrecinct: rluc ? `${rluc} (SEQ Regional Plan)` : null,
    lvl1Zone: rluc,
    lvl2Zone: null,
    hasConsideration: Boolean(rluc),
    sources: [
      {
        name: "ShapingSEQ 2023 — Regional land use category",
        url: SEQ_PLAN_DOC,
        layer: SEQ_RLUC,
      },
    ],
    raw: fc,
    context: ctx,
    scheme: "seq_rluc",
    available: Boolean(rluc),
    availabilityNote: rluc
      ? `Detailed ${council} planning-scheme zoning is not integrated yet — the SEQ Regional Plan land use category is shown instead. Check the council's planning scheme for the statutory zone.`
      : `Neither a council zoning adapter nor the SEQ Regional Plan covers this location yet. Check ${council}'s planning scheme mapping directly.`,
  };
}
