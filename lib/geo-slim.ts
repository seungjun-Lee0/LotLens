// Shrink GeoJSON payloads before they hit the database.
//
// Some statutory overlays are enormous — the Brisbane River flood planning
// area is a ~7 MB multipolygon with thousands of parts tracing the whole
// river. Storing it verbatim costs seconds of Neon upload per report and
// again on every read. The report map only ever shows a ~300 m viewport,
// so around a centre point we can safely:
//   1. drop multipolygon parts / rings whose bbox is entirely outside a
//      generous keep-window (±0.02° ≈ 2.2 km),
//   2. round coordinates to 6 dp (~0.1 m), and
//   3. decimate any ring with more vertices than MAX_RING_VERTICES
//      (endpoints preserved so rings stay closed).
//
// Attributes and structure are untouched — risk classification happens
// before slimming, this only affects what gets drawn.

const MAX_RING_VERTICES = 1200;
/** Half-width of the keep-window around the property (degrees). */
const KEEP_RADIUS_DEG = 0.02;

type Position = number[];
type Bbox = { xMin: number; yMin: number; xMax: number; yMax: number };

function round(p: Position): Position {
  return p.map((n) => Math.round(n * 1e6) / 1e6);
}

function slimRing(ring: Position[]): Position[] {
  if (ring.length <= MAX_RING_VERTICES) return ring.map(round);
  const step = Math.ceil(ring.length / MAX_RING_VERTICES);
  const out: Position[] = [];
  for (let i = 0; i < ring.length; i += step) out.push(round(ring[i]));
  // Preserve the closing point so polygon rings stay valid.
  const last = round(ring[ring.length - 1]);
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function ringBboxIntersects(ring: Position[], view: Bbox): boolean {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of ring) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return xMin <= view.xMax && xMax >= view.xMin && yMin <= view.yMax && yMax >= view.yMin;
}

type GeometryLike = { type?: unknown; coordinates?: unknown };

/** Geometry-aware slimming; returns null when nothing survives the window. */
function slimGeometry(geom: GeometryLike, view: Bbox | null): unknown {
  const t = geom.type;
  const c = geom.coordinates;
  if (t === "Polygon" && Array.isArray(c)) {
    const rings = c as Position[][];
    if (view && rings[0] && !ringBboxIntersects(rings[0], view)) return null;
    return { ...geom, coordinates: rings.map(slimRing) };
  }
  if (t === "MultiPolygon" && Array.isArray(c)) {
    const polys = (c as Position[][][]).filter(
      (poly) => !view || (poly[0] && ringBboxIntersects(poly[0], view)),
    );
    if (polys.length === 0) return null;
    return {
      ...geom,
      coordinates: polys.map((poly) => poly.map(slimRing)),
    };
  }
  if (t === "LineString" && Array.isArray(c)) {
    const line = c as Position[];
    if (view && !ringBboxIntersects(line, view)) return null;
    return { ...geom, coordinates: slimRing(line) };
  }
  if (t === "MultiLineString" && Array.isArray(c)) {
    const lines = (c as Position[][]).filter(
      (l) => !view || ringBboxIntersects(l, view),
    );
    if (lines.length === 0) return null;
    return { ...geom, coordinates: lines.map(slimRing) };
  }
  return geom;
}

/**
 * Recursively walk any JSON value; FeatureCollections get their features'
 * geometries slimmed to the keep-window (features left with no geometry
 * are dropped), any other structure passes through with nested collections
 * handled the same way.
 */
export function slimGeoJson(
  value: unknown,
  centre?: { lat: number; lng: number },
): unknown {
  const view: Bbox | null = centre
    ? {
        xMin: centre.lng - KEEP_RADIUS_DEG,
        xMax: centre.lng + KEEP_RADIUS_DEG,
        yMin: centre.lat - KEEP_RADIUS_DEG,
        yMax: centre.lat + KEEP_RADIUS_DEG,
      }
    : null;

  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
        const features = (obj.features as Array<Record<string, unknown>>)
          .map((f) => {
            if (!f || typeof f !== "object" || !f.geometry) return f;
            const g = slimGeometry(f.geometry as GeometryLike, view);
            return g === null ? null : { ...f, geometry: g };
          })
          .filter((f): f is Record<string, unknown> => f !== null);
        return { ...obj, features };
      }
      if (
        typeof obj.type === "string" &&
        "coordinates" in obj &&
        Array.isArray(obj.coordinates)
      ) {
        return slimGeometry(obj as GeometryLike, view) ?? obj;
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(obj)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}
