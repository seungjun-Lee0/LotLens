// Server-side static map renderer for the PDF report.
//
// Two-stage design, built for the PDF route's "render 16 module maps of
// the SAME frame" workload:
//
//   1. BASE — satellite tiles for the fixed lot-scale frame, rendered by
//      the `staticmaps` package ONCE per (lat,lng,size) and memoised as a
//      promise, so 16 concurrent module renders trigger a single tile
//      fetch pass (~24 tiles) instead of ~380 duplicate downloads two at
//      a time (staticmaps' per-instance tileRequestLimit defaults to 2 —
//      that serial trickle was why PDF generation took tens of seconds).
//   2. OVERLAYS — module polygons, cadastre hairlines, the yellow
//      property outline and the pin are projected to pixels with plain
//      web-mercator math and composited onto the base as an SVG layer by
//      sharp. Pure CPU, no network, runs happily in parallel.
//
// Per tile usage policy: unique User-Agent, one frame's worth of tiles
// per report. Prototype-scale traffic is well inside fair use.

import sharp from "sharp";
import StaticMaps from "staticmaps";

import type { OverlayFeature } from "@/lib/overlays";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";

// Tile source: prefer Mapbox Satellite Streets (Develo-grade imagery)
// when NEXT_PUBLIC_MAPBOX_TOKEN is set, fall back to free Esri World
// Imagery so the PDF still renders without a token.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const SAT_TILES = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_UA = "LotLens/0.1 Brisbane-DD (contact: hello@lotlens.au)";

// z19 ≈ 0.26 m/px at Brisbane latitudes → ~160 m half-width at 1200 px.
// The Develo-style lot-scale frame, identical across every module. Both
// Esri World Imagery and Mapbox serve z19 over QLD.
const ZOOM = 19;
const TILE_SIZE = 256;

// ── Web-mercator projection (matches staticmaps' tile math) ─────────────

const lonToX = (lon: number) => ((lon + 180) / 360) * 2 ** ZOOM;
const latToY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM;
};
const metersPerPixel = (lat: number) =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;

// ── Base imagery, one tile pass per frame ───────────────────────────────

// Promise-memo so concurrent module renders share ONE in-flight tile
// fetch. Entries expire shortly after settling — this is a per-request
// dedupe, not a long-lived cache.
const basePromises = new Map<string, Promise<Buffer>>();

