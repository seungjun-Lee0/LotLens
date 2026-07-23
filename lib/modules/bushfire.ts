// Bushfire module — statewide Bushfire Prone Area (BPA).
//
// Primary source: the QFD-hosted BPA FeatureServer (proxied via
// utility.arcgis.com). It carries the full class vocabulary ("Very High /
// High / Medium Potential Intensity", "Potential Impact Buffer").
//
//   https://utility.arcgis.com/usrsvcs/servers/8ac1ba8eccee472fbd0e7a57bf3ad320/
//     rest/services/Hosted/BPA/FeatureServer/0
//
// ⚠ That proxy's stored credential broke in July 2026 ("CONT_0044 Error
// generating token"), and QFD publishes no other queryable BPA REST layer
// (QSpatial's BPA is tiles-only; even QFD's own public postcode checker
// reads vector tiles). So on any FeatureServer failure we fall back to
// decoding QFD's public "Bushfire Prone Area Awareness Area" VECTOR TILES
// (tiles.arcgis.com, keyless):
//   layer "out_5x5"        = bushfire prone (hazard) area
//   layer "out_5x5_buffer" = potential impact buffer
// The tiles carry no intensity class — the fallback classifies a hazard
// hit as "Bushfire prone area" (medium) and buffer-only as the buffer
// (low), which is exactly what QFD's own public checker reports.
//
// 0 features = "no consideration identified" (riskLevel='none').

import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import { PbfReader } from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const BPA_LAYER =
  "https://utility.arcgis.com/usrsvcs/servers/8ac1ba8eccee472fbd0e7a57bf3ad320/rest/services/Hosted/BPA/FeatureServer/0/query";

const QLD_BUSHFIRE_DOC =
  "https://www.qld.gov.au/emergency/dealing-disasters/map-hazards/bushfire-prone-areas";

// QFD public BPA awareness vector tiles, split into three latitude bands.
// Extents are the published fullExtent y-ranges (EPSG:3857 metres),
// verified live 2026-07-22.
const TILE_ROOT =
  "https://tiles.arcgis.com/tiles/vkTwD8kHw2woKBqV/arcgis/rest/services";
const TILE_SERVICES = [
  { url: `${TILE_ROOT}/Bushfire_Prone_Area_Awareness_Area_Row_5/VectorTileServer`, ymin: -3402091, ymax: -2889054 },
  { url: `${TILE_ROOT}/Bushfire_Prone_Area_Awareness_Area_Tile_Rows_3_and_4_Central_QLD/VectorTileServer`, ymin: -2912234, ymax: -1948436 },
  { url: `${TILE_ROOT}/Bushfire_Prone_Area_Awareness_Area_Tile_Rows_1_and_2_Far_North/VectorTileServer`, ymin: -1964407, ymax: -1046653 },
];
const HAZARD_LAYER = "out_5x5";
const BUFFER_LAYER = "out_5x5_buffer";
const HAZARD_CLASS = "Bushfire prone area";
const BUFFER_CLASS = "Potential impact buffer";
// z14 tiles are ~2.4 km wide with 0.15 m resolution — plenty for a lot.
const TILE_ZOOM = 14;

export type BushfireSource = { name: string; url: string; layer: string };

