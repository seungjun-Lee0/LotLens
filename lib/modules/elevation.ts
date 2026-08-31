// Elevation profile from Queensland's statewide contour service.
//
// Feeds the Steep Land module. The council landslide overlays it normally
// relies on exist in five LGAs; contours exist for the whole state, so a
// lot outside every adapter still gets the one fact a buyer actually wants
// from that page: how much the land falls across it.
//
// Endpoint: Elevation/Contours/MapServer
//   30  Contour LiDAR 1m   (best; Brisbane is 25 cm LiDAR under the hood)
//   20  Contour LiDAR 5m
//   10  Contour SRTM 10m   (coarse fallback for remote areas)
//   Fields: elevation_m, feature_type, elevation_source, elev_accuracy_m
//
// Verified live 2026-07: East Brisbane returns
// "Qld_25cm LiDAR Contours_Brisbane_2025", elev_accuracy_m 0.3.

import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from "geojson";

import { queryArcGIS } from "@/lib/arcgis";

const BASE =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/Contours/MapServer";

export const QLD_CONTOUR_DOC =
  "https://www.data.qld.gov.au/dataset/contours-queensland-series";

/**
 * Prefer the finest LiDAR layer for the map. A 5 m contour set can measure
 * the broad fall, but at a normal property-map scale it renders as only a
 * handful of disconnected lines and hides the shape of the slope. The 1 m
 * layer gives the Develo-style readable terrain the module promises.
 *
 * 5 m LiDAR remains the first fallback for gaps in the 1 m collection, with
 * 10 m SRTM as the statewide last resort.
 *
 * Whichever layer answers, its interval is reported to the reader: "flat"
 * from 5 m contours means flat to within 5 m, and the UI says so rather
 * than implying a precision the source doesn't have.
 */
const CONTOUR_LAYERS = [
  { id: 30, interval: "1 m LiDAR" },
  { id: 20, interval: "5 m LiDAR" },
  { id: 10, interval: "10 m SRTM" },
] as const;


/**
 * How wide to fetch contours, in degrees of half-width.
 *
 * The map frames the whole selected parcel, so a fixed radius quietly fails
 * on big lots: the Brisbane Markets site at Rocklea is ~1 km across and a
 * 130 m fetch left contours covering a postage stamp in the middle of the
 * frame. Follow the lot instead, with a floor so suburban blocks still get
 * surrounding relief and a ceiling so one enormous parcel can't turn this
 * into the slowest query in the report.
 */
// The FLOOR is set by the widest frame a renderer shows, not the lot: the
// web map lands at maxZoom 18 for suburban lots, which is ~700 m across on
// a desktop container. A 130 m floor left contours covering only a middle
// band of that frame, with bare corners that read as unfinished.
const MIN_HALF_DEG = 0.0035; // ~385 m — covers the web map's widest frame
const MAX_HALF_DEG = 0.007; // ~770 m — big-lot frames zoom out further

function halfWindowDeg(lot?: Geometry | null): number {
  if (!lot) return MIN_HALF_DEG;
  const rings: number[][][] =
    lot.type === "Polygon" ? (lot.coordinates as number[][][]) :
    lot.type === "MultiPolygon" ? (lot.coordinates as number[][][][]).flat() : [];
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!Number.isFinite(xMin)) return MIN_HALF_DEG;
  // 1.3x the lot's own half-extent: enough margin that the slope leading
  // onto the lot is visible, not just the ground under it.
  const half = (Math.max(xMax - xMin, yMax - yMin) / 2) * 1.3;
  return Math.min(MAX_HALF_DEG, Math.max(MIN_HALF_DEG, half));
}

/** Below this many distinct levels in frame the map reads as empty and the
 * legend's gradient has nothing to span, so it's worth paying for a finer
 * interval. Rocklea returned exactly one 5 m contour. */
const MIN_LEVELS_FOR_A_READABLE_MAP = 3;