function getBasePNG(lat: number, lng: number, width: number, height: number): Promise<Buffer> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)},${width}x${height}`;
  let p = basePromises.get(key);
  if (!p) {
    p = (async () => {
      const map = new StaticMaps({
        width,
        height,
        tileUrl: SAT_TILES,
        tileSize: TILE_SIZE,
        tileRequestHeader: { "User-Agent": TILE_UA, "Accept-Language": "en" },
        tileRequestTimeout: 15000,
        tileRequestLimit: 12,
        paddingX: 0,
        paddingY: 0,
        // staticmaps caps zoom at 17 by default — too far out for a
        // lot-scale frame.
        zoomRange: { min: 1, max: 20 },
      });
      // Explicit centre + zoom — NEVER a bbox. staticmaps treats a
      // 4-element "center" as one extent among many and unions it with
      // every feature's bounds, which dragged the frame kilometres out.
      await map.render([lng, lat], ZOOM);
      return map.image.buffer("image/png");
    })();
    basePromises.set(key, p);
    p.finally(() => setTimeout(() => basePromises.delete(key), 120_000)).catch(() => {});
  }
  return p;
}

// ── SVG overlay construction ────────────────────────────────────────────

type Px = (lon: number, lat: number) => [number, number];

function ringsToPath(rings: number[][][], px: Px): string {
  let d = "";
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = px(lon, lat);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    d += "Z";
  }
  return d;
}

function polygonRings(geometry: { type?: string; coordinates?: unknown } | null | undefined): number[][][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  return [];
}

/**
 * Render a property-centric map image at a fixed lot-scale frame with
 * overlay polygons painted in their fill colours.
 *
 * Returns PNG bytes; pass as Buffer to React-PDF's Image src.
 */
export async function renderModuleMapPNG({
  lat,
  lng,
  overlays,
  propertyPolygon = null,
  lotLines = null,
  width = 1200,
  height = 720,
}: {
  lat: number;
  lng: number;
  /** Module-tagged polygon features from extractOverlays(). */
  overlays: OverlayFeature[];
  /** GeoJSON Polygon / MultiPolygon for the cadastre lot. When present
   * we draw it as the yellow highlight; otherwise we fall back to a
   * ~50 m box around the geocoded point. */
  propertyPolygon?: unknown | null;
  /** GeoJSON FeatureCollection of nearby cadastre lots, drawn as faint
   * white boundary lines so zone fills read per-lot. null = skip. */
  lotLines?: unknown | null;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const basePromise = getBasePNG(lat, lng, width, height);

  const cx = lonToX(lng);
  const cy = latToY(lat);
  const px: Px = (lon, la) => [
    (lonToX(lon) - cx) * TILE_SIZE + width / 2,
    (latToY(la) - cy) * TILE_SIZE + height / 2,
  ];

  const parts: string[] = [];

  // Module overlays — evenodd so polygon holes render correctly (an
  // upgrade over the old outer-ring-only drawing).
  for (const f of overlays) {
    for (const poly of polygonRings(f.geometry as { type?: string; coordinates?: unknown } | null)) {
      const d = ringsToPath(poly, px);
      if (!d) continue;
      const c = f.properties.fillColor;
      parts.push(
        `<path d="${d}" fill="${c}" fill-opacity="${f.properties.fillOpacity ?? 0.35}" fill-rule="evenodd" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`,
      );
    }
  }

  // Cadastre lot boundaries — faint white hairlines so zone fills read
  // per-lot (Develo-style) instead of as one flat colour wash.
  if (
    lotLines &&
    typeof lotLines === "object" &&
    (lotLines as { type?: string }).type === "FeatureCollection"
  ) {
    const fc = lotLines as { features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }> };
    for (const f of fc.features ?? []) {
      for (const poly of polygonRings(f.geometry)) {
        const d = ringsToPath(poly, px);
        if (d) {
          parts.push(
            `<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="0.8"/>`,
          );
        }
      }
    }
  }

  // "Selected property" highlight — the real cadastre lot polygon when
  // present, else a ~60×60 m box centred on the geocoded point. White
  // halo first for legibility against dark satellite imagery.
  const propRings: number[][][][] = polygonRings(
    propertyPolygon as { type?: string; coordinates?: unknown } | null,
  );
  const propPaths =
    propRings.length > 0
      ? propRings.map((poly) => ringsToPath([poly[0]].filter(Boolean), px)).filter(Boolean)
      : [
          ringsToPath(
            [[
              [lng - 0.00028, lat - 0.00028],
              [lng + 0.00028, lat - 0.00028],
              [lng + 0.00028, lat + 0.00028],
              [lng - 0.00028, lat + 0.00028],
              [lng - 0.00028, lat - 0.00028],
            ]],
            px,
          ),
        ];
  for (const d of propPaths) {
    parts.push(
      `<path d="${d}" fill="none" stroke="${SELECTED_PROPERTY_STYLE.haloHex}" stroke-width="${SELECTED_PROPERTY_STYLE.haloWidth}" stroke-linejoin="round"/>`,
    );
    parts.push(
      `<path d="${d}" fill="none" stroke="${SELECTED_PROPERTY_STYLE.colorHex}" stroke-width="${SELECTED_PROPERTY_STYLE.lineWidth}" stroke-linejoin="round"/>`,
    );
  }

  // Small inner pin — exact geocoded point (3.5 m radius, as before).
  const pinR = 3.5 / metersPerPixel(lat);
  const [pinX, pinY] = px(lng, lat);
  parts.push(
    `<circle cx="${pinX.toFixed(1)}" cy="${pinY.toFixed(1)}" r="${pinR.toFixed(1)}" fill="${SELECTED_PROPERTY_STYLE.colorHex}"/>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;

  const base = await basePromise;
  return sharp(base)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}
