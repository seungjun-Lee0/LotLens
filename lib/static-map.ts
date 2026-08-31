// Server-side static map renderer for the PDF report.
//
// Two-stage design, built for the PDF route's "render 16 module maps of
// the SAME frame" workload:
//
//   1. BASE: the SAME Queensland Government aerial the web report map
//      uses (LatestStateProgram ImageServer), fetched as ONE exportImage
//      request for the whole frame and promise-memoised, so 16 concurrent
//      module renders share a single upstream call. No tile compositing
//      at all: the previous tile pipeline both hammered the tile server
//      (~380 duplicate fetches, two at a time) and scrambled the image
//      when the Mapbox @2x URL returned 512px tiles into 256px slots.
//   2. OVERLAYS: module polygons, cadastre hairlines, the yellow
//      property outline and the pin are projected to pixels with plain
//      web-mercator math and composited onto the base as an SVG layer by
//      sharp. Pure CPU, no network, runs happily in parallel.

import sharp from "sharp";

import { contourCoverageBbox, type OverlayFeature } from "@/lib/overlays";

// Bound sharp's memory footprint for the bulk workload. The libvips
// operation cache retains decoded bitmaps between calls — helpful for a
// hot single render, but in a 40-report bulk ZIP it just piles up raw
// buffers until the heap OOMs. Disable it, and pin libvips to one thread
// per op: every render here is network-bound (the exportImage fetch
// dominates), so the CPU parallelism buys nothing and only multiplies
// peak memory when several composites run at once.
sharp.cache(false);
sharp.concurrency(1);
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";
import { stopBadgeFragment } from "@/lib/stop-icons";

// Same imagery service as components/report/module-map.tsx: the PDF and
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
  extraPoints: number[][] = [],
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
  // Point markers that must be in frame (transport stops): a tighter
  // margin than the parcel's: a badge clipped at the very edge is fine,
  // a sliced lot outline is not.
  for (const [lon, la] of extraPoints) {
    needX = Math.max(needX, Math.abs(merX(lon) - cx) * 1.15);
    needY = Math.max(needY, Math.abs(merY(la) - cy) * 1.15);
  }
  const scale = Math.min(10, Math.max(1, needX / hw, needY / hh));
  hw *= scale;
  hh *= scale;
  return { xmin: cx - hw, ymin: cy - hh, xmax: cx + hw, ymax: cy + hh };
}

// ── Base imagery: one exportImage call per frame ───────────────────────

// Promise-memo so concurrent module renders share ONE in-flight fetch.
// The entry is dropped the moment the fetch settles — the point is to
// dedupe the many module renders of a single report that all fire at once,
// NOT to hold decoded imagery between reports (in a bulk run every report
// has a different frame, so a retained buffer is never re-read and just
// grows the heap until it OOMs).
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
    p.finally(() => basePromises.delete(key)).catch(() => {});
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

function lineStrings(geometry: { type?: string; coordinates?: unknown } | null | undefined): number[][][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as number[][][];
  return [];
}

