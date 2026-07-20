// Property parcel lookup — the real cadastre lot polygon + metadata.
//
// Source: Queensland DCDB (Land Parcel Property Framework) on QSpatial —
// statewide, nightly-updated, so any Queensland address resolves, not just
// Brisbane. Layer 4 = all cadastral parcels.
//
// Field highlights (lowercase in this service):
//   lot, plan, lotplan (e.g. "1RP84598")
//   lot_area (m²), tenure ("Freehold" etc.), parcel_typ
//   locality (suburb), shire_name (LGA, e.g. "Gold Coast City") — this is
//   how the pipeline decides which council overlay adapter applies.

import type { FeatureCollection, Geometry } from "geojson";
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
 * shared fence line as intersecting — so querying with the exact lot
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
      outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name",
      returnGeometry: true,
      // Tiny simplification — the lot is already a 5–8 vertex rectangle.
      maxAllowableOffset: 0.00001,
    });
    // Road/rail/water reserves come back with null lotplan — prefer a real
    // lot if the point straddles boundaries.
    const direct =
      fc.features.find(hasLotPlan) ?? fc.features.find((x) => !!x.geometry);
    if (direct && hasLotPlan(direct)) return toParcelInfo(direct);

    // The pin missed the cadastre (interpolated geocodes drop onto the
    // road; large sites can pin on internal reserves). Search ~40 m out
    // and take the REAL lot nearest to the pin — without this the whole
    // report runs point-only: no lot polygon, no lot-clipped overlay
    // checks (heritage/easements silently under-report).
    const near = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name",
      returnGeometry: true,
      bufferDegrees: 0.00036, // ~40 m
      maxAllowableOffset: 0.00001,
    });
    const lots = near.features.filter(hasLotPlan);
    if (lots.length > 0) {
      lots.sort(
        (a, b) => parcelDistanceSq(a, lat, lng) - parcelDistanceSq(b, lat, lng),
      );
      console.warn(
        `[property] pin missed cadastre at ${lat.toFixed(6)},${lng.toFixed(6)} — using nearest lot ${
          (lots[0].properties as { lotplan?: string })?.lotplan
        }`,
      );
      return toParcelInfo(lots[0]);
    }

    // Nothing real nearby — keep whatever the point hit (reserve) or EMPTY.
    return direct?.geometry ? toParcelInfo(direct) : EMPTY;
  } catch (err) {
    console.error("[property] parcel lookup failed:", err);
    return EMPTY;
  }
}

/**
 * Fetch every cadastre lot polygon within ~155 m of the point so a map can
 * draw the individual lot boundary lines (Develo-style).
 *
 * Zoning polygons are dissolved by zone-precinct — a single polygon spans a
 * whole block of lots — so on their own they read as one flat colour wash.
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
      outFields: "lotplan",
      returnGeometry: true,
      bufferDegrees: 0.0014, // ~155 m — comfortably covers the ~115 m viewport
      maxAllowableOffset: 0.00001,
    });
    const features = fc.features.filter(
      (f): f is typeof f & { geometry: Geometry } => f.geometry != null,
    );
    if (features.length === 0) return null;
    return { type: "FeatureCollection", features };
  } catch (err) {
    console.error("[property] parcel-lines lookup failed:", err);
    return null;
  }
}
