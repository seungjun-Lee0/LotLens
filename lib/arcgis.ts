// ArcGIS REST query helper.
//
// All Brisbane spatial layers we use are hosted on the same FeatureServer
// pattern: `.../FeatureServer/<layer>/query`. They use varying native SRIDs
// (BCC layers are mostly EPSG:28356 — GDA94 / MGA Zone 56), but accept
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
   * corridor layers — point queries near polygon boundaries can miss
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
};

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

/**
 * Run an esriGeometryPoint intersect query and return GeoJSON.
 *
 * The result's `features` array is empty when the point falls outside every
 * polygon in the layer — that's the "no consideration identified" case, not
 * an error.
 */
export async function queryArcGIS(
  endpoint: string,
  params: QueryArcGISParams,
): Promise<FeatureCollection<Geometry | null, GeoJsonProperties>> {
  const sr = params.inSR ?? params.geometry.spatialReference ?? 4326;
  const buf = params.bufferDegrees ?? 0;
  const geom = buf > 0
    ? {
        xmin: params.geometry.x - buf,
        ymin: params.geometry.y - buf,
        xmax: params.geometry.x + buf,
        ymax: params.geometry.y + buf,
        spatialReference: { wkid: params.geometry.spatialReference ?? 4326 },
      }
    : {
        x: params.geometry.x,
        y: params.geometry.y,
        spatialReference: { wkid: params.geometry.spatialReference ?? 4326 },
      };
  const search = new URLSearchParams({
    f: "geojson",
    geometry: JSON.stringify(geom),
    geometryType: buf > 0 ? "esriGeometryEnvelope" : params.geometryType,
    inSR: String(sr),
    spatialRel: "esriSpatialRelIntersects",
    outFields: params.outFields ?? "*",
    returnGeometry: String(params.returnGeometry ?? false),
    outSR: "4326",
  });
  if (params.returnGeometry && params.maxAllowableOffset !== undefined) {
    // The offset is expressed in *output* SR units. We outSR=4326 so the
    // offset is in degrees; ~9e-5 ≈ 10m at Brisbane's latitude.
    search.set("maxAllowableOffset", String(params.maxAllowableOffset));
  }
  const url = `${endpoint}?${search.toString()}`;
  if (DEBUG) console.log("[arcgis] GET", url);

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/geo+json" } });
  } catch (err) {
    throw new ArcGISError(
      `Network error querying ${endpoint}: ${(err as Error).message}`,
      endpoint,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ArcGISError(
      `ArcGIS ${res.status} ${res.statusText} at ${endpoint}`,
      endpoint,
      res.status,
      body.slice(0, 500),
    );
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
}
