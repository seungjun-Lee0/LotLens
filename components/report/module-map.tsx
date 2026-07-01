"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { OverlayFeature } from "@/lib/overlays";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Mapbox satellite-streets (and Esri World Imagery) render a little flat /
// hazy at these zooms. A small contrast + saturation lift on the raster
// layer punches the imagery back up without touching the overlay polygons
// or lot lines. Tune these two if it's over/under-cooked.
const RASTER_PAINT = {
  "raster-contrast": 0.28,
  "raster-saturation": 0.32,
} as const;

/**
 * Prefer Mapbox Satellite Streets (Develo-grade imagery) when the token
 * is configured. Fall back to free Esri World Imagery so the report
 * still renders if Mapbox is unset.
 */
function buildBasemapStyle(): maplibregl.StyleSpecification {
  if (MAPBOX_TOKEN) {
    return {
      version: 8,
      sources: {
        mapbox: {
          type: "raster",
          tiles: [
            `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
          ],
          tileSize: 256,
          attribution:
            '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="http://www.openstreetmap.org/about/">OpenStreetMap</a>',
        },
      },
      layers: [{ id: "mapbox", type: "raster", source: "mapbox", paint: RASTER_PAINT }],
    };
  }
  return {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution:
          "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [{ id: "esri", type: "raster", source: "esri", paint: RASTER_PAINT }],
  };
}

// Property-pin map with optional module-specific overlay polygons. OSM
// raster basemap (free, no key). Each feature carries a `fillColor` in its
// properties so a single fill layer paints them all.

export function ModuleMap({
  lat,
  lng,
  tint,
  zoom = 16,
  className = "h-44 w-full",
  overlays = [],
  propertyPolygon = null,
  lotLines = null,
}: {
  lat: number;
  lng: number;
  /** Pin colour. Pass a CSS color expression. */
  tint: string;
  zoom?: number;
  /** Tailwind size classes. Default "h-44 w-full". */
  className?: string;
  /** Module-tagged polygon features. Empty array = pin-only map. */
  overlays?: OverlayFeature[];
  /** GeoJSON FeatureCollection of nearby cadastre lots, drawn as faint
   * boundary lines so zone fills read per-lot. null = no lot lines. */
  lotLines?: unknown | null;
  /** GeoJSON Polygon / MultiPolygon for the cadastre lot the property
   * sits on. When present we use this as the yellow "selected property"
   * highlight; falls back to a ~30 m square otherwise. */
  propertyPolygon?: unknown | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [lng, lat],
      zoom,
      attributionControl: { compact: true },
      style: buildBasemapStyle(),
    });
    mapRef.current = map;

    // Small centre dot — gives the eye an exact geocoded point inside
    // the "selected property" box drawn below as a map layer.
    const el = document.createElement("div");
    el.style.cssText = `
      width: 8px; height: 8px;
      border-radius: 999px;
      background: ${tint};
      box-shadow:
        0 0 0 1.5px white,
        0 4px 10px -3px color-mix(in oklab, ${tint} 60%, transparent);
    `;
    new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

    map.on("load", () => {
      if (overlays.length > 0) {
        map.addSource("overlays", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: overlays,
          },
        });
        map.addLayer({
          id: "overlay-fill",
          type: "fill",
          source: "overlays",
          paint: {
            "fill-color": ["get", "fillColor"],
            // Per-feature opacity when set (zoning fills are faint so the
            // satellite imagery + lot lines stay legible), else the default.
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.35],
            "fill-antialias": true,
          },
        });
        map.addLayer({
          id: "overlay-line",
          type: "line",
          source: "overlays",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["get", "fillColor"],
            "line-width": 1.8,
            "line-opacity": 0.95,
          },
        });
      }

      // Cadastre lot boundaries — faint white hairlines so zone fills read
      // per-lot (Develo-style) instead of as one flat colour wash. Drawn
      // above the overlay fill but below the selected-property outline.
      if (
        lotLines &&
        typeof lotLines === "object" &&
        (lotLines as { type?: string }).type === "FeatureCollection"
      ) {
        map.addSource("lot-lines", {
          type: "geojson",
          data: lotLines as GeoJSON.FeatureCollection,
        });
        map.addLayer({
          id: "lot-lines",
          type: "line",
          source: "lot-lines",
          layout: { "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": 0.8,
            "line-opacity": 0.55,
          },
        });
      }

      // "Selected property" highlight — drawn ABOVE the overlay polygons
      // so it stays visible regardless of overlay colour.
      // Prefer the real cadastre lot polygon (from zoning); fall back to a
      // ~30 m box when no parcel was matched.
      const PROP = 0.00028;
      const fallbackBox = {
        type: "Polygon" as const,
        coordinates: [[
          [lng - PROP, lat - PROP],
          [lng + PROP, lat - PROP],
          [lng + PROP, lat + PROP],
          [lng - PROP, lat + PROP],
          [lng - PROP, lat - PROP],
        ]],
      };
      const propertyGeom =
        propertyPolygon &&
        typeof propertyPolygon === "object" &&
        ((propertyPolygon as { type?: string }).type === "Polygon" ||
          (propertyPolygon as { type?: string }).type === "MultiPolygon")
          ? (propertyPolygon as GeoJSON.Geometry)
          : fallbackBox;
      map.addSource("selected-property", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: propertyGeom,
        },
      });
      map.addLayer({
        id: "selected-property-line",
        type: "line",
        source: "selected-property",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#f5c518", "line-width": 2.8 },
      });
      // Frame the property, not the polygons. We let overlay polygons
      // extend outside the viewport — MapLibre clips them for free.
      // Develo's reports zoom in tight (~100 m half-width); matching that
      // makes the lot outline read at a glance and overlay tints feel
      // immediate. Larger overlay polygons are still obvious from the
      // colour bleeding off the edges.
      const PAD = 0.00105; // ~115 m half-width at Brisbane latitude
      map.fitBounds(
        [
          [lng - PAD, lat - PAD],
          [lng + PAD, lat + PAD],
        ],
        // Cap at z18: Brisbane Mapbox satellite tops out near its native
        // resolution around here, so z19 overzooms and reads soft/washed.
        { padding: 10, maxZoom: 18, duration: 0 },
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // overlays identity changes are not expected mid-life — the parent passes
    // a stable array per server render. If you start re-rendering with new
    // overlays, switch to setData on the existing source instead of recreating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Floating legend (Apple-style glass card, bottom-right of the map).
  // We dedupe overlay (fillColor, legendLabel) pairs so each colour is
  // listed once — the user can see at a glance what each tint means.
  const legendItems: { color: string; label: string }[] = [
    { color: "#f5c518", label: "Selected property" },
  ];
  const seen = new Set<string>();
  for (const f of overlays) {
    const key = `${f.properties.fillColor}|${f.properties.legendLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    legendItems.push({
      color: f.properties.fillColor,
      label: f.properties.legendLabel,
    });
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`${className} overflow-hidden rounded-2xl border border-border/40`}
        style={{ background: "var(--muted)" }}
        aria-label="Property location map"
      />
      {legendItems.length > 0 && (
        <div className="pointer-events-none absolute bottom-2.5 right-2.5 z-10 max-w-[55%] sm:bottom-3 sm:right-3">
          <div
            className="rounded-xl px-2.5 py-2 text-[10.5px] leading-tight shadow-[0_4px_18px_-6px_rgba(0,0,0,0.4)] sm:text-[11px]"
            style={{
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "saturate(180%) blur(14px)",
              WebkitBackdropFilter: "saturate(180%) blur(14px)",
              color: "#1d1d1f",
            }}
          >
            <ul className="flex flex-col gap-1">
              {legendItems.map((item) => (
                <li key={`${item.color}-${item.label}`} className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{
                      background: item.color,
                      outline: `1px solid color-mix(in oklab, ${item.color} 75%, transparent)`,
                    }}
                  />
                  <span className="truncate font-medium">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
