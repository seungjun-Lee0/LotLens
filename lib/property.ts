// Property parcel lookup: the real cadastre lot polygon + metadata.
//
// Source: Queensland DCDB (Land Parcel Property Framework) on QSpatial -
// statewide, nightly-updated, so any Queensland address resolves, not just
// Brisbane. Layer 4 = all cadastral parcels.
//
// Field highlights (lowercase in this service):
//   lot, plan, lotplan (e.g. "1RP84598")
//   lot_area (m²), tenure ("Freehold" etc.), parcel_typ
//   locality (suburb), shire_name (LGA, e.g. "Gold Coast City"): this is
//   how the pipeline decides which council overlay adapter applies.

import type { FeatureCollection, Geometry } from "geojson";
import polygonClipping from "polygon-clipping";
import { queryArcGIS } from "@/lib/arcgis";

const PARCEL_LAYER =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query";

export type ParcelInfo = {
  polygon: Geometry | null;
  lotPlan: string | null; // "1RP84598"
  lotNumber: string | null;
  planNumber: string | null;
  areaM2: number | null; // freehold land area
  tenure: string | null; // "Freehold" etc.
  suburb: string | null; // DCDB locality
  /** Local government area, e.g. "Brisbane City", "Noosa Shire". */
  lga: string | null;
  /** Kept for backward compatibility with older BCC-sourced rows. */
  houseNumber: string | null;
  street: string | null;
  postcode: string | null;
  ward: string | null;
};

const EMPTY: ParcelInfo = {
  polygon: null,
  lotPlan: null,
  lotNumber: null,
  planNumber: null,
  areaM2: null,
  tenure: null,
  suburb: null,
  lga: null,
  houseNumber: null,
  street: null,
  postcode: null,
  ward: null,
};

/** The "no cadastre hit" parcel. Exported so the report loader can stand in
 * for a cached geo blob whose parcel is absent without a live lookup. */
export const EMPTY_PARCEL: ParcelInfo = EMPTY;

/**
 * The classification lot (the 0.3%-inset copy from insetParcelPolygon)
 * pushed `metres` past its TRUE boundary. For "adjoining" checks: an
 * easement parcel or a sewer main that runs along the fence line sits
 * outside the inset lot, and the cadastre polygon was generalised to ~1 m
 * on fetch, so a growth measured in centimetres would not reliably reach
 * it. The nearest such feature that is NOT on a shared boundary sits a
 * road width (15 m+) away, so a metre or two cannot over-reach.
 */
export function growInsetLot(lot: Geometry, metres: number): Geometry {
  const rings: number[][][] =
    lot.type === "Polygon"
      ? (lot.coordinates as number[][][])
      : lot.type === "MultiPolygon"
        ? (lot.coordinates as number[][][][]).flat()
        : [];
  const verts = rings.flat();
  if (verts.length === 0) return lot;
  const cx = verts.reduce((s, [x]) => s + x, 0) / verts.length;
  const cy = verts.reduce((s, [, y]) => s + y, 0) / verts.length;
  const kx = Math.cos((cy * Math.PI) / 180) * 111_320;
  const ky = 111_320;
  // Nearest vertex to the centroid bounds how far the boundary sits from
  // it: scaling by 1 + m / that distance moves every edge out by ≥ m.
  const minR = Math.min(
    ...verts.map(([x, y]) => Math.hypot((x - cx) * kx, (y - cy) * ky)),
  );
  if (!Number.isFinite(minR) || minR <= 0) return lot;
  // Undo the classification inset first, then grow.
  return insetParcelPolygon(lot, (1 / 0.997) * (1 + metres / minR));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Shrink a lot polygon slightly toward its centroid (default 0.3%).
 *
 * Cadastre-snapped overlay layers (easement parcels, zoning) share exact
 * boundary vertices with the lot, and esriSpatialRelIntersects counts a
 * shared fence line as intersecting: so querying with the exact lot
 * polygon would flag the NEIGHBOUR'S easement/zone. A ~10-30 cm inset
 * removes boundary touches without meaningfully changing what's "on" the
 * lot. Centroid scaling isn't a true buffer for concave lots, but at 0.3%
 * the distortion is centimetres.
 */
export function insetParcelPolygon(g: Geometry, factor = 0.997): Geometry {
  const scaleRing = (ring: number[][], cx: number, cy: number) =>
    ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
  const ringCentroid = (ring: number[][]): [number, number] => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  };
  if (g.type === "Polygon") {
    const [cx, cy] = ringCentroid(g.coordinates[0] as number[][]);
    return {
      type: "Polygon",
      coordinates: (g.coordinates as number[][][]).map((r) => scaleRing(r, cx, cy)),
    };
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (g.coordinates as number[][][][]).map((poly) => {
        const [cx, cy] = ringCentroid(poly[0] as number[][]);
        return poly.map((r) => scaleRing(r, cx, cy));
      }),
    };
  }
  return g;
}

