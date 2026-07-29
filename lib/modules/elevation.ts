// Elevation profile from Queensland's statewide contour service.
//
// Feeds the Steep Land module. The council landslide overlays it normally
// relies on exist in five LGAs; contours exist for the whole state, so a
// lot outside every adapter still gets the one fact a buyer actually wants
// from that page — how much the land falls across it.
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
 * Cheapest-adequate first, not finest first.
 *
 * The 1 m layer is 3–6× slower to QUERY than the 5 m one — measured at 5–8 s
 * for a single feature with zero geometry returned, so it is spatial-index
 * cost, not payload. Leading with it made the whole report wait ~15 s on one
 * module. The 5 m layer answers the question this module actually asks
 * ("flat, or how much fall?") in about 2 s.
 *
 * 1 m stays as the fallback because 5 m has coverage holes — Maroochydore
 * and Cairns both return nothing from it. 10 m SRTM is the last resort.
 *
 * Whichever layer answers, its interval is reported to the reader: "flat"
 * from 5 m contours means flat to within 5 m, and the UI says so rather
 * than implying a precision the source doesn't have.
 */
const CONTOUR_LAYERS = [
  { id: 20, interval: "5 m LiDAR" },
  { id: 30, interval: "1 m LiDAR" },
  { id: 10, interval: "10 m SRTM" },
] as const;

export type ElevationProfile = {
  /** Highest contour crossing the measured area, in metres AHD. */
  highM: number;
  lowM: number;
  /**
   * highM - lowM: how much the land drops. The number buyers care about.
   *
   * null when only ONE contour level was found. That does NOT mean zero
   * fall — a single 10 m contour clipping the lot means the ground is
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
  /** Elevation range of `contextContours` — the span the map's colour ramp
   * covers, which is what the legend's gradient bar is labelled with. The
   * property's own high/low sit somewhere inside it. */
  contextLowM: number | null;
  contextHighM: number | null;
};


/**
 * Trim contour lines to the map window.
 *
 * ArcGIS returns each matched feature's WHOLE geometry, and a contour is a
 * statewide polyline — a single 45 m line can run for kilometres. At Bardon
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
  const inside = ([x, y]: number[]) =>
    x >= lng - pad && x <= lng + pad && y >= lat - pad && y <= lat + pad;
  const out: Feature<Geometry | null, GeoJsonProperties>[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const lines: number[][][] =
      g.type === "LineString" ? [g.coordinates as number[][]] :
      g.type === "MultiLineString" ? (g.coordinates as number[][][]) : [];
    for (const line of lines) {
      let run: number[][] = [];
      for (let i = 0; i < line.length; i++) {
        if (inside(line[i])) {
          // Reach back one point so the run starts off-frame and the drawn
          // line meets the edge rather than floating inside it.
          if (run.length === 0 && i > 0) run.push(line[i - 1]);
          run.push(line[i]);
        } else if (run.length > 0) {
          run.push(line[i]);
          if (run.length >= 2) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: run }, properties: f.properties });
          run = [];
        }
      }
      if (run.length >= 2) {
        out.push({ type: "Feature", geometry: { type: "LineString", coordinates: run }, properties: f.properties });
      }
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
 * Returns null when no contour layer has coverage — offshore, or a genuinely
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
  const CONTEXT_HALF_DEG = 0.0012; // ~130 m

  for (const layer of CONTOUR_LAYERS) {
    const url = `${BASE}/${layer.id}/query`;

    // Coverage is decided by the MAP window, not the lot. A flat lot has no
    // 5 m contour crossing it, so testing the lot first would fail over to
    // the slow 1 m layer on exactly the addresses that least need it — that
    // mistake cost 19 s at Graceville. The window answers "does this layer
    // have data here?", which is the actual question.
    const rawContext = await queryArcGIS(url, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields,
      returnGeometry: true,
      maxAllowableOffset: 0.0002,
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

    // Measurement: numbers only, so this stays cheap. Lot first, then a
    // ~50 m envelope for a lot too flat for any contour to cross it.
    const measure = async (params: Parameters<typeof queryArcGIS>[1]) => {
      const fc = await queryArcGIS(url, params).catch(() => null);
      const levels = new Set<number>();
      for (const f of fc?.features ?? []) {
        const e = num(((f.properties ?? {}) as Record<string, unknown>).elevation_m);
        if (e !== null) levels.add(e);
      }
      return levels;
    };
    const base = {
      geometry: point,
      geometryType: "esriGeometryPoint" as const,
      inSR: 4326,
      outFields,
      returnGeometry: false,
    };
    let levels = await measure({ ...base, bufferDegrees: lot ? 0 : 0.00027, lotPolygon: lot });
    let scope: "lot" | "nearby" = "lot";
    if (levels.size === 0) {
      levels = await measure({ ...base, bufferDegrees: 0.00045 });
      scope = "nearby";
    }

    // Still nothing within ~50 m: the ground really is flat at this
    // interval. Take the nearest mapped contour as the representative
    // elevation rather than reporting no answer at all.
    if (levels.size === 0) {
      const nearest = nearestContourElevation(rawContext, lat, lng);
      if (nearest === null) continue;
      levels = new Set([nearest]);
      scope = "nearby";
    }

    const values = [...levels];
    const highM = Math.max(...values);
    const lowM = Math.min(...values);
    return {
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
  }
  return null;
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