export type BushfireResult = {
  riskLevel: RiskLevel;
  /** Raw BPA class string, e.g. "High Potential Intensity". */
  hazardCategory: string | null;
  /** BPA region label, e.g. "South East Queensland". */
  hazardCode: string | null;
  hasConsideration: boolean;
  sources: BushfireSource[];
  /** Point-query GeoJSON — drives classification. */
  raw: unknown;
  /** Envelope-query GeoJSON (~280 m around property) for map context. */
  context: unknown;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

// Map the BPA vocabulary to our 5-tier RiskLevel. Forgiving matcher — falls
// back to 'medium' when a hazard polygon is present but the wording is novel
// (this also classifies the tile fallback's class-less "Bushfire prone
// area" as medium).
function classifyHazard(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  if (s.includes("very high")) return "high";
  if (s.includes("high")) return "high";
  if (s.includes("medium")) return "medium";
  if (s.includes("buffer") || s.includes("impact")) return "low";
  return "medium";
}

/** Prefer the worst class when the point sits under stacked polygons. */
function worstFeature(
  features: Feature<Geometry | null, GeoJsonProperties>[],
): Feature<Geometry | null, GeoJsonProperties> | undefined {
  const rank = (f: Feature<Geometry | null, GeoJsonProperties>) => {
    const c = String(attrs(f).class ?? "").toLowerCase();
    if (c.includes("very high")) return 4;
    if (c.includes("high")) return 3;
    if (c.includes("medium")) return 2;
    return 1;
  };
  return [...features].sort((a, b) => rank(b) - rank(a))[0];
}

// ── Vector-tile fallback ─────────────────────────────────────────────────

function mercY(lat: number): number {
  return (
    (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) *
    20037508.342789244
  );
}

function pickTileService(lat: number): string {
  const y = mercY(lat);
  const hit = TILE_SERVICES.find((s) => y >= s.ymin && y <= s.ymax);
  if (hit) return hit.url;
  // Outside every band (shouldn't happen inside QLD) — nearest band.
  const nearest = [...TILE_SERVICES].sort(
    (a, b) =>
      Math.min(Math.abs(y - a.ymin), Math.abs(y - a.ymax)) -
      Math.min(Math.abs(y - b.ymin), Math.abs(y - b.ymax)),
  )[0];
  return nearest.url;
}

/** Fractional web-mercator tile coordinates at zoom z. */
function tileFrac(lat: number, lng: number, z: number): { xf: number; yf: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    xf: ((lng + 180) / 360) * n,
    yf: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

type TilePoint = { x: number; y: number };

/** Even-odd point-in-rings test in tile coordinates (handles holes). */
function pointInRings(px: number, py: number, rings: TilePoint[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (
        a.y > py !== b.y > py &&
        px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

async function fetchTile(
  service: string,
  z: number,
  x: number,
  y: number,
): Promise<VectorTile | null> {
  const res = await fetch(`${service}/tile/${z}/${y}/${x}.pbf`, {
    signal: AbortSignal.timeout(15_000),
  });
  // Missing tiles (open water, far outback) 404 — that's "no data here".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BPA tile ${res.status} at z${z}/${y}/${x}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  return new VectorTile(new PbfReader(buf));
}

/** All lon/lat sample points to hazard-test: the geocode point plus the
 * lot polygon's vertices (capped), so "on the lot" matches the
 * FeatureServer path's whole-lot intersect behaviour. */
function samplePoints(lat: number, lng: number, lot?: Geometry | null): [number, number][] {
  const pts: [number, number][] = [[lng, lat]];
  const rings =
    lot?.type === "Polygon"
      ? (lot.coordinates as number[][][])
      : lot?.type === "MultiPolygon"
        ? (lot.coordinates as number[][][][]).flat()
        : [];
  const verts = rings.flat();
  const step = Math.max(1, Math.ceil(verts.length / 24));
  for (let i = 0; i < verts.length; i += step) {
    pts.push([verts[i][0], verts[i][1]]);
  }
  return pts;
}

async function fetchBushfireFromTiles(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<BushfireResult> {
  const service = pickTileService(lat);

  // Group sample points by the z14 tile they land in, decode each tile
  // once, and hazard-test every point against both layers.
  const byTile = new Map<string, { x: number; y: number; pts: [number, number][] }>();
  for (const [plng, plat] of samplePoints(lat, lng, lot)) {
    const { xf, yf } = tileFrac(plat, plng, TILE_ZOOM);
    const tx = Math.floor(xf);
    const ty = Math.floor(yf);
    const key = `${tx}/${ty}`;
    const slot = byTile.get(key) ?? { x: tx, y: ty, pts: [] };
    slot.pts.push([plng, plat]);
    byTile.set(key, slot);
  }

  let hazardHit = false;
  let bufferHit = false;
  const tiles = await Promise.all(
    [...byTile.values()].map(async (slot) => ({
      slot,
      tile: await fetchTile(service, TILE_ZOOM, slot.x, slot.y),
    })),
  );
  for (const { slot, tile } of tiles) {
    if (!tile) continue;
    for (const [layerName, mark] of [
      [HAZARD_LAYER, () => (hazardHit = true)],
      [BUFFER_LAYER, () => (bufferHit = true)],
    ] as const) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const rings = feature.loadGeometry();
        for (const [plng, plat] of slot.pts) {
          const { xf, yf } = tileFrac(plat, plng, TILE_ZOOM);
          const px = (xf - slot.x) * feature.extent;
          const py = (yf - slot.y) * feature.extent;
          if (pointInRings(px, py, rings)) {
            mark();
            break;
          }
        }
        if (hazardHit && bufferHit) break;
      }
    }
  }

  // Context polygons for the module map: every hazard/buffer feature from
  // the tiles covering a ~280 m envelope, as GeoJSON. Adjacent-tile clip
  // seams tile together invisibly at render.
  const BUF = 0.0025;
  const corners: [number, number][] = [
    [lng - BUF, lat - BUF],
    [lng + BUF, lat - BUF],
    [lng - BUF, lat + BUF],
    [lng + BUF, lat + BUF],
  ];
  const ctxKeys = new Map<string, { x: number; y: number }>();
  for (const [clng, clat] of corners) {
    const { xf, yf } = tileFrac(clat, clng, TILE_ZOOM);
    const tx = Math.floor(xf);
    const ty = Math.floor(yf);
    ctxKeys.set(`${tx}/${ty}`, { x: tx, y: ty });
  }
  const ctxFeatures: Feature<Geometry, GeoJsonProperties>[] = [];
  const ctxTiles = await Promise.all(
    [...ctxKeys.values()].map(async ({ x, y }) => ({
      x,
      y,
      tile: await fetchTile(service, TILE_ZOOM, x, y).catch(() => null),
    })),
  );
  for (const { x, y, tile } of ctxTiles) {
    if (!tile) continue;
    for (const [layerName, klass] of [
      [HAZARD_LAYER, HAZARD_CLASS],
      [BUFFER_LAYER, BUFFER_CLASS],
    ] as const) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const gj = layer.feature(i).toGeoJSON(x, y, TILE_ZOOM) as Feature<
          Geometry,
          GeoJsonProperties
        >;
        gj.properties = { class: klass };
        ctxFeatures.push(gj);
      }
    }
  }

  const hazardCategory = hazardHit ? HAZARD_CLASS : bufferHit ? BUFFER_CLASS : null;
  const riskLevel = classifyHazard(hazardCategory);
  const hits: Feature<Geometry | null, GeoJsonProperties>[] = [];
  if (hazardHit) hits.push({ type: "Feature", geometry: null, properties: { class: HAZARD_CLASS } });
  if (bufferHit) hits.push({ type: "Feature", geometry: null, properties: { class: BUFFER_CLASS } });

  const fc: FeatureCollection<Geometry | null, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: hits,
  };
  const ctx: FeatureCollection<Geometry, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: ctxFeatures,
  };

  return {
    riskLevel,
    hazardCategory,
    hazardCode: null,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Queensland Bushfire Prone Area (State Planning Policy)",
        url: QLD_BUSHFIRE_DOC,
        layer: service,
      },
    ],
    raw: fc,
    context: ctx,
  };
}

// ── FeatureServer path (full class vocabulary) ───────────────────────────

async function fetchBushfireFromFeatureServer(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<BushfireResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "class,region,lga";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(BPA_LAYER, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: false,
      lotPolygon: lot,
    }),
    queryArcGIS(BPA_LAYER, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);
  const a = attrs(worstFeature(fc.features));
  const hazardCategory = typeof a.class === "string" ? a.class : null;
  const hazardCode = typeof a.region === "string" ? a.region : null;
  const riskLevel = classifyHazard(hazardCategory);

  return {
    riskLevel,
    hazardCategory,
    hazardCode,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Queensland Bushfire Prone Area (State Planning Policy)",
        url: QLD_BUSHFIRE_DOC,
        layer: BPA_LAYER,
      },
    ],
    raw: fc,
    context: ctx,
  };
}

export async function fetchBushfireData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<BushfireResult> {
  try {
    return await fetchBushfireFromFeatureServer(lat, lng, lot);
  } catch {
    // The proxied FeatureServer breaks whenever QFD's stored credential
    // lapses — the public awareness vector tiles are the durable path.
    return await fetchBushfireFromTiles(lat, lng, lot);
  }
}