type ParcelFeature = {
  geometry?: Geometry | null;
  properties?: Record<string, unknown> | null;
};

/** Squared degree-space distance (lng scaled by cos lat) from the pin to
 * the nearest vertex of the feature's rings. Coarse but plenty to rank
 * "which neighbouring lot is closest to the pin". */
function parcelDistanceSq(f: ParcelFeature, lat: number, lng: number): number {
  const g = f.geometry;
  if (!g) return Infinity;
  const kx = Math.cos((lat * Math.PI) / 180);
  const polys: number[][][][] =
    g.type === "Polygon" ? [g.coordinates as number[][][]] :
    g.type === "MultiPolygon" ? (g.coordinates as number[][][][]) : [];
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        const dx = (x - lng) * kx;
        const dy = y - lat;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
  }
  return best;
}

const hasLotPlan = (f: ParcelFeature) =>
  !!f.geometry && !!(f.properties as { lotplan?: unknown } | null)?.lotplan;

/** DCDB lot numbers that mean "common property of a community titles
 * scheme" rather than an individual lot. */
const COMMON_PROPERTY_LOTS = new Set(["0", "00000"]);

/**
 * Which of several parcels containing the pin IS the property. A point
 * in a unit block or a mixed-use site lands on stacked parcels: the base
 * ground lot, volumetric/strata slices above it, and easement parcels
 * drawn over it. Higher wins:
 *   - an easement parcel is never the property (it is somebody's right
 *     over the property);
 *   - the ground ("Base") parcel over volumetric/strata slices;
 *   - a parcel with a registered area over the zero-area fragments the
 *     DCDB uses for common-property pieces;
 *   - then the larger area.
 * Before this the first feature ArcGIS happened to return won, which put
 * 1019 Ann St on its 612 m² drainage easement instead of the 6,632 m²
 * site.
 */
function parcelRank(f: ParcelFeature): number {
  if (!hasLotPlan(f)) return -1;
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const parcelType = String(p.parcel_typ ?? "");
  const cover = String(p.cover_typ ?? "");
  if (/easement/i.test(parcelType) || /easement/i.test(cover)) return 0;
  let r = 1;
  if (cover === "Base") r += 4;
  if ((num(p.lot_area) ?? 0) > 0) r += 2;
  return r;
}

function pickParcel(features: ParcelFeature[]): ParcelFeature | undefined {
  return [...features]
    .filter((f) => parcelRank(f) > 0)
    .sort(
      (a, b) =>
        parcelRank(b) - parcelRank(a) ||
        (num((b.properties ?? {}).lot_area) ?? 0) - (num((a.properties ?? {}).lot_area) ?? 0),
    )[0];
}

/**
 * A pin on common property (lot 0 / 00000) is a pin on a unit block or a
 * strata site: the "property" a buyer means is the whole scheme's ground
 * footprint, which the DCDB stores as several common-property fragments
 * (50 Macquarie St Teneriffe: two 00000SP125099 slivers and two 0SP125099
 * pieces, 713 m² registered between them). Dissolve every base parcel of
 * the plan into one polygon and carry the registered area.
 */
async function expandCommunityTitle(
  chosen: ParcelFeature,
  lat: number,
  lng: number,
): Promise<ParcelFeature> {
  const p = (chosen.properties ?? {}) as Record<string, unknown>;
  const plan = str(p.plan);
  const lot = str(p.lot);
  if (!plan || !lot || !COMMON_PROPERTY_LOTS.has(lot)) return chosen;
  const siblings = await queryArcGIS(PARCEL_LAYER, {
    geometry: { x: lng, y: lat, spatialReference: 4326 },
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name,cover_typ",
    returnGeometry: true,
    bufferDegrees: 0.005, // ~500 m: a scheme's footprint, never a suburb
    maxAllowableOffset: 0.00001,
    where: `plan = '${plan.replace(/'/g, "''")}' AND lot IN ('0','00000') AND cover_typ = 'Base'`,
  });
  const parts = siblings.features.filter((f) => f.geometry);
  if (parts.length < 2) return chosen;
  const polys = parts.flatMap((f) => {
    const g = f.geometry!;
    if (g.type === "Polygon") return [g.coordinates as [number, number][][]];
    if (g.type === "MultiPolygon") return g.coordinates as [number, number][][][];
    return [];
  });
  let union: [number, number][][][];
  try {
    // One MultiPolygon holding every fragment: union dissolves shared edges.
    union = polygonClipping.union(polys as [number, number][][][]);
  } catch {
    return chosen;
  }
  if (union.length === 0) return chosen;
  const area = Math.max(
    ...parts.map((f) => num((f.properties ?? {}).lot_area) ?? 0),
    num(p.lot_area) ?? 0,
  );
  return {
    geometry:
      union.length === 1
        ? { type: "Polygon", coordinates: union[0] }
        : { type: "MultiPolygon", coordinates: union },
    properties: {
      ...p,
      lot: "0",
      lotplan: `0${plan}`,
      lot_area: area > 0 ? area : p.lot_area,
    },
  };
}

