"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { OverlayFeature } from "@/lib/overlays";

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
      style: {
        version: 8,
        sources: {
          // Esri World Imagery — free satellite raster tiles, no API key.
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
        layers: [{ id: "esri", type: "raster", source: "esri" }],
      },
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
            "fill-opacity": 0.35,
          },
        });
        map.addLayer({
          id: "overlay-line",
          type: "line",
          source: "overlays",
          paint: {
            "line-color": ["get", "fillColor"],
            "line-width": 1.5,
            "line-opacity": 0.9,
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
        id: "selected-property-fill",
        type: "fill",
        source: "selected-property",
        paint: { "fill-color": "#f5c518", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "selected-property-line",
        type: "line",
        source: "selected-property",
        paint: { "line-color": "#f5c518", "line-width": 2.4 },
      });
      // Frame the property, not the polygons. We let overlay polygons
      // extend outside the viewport — MapLibre clips them for free. A
      // property pack is about "where is YOUR house and what's on it",
      // not "how big is the flood polygon as a whole". A tight ~250 m
      // envelope keeps every module map at a consistent scale.
      const PAD = 0.0023; // ~250 m at Brisbane latitude
      map.fitBounds(
        [
          [lng - PAD, lat - PAD],
          [lng + PAD, lat + PAD],
        ],
        { padding: 12, maxZoom: 18, duration: 0 },
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

  return (
    <div
      ref={containerRef}
      className={`${className} overflow-hidden rounded-2xl border border-border/40`}
      style={{ background: "var(--muted)" }}
      aria-label="Property location map"
    />
  );
}
