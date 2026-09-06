// ArcGIS REST query helper.
//
// All Brisbane spatial layers we use are hosted on the same FeatureServer
// pattern: `.../FeatureServer/<layer>/query`. They use varying native SRIDs
// (BCC layers are mostly EPSG:28356: GDA94 / MGA Zone 56), but accept
// reprojected geometry via inSR. We pass lat/lng (EPSG:4326) everywhere and
// let ArcGIS do the math.
//
// Reference: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer.htm

import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

export type ArcGISPoint = {
  x: number; // lng in EPSG:4326
  y: number; // lat in EPSG:4326
  spatialReference: number; // wkid, default 4326
};

export type QueryArcGISParams = {
  geometry: ArcGISPoint;
  geometryType: "esriGeometryPoint";
  /** Spatial reference of input geometry. Defaults to geometry.spatialReference or 4326. */
  inSR?: number;
  /** Comma-separated field list. Default "*". */
  outFields?: string;
  /** Whether to return polygon/line geometry alongside attributes. Default false. */
  returnGeometry?: boolean;
  /**
   * Half-width of an envelope drawn around the point, in `inSR` degrees.
   * Use a small positive value (~5e-5 ≈ 5m at Brisbane latitude) for thin
   * corridor layers: point queries near polygon boundaries can miss
   * features when ArcGIS reprojects from EPSG:28356 to EPSG:4326. Default
   * 0 = exact point query.
   */
  bufferDegrees?: number;
  /**
   * Tells ArcGIS to simplify returned geometry to within this many `inSR`
   * units of the original. ~10 meters in EPSG:28356 cuts polygon vertex
   * count dramatically without visible loss at map zoom levels we use.
   * Only meaningful when `returnGeometry` is true. Default 0 = unsimplified.
   */
  maxAllowableOffset?: number;
  /**
   * SQL attribute filter sent alongside the spatial filter. Lets one layer
   * back several adapters: Logan's Property Report layer is a per-lot
   * polygon carrying EVERY overlay as flag columns, so the flood adapter
   * queries it with `OM_0504A=1 OR …` while steep queries `OM_0801…`.
   * Without a where, a per-lot layer matches EVERY address (the lot always
   * intersects itself) and a flag-less lot would still count as a hit.
   */
  where?: string;
  /**
   * GeoJSON Polygon/MultiPolygon in EPSG:4326: the cadastre lot. When set,
   * the query runs as an esriGeometryPolygon intersect against this shape
   * instead of the point/envelope, so "consideration applies" means
   * "anywhere on the lot", not "at the geocoded point" (which can sit on a
   * driveway corner of a lot whose far edge carries the overlay). Takes
   * precedence over bufferDegrees. Ignored for non-polygon geometry.
   */
  lotPolygon?: Geometry | null;
};

/** GeoJSON Polygon/MultiPolygon → esri rings array, or null if not a polygon. */
function esriRings(g: Geometry): number[][][] | null {
  if (g.type === "Polygon") return g.coordinates as number[][][];
  if (g.type === "MultiPolygon") {
    return (g.coordinates as number[][][][]).flat();
  }
  return null;
}

export class ArcGISError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ArcGISError";
  }
}

const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

// ── Per-host concurrency limiter ──────────────────────────────────────────
//
// The QLD on-prem GIS host serves several genuinely slow statewide layers
// (mining, steep land, easements — seconds each, server-side). Firing the
// whole ~18-layer module fan-out at it AT ONCE makes it queue requests and
// time some out. Capping in-flight requests PER HOST so each query gets the
// server's attention shortens the tail and cuts timeouts, without throttling
// the fast Esri-cloud (AGOL) hosts the council overlays use.

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    // Wait for a holder to release; the slot passes straight to us, so the
    // in-flight count never exceeds `max`.
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

// Host patterns → max concurrent requests. Unlisted hosts are unlimited.
const HOST_LIMITS: Array<[RegExp, number]> = [
  [/(^|\.)information\.qld\.gov\.au$/i, 6],
];
const limiters = new Map<string, Semaphore>();

function limiterFor(endpoint: string): Semaphore | null {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return null;
  }
  const rule = HOST_LIMITS.find(([re]) => re.test(host));
  if (!rule) return null;
  let sem = limiters.get(host);
  if (!sem) {
    sem = new Semaphore(rule[1]);
    limiters.set(host, sem);
  }
  return sem;
}

/**
 * Run an esriGeometryPoint intersect query and return GeoJSON.
 *
 * The result's `features` array is empty when the point falls outside every
 * polygon in the layer: that's the "no consideration identified" case, not
 * an error.
 */
