// Zoning module.
//
// Brisbane LGA: BCC City Plan 2014 Zoning (detailed zone + precinct).
// Rest of SEQ: ShapingSEQ 2023 regional land use category (QSpatial
//   StatePlanning layer 140, field `rluc2023`: Urban Footprint / Rural
//   Living Area / Regional Landscape and Rural Production Area). There is
//   NO public statewide merged council-zoning service: each LGA publishes
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
// Every Brisbane parcel sits inside exactly one zone polygon: so the
// query effectively never returns 0 features for a valid Brisbane LGA
// point. We surface the 'informational' riskLevel when there *is* a zone
// (it's a fact about the land, not a risk axis: a severity here would fire
// on every report) and 'none' as a "couldn't resolve" fallback.
//
// Verified: CBD → PC1; Rocklea Markets → OS Open space; Chermside → MU2
// Mixed use (Centre frame).

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import { councilOf, ZONING_ADAPTERS, type ZoningAdapter } from "@/lib/councils";
import polygonClipping from "polygon-clipping";

import { insetParcelPolygon } from "@/lib/property";
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
  /** Other zones the lot ALSO sits in, by precinct/zone label. Large sites
   * (a shopping centre, a PDA edge) straddle zone boundaries; the point
   * query alone reported one zone and hid the rest. Empty for the usual
   * single-zone lot. */
  otherZones: string[];
  hasConsideration: boolean;
  sources: ZoningSource[];
  /** Point-query GeoJSON: drives classification. */
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

/** ArcGIS "intersects" counts a shared boundary, so the lot-wide zone query
 * runs on a copy shrunk 2% toward its centroid, and every returned polygon
 * is then measured against the lot: a zone counts only when it covers at
 * least ZONE_MIN_SHARE of the lot's area. That drops the 0.4% sliver of
 * open space a cadastre edge happens to clip, and keeps the Centre frame
 * strip that genuinely covers a tenth of a shopping centre. */
const ZONE_INSET = 0.98;
const ZONE_MIN_SHARE = 0.02;

type Ring = [number, number][];
type MultiPoly = Ring[][];

function toMultiPoly(g: Geometry | null | undefined): MultiPoly | null {
  if (!g) return null;
  if (g.type === "Polygon") return [g.coordinates as Ring[]];
  if (g.type === "MultiPolygon") return g.coordinates as MultiPoly;
  return null;
}

/** Planar area in square degrees: a ratio of two such areas is what we
 * need, so no projection is required. Holes subtract. */
function areaOf(m: MultiPoly): number {
  let total = 0;
  for (const poly of m) {
    poly.forEach((ring, i) => {
      let a = 0;
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        a += (ring[j][0] + ring[k][0]) * (ring[j][1] - ring[k][1]);
      }
      total += (i === 0 ? 1 : -1) * Math.abs(a) / 2;
    });
  }
  return total;
}

/**
 * Distinct zone labels for every polygon that covers a real share of the
 * lot, minus the primary. The lot handed to the fetchers is the 0.3%-inset
 * classification copy (lib/property); see ZONE_INSET above.
 */