export type ElevationProfile = {
  /** Highest contour crossing the measured area, in metres AHD. */
  highM: number;
  lowM: number;
  /**
   * highM - lowM: how much the land drops. The number buyers care about.
   *
   * null when only ONE contour level was found. That does NOT mean zero
   * fall: a single 10 m contour clipping the lot means the ground is
   * somewhere between 0 and 2 intervals of drop, and we can't say where.
   * Reporting 0 there would state "perfectly flat" on evidence that
   * doesn't support it, so callers must render null as "flat to within
   * the contour interval", not as a measurement.
   */
  fallM: number | null;
  /** Distinct contour levels the range was measured across. */
  contourLevels: number;
  /** Contour interval the numbers came from, e.g. "1 m LiDAR". */
  interval: string;
  /** Dataset name from the source, e.g. "Qld_25cm LiDAR Contours_Brisbane_2025". */
  source: string | null;
  /** "lot" when contours crossed the cadastre lot; "nearby" when the lot
   * was flat enough that no contour crossed it and we widened to ~50 m. A
   * flat lot is a real answer, so this distinction has to survive. */
  scope: "lot" | "nearby";
  /** Kept for callers that read `contours`; same set as contextContours.
   * The measurement pass fetches no geometry at all. */
  contours: unknown;
  /**
   * A wider set for the MAP. The measurement wants the lot and nothing
   * else; the map wants enough surrounding relief to read the slope, the
   * same way Develo's steep-land page shows contours across the frame.
   * Drawing only the lot-scoped set leaves a near-empty map on flat land.
   */
  contextContours: unknown;
  /** Elevation range of `contextContours`: the span the map's colour ramp
   * covers, which is what the legend's gradient bar is labelled with. The
   * property's own high/low sit somewhere inside it. */
  contextLowM: number | null;
  contextHighM: number | null;
};


/**
 * Trim contour lines to the map window.
 *
 * ArcGIS returns each matched feature's WHOLE geometry, and a contour is a
 * statewide polyline: a single 45 m line can run for kilometres. At Bardon
 * a 200 m query came back as 7 MB / 300k vertices for 47 lines, almost all
 * of it outside the frame. Server-side clipping isn't available on this
 * service (quantizationParameters made it worse, not better), so cut the
 * runs ourselves before the geometry is stored or drawn.
 *
 * Each in-window run becomes its own LineString, with one point kept either
 * side so lines still reach the frame edge instead of stopping short.
 */
function clipContoursToWindow(
  fc: FeatureCollection<Geometry | null, GeoJsonProperties>,
  lat: number,
  lng: number,
  halfDeg: number,
): FeatureCollection<Geometry | null, GeoJsonProperties> {
  const pad = halfDeg * 1.15;
  const x0 = lng - pad, x1 = lng + pad, y0 = lat - pad, y1 = lat + pad;
  const inside = (p: number[]) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;

  /** Where segment a->b crosses the window edge. Straight-line interpolation
   * is exact here: the source vertices ARE the line, so cutting between two
   * of them stays on it. */
  function crossing(a: number[], b: number[]): number[] {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clip(-dx, a[0] - x0) && clip(dx, x1 - a[0]) &&
        clip(-dy, a[1] - y0) && clip(dy, y1 - a[1])) {
      const t = inside(a) ? t1 : t0;
      return [a[0] + t * dx, a[1] + t * dy];
    }
    return inside(a) ? a : b;
  }

  const out: Feature<Geometry | null, GeoJsonProperties>[] = [];
  const emit = (run: number[][], props: GeoJsonProperties) => {
    if (run.length >= 2) {
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: run }, properties: props });
    }
  };

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const lines: number[][][] =
      g.type === "LineString" ? [g.coordinates as number[][]] :
      g.type === "MultiLineString" ? (g.coordinates as number[][][]) : [];
    for (const line of lines) {
      let run: number[][] = [];
      for (let i = 0; i < line.length; i++) {
        const cur = line[i];
        const curIn = inside(cur);
        const prev = i > 0 ? line[i - 1] : null;
        if (curIn) {
          // Entering: start the run ON the boundary, not at the previous
          // vertex. Simplification puts that vertex hundreds of metres
          // away, which drew a spike from off-frame into the middle of the
          // map: the jagged shapes that didn't look like contours.
          if (run.length === 0 && prev) run.push(crossing(prev, cur));
          run.push(cur);
        } else if (run.length > 0 && prev) {
          run.push(crossing(prev, cur));
          emit(run, f.properties);
          run = [];
        }
      }
      emit(run, f.properties);
    }
  }
  return { type: "FeatureCollection", features: out };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Resolve the elevation range over the lot.
 *
 * Returns null when no contour layer has coverage: offshore, or a genuinely
 * flat area at the coarsest interval. Never throws for "no data"; callers
 * treat null as "not measurable here", not as a failure.
 */
