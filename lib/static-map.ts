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

// Esri World Imagery — free satellite tile service, no API key. URL uses
// {z}/{y}/{x} order (ArcGIS REST convention) rather than OSM's {z}/{x}/{y}.
const SAT_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_UA = "PropAI/0.1 Brisbane-DD-prototype (contact: jun@propai.dev)";

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
  propertyPolygon = null,
  width = 1200,
  height = 720,
}: {
  lat: number;
  lng: number;
  /** Property pin colour. */
  tint: string;
  /** Module-tagged polygon features from extractOverlays(). */
  overlays: OverlayFeature[];
  /** GeoJSON Polygon / MultiPolygon for the cadastre lot. When present
   * we draw it as the yellow highlight; otherwise we fall back to a
   * ~50 m box around the geocoded point. */
  propertyPolygon?: unknown | null;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const map = new StaticMaps({
    width,
    height,
    tileUrl: SAT_TILES,
    tileSize: 256,
    tileRequestHeader: { "User-Agent": TILE_UA, "Accept-Language": "en" },
    tileRequestTimeout: 15000,
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

  // "Selected property" highlight — mirrors Develo's yellow lot outline.
  // Uses the real cadastre lot polygon (from zoning's point-query) when
  // present, falls back to a ~60×60 m box centred on the geocoded point
  // when zoning didn't match (rare for Brisbane LGA addresses).
  const drawPropertyRing = (ring: [number, number][]) => {
    // White halo first for legibility against dark satellite imagery.
    map.addPolygon({ coords: ring, color: "#ffffff", width: 5, fill: "#ffffff00" });
    map.addPolygon({
      coords: ring,
      color: "#f5c518",
      width: 3,
      fill: withAlpha("#f5c518", 0.28),
    });
  };

  let drew = false;
  if (
    propertyPolygon &&
    typeof propertyPolygon === "object" &&
    "type" in propertyPolygon
  ) {
    const g = propertyPolygon as { type: string; coordinates: unknown };
    if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
      const ring = (g.coordinates as number[][][])[0];
      if (ring && ring.length >= 3) {
        drawPropertyRing(ring as [number, number][]);
        drew = true;
      }
    } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates as number[][][][]) {
        const ring = poly[0];
        if (ring && ring.length >= 3) {
          drawPropertyRing(ring as [number, number][]);
          drew = true;
        }
      }
    }
  }
  if (!drew) {
    const PROP_HALF = 0.00028;
    drawPropertyRing([
      [lng - PROP_HALF, lat - PROP_HALF],
      [lng + PROP_HALF, lat - PROP_HALF],
      [lng + PROP_HALF, lat + PROP_HALF],
      [lng - PROP_HALF, lat + PROP_HALF],
      [lng - PROP_HALF, lat - PROP_HALF],
    ]);
  }

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
