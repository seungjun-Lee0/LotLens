// Hero aerial URL for the web report: the same Queensland Government
// imagery the maps and the PDF cover use, requested as ONE exportImage in
// EPSG:3857 so the browser gets a single photo instead of tiles. Pure
// arithmetic, no sharp: safe to import from a server component.

const QLD_IMAGERY_EXPORT =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage";

const R = 6378137;
const merX = (lon: number) => R * ((lon * Math.PI) / 180);
const merY = (lat: number) =>
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

// The lot sits at this fraction of the frame (x from left, y from top),
// not dead centre: the address and the verdict numerals occupy the
// lower-left, so the house is framed upper-right where nothing covers it.
const FOCUS_X = 0.7;
const FOCUS_Y = 0.36;

type HeroFrame = { xmin: number; ymin: number; xmax: number; ymax: number };

function heroFrame(lat: number, lng: number, width: number, height: number): HeroFrame {
  const metresPerPx = 0.45;
  // Mercator metres are inflated by 1/cos(lat) relative to ground metres.
  const k = 1 / Math.cos((lat * Math.PI) / 180);
  const w = width * metresPerPx * k;
  const h = height * metresPerPx * k;
  const lx = merX(lng);
  const ly = merY(lat);
  const xmin = lx - FOCUS_X * w;
  const ymax = ly + FOCUS_Y * h;
  return { xmin, ymin: ymax - h, xmax: xmin + w, ymax };
}

/**
 * A wide, landscape frame around the lot at ~0.45 m/px: the street and a
 * few neighbours, enough to read as "this house" without turning into a
 * satellite tile. `width`/`height` are the requested pixel size.
 */
export function heroAerialUrl(
  lat: number,
  lng: number,
  width = 1600,
  height = 640,
): string {
  const f = heroFrame(lat, lng, width, height);
  const bbox = [f.xmin, f.ymin, f.xmax, f.ymax].map((v) => v.toFixed(2)).join(",");
  return (
    `${QLD_IMAGERY_EXPORT}?bbox=${bbox}&bboxSR=3857&imageSR=3857` +
    `&size=${width},${height}&format=jpeg&transparent=false&f=image`
  );
}

/**
 * Project a GeoJSON Polygon/MultiPolygon into the pixel space of the
 * hero frame above, as SVG path data. The SVG is drawn with the same
 * viewBox and `preserveAspectRatio="xMidYMid slice"`, so it crops exactly
 * like the `object-cover` image underneath it.
 */
export function heroLotPath(
  polygon: unknown,
  lat: number,
  lng: number,
  width = 1600,
  height = 640,
): string {
  const g = polygon as { type?: string; coordinates?: unknown } | null;
  if (!g) return "";
  const rings: number[][][] =
    g.type === "Polygon"
      ? (g.coordinates as number[][][])
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][]).flat()
        : [];
  if (rings.length === 0) return "";
  const f = heroFrame(lat, lng, width, height);
  const px = (lon: number, la: number): [number, number] => [
    ((merX(lon) - f.xmin) / (f.xmax - f.xmin)) * width,
    ((f.ymax - merY(la)) / (f.ymax - f.ymin)) * height,
  ];
  let d = "";
  for (const ring of rings) {
    ring.forEach(([lon, la], i) => {
      const [x, y] = px(lon, la);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    d += "Z";
  }
  return d;
}