/** Open path (no Z): closing a contour or pipe run would invent an edge. */
function lineToPath(line: number[][], px: Px): string {
  let d = "";
  line.forEach(([lon, lat], i) => {
    const [x, y] = px(lon, lat);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d;
}

/** "Selected property" SVG fragments: white halo + amber outline (real
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
 * Transport framing: fit the CLOSEST handful of stops, not every stop the
 * module returned — fitting them all zoomed the frame out to suburb scale,
 * and a radius rule alone fails in the CBD, where "within 800 m" is still
 * dozens of stops spanning kilometres of frame. Nearest five inside
 * ~800 m; always at least the closest two so a transit desert still shows
 * something. Mirrors the web map's rule in module-map.tsx; used by BOTH
 * the render and warmFrames so the warmed frame's memo key matches the
 * render's. Farther stops still exist in the data; the viewBox clips them.
 */
function nearbyStopPoints(points: number[][], lat: number, lng: number): number[][] {
  const NEAR_DEG = 0.0072; // ~800 m
  const MIN_STOPS = 2;
  const MAX_STOPS = 5;
  return points
    .map(([x, y]) => ({
      x,
      y,
      d: Math.hypot((x - lng) * Math.cos((lat * Math.PI) / 180), y - lat),
    }))
    .sort((a, b) => a.d - b.d)
    .filter((p, i) => i < MIN_STOPS || (i < MAX_STOPS && p.d <= NEAR_DEG))
    .map((p) => [p.x, p.y]);
}

/**
 * Fire-and-forget imagery warmer for the PDF route. The upstream
 * exportImage calls (~2 s each) dominate the render, and none of them
 * need the full report payload — so the loader kicks this off as soon
 * as the coordinates and parcel polygon are known, and the later render
 * calls hit the basePromises memo instead of the network.
 *
 * `propertyPolygon` must be the SAME polygon the render will use:
 * frameFor widens the frame to fit the parcel, so warming without it
 * computes a different frame and misses the memo (a wasted fetch, never
 * a wrong image — the memo key is the exact bbox).
 */
export function warmFrames(
  lat: number,
  lng: number,
  propertyPolygon: unknown | null = null,
  transportPoints?: number[][],
): void {
  const warm = (w: number, h: number, pts: number[][] = []) => {
    const frame = frameFor(lat, lng, w, h, propertyPolygon, pts);
    getBasePNG(frame, w, h).catch(() => {});
  };
  if (transportPoints && transportPoints.length > 0) {
    // The transport module's widened frame — its own upstream call. Trimmed
    // to the nearby stops so the warmed bbox matches the render's exactly.
    warm(1200, 720, nearbyStopPoints(transportPoints, lat, lng));
  } else {
    warm(1200, 720); // shared lot-scale frame, every other module map
    warm(1050, 1486); // cover aerial
  }
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
  fitPoints = false,
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
  /** Widen the frame so overlay POINT features (transport stops) are in
   * view. Off by default: every other module frames the lot. */
  fitPoints?: boolean;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const stopPoints: number[][] = [];
  for (const f of overlays) {
    if (f.geometry?.type === "Point") stopPoints.push(f.geometry.coordinates);
  }
  const frame = frameFor(
    lat, lng, width, height, propertyPolygon,
    fitPoints ? nearbyStopPoints(stopPoints, lat, lng) : [],
  );
  const basePromise = getBasePNG(frame, width, height);

  // Linear mercator→pixel mapping over the exportImage frame: exact,
  // because the imagery was requested in the same 3857 bbox.
  const spanX = frame.xmax - frame.xmin;
  const spanY = frame.ymax - frame.ymin;
  const px: Px = (lon, la) => [
    ((merX(lon) - frame.xmin) / spanX) * width,
    ((frame.ymax - merY(la)) / spanY) * height,
  ];

  const parts: string[] = [];

  // Module overlays: evenodd so polygon holes render correctly (an
  // upgrade over the old outer-ring-only drawing).
  //
  // Fills go down in one pass, outlines in a second pass on top: painted
  // per-polygon, a neighbouring polygon's fill lands over the edge that
  // was just stroked and eats half its width. The outline uses the
  // darkened stroke colour (lib/overlays.ts) at a width that survives the
  // ~0.44× downscale from this 1200 px render to the PDF page.
  const outlines: string[] = [];
  // Diagonal-hatch pattern defs, one per colour actually used (school
  // secondary catchments). Prepended to the svg below.
  const hatchDefs: string[] = [];
  const hatchIds = new Map<string, string>();
  const hatchId = (color: string): string => {
    let id = hatchIds.get(color);
    if (!id) {
      id = `hatch${hatchIds.size}`;
      hatchIds.set(color, id);
      // Sparse, light stripes: the catchment usually covers the WHOLE
      // frame, so a dense hatch would wallpaper the map.
      hatchDefs.push(
        `<pattern id="${id}" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
          `<rect x="0" y="0" width="5" height="26" fill="${color}" fill-opacity="0.65"/></pattern>`,
      );
    }
    return id;
  };
  for (const f of overlays) {
    const geom = f.geometry as { type?: string; coordinates?: unknown } | null;
    for (const poly of polygonRings(geom)) {
      const d = ringsToPath(poly, px);
      if (!d) continue;
      const c = f.properties.fillColor;
      const sw = (f.properties as { strokeWidth?: number }).strokeWidth;
      if (f.properties.fillPattern === "hatch") {
        parts.push(`<path d="${d}" fill="url(#${hatchId(c)})" fill-rule="evenodd"/>`);
      } else {
        parts.push(
          `<path d="${d}" fill="${c}" fill-opacity="${f.properties.fillOpacity ?? 0.35}" fill-rule="evenodd"/>`,
        );
      }
      // Boundary-only overlays (school catchments) carry a strokeWidth: paint
      // a white casing under a bolder line so the boundary reads over the
      // aerial (mirrors the web map's overlay-line-casing).
      if (sw) {
        outlines.push(
          `<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${(sw + 3).toFixed(1)}" stroke-linejoin="round"/>`,
        );
      }
      outlines.push(
        `<path d="${d}" fill="none" stroke="${f.properties.strokeColor ?? c}" stroke-width="${(sw ?? 3.2).toFixed(1)}" stroke-linejoin="round"/>`,
      );
    }
    // LineString features (stormwater pipes, sewer/water mains, contour
    // lines) stroke in their OWN colour, not the darkened outline tint -
    // for contours the colour IS the elevation. Pushed with the outlines
    // so they paint above every polygon fill. Width honours the feature's
    // strokeWidth when set (contours ask for a thin 2): many fine lines
    // read as terrain, few fat ones read as scribble.
    const lineW = (f.properties as { strokeWidth?: number }).strokeWidth ?? 3;
    const lineO = (f.properties as { strokeOpacity?: number }).strokeOpacity ?? 0.95;
    for (const line of lineStrings(geom)) {
      const d = lineToPath(line, px);
      if (!d) continue;
      outlines.push(
        `<path d="${d}" fill="none" stroke="${f.properties.fillColor}" stroke-width="${lineW}" stroke-opacity="${lineO}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }
  // Contour coverage veil (mirrors the web map): dim outside the fetched
  // contour window when the frame extends past it, UNDER the contour lines
  // so they stay crisp. Gaussian-blurred so the dim FADES in across the
  // data boundary instead of stopping at a hard seam; the outer rect
  // extends past the frame so the blur never lightens the frame edges.
  // Skipped when the data covers the whole frame.
  const cov = contourCoverageBbox(overlays);
  if (cov) {
    const [cx0, cy0] = px(cov.west, cov.north);
    const [cx1, cy1] = px(cov.east, cov.south);
    if (cx0 > 0 || cy0 > 0 || cx1 < width || cy1 < height) {
      const fade = 0.12 * Math.min(cx1 - cx0, cy1 - cy0);
      const m = (2 * fade).toFixed(1);
      parts.push(
        `<defs><filter id="covblur" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${(fade / 2).toFixed(1)}"/></filter></defs>` +
          `<path d="M-${m} -${m}H${width + 2 * fade}V${height + 2 * fade}H-${m}Z M${cx0.toFixed(1)} ${cy0.toFixed(1)}H${cx1.toFixed(1)}V${cy1.toFixed(1)}H${cx0.toFixed(1)}Z" fill="#0b1220" fill-opacity="0.55" fill-rule="evenodd" filter="url(#covblur)"/>`,
      );
    }
  }

  parts.push(...outlines);

  // Cadastre lot boundaries: faint white hairlines so zone fills read
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

  // Point features, on top of everything. Fill/line drawing ignores Point
  // geometry, so without these the stops never appeared on the PDF map at
  // all. Modes with a badge (train/bus/ferry/tram) get the shared
  // stop-icons marker; any other point falls back to a plain dot. The SVG
  // viewBox clips whatever lands outside the frame.
  for (const f of overlays) {
    if (f.geometry?.type !== "Point") continue;
    const [lon, la] = f.geometry.coordinates;
    const [x, y] = px(lon, la);
    const badge = stopBadgeFragment(f.properties.legendLabel, x, y, 38);
    parts.push(
      badge ??
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${f.properties.fillColor}" stroke="#ffffff" stroke-width="1.5"/>`,
    );
  }

  const defs = hatchDefs.length > 0 ? `<defs>${hatchDefs.join("")}</defs>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}${parts.join("")}</svg>`;

  const base = await basePromise;
  // JPEG out, not PNG: aerial imagery is photographic: PNG made each map
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
 * gradients): heavy at the top and bottom where the cover type sits,
 * clear over the lot: plus the amber lot outline and pin.
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
  // Homepage-hero LOUPE cover (DARK): a wide, dimmed aerial of the
  // neighbourhood fills the page, and a crisp circular loupe in the middle
  // magnifies the lot with its amber outline — the property reads as the
  // bright focal point over the darkened surroundings.

  // Supersample: the frame geometry (and every coordinate below) stays in
  // the logical width/height space, but the imagery is FETCHED at SS× that
  // pixel density and the SVG overlays rasterise at SS× via their viewBox.
  // Same geographic extent, genuinely sharper pixels (QLD state imagery is
  // sub-metre, so there's headroom) — the cover is the one page that gets
  // this treatment, so the file-size cost lands only once.
  const SS = 1.5;
  const W = Math.round(width * SS);
  const H = Math.round(height * SS);

  // 1. Wide context frame (background) = the lot-fit frame zoomed out.
  const fit = frameFor(lat, lng, width, height, propertyPolygon);
  const fcx = (fit.xmin + fit.xmax) / 2;
  const fcy = (fit.ymin + fit.ymax) / 2;
  const fhw = (fit.xmax - fit.xmin) / 2;
  const fhh = (fit.ymax - fit.ymin) / 2;
  const WIDE = 2.4;
  const wideFrame: Frame = {
    xmin: fcx - fhw * WIDE,
    xmax: fcx + fhw * WIDE,
    ymin: fcy - fhh * WIDE,
    ymax: fcy + fhh * WIDE,
  };
  const widePromise = getBasePNG(wideFrame, W, H);

  // 2. Loupe = a square frame tight on the lot, rendered at the loupe size.
  const D = 660; // loupe diameter (logical px)
  const DD = Math.round(D * SS); // loupe fetch/raster size
  const sq = Math.max(fhw, fhh, 1); // square half-span: the whole lot fits
  const loupeFrame: Frame = {
    xmin: fcx - sq,
    xmax: fcx + sq,
    ymin: fcy - sq,
    ymax: fcy + sq,
  };
  const loupePromise = getBasePNG(loupeFrame, DD, DD);

  const loupeSpan = loupeFrame.xmax - loupeFrame.xmin;
  const loupePx: Px = (lon, la) => [
    ((merX(lon) - loupeFrame.xmin) / loupeSpan) * D,
    ((loupeFrame.ymax - merY(la)) / loupeSpan) * D,
  ];
  const loupeParts = propertyParts(loupePx, propertyPolygon, lat, lng);

  // Loupe centre on the page: below the brand/address block, above the
  // prepared-by strip.
  const cx = Math.round(width / 2);
  const cy = Math.round(height * 0.55);
  const ringW = 3; // thin, refined hairline ring

  const [wide, loupeBase] = await Promise.all([widePromise, loupePromise]);

  // Dark, dimmed neighbourhood background: darken + desaturate the aerial,
  // then a dark navy veil (heavy top/bottom where the cover type sits) so
  // the crisp loupe reads as the bright focal point.
  const VEIL = "#0b1220";
  const veilSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<defs><linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${VEIL}" stop-opacity="0.9"/>` +
    `<stop offset="0.28" stop-color="${VEIL}" stop-opacity="0.6"/>` +
    `<stop offset="0.5" stop-color="${VEIL}" stop-opacity="0.5"/>` +
    `<stop offset="0.72" stop-color="${VEIL}" stop-opacity="0.6"/>` +
    `<stop offset="1" stop-color="${VEIL}" stop-opacity="0.9"/>` +
    `</linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#veil)"/></svg>`;
  const bg = await sharp(wide)
    .modulate({ brightness: 0.52, saturation: 0.45 })
    .composite([{ input: Buffer.from(veilSvg) }])
    .toBuffer();

  // The loupe image: crisp aerial + lot outline + a thin white ring, then a
  // circular alpha mask so everything outside the circle is transparent.
  // viewBox in logical D-space, rasterised at DD → strokes scale with it.
  const loupeOverlay =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DD}" height="${DD}" viewBox="0 0 ${D} ${D}">` +
    loupeParts.join("") +
    // hairline dark line just inside the white ring for crisp definition
    `<circle cx="${D / 2}" cy="${D / 2}" r="${D / 2 - ringW - 0.5}" fill="none" stroke="#0b1220" stroke-opacity="0.35" stroke-width="1"/>` +
    `<circle cx="${D / 2}" cy="${D / 2}" r="${D / 2 - ringW / 2}" fill="none" stroke="#ffffff" stroke-opacity="0.92" stroke-width="${ringW}"/>` +
    `</svg>`;
  const circleMask =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DD}" height="${DD}" viewBox="0 0 ${D} ${D}">` +
    `<circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`;
  const loupe = await sharp(loupeBase)
    .modulate({ brightness: 1.03, saturation: 1.05 })
    .composite([
      { input: Buffer.from(loupeOverlay) },
      { input: Buffer.from(circleMask), blend: "dest-in" },
    ])
    .png()
    .toBuffer();

  // Soft light halo so the loupe lifts off the dark ground (a dark drop
  // shadow would be invisible here).
  const glowSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${width} ${height}">` +
    `<defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%">` +
    `<feGaussianBlur stdDeviation="26"/></filter></defs>` +
    `<circle cx="${cx}" cy="${cy}" r="${D / 2 + 6}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="24" filter="url(#g)"/></svg>`;

  return sharp(bg)
    .composite([
      { input: Buffer.from(glowSvg), top: 0, left: 0 },
      {
        input: loupe,
        top: Math.round((cy - D / 2) * SS),
        left: Math.round((cx - D / 2) * SS),
      },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}
