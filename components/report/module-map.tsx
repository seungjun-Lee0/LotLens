"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Lightweight property-pin map. OSM raster basemap (free, no key).
// Polygon overlays are deferred — see comment in lib/pipeline.ts re:
// returnGeometry=false in our ArcGIS queries.

export function ModuleMap({
  lat,
  lng,
  tint,
  zoom = 15,
}: {
  lat: number;
  lng: number;
  /** Pin colour. Pass a CSS color expression. */
  tint: string;
  zoom?: number;
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
            tiles: [
              "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    mapRef.current = map;

    // Custom pin: a small filled circle in the module's tint.
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

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, tint, zoom]);

  return (
    <div
      ref={containerRef}
      className="h-44 w-full overflow-hidden rounded-2xl border border-border/40"
      style={{ background: "var(--muted)" }}
      aria-label="Property location map"
    />
  );
}