function toParcelInfo(f: ParcelFeature): ParcelInfo {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return {
    ...EMPTY,
    polygon: f.geometry ?? null,
    lotPlan: str(p.lotplan),
    lotNumber: str(p.lot),
    planNumber: str(p.plan),
    areaM2: num(p.lot_area),
    tenure: str(p.tenure),
    suburb: str(p.locality),
    lga: str(p.shire_name),
  };
}

export async function fetchPropertyParcel(
  lat: number,
  lng: number,
): Promise<ParcelInfo> {
  try {
    const fc = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name,cover_typ",
      returnGeometry: true,
      // Tiny simplification: the lot is already a 5–8 vertex rectangle.
      maxAllowableOffset: 0.00001,
    });
    // Road/rail/water reserves come back with null lotplan: prefer a real
    // lot if the point straddles boundaries, and among real lots the one
    // parcelRank says is the property.
    const direct = pickParcel(fc.features) ?? fc.features.find((x) => !!x.geometry);
    if (direct && hasLotPlan(direct)) {
      return toParcelInfo(await expandCommunityTitle(direct, lat, lng));
    }

    // The pin missed the cadastre (interpolated geocodes drop onto the
    // road; large sites can pin on internal reserves). Search ~40 m out
    // and take the REAL lot nearest to the pin: without this the whole
    // report runs point-only: no lot polygon, no lot-clipped overlay
    // checks (heritage/easements silently under-report).
    const near = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name,cover_typ",
      returnGeometry: true,
      bufferDegrees: 0.00036, // ~40 m
      maxAllowableOffset: 0.00001,
    });
    // Easement parcels are excluded here too: the nearest polygon to a
    // kerb-side pin is often the drainage easement along the frontage.
    const lots = near.features.filter((f) => parcelRank(f) > 0);
    if (lots.length > 0) {
      lots.sort(
        (a, b) => parcelDistanceSq(a, lat, lng) - parcelDistanceSq(b, lat, lng),
      );
      console.warn(
        `[property] pin missed cadastre at ${lat.toFixed(6)},${lng.toFixed(6)}: using nearest lot ${
          (lots[0].properties as { lotplan?: string })?.lotplan
        }`,
      );
      return toParcelInfo(await expandCommunityTitle(lots[0], lat, lng));
    }

    // Nothing real nearby: keep whatever the point hit (reserve) or EMPTY.
    return direct?.geometry ? toParcelInfo(direct) : EMPTY;
  } catch (err) {
    // Expected, handled degradation (server flaked after retries): the
    // report just loses the cadastre lot outline. warn, not error, so a
    // transient upstream doesn't throw a red dev overlay at the user.
    console.warn("[property] parcel lookup unavailable, continuing without it:", (err as Error).message);
    return EMPTY;
  }
}

/**
 * Fetch every cadastre lot polygon within ~155 m of the point so a map can
 * draw the individual lot boundary lines (Develo-style).
 *
 * Zoning polygons are dissolved by zone-precinct: a single polygon spans a
 * whole block of lots: so on their own they read as one flat colour wash.
 * Overlaying the real per-lot cadastre outlines restores the "each lot is
 * distinct" look of the reference planning map. Geometry only; we don't
 * need attributes for boundary lines.
 */
export async function fetchParcelLinesNear(
  lat: number,
  lng: number,
): Promise<FeatureCollection<Geometry> | null> {
  try {
    const fc = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      // No attributes: these are drawn as plain boundary lines, so we keep
      // geometry only. ~2 m simplification is invisible at the map's zoom
      // but roughly halves the vertex count on curved boundaries.
      outFields: "",
      returnGeometry: true,
      bufferDegrees: 0.0014, // ~155 m: comfortably covers the ~115 m viewport
      maxAllowableOffset: 0.00002,
    });
    // Geometry-only Features: the boundary lines never read a property, and
    // dropping them trims the payload sent to the browser and stored in geo.
    const features = fc.features
      .filter((f): f is typeof f & { geometry: Geometry } => f.geometry != null)
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {},
      }));
    if (features.length === 0) return null;
    return { type: "FeatureCollection", features };
  } catch (err) {
    console.warn("[property] parcel-lines unavailable, continuing without them:", (err as Error).message);
    return null;
  }
}
