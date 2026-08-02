"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { CONTOUR_LEGEND_LABEL, type OverlayFeature } from "@/lib/overlays";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";
import { hasStopIcon, stopBadgeSVG } from "@/lib/stop-icons";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Basemap source. QLD imagery is the authoritative government aerial (what
// Queensland Globe / Council mapping shows) and reads far crisper than
// Mapbox satellite. Flip to "mapbox" or "esri" to fall back.
const BASEMAP: "qld" | "mapbox" | "esri" = "qld";

// Queensland Government "Latest state program" aerial imagery, a dynamic
// ImageServer (SR 3857) that reprojects on the fly, so it drops straight
// into MapLibre. Public (no token), statewide QLD coverage. We hand it each
// tile's bbox via MapLibre's {bbox-epsg-3857} placeholder and ask for a
// 512px image in a 256-unit tile slot (= @2x retina sharpness).
const QLD_IMAGERY =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage" +
  "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpeg&transparent=false&f=image";

// A small contrast + saturation lift punches the imagery up without touching
// the overlay polygons or lot lines. Tune these two if it's over/under-cooked.
const RASTER_PAINT = {
  "raster-contrast": 0.12,
  "raster-saturation": 0.15,
} as const;

function buildBasemapStyle(): maplibregl.StyleSpecification {
  if (BASEMAP === "qld") {
    return {
      version: 8,
      sources: {
        qld: {
          type: "raster",
          tiles: [QLD_IMAGERY],
          tileSize: 256,
          attribution:
            "Imagery &copy; State of Queensland (Department of Resources)",
        },
      },
      layers: [{ id: "qld", type: "raster", source: "qld", paint: RASTER_PAINT }],
    };
  }
  if (BASEMAP === "mapbox" && MAPBOX_TOKEN) {
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
  zoom = 16,
  className = "h-44 w-full",
  overlays = [],
  applicableOverlays = [],
  propertyPolygon = null,
  lotLines = null,
  fitPoints = false,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  /** Tailwind size classes. Default "h-44 w-full". */
  className?: string;
  /** Module-tagged polygon features. Empty array = pin-only map. */
  overlays?: OverlayFeature[];
  /** Property-hit features used for the legend. Nearby context is excluded. */
  applicableOverlays?: OverlayFeature[];
  /** GeoJSON FeatureCollection of nearby cadastre lots, drawn as faint
   * boundary lines so zone fills read per-lot. null = no lot lines. */
  lotLines?: unknown | null;
  /** GeoJSON Polygon / MultiPolygon for the cadastre lot the property
   * sits on. When present we use this as the yellow "selected property"
   * highlight; falls back to a ~30 m square otherwise. */
  propertyPolygon?: unknown | null;
  /** Widen the initial frame so overlay POINT features (transport stops)
   * are in view. Off by default: every other module frames the lot. */
  fitPoints?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [lng, lat],
      zoom,
      // The compact control adds an info-button beside the attribution.
      // At report-map scale that glyph reads like a broken logo; keep the
      // required source credit permanently visible without the toggle.
      attributionControl: { compact: false },
      cooperativeGestures: true,
      style: buildBasemapStyle(),
    });
    mapRef.current = map;

    map.on("load", async () => {
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
        // Polygon OUTLINES only. The darkened strokeColor is right for a
        // border over that polygon's own 35% fill, but LineString features
        // (stormwater pipes, contours) ARE their colour: darkening a
        // contour breaks the elevation ramp, so they get their own layer.
        map.addLayer({
          id: "overlay-line",
          type: "line",
          source: "overlays",
          filter: ["==", ["geometry-type"], "Polygon"],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            // Darkened fill colour (see lib/overlays.ts) at full opacity -
            // a same-hue outline over a 35% fill blurs into it.
            "line-color": ["coalesce", ["get", "strokeColor"], ["get", "fillColor"]],
            "line-width": 2.4,
            "line-opacity": 1,
          },
        });
        map.addLayer({
          id: "overlay-linestrings",
          type: "line",
          source: "overlays",
          filter: ["==", ["geometry-type"], "LineString"],
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": ["get", "fillColor"],
            "line-width": 2,
            "line-opacity": 0.95,
          },
        });
      }

      // Cadastre lot boundaries: faint white hairlines so zone fills read
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

      // "Selected property" highlight, drawn above the overlay polygons
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
        paint: {
          "line-color": SELECTED_PROPERTY_STYLE.colorHex,
          "line-width": SELECTED_PROPERTY_STYLE.lineWidth,
        },
      });
      // Frame the property, not the overlay polygons (MapLibre clips those
      // for free). Baseline is the tight Develo-style ~115 m half-width -
      // but the bounds EXTEND to contain the whole selected parcel, so a
      // shopping-centre-sized lot (Westfield Chermside spans ~470 m)
      // doesn't get its outline sliced off at the viewport edges.
      const PAD = 0.00105; // ~115 m half-width at Brisbane latitude
      const bounds = new maplibregl.LngLatBounds(
        [lng - PAD, lat - PAD],
        [lng + PAD, lat + PAD],
      );
      const extendRings = (g: GeoJSON.Geometry) => {
        const polys =
          g.type === "Polygon" ? [g.coordinates] :
          g.type === "MultiPolygon" ? g.coordinates : [];
        for (const poly of polys as number[][][][]) {
          for (const ring of poly) {
            for (const [x, y] of ring) bounds.extend([x, y]);
          }
        }
      };
      if (propertyGeom !== fallbackBox) extendRings(propertyGeom);
      const pointFeats = overlays.filter((f) => f.geometry?.type === "Point");
      if (fitPoints) {
        for (const f of pointFeats) {
          const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
          bounds.extend([x, y]);
        }
      }
      map.fitBounds(
        bounds,
        // padding gives the parcel breathing room when it drives the
        // frame; maxZoom 18 keeps small lots from overzooming past the
        // imagery's native resolution.
        { padding: 28, maxZoom: 18, duration: 0 },
      );

      // Point features. Fill/line layers ignore Point geometry entirely,
      // so without these the stops never appeared on the map at all.
      // Modes with a badge (train/bus/ferry/tram) get the shared
      // stop-icons marker; any other point falls back to a plain dot.
      if (pointFeats.length > 0) {
        const iconLabels = [
          ...new Set(
            pointFeats
              .map((f) => f.properties.legendLabel)
              .filter((l) => hasStopIcon(l)),
          ),
        ];
        map.addLayer({
          id: "overlay-points",
          type: "circle",
          source: "overlays",
          filter: [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["!", ["in", ["get", "legendLabel"], ["literal", iconLabels]]],
          ],
          paint: {
            "circle-radius": 4,
            "circle-color": ["get", "fillColor"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.2,
          },
        });
        // Badge images decode async from data URIs; the map can unmount
        // mid-await (mapRef nulled in cleanup), so bail before touching it.
        await Promise.all(
          iconLabels.map(
            (label) =>
              new Promise<void>((resolve) => {
                const svg = stopBadgeSVG(label, 48);
                if (!svg) return resolve();
                const img = new Image(48, 48);
                img.onload = () => {
                  if (mapRef.current === map && !map.hasImage(`stop:${label}`)) {
                    map.addImage(`stop:${label}`, img, { pixelRatio: 2 });
                  }
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
              }),
          ),
        );
        if (mapRef.current !== map) return;
        if (iconLabels.length > 0) {
          map.addLayer({
            id: "overlay-stop-icons",
            type: "symbol",
            source: "overlays",
            filter: [
              "all",
              ["==", ["geometry-type"], "Point"],
              ["in", ["get", "legendLabel"], ["literal", iconLabels]],
            ],
            layout: {
              "icon-image": ["concat", "stop:", ["get", "legendLabel"]],
              "icon-allow-overlap": true,
            },
          });
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // overlays identity changes are not expected mid-life; the parent passes
    // a stable array per server render. If you start re-rendering with new
    // overlays, switch to setData on the existing source instead of recreating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applicableKeys = new Set(
    applicableOverlays.map((f) => `${f.properties.fillColor}|${f.properties.legendLabel}`),
  );
  const visibleLegendItems: { color: string; label: string; applies: boolean }[] = [];
  const seenVisible = new Set<string>();
  for (const f of overlays) {
    const key = `${f.properties.fillColor}|${f.properties.legendLabel}`;
    if (seenVisible.has(key)) continue;
    seenVisible.add(key);
    visibleLegendItems.push({
      color: f.properties.fillColor,
      label: f.properties.legendLabel,
      applies: applicableKeys.has(key),
    });
  }
  // Show both property and surrounding context in the canvas legend without
  // an extra scope suffix. Contours use the elevation legend
  // below the map, so the generic line label is never shown here.
  const appliesItems = visibleLegendItems.filter(
    (item) => item.applies && item.label !== CONTOUR_LEGEND_LABEL,
  );
  const nearbyItems = visibleLegendItems.filter(
    (item) => !item.applies && item.label !== CONTOUR_LEGEND_LABEL,
  );

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`${className} overflow-hidden rounded-2xl border border-border/40`}
        style={{ background: "var(--muted)" }}
        aria-label="Property location map"
      />
      <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[58%] sm:left-auto sm:right-3 sm:top-3 sm:max-w-[48%]">
        <div
          className="rounded-lg px-1.5 py-1 text-[8.5px] leading-tight shadow-[0_4px_18px_-6px_rgba(0,0,0,0.4)] sm:rounded-xl sm:px-2.5 sm:py-2 sm:text-[11px]"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "saturate(180%) blur(14px)",
            WebkitBackdropFilter: "saturate(180%) blur(14px)",
            color: "#1d1d1f",
          }}
        >
          <ul className="flex flex-col gap-0.5 sm:gap-1">
            <li className="flex items-center gap-1.5 sm:gap-2">
              <span
                className="size-1.5 shrink-0 rounded-sm sm:size-2.5"
                style={{
                  background: SELECTED_PROPERTY_STYLE.color,
                  outline: `1px solid color-mix(in oklab, ${SELECTED_PROPERTY_STYLE.color} 75%, transparent)`,
                }}
              />
              <span className="truncate font-medium">{SELECTED_PROPERTY_STYLE.label}</span>
            </li>
            {appliesItems.map((item) => (
              <li key={`applies-${item.color}-${item.label}`} className="flex items-center gap-1.5 sm:gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-sm sm:size-2.5"
                  style={{
                    background: item.color,
                    outline: `1px solid color-mix(in oklab, ${item.color} 75%, transparent)`,
                  }}
                />
                <span className="truncate font-medium">{item.label}</span>
              </li>
            ))}
            {nearbyItems.map((item) => (
              <li
                key={`nearby-${item.color}-${item.label}`}
                className="flex items-center gap-1.5 opacity-65 sm:gap-2"
              >
                <span
                  className="size-1.5 shrink-0 rounded-sm sm:size-2.5"
                  style={{
                    background: item.color,
                    outline: `1px solid color-mix(in oklab, ${item.color} 65%, transparent)`,
                  }}
                />
                <span className="truncate font-medium">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