export async function fetchElevationProfile(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<ElevationProfile | null> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const outFields = "elevation_m,feature_type,elevation_source";
  const CONTEXT_HALF_DEG = halfWindowDeg(lot);

  // Best-so-far context, used when no layer clears the readability bar -
  // genuinely flat ground, where "one contour, and that's it" is the honest
  // answer. Only the winning layer ever pays for measurement queries.
  type Chosen = {
    layer: (typeof CONTOUR_LAYERS)[number];
    contextContours: FeatureCollection<Geometry | null, GeoJsonProperties>;
    ctxLevels: number[];
    source: string | null;
    rawContext: FeatureCollection<Geometry | null, GeoJsonProperties>;
  };
  let fallbackCtx: (Chosen & { levels: number }) | null = null;
  let chosen: Chosen | null = null;

  for (const layer of CONTOUR_LAYERS) {
    const url = `${BASE}/${layer.id}/query`;

    // Coverage is decided by the MAP window, not the lot. A flat lot has no
    // 5 m contour crossing it, so testing the lot first would fail over to
    // the slow 1 m layer on exactly the addresses that least need it: that
    // mistake cost 19 s at Graceville. The window answers "does this layer
    // have data here?", which is the actual question.
    const rawContext = await queryArcGIS(url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: true,
      // ~2.2 m. The old 0.00004 (~4.4 m) chorded the smooth LiDAR curves
      // into visible zigzags — contours are the one layer where the line
      // SHAPE is the content. The renderer's Chaikin smoothing (see
      // overlays.ts) rounds the remaining chords, so 2.2 m reads as a
      // clean curve while keeping the payload of the now much wider
      // window in check. Server timing is index-dominated, so tolerance
      // costs transfer size only (clipContoursToWindow + slimGeoJson
      // still bound what we store).
      maxAllowableOffset: 0.00002,
      bufferDegrees: CONTEXT_HALF_DEG,
    }).catch(() => null);
    if (!rawContext || rawContext.features.length === 0) continue;

    const contextContours = clipContoursToWindow(rawContext, lat, lng, CONTEXT_HALF_DEG);
    const ctxLevels: number[] = [];
    let source: string | null = null;
    for (const f of rawContext.features) {
      const a = (f.properties ?? {}) as Record<string, unknown>;
      const e = num(a.elevation_m);
      if (e !== null) ctxLevels.push(e);
      if (!source && typeof a.elevation_source === "string") source = a.elevation_source;
    }
    const distinctInFrame = new Set(ctxLevels).size;

    // Decide on the layer BEFORE measuring. Running the lot and nearby
    // measurement passes for a layer we're about to discard doubled the
    // cost on flat suburban lots: 20 s at Graceville, most of it wasted.
    const finerLayerExists = layer !== CONTOUR_LAYERS[CONTOUR_LAYERS.length - 1];
    if (distinctInFrame < MIN_LEVELS_FOR_A_READABLE_MAP && finerLayerExists) {
      if (!fallbackCtx || distinctInFrame > fallbackCtx.levels) {
        fallbackCtx = { layer, contextContours, ctxLevels, source, rawContext, levels: distinctInFrame };
      }
      continue;
    }

    chosen = { layer, contextContours, ctxLevels, source, rawContext };
    break;
  }

  // No layer cleared the bar, but a thin one may still be the truth on flat
  // ground. Fall back to whichever showed the most levels.
  if (!chosen && fallbackCtx) {
    chosen = { ...fallbackCtx, rawContext: fallbackCtx.rawContext };
  }
  if (!chosen) return null;

  {
    const { layer, contextContours, ctxLevels, source, rawContext } = chosen;
    // Measured from the contours already in hand rather than re-querying.
    let levels = levelsOverLot(rawContext, lot);
    let scope: "lot" | "nearby" = "lot";
    if (levels.size === 0) {
      levels = levelsNearPoint(rawContext, lat, lng, 0.00045);
      scope = "nearby";
    }

    // Still nothing within ~50 m: the ground really is flat at this
    // interval. Take the nearest mapped contour as the representative
    // elevation rather than reporting no answer at all.
    if (levels.size === 0) {
      const nearest = nearestContourElevation(rawContext, lat, lng);
      if (nearest === null) return null;
      levels = new Set([nearest]);
      scope = "nearby";
    }

    const values = [...levels];
    const highM = Math.max(...values);
    const lowM = Math.min(...values);
    const profile: ElevationProfile = {
      highM,
      lowM,
      fallM: levels.size > 1 ? Math.round((highM - lowM) * 10) / 10 : null,
      contourLevels: levels.size,
      interval: layer.interval,
      source,
      scope,
      contours: contextContours,
      contextContours,
      contextLowM: ctxLevels.length ? Math.min(...ctxLevels) : null,
      contextHighM: ctxLevels.length ? Math.max(...ctxLevels) : null,
    };
    return profile;
  }
}


