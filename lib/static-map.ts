// Server-side static map renderer for the PDF report.
//
// Uses the `staticmaps` npm package — fetches OSM raster tiles, composites
// them with sharp, and draws our polygons + property pin. Output is a PNG
// Buffer that React-PDF can embed via Image src.
//
// Per OSM tile usage policy: include a unique User-Agent and don't hammer
// the tile server. Each PDF generation grabs ~9 tiles at our zoom level
// once, then in-process state caches them for the rest of the request.
// Prototype-scale traffic is well inside fair use.

import StaticMaps from "staticmaps";

import type { OverlayFeature } from "@/lib/overlays";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_UA = "PropAI/0.1 Brisbane-DD-prototype (contact: jun@propai.dev)";

// 8-digit hex with alpha for staticmaps fill colours.
function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/**
 * Render a property-centric map image, ~280 m envelope around the point,
 * with overlay polygons painted in their fill colours.
 *
 * Returns PNG bytes; pass as Buffer to React-PDF's Image src.
 */
export async function renderModuleMapPNG({
  lat,
  lng,
  tint,
  overlays,
  width = 1100,
  height = 540,
}: {
  lat: number;
  lng: number;
  /** Property pin colour. */
  tint: string;
  /** Module-tagged polygon features from extractOverlays(). */
  overlays: OverlayFeature[];
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const map = new StaticMaps({
    width,
    height,
    tileUrl: OSM_TILES,
    tileSize: 256,
    tileRequestHeader: { "User-Agent": OSM_UA, "Accept-Language": "en" },
    tileRequestTimeout: 12000,
    paddingX: 0,
    paddingY: 0,
  });

  for (const f of overlays) {
    if (!f.geometry) continue;
    const fillColor = f.properties.fillColor;
    const fill = withAlpha(fillColor, 0.35);
    const stroke = fillColor;
    if (f.geometry.type === "Polygon") {
      // staticmaps doesn't support holes; draw outer ring only.
      const ring = (f.geometry.coordinates as number[][][])[0];
      if (ring) {
        map.addPolygon({
          coords: ring as [number, number][],
          color: stroke,
          fill,
          width: 1.6,
        });
      }
    } else if (f.geometry.type === "MultiPolygon") {
      const polys = f.geometry.coordinates as number[][][][];
      for (const poly of polys) {
        const ring = poly[0];
        if (ring) {
          map.addPolygon({
            coords: ring as [number, number][],
            color: stroke,
            fill,
            width: 1.6,
          });
        }
      }
    }
  }

  // "Selected property" highlight — mirrors Develo's yellow box on every
  // module page. We don't have the actual cadastre lot polygon (a paid
  // Title Search), so we approximate with a ~50×50 m square centred on
  // the geocoded point. That matches typical Brisbane lot frontage and
  // is unambiguous enough to read at a glance.
  const PROP_HALF = 0.00028; // ~30 m at Brisbane latitude
  const propCoords: [number, number][] = [
    [lng - PROP_HALF, lat - PROP_HALF],
    [lng + PROP_HALF, lat - PROP_HALF],
    [lng + PROP_HALF, lat + PROP_HALF],
    [lng - PROP_HALF, lat + PROP_HALF],
    [lng - PROP_HALF, lat - PROP_HALF],
  ];
  // White soft halo behind so the highlight stays legible over dark
  // overlay polygons.
  map.addPolygon({
    coords: propCoords,
    color: "#ffffff",
    width: 4.5,
    fill: "#ffffff00",
  });
  map.addPolygon({
    coords: propCoords,
    color: "#f5c518", // Apple-ish yellow used by Develo for the same job
    width: 2.6,
    fill: withAlpha("#f5c518", 0.28),
  });

  // Small inner pin in the module tint — exact geocoded point.
  map.addCircle({
    coord: [lng, lat],
    radius: 3.5,
    color: tint,
    fill: tint,
    width: 0,
  });

  // ~280m half-width around the property — locks framing across modules.
  const PAD = 0.0023;
  await map.render([lng - PAD, lat - PAD, lng + PAD, lat + PAD]);

  return await map.image.buffer("image/png");
}