function otherZoneLabels(
  features: Feature<Geometry | null, GeoJsonProperties>[],
  labelOf: (props: Record<string, unknown>) => string | null,
  primary: string | null,
  lot: Geometry | null | undefined,
): string[] {
  const lotM = toMultiPoly(lot);
  const lotArea = lotM ? areaOf(lotM) : 0;
  const share = new Map<string, number>();
  for (const f of features) {
    const l = labelOf(attrs(f));
    if (!l || l === primary) continue;
    const zm = toMultiPoly(f.geometry);
    let ratio = 1; // no geometry to measure: trust the intersect
    if (lotM && zm && lotArea > 0) {
      try {
        ratio = areaOf(polygonClipping.intersection(lotM, zm) as MultiPoly) / lotArea;
      } catch {
        ratio = 0; // degenerate ring the library rejects: don't invent a zone
      }
    }
    share.set(l, (share.get(l) ?? 0) + ratio);
  }
  return [...share.entries()]
    .filter(([, r]) => r >= ZONE_MIN_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

export async function fetchZoningData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<ZoningResult> {
  const isBrisbane = region?.isBrisbane ?? true;
  if (!isBrisbane) {
    const adapter = ZONING_ADAPTERS[councilOf(region) ?? "brisbane"];
    if (adapter) {
      const result = await fetchCouncilZoning(lat, lng, adapter, lot);
      // Council layers occasionally miss (unzoned strategic land, layer
      // gaps): fall back to the regional-plan category rather than
      // reporting nothing.
      if (result.hasConsideration) return result;
    }
    return fetchSeqRegionalZoning(lat, lng, region, lot);
  }
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "ZONE_CODE,ZONE_PREC_DESC,LVL1_ZONE,LVL2_ZONE";
  const [fc, onLot, ctx] = await Promise.all([
    queryArcGIS(ZONING, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      // Zoning polygons follow cadastre lot boundaries 1:1 in BCC's data -
      // so the point-query polygon IS the property's lot outline. We use
      // this as the Develo-style yellow "selected property" highlight.
      returnGeometry: true,
      maxAllowableOffset: 0.00002, // ~2m: sharp parcel edges
    }),
    // Every zone polygon the lot itself touches (see otherZoneLabels).
    lot
      ? queryArcGIS(ZONING, {
          geometry: point,
          geometryType: "esriGeometryPoint",
          inSR: 4326,
          outFields: fields,
          returnGeometry: true,
          maxAllowableOffset: 0.00005,
          lotPolygon: insetParcelPolygon(lot, ZONE_INSET),
        }).catch(() => null)
      : Promise.resolve(null),
    queryArcGIS(ZONING, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: contextBuffer(lot, lat, lng),
      // Zone polygons follow cadastre lots: smaller than flood/heritage
      // polygons and want sharper boundaries. ~3 m simplification.
      maxAllowableOffset: 0.00003,
      quantize: true,
    }),
  ]);
  const a = attrs(fc.features[0]);
  const zoneCode = str(a.ZONE_CODE);
  const zonePrecinct = str(a.ZONE_PREC_DESC);
  const lvl1Zone = str(a.LVL1_ZONE);
  const lvl2Zone = str(a.LVL2_ZONE);
  const resolved = Boolean(zoneCode ?? lvl1Zone);
  const otherZones = onLot
    ? otherZoneLabels(onLot.features, (pr) => str(pr.ZONE_PREC_DESC) ?? str(pr.LVL2_ZONE), zonePrecinct ?? lvl2Zone, lot)
    : [];

  return {
    riskLevel: resolved ? "informational" : "none",
    zoneCode,
    zonePrecinct,
    lvl1Zone,
    lvl2Zone,
    otherZones,
    hasConsideration: resolved,
    sources: [
      {
        name: "BCC City Plan 2014: Zoning",
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
// Moreton Bay, Sunshine Coast, Redland: see lib/councils.ts).
async function fetchCouncilZoning(
  lat: number,
  lng: number,
  adapter: ZoningAdapter,
  lot?: Geometry | null,
): Promise<ZoningResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const [fc, onLot, ctx, precinct] = await Promise.all([
    queryArcGIS(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: adapter.outFields,
      returnGeometry: true,
      maxAllowableOffset: 0.00002,
    }),
    lot
      ? queryArcGIS(adapter.url, {
          geometry: point,
          geometryType: "esriGeometryPoint",
          inSR: 4326,
          outFields: adapter.outFields,
          returnGeometry: true,
          maxAllowableOffset: 0.00005,
          lotPolygon: insetParcelPolygon(lot, ZONE_INSET),
        }).catch(() => null)
      : Promise.resolve(null),
    queryArcGIS(adapter.url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: adapter.outFields,
      returnGeometry: true,
      bufferDegrees: contextBuffer(lot, lat, lng),
      maxAllowableOffset: 0.00003,
      quantize: true,
    }),
    // Councils that split zone and precinct across two layers: the
    // precinct only ever refines the zone, so a miss here is normal and
    // must not blank the zone itself.
    adapter.precinctUrl
      ? queryArcGIS(adapter.precinctUrl, {
          geometry: point,
          geometryType: "esriGeometryPoint",
          inSR: 4326,
          outFields: adapter.precinctOutFields ?? "*",
          returnGeometry: false,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const parsed = adapter.parse({
    ...attrs(fc.features[0]),
    ...(precinct ? attrs(precinct.features[0]) : {}),
  });
  const resolved = Boolean(parsed.zonePrecinct ?? parsed.lvl1Zone ?? parsed.zoneCode);
  const zoneOnly = (pr: Record<string, unknown>) => {
    const z = adapter.parse(pr);
    return z.lvl1Zone ?? z.zonePrecinct ?? z.lvl2Zone;
  };
  const otherZones = onLot
    ? otherZoneLabels(onLot.features, zoneOnly, zoneOnly(attrs(fc.features[0])), lot)
    : [];

  return {
    riskLevel: resolved ? "informational" : "none",
    ...parsed,
    otherZones,
    hasConsideration: resolved,
    sources: [{ name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url }],
    raw: fc,
    context: ctx,
    scheme: "council",
    available: true,
  };
}

// SEQ regional land use category: the statewide baseline outside the
// council adapters. One dissolved polygon per category, so no lot-scale
// context map value; we still fetch a context envelope for the overlay wash.
async function fetchSeqRegionalZoning(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
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
      bufferDegrees: contextBuffer(lot, lat, lng),
      maxAllowableOffset: 0.00005,
    }),
  ]);
  const a = attrs(fc.features[0]);
  const rluc = str(a.rluc2023);
  const council = region ? councilDisplayName(region) : "the local council";

  return {
    riskLevel: rluc ? "informational" : "none",
    zoneCode: null,
    zonePrecinct: rluc ? `${rluc} (SEQ Regional Plan)` : null,
    lvl1Zone: rluc,
    lvl2Zone: null,
    otherZones: [],
    hasConsideration: Boolean(rluc),
    sources: [
      {
        name: "ShapingSEQ 2023: Regional land use category",
        url: SEQ_PLAN_DOC,
        layer: SEQ_RLUC,
      },
    ],
    raw: fc,
    context: ctx,
    scheme: "seq_rluc",
    available: Boolean(rluc),
    availabilityNote: rluc
      ? `The SEQ Regional Plan land use category is shown for this property. Confirm the statutory zone through ${council}'s planning scheme mapping.`
      : `A statutory zoning result is not available from the connected sources for this location. Confirm the property through ${council}'s planning scheme mapping.`,
  };
}
