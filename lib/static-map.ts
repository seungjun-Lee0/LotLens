// Server-side static map renderer for the PDF report.
//
// Two-stage design, built for the PDF route's "render 16 module maps of
// the SAME frame" workload:
//
//   1. BASE — the SAME Queensland Government aerial the web report map
//      uses (LatestStateProgram ImageServer), fetched as ONE exportImage
//      request for the whole frame and promise-memoised, so 16 concurrent
//      module renders share a single upstream call. No tile compositing
//      at all — the previous tile pipeline both hammered the tile server
//      (~380 duplicate fetches, two at a time) and scrambled the image
//      when the Mapbox @2x URL returned 512px tiles into 256px slots.
//   2. OVERLAYS — module polygons, cadastre hairlines, the yellow
//      property outline and the pin are projected to pixels with plain
//      web-mercator math and composited onto the base as an SVG layer by
//      sharp. Pure CPU, no network, runs happily in parallel.

import sharp from "sharp";

import type { OverlayFeature } from "@/lib/overlays";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";

// Same imagery service as components/report/module-map.tsx — the PDF and
// the on-screen report must show the identical basemap.
const QLD_IMAGERY_EXPORT =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage";

// Frame scale: ≈0.30 mercator-m/px (z19-equivalent), ≈0.26 ground-m/px at
// Brisbane latitudes → ~160 m half-width at 1200 px. The Develo-style
// lot-scale frame, identical across every module.
const MERC_RES = 156543.03392 / 2 ** 19;

// ── Web-mercator (EPSG:3857) helpers ────────────────────────────────────

const R = 6378137;
const merX = (lon: number) => R * ((lon * Math.PI) / 180);
const merY = (lat: number) =>
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

type Frame = { xmin: number; ymin: number; xmax: number; ymax: number };

/** Frame centred on the pin at the default lot scale, zoomed OUT (aspect
 * preserved) just enough that the whole selected parcel fits with ~30%
 * margin. A suburban 600 m² lot keeps the tight Develo-style frame; a
 * shopping-centre-sized lot (Westfield Chermside is ~470 m across) scales
 * up instead of having its outline sliced off at the edges. Capped at 10×
 * so a pathological parcel can't zoom the map into orbit. */
function frameFor(
  lat: number,
  lng: number,
  width: number,
  height: number,
  propertyPolygon?: unknown | null,
): Frame {
  const cx = merX(lng);
  const cy = merY(lat);
  let hw = (width / 2) * MERC_RES;
  let hh = (height / 2) * MERC_RES;
  let needX = 0;
  let needY = 0;
  for (const poly of polygonRings(
    propertyPolygon as { type?: string; coordinates?: unknown } | null,
  )) {
    for (const ring of poly) {
      for (const [lon, la] of ring) {
        needX = Math.max(needX, Math.abs(merX(lon) - cx) * 1.3);
        needY = Math.max(needY, Math.abs(merY(la) - cy) * 1.3);
      }
    }
  }
  const scale = Math.min(10, Math.max(1, needX / hw, needY / hh));
  hw *= scale;
  hh *= scale;
  return { xmin: cx - hw, ymin: cy - hh, xmax: cx + hw, ymax: cy + hh };
}

// ── Base imagery — one exportImage call per frame ───────────────────────

// Promise-memo so concurrent module renders share ONE in-flight fetch.
// Entries expire shortly after settling — a per-request dedupe, not a
// long-lived cache.
const basePromises = new Map<string, Promise<Buffer>>();

function getBasePNG(frame: Frame, width: number, height: number): Promise<Buffer> {
  const key = `${frame.xmin.toFixed(1)},${frame.ymin.toFixed(1)},${width}x${height}`;
  let p = basePromises.get(key);
  if (!p) {
    p = (async () => {
      const url =
        `${QLD_IMAGERY_EXPORT}?bbox=${frame.xmin},${frame.ymin},${frame.xmax},${frame.ymax}` +
        `&bboxSR=3857&imageSR=3857&size=${width},${height}&format=jpeg&transparent=false&f=image`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`QLD imagery export ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
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

/** "Selected property" SVG fragments — white halo + amber outline (real
 * cadastre lot when present, ~60×60 m fallback box). No centre pin: the
 * lot outline alone marks the property. */
function propertyParts(
  px: Px,
  propertyPolygon: unknown | null | undefined,
  lat: number,
  lng: number,
): string[] {
  const parts: string[] = [];
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
  return parts;
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
  const frame = frameFor(lat, lng, width, height, propertyPolygon);
  const basePromise = getBasePNG(frame, width, height);

  // Linear mercator→pixel mapping over the exportImage frame — exact,
  // because the imagery was requested in the same 3857 bbox.
  const spanX = frame.xmax - frame.xmin;
  const spanY = frame.ymax - frame.ymin;
  const px: Px = (lon, la) => [
    ((merX(lon) - frame.xmin) / spanX) * width,
    ((frame.ymax - merY(la)) / spanY) * height,
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

  parts.push(
    ...propertyParts(px, propertyPolygon, lat, lng),
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;

  const base = await basePromise;
  // JPEG out, not PNG: aerial imagery is photographic — PNG made each map
  // ~2 MB and the 16-map fact pack a 30 MB download; JPEG q82 reads
  // identically at print size for ~a tenth of that.
  return sharp(base)
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/**
 * Full-page portrait cover aerial in the landing-hero (light) style: the
 * near-grayscale washed aerial the homepage hero uses, with the white
 * veil gradient BAKED into the jpeg (react-pdf can't paint CSS
 * gradients) — heavy at the top and bottom where the cover type sits,
 * clear over the lot — plus the amber lot outline and pin.
 */
export async function renderCoverAerial({
  lat,
  lng,
  propertyPolygon = null,
  width = 1050,
  height = 1486,
}: {
  lat: number;
  lng: number;
  propertyPolygon?: unknown | null;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const frame = frameFor(lat, lng, width, height, propertyPolygon);
  const basePromise = getBasePNG(frame, width, height);
  const spanX = frame.xmax - frame.xmin;
  const spanY = frame.ymax - frame.ymin;
  const px: Px = (lon, la) => [
    ((merX(lon) - frame.xmin) / spanX) * width,
    ((frame.ymax - merY(la)) / spanY) * height,
  ];
  const parts = propertyParts(px, propertyPolygon, lat, lng);
  const VEIL = "#f8fafc";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${VEIL}" stop-opacity="0.94"/>` +
    `<stop offset="0.36" stop-color="${VEIL}" stop-opacity="0.5"/>` +
    `<stop offset="0.6" stop-color="${VEIL}" stop-opacity="0.26"/>` +
    `<stop offset="0.84" stop-color="${VEIL}" stop-opacity="0.6"/>` +
    `<stop offset="1" stop-color="${VEIL}" stop-opacity="0.94"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#veil)"/>` +
    parts.join("") +
    `</svg>`;
  const base = await basePromise;
  // Same wash as the homepage hero: brightness ~1.04, saturation way
  // down, a touch less contrast.
  return sharp(base)
    .modulate({ brightness: 1.04, saturation: 0.18 })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
