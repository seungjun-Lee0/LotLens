// Shrink GeoJSON payloads before they hit the database.
//
// Some statutory overlays are enormous: the Brisbane River flood planning
// area is a ~7 MB multipolygon with thousands of parts tracing the whole
// river. Storing it verbatim costs seconds of Neon upload per report and
// again on every read. The report map frames a ~230 m-wide viewport, so
// around a centre point we can safely:
//   1. CLIP every polygon to a keep-window (±0.006° ≈ 660 m half-width:
//      the map frame plus room to drag it), dropping parts entirely
//      outside it. A true boolean clip (polygon-clipping), not a bbox
//      filter: a river-length part whose bbox touches the window used to
//      survive whole, which is how one address stored 6 MB of polygon
//      the map never drew;
//   2. drop line parts whose bbox misses the window;
//   3. round coordinates to 6 dp (~0.1 m), and
//   4. decimate any ring with more vertices than MAX_RING_VERTICES
//      (endpoints preserved so rings stay closed).
//
// Points pass through untouched (transport stops sit up to 2 km out and
// the map frames them). Attributes and structure are untouched: risk
// classification happens before slimming, this only affects what gets
// drawn.

import polygonClipping from "polygon-clipping";

const MAX_RING_VERTICES = 1200;
/** Half-width of the keep-window around the property (degrees). */
const KEEP_RADIUS_DEG = 0.006;

type Position = number[];
type Bbox = { xMin: number; yMin: number; xMax: number; yMax: number };
type Ring = [number, number][];

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

function ringBbox(ring: Position[]): Bbox {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of ring) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { xMin, yMin, xMax, yMax };
}

function bboxIntersects(a: Bbox, view: Bbox): boolean {
  return a.xMin <= view.xMax && a.xMax >= view.xMin && a.yMin <= view.yMax && a.yMax >= view.yMin;
}

function bboxWithin(a: Bbox, view: Bbox): boolean {
  return a.xMin >= view.xMin && a.xMax <= view.xMax && a.yMin >= view.yMin && a.yMax <= view.yMax;
}

function ringArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(s) / 2;
}

/**
 * Clip one polygon (outer ring + holes) to the window. Three cases, cheap
 * to expensive: bbox misses → gone; bbox inside → untouched; straddles →
 * boolean intersection. Rings are ordered largest-first before the clip
 * because ArcGIS GeoJSON does not reliably put the exterior first and the
 * library takes ring order literally (a hole listed first would make the
 * whole part a hole).
 */
function clipPolygon(poly: Position[][], view: Bbox): Position[][][] {
  if (poly.length === 0 || !poly[0]) return [];
  const outerBox = ringBbox(poly[0]);
  if (!bboxIntersects(outerBox, view)) return [];
  if (bboxWithin(outerBox, view)) return [poly];
  const ordered = [...poly].sort((a, b) => ringArea(b) - ringArea(a)) as Ring[];
  const window: Ring[] = [[
    [view.xMin, view.yMin], [view.xMax, view.yMin], [view.xMax, view.yMax], [view.xMin, view.yMax], [view.xMin, view.yMin],
  ]];
  try {
    return polygonClipping.intersection([ordered], [window]) as Position[][][];
  } catch {
    // Degenerate input (self-touching rings the library rejects): keep
    // the bbox-filtered original rather than lose the feature.
    return [poly];
  }
}

type GeometryLike = { type?: unknown; coordinates?: unknown };

/** Geometry-aware slimming; returns null when nothing survives the window. */
function slimGeometry(geom: GeometryLike, view: Bbox | null): unknown {
  const t = geom.type;
  const c = geom.coordinates;
  if (t === "Polygon" && Array.isArray(c)) {
    const rings = c as Position[][];
    if (!view) return { ...geom, coordinates: rings.map(slimRing) };
    const parts = clipPolygon(rings, view);
    if (parts.length === 0) return null;
    if (parts.length === 1) return { type: "Polygon", coordinates: parts[0].map(slimRing) };
    return { type: "MultiPolygon", coordinates: parts.map((p) => p.map(slimRing)) };
  }
  if (t === "MultiPolygon" && Array.isArray(c)) {
    const polys = c as Position[][][];
    const parts = view ? polys.flatMap((poly) => clipPolygon(poly, view)) : polys;
    if (parts.length === 0) return null;
    return { ...geom, coordinates: parts.map((poly) => poly.map(slimRing)) };
  }
  if (t === "LineString" && Array.isArray(c)) {
    const line = c as Position[];
    if (view && !bboxIntersects(ringBbox(line), view)) return null;
    return { ...geom, coordinates: slimRing(line) };
  }
  if (t === "MultiLineString" && Array.isArray(c)) {
    const lines = (c as Position[][]).filter(
      (l) => !view || bboxIntersects(ringBbox(l), view),
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
