"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { OverlayFeature } from "@/lib/overlays";

// Property-pin map with optional module-specific overlay polygons. OSM
// raster basemap (free, no key). Each feature carries a `fillColor` in its
// properties so a single fill layer paints them all.

function bboxFromFeatures(
  features: OverlayFeature[],
  fallback: { lat: number; lng: number },
): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function visit(coords: unknown) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const lng = coords[0] as number;
      const lat = coords[1] as number;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  }
  for (const f of features) {
    if (!f.geometry) continue;
    visit((f.geometry as { coordinates?: unknown }).coordinates);
  }
  if (!Number.isFinite(minLng)) {
    // No features — make a tiny box around the property pin.
    const pad = 0.0015;
    return [
      [fallback.lng - pad, fallback.lat - pad],
      [fallback.lng + pad, fallback.lat + pad],
    ];
  }
  // Include the property pin in the bounds.
  if (fallback.lng < minLng) minLng = fallback.lng;
  if (fallback.lng > maxLng) maxLng = fallback.lng;
  if (fallback.lat < minLat) minLat = fallback.lat;
  if (fallback.lat > maxLat) maxLat = fallback.lat;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export function ModuleMap({
  lat,
  lng,
  tint,
  zoom = 16,
  className = "h-44 w-full",
  overlays = [],
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
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    mapRef.current = map;

    // Pin
    const el = document.createElement("div");
    el.style.cssText = `
      width: 18px; height: 18px;
      border-radius: 999px;
      background: ${tint};
      box-shadow:
        0 0 0 2px white,
        0 6px 16px -4px color-mix(in oklab, ${tint} 60%, transparent);
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

        // Fit to overlay extents (with the pin included).
        const [sw, ne] = bboxFromFeatures(overlays, { lat, lng });
        map.fitBounds(
          [
            [sw[0], sw[1]],
            [ne[0], ne[1]],
          ],
          { padding: 28, maxZoom: 17, duration: 0 },
        );
      }
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