export async function queryArcGIS(
  endpoint: string,
  params: QueryArcGISParams,
): Promise<FeatureCollection<Geometry | null, GeoJsonProperties>> {
  const sr = params.inSR ?? params.geometry.spatialReference ?? 4326;
  const buf = params.bufferDegrees ?? 0;
  const rings = params.lotPolygon ? esriRings(params.lotPolygon) : null;
  const wkid = params.geometry.spatialReference ?? 4326;
  const geom = rings
    ? { rings, spatialReference: { wkid } }
    : buf > 0
      ? {
          xmin: params.geometry.x - buf,
          ymin: params.geometry.y - buf,
          xmax: params.geometry.x + buf,
          ymax: params.geometry.y + buf,
          spatialReference: { wkid },
        }
      : {
          x: params.geometry.x,
          y: params.geometry.y,
          spatialReference: { wkid },
        };
  const search = new URLSearchParams({
    ...(params.where ? { where: params.where } : {}),
    f: "geojson",
    geometry: JSON.stringify(geom),
    geometryType: rings
      ? "esriGeometryPolygon"
      : buf > 0
        ? "esriGeometryEnvelope"
        : params.geometryType,
    inSR: String(sr),
    spatialRel: "esriSpatialRelIntersects",
    outFields: params.outFields ?? "*",
    returnGeometry: String(params.returnGeometry ?? false),
    outSR: "4326",
    // 6 decimal places ≈ 0.1 m: full-precision coordinates double the
    // payload of big polygons for zero visible benefit.
    geometryPrecision: "6",
  });
  if (params.returnGeometry && params.maxAllowableOffset !== undefined) {
    // The offset is expressed in *output* SR units. We outSR=4326 so the
    // offset is in degrees; ~9e-5 ≈ 10m at Brisbane's latitude.
    search.set("maxAllowableOffset", String(params.maxAllowableOffset));
  }
  const url = `${endpoint}?${search.toString()}`;
  // Polygon queries always go as form POSTs: every ArcGIS server accepts
  // the same params in a POST body, and GET URL limits vary wildly -
  // services-ap1.arcgis.com (Gold Coast et al.) 404s at ~3.5k chars, which
  // a ~70-vertex lot polygon already exceeds. Point/envelope queries stay
  // GET (shorter, and friendlier to any HTTP-level caching).
  const usePost = rings !== null || url.length > 4000;
  if (DEBUG) console.log(`[arcgis] ${usePost ? "POST" : "GET"}`, usePost ? endpoint : url);

  // Cap in-flight requests to slow hosts (acquired around the whole
  // fetch+retry+read so retries and body transfer count as one slot).
  const sem = limiterFor(endpoint);
  if (sem) await sem.acquire();
  try {
  // The Queensland Government ArcGIS servers intermittently return 5xx (and
  // 429) under load — a retry a moment later almost always succeeds. Retry
  // transient failures SILENTLY and internally so a flaky server never
  // surfaces to the user; only a genuinely persistent failure propagates to
  // the caller's graceful fallback. 4xx and ArcGIS error-JSON aren't
  // transient (bad request, expired token) so they fail fast.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [300, 800];
  let res: Response | null = null;
  let lastErr: ArcGISError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? 800);
    try {
      res = await fetch(usePost ? endpoint : url, {
        method: usePost ? "POST" : "GET",
        headers: {
          Accept: "application/geo+json",
          ...(usePost
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: usePost ? search.toString() : undefined,
        // Government ArcGIS servers occasionally hang; cap the wait so one
        // stuck layer can't stall the whole parallel overlay fan-out.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      lastErr = new ArcGISError(
        `Network error querying ${endpoint}: ${(err as Error).message}`,
        endpoint,
      );
      res = null;
      // A timeout means the layer is genuinely SLOW, not flaky — retrying
      // just triples the wait (up to 3×15 s) on a query that might have
      // finished at 16 s. Fail fast on timeouts; retry only real connection
      // blips (DNS/reset), which recover immediately.
      if ((err as Error)?.name === "TimeoutError") break;
      continue;
    }
    if (res.ok) break;
    // Retry only transient server-side statuses; fail fast on 4xx.
    if (res.status >= 500 || res.status === 429) {
      const body = await res.text().catch(() => "");
      lastErr = new ArcGISError(
        `ArcGIS ${res.status} ${res.statusText} at ${endpoint}`,
        endpoint,
        res.status,
        body.slice(0, 500),
      );
      res = null;
      continue;
    }
    // Non-retryable HTTP error.
    const body = await res.text().catch(() => "");
    throw new ArcGISError(
      `ArcGIS ${res.status} ${res.statusText} at ${endpoint}`,
      endpoint,
      res.status,
      body.slice(0, 500),
    );
  }
  if (!res) {
    // Every attempt failed transiently — hand the caller its last error so
    // its try/catch can fall back (empty parcel, skipped overlay, etc.).
    throw lastErr ??
      new ArcGISError(`ArcGIS request failed at ${endpoint}`, endpoint);
  }
  const json = (await res.json()) as
    | FeatureCollection<Geometry | null, GeoJsonProperties>
    | { error?: { code?: number; message?: string; details?: string[] } };

  if ("error" in json && json.error) {
    throw new ArcGISError(
      `ArcGIS error ${json.error.code}: ${json.error.message ?? "unknown"}`,
      endpoint,
      json.error.code,
      JSON.stringify(json.error.details ?? []),
    );
  }
  return json as FeatureCollection<Geometry | null, GeoJsonProperties>;
  } finally {
    if (sem) sem.release();
  }
}