/** Rings of a Polygon / MultiPolygon, flattened. */
function lotRings(lot?: Geometry | null): number[][][] {
  if (!lot) return [];
  return lot.type === "Polygon" ? (lot.coordinates as number[][][])
    : lot.type === "MultiPolygon" ? (lot.coordinates as number[][][][]).flat()
    : [];
}

function pointInRings(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segmentsCross(
  a: number[], b: number[], c: number[], d: number[],
): boolean {
  const o = (p: number[], q: number[], r: number[]) =>
    Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * Elevations of the contours that actually cross the lot, read off the
 * context set we already downloaded.
 *
 * Replaces a second round of ArcGIS queries. The 1 m layer costs ~9 s per
 * call regardless of window or simplification (server-side index cost), so
 * a separate measurement pass doubled the module's time on exactly the
 * addresses that need the fine layer. Vertices alone aren't enough at
 * ~20 m simplification: a contour can cross a 30 m lot without landing a
 * vertex in it: so segment crossings count too.
 */
function levelsOverLot(
  fc: FeatureCollection<Geometry | null, GeoJsonProperties>,
  lot?: Geometry | null,
): Set<number> {
  const rings = lotRings(lot);
  const levels = new Set<number>();
  if (rings.length === 0) return levels;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  for (const f of fc.features) {
    const e = num(((f.properties ?? {}) as Record<string, unknown>).elevation_m);
    if (e === null || !f.geometry) continue;
    if (levels.has(e)) continue;
    const lines: number[][][] =
      f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] :
      f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [];
    outer: for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        const [x, y] = line[i];
        // Cheap bbox reject before any real geometry work.
        const near = x >= xMin && x <= xMax && y >= yMin && y <= yMax;
        if (near && pointInRings(x, y, rings)) { levels.add(e); break outer; }
        if (i === 0) continue;
        const a = line[i - 1];
        const b = line[i];
        if (Math.max(a[0], b[0]) < xMin || Math.min(a[0], b[0]) > xMax) continue;
        if (Math.max(a[1], b[1]) < yMin || Math.min(a[1], b[1]) > yMax) continue;
        for (const ring of rings) {
          for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
            if (segmentsCross(a, b, ring[j], ring[k])) { levels.add(e); break outer; }
          }
        }
      }
    }
  }
  return levels;
}

/** Elevations of contours passing within `halfDeg` of the point. */
function levelsNearPoint(
  fc: FeatureCollection<Geometry | null, GeoJsonProperties>,
  lat: number,
  lng: number,
  halfDeg: number,
): Set<number> {
  const levels = new Set<number>();
  for (const f of fc.features) {
    const e = num(((f.properties ?? {}) as Record<string, unknown>).elevation_m);
    if (e === null || !f.geometry || levels.has(e)) continue;
    const lines: number[][][] =
      f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] :
      f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [];
    for (const line of lines) {
      for (const [x, y] of line) {
        if (Math.abs(x - lng) <= halfDeg && Math.abs(y - lat) <= halfDeg) {
          levels.add(e);
          break;
        }
      }
    }
  }
  return levels;
}

/** Elevation of the contour vertex closest to the point, or null. */
function nearestContourElevation(
  fc: FeatureCollection<Geometry | null, GeoJsonProperties>,
  lat: number,
  lng: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const f of fc.features) {
    const e = num(((f.properties ?? {}) as Record<string, unknown>).elevation_m);
    if (e === null || !f.geometry) continue;
    const lines: number[][][] =
      f.geometry.type === "LineString" ? [f.geometry.coordinates as number[][]] :
      f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [];
    for (const line of lines) {
      for (const [x, y] of line) {
        const d = (x - lng) ** 2 + (y - lat) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
  }
  return best;
}
