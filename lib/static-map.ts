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
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";

// Tile source: prefer Mapbox Satellite Streets (Develo-grade imagery)
// when NEXT_PUBLIC_MAPBOX_TOKEN is set, fall back to free Esri World
// Imagery so the PDF still renders without a token.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const SAT_TILES = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_UA = "LotLens/0.1 Brisbane-DD (contact: hello@lotlens.au)";

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
    const fill = withAlpha(fillColor, f.properties.fillOpacity ?? 0.35);
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

  // Cadastre lot boundaries — faint white hairlines so zone fills read
  // per-lot (Develo-style) instead of as one flat colour wash.
  if (
    lotLines &&
    typeof lotLines === "object" &&
    (lotLines as { type?: string; features?: unknown }).type === "FeatureCollection"
  ) {
    const fc = lotLines as {
      features?: Array<{ geometry?: { type?: string; coordinates?: unknown } }>;
    };
    const drawLotRing = (ring: [number, number][]) => {
      if (ring.length >= 3) {
        map.addPolygon({ coords: ring, color: "#ffffffcc", width: 0.8, fill: "#ffffff00" });
      }
    };
    for (const f of fc.features ?? []) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        const ring = (g.coordinates as number[][][])[0];
        if (ring) drawLotRing(ring as [number, number][]);
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates as number[][][][]) {
          const ring = poly[0];
          if (ring) drawLotRing(ring as [number, number][]);
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
    map.addPolygon({
      coords: ring,
      color: SELECTED_PROPERTY_STYLE.haloHex,
      width: SELECTED_PROPERTY_STYLE.haloWidth,
      fill: `${SELECTED_PROPERTY_STYLE.haloHex}00`,
    });
    map.addPolygon({
      coords: ring,
      color: SELECTED_PROPERTY_STYLE.colorHex,
      width: SELECTED_PROPERTY_STYLE.lineWidth,
      fill: `${SELECTED_PROPERTY_STYLE.colorHex}00`,
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
    color: SELECTED_PROPERTY_STYLE.colorHex,
    fill: SELECTED_PROPERTY_STYLE.colorHex,
    width: 0,
  });

  // ~280m half-width around the property — locks framing across modules.
  // Match the web map zoom (Develo-style tight ~115 m half-width).
  const PAD = 0.00105;
  await map.render([lng - PAD, lat - PAD, lng + PAD, lat + PAD]);

  return await map.image.buffer("image/png");
}
