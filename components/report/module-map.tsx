"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  CONTOUR_LEGEND_LABEL,
  contourCoverageBbox,
  type OverlayFeature,
} from "@/lib/overlays";
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

type ViewBox = { west: number; south: number; east: number; north: number };

/** True when the feature's bbox intersects the fitted viewport. */
function featureInView(f: OverlayFeature, box: ViewBox): boolean {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const scan = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number;
      const y = c[1] as number;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      return;
    }
    for (const sub of c) scan(sub);
  };
  scan((f.geometry as { coordinates?: unknown } | null)?.coordinates);
  return xMax >= box.west && xMin <= box.east && yMax >= box.south && yMin <= box.north;
}

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
  tightFrame = false,
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
  /** Frame ~half as wide as the default so the selected lot stays the
   * obvious subject. For maps whose layer fills the whole viewport
   * (contours): everywhere-colour needs a closer look at the lot. */
  tightFrame?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Legend isolate: tap a legend row to show only that layer. Holds each
  // overlay layer's base filter so the label condition can be AND-ed onto it.
  const baseFiltersRef = useRef<Array<[string, unknown]>>([]);
  const [isolated, setIsolated] = useState<string | null>(null);
  // The fitted initial viewport, set once after fitBounds: the legend lists
  // only layers actually visible in this frame. A row for an off-screen
  // feature reads as "it's here somewhere" and sends the reader hunting.
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);

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

    // Tapping the map clears any legend isolate — an intuitive "show all"
    // that never fights the user with a timer. (Legend taps hit the HTML
    // overlay, not the canvas, so they don't trigger this.)
    map.on("click", () => setIsolated(null));

    map.on("load", async () => {
      // Hatch-fill layer ids (one per colour), so the legend isolate can
      // filter them like every other overlay layer.
      const hatchLayerIds: string[] = [];
      if (overlays.length > 0) {
        map.addSource("overlays", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            // Context overlays always carry geometry; the null-geometry
            // form only exists in property-scoped (legend) extractions.
            features: overlays.filter(
              (f): f is typeof f & { geometry: GeoJSON.Geometry } =>
                f.geometry != null,
            ),
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
        // Diagonal-hatch fills for features that opt in via fillPattern
        // (secondary school catchments): a hatch OVER another zone's tint
        // reads as "both", where two stacked tints blend into mud. One
        // stripe tile + one layer per colour actually present.
        const hatchColors = [
          ...new Set(
            overlays
              .filter((f) => f.properties.fillPattern === "hatch")
              .map((f) => f.properties.fillColor),
          ),
        ];
        for (const color of hatchColors) {
          // Sparse, light stripes (the catchment usually covers the whole
          // frame — a dense hatch would wallpaper the map). 48px tile at
          // pixelRatio 2 = 24 logical px spacing, ~2.5px stripes.
          const tile = document.createElement("canvas");
          tile.width = 48;
          tile.height = 48;
          const tg = tile.getContext("2d");
          if (!tg) continue;
          tg.strokeStyle = color;
          tg.lineWidth = 5;
          for (const off of [-48, 0, 48]) {
            tg.beginPath();
            tg.moveTo(off, 48);
            tg.lineTo(off + 48, 0);
            tg.stroke();
          }
          const name = `hatch-${color}`;
          if (!map.hasImage(name)) {
            map.addImage(name, tg.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
          }
          const id = `overlay-fill-hatch-${color}`;
          map.addLayer({
            id,
            type: "fill",
            source: "overlays",
            filter: [
              "all",
              ["==", ["geometry-type"], "Polygon"],
              ["==", ["get", "fillPattern"], "hatch"],
              ["==", ["get", "fillColor"], color],
            ],
            paint: { "fill-pattern": name, "fill-opacity": 0.65 },
          });
          hatchLayerIds.push(id);
        }
        // Polygon OUTLINES only. The darkened strokeColor is right for a
        // border over that polygon's own 35% fill, but LineString features
        // (stormwater pipes, contours) ARE their colour: darkening a
        // contour breaks the elevation ramp, so they get their own layer.
        // White casing UNDER the outline for boundary-only overlays (school
        // catchments): a thin green thread vanishes over the aerial, so a
        // white halo makes it read over both dark trees and light rooftops.
        map.addLayer({
          id: "overlay-line-casing",
          type: "line",
          source: "overlays",
          filter: ["all", ["==", ["geometry-type"], "Polygon"], ["has", "strokeWidth"]],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": ["+", ["coalesce", ["get", "strokeWidth"], 2.4], 3],
            "line-opacity": 0.85,
          },
        });
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
            // Boundary-only overlays (catchments) opt into a bolder width.
            "line-width": ["coalesce", ["get", "strokeWidth"], 2.4],
            "line-opacity": 1,
          },
        });
        // Contour coverage veil: dim everything OUTSIDE the fetched contour
        // window (a big lot's frame can extend past the data; a hard edge
        // of lines reads as a bug, a dimmed border reads as "measured
        // extent"). Drawn as a geo-anchored IMAGE — a canvas filled with
        // the veil colour, the coverage box erased through a blur so the
        // dim falls off GRADUALLY instead of stopping at a hard seam. The
        // image extends far past any plausible frame and tracks pan/zoom.
        const cov = contourCoverageBbox(overlays);
        if (cov) {
          const spanX = cov.east - cov.west;
          const spanY = cov.north - cov.south;
          const EXT = 2.5 * Math.max(spanX, spanY);
          const W = 1024;
          const H = 1024;
          const sx = W / (spanX + 2 * EXT);
          const sy = H / (spanY + 2 * EXT);
          const canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = H;
          const g = canvas.getContext("2d");
          if (g) {
            g.fillStyle = "#0b1220";
            g.fillRect(0, 0, W, H);
            // Feathered hole over the coverage box: the blurred erase makes
            // the veil fade in over ~a tenth of the coverage span.
            const hx = EXT * sx;
            const hy = EXT * sy;
            const hw = spanX * sx;
            const hh = spanY * sy;
            g.globalCompositeOperation = "destination-out";
            g.filter = `blur(${(0.12 * Math.min(hw, hh)).toFixed(1)}px)`;
            g.fillStyle = "#000";
            g.fillRect(hx, hy, hw, hh);
            map.addSource("contour-coverage", {
              type: "image",
              url: canvas.toDataURL(),
              coordinates: [
                [cov.west - EXT, cov.north + EXT],
                [cov.east + EXT, cov.north + EXT],
                [cov.east + EXT, cov.south - EXT],
                [cov.west - EXT, cov.south - EXT],
              ],
            });
            map.addLayer({
              id: "contour-coverage-veil",
              type: "raster",
              source: "contour-coverage",
              paint: { "raster-opacity": 0.55, "raster-fade-duration": 0 },
            });
          }
        }
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
            // Per-feature overrides: contours ask for thin lines; pipes
            // and mains keep the bolder defaults.
            "line-width": ["coalesce", ["get", "strokeWidth"], 2],
            "line-opacity": ["coalesce", ["get", "strokeOpacity"], 0.95],
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
      // Contour maps opt into a tighter frame: their layer covers the WHOLE
      // viewport, so at the default frame the lot drowns in colour. ~66 m
      // half-width keeps the parcel unmistakably the subject (the wider
      // contour fetch window still fills the frame edge to edge).
      const PAD = tightFrame ? 0.0006 : 0.00105; // ~66 m / ~115 m half-width
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
        // Frame the CLOSEST handful of stops, not every stop the module
        // returned: fitting them all zoomed the frame out to suburb scale,
        // and a radius alone fails in the CBD, where "within 800 m" is
        // still dozens of stops spanning kilometres. Nearest five inside
        // ~800 m; always at least the closest two so a transit desert
        // still shows something. (Mirrors nearbyStopPoints in
        // lib/static-map.ts — keep the two rules identical.)
        const NEAR_DEG = 0.0072; // ~800 m
        const MIN_STOPS = 2;
        const MAX_STOPS = 5;
        const withDist = pointFeats
          .map((f) => {
            const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
            const dx = (x - lng) * Math.cos((lat * Math.PI) / 180);
            const dy = y - lat;
            return { x, y, d: Math.hypot(dx, dy) };
          })
          .sort((a, b) => a.d - b.d);
        withDist.forEach((p, i) => {
          if (i < MIN_STOPS || (i < MAX_STOPS && p.d <= NEAR_DEG)) {
            bounds.extend([p.x, p.y]);
          }
        });
      }
      map.fitBounds(
        bounds,
        // padding gives the parcel breathing room when it drives the
        // frame; maxZoom 18 keeps small lots from overzooming past the
        // imagery's native resolution (tight frames trade a touch of
        // sharpness for a legible lot).
        { padding: 28, maxZoom: tightFrame ? 18.5 : 18, duration: 0 },
      );
      // duration 0 → bounds are final immediately; hand them to the legend
      // so it can drop rows for features outside this frame.
      const vb = map.getBounds();
      setViewBox({
        west: vb.getWest(),
        south: vb.getSouth(),
        east: vb.getEast(),
        north: vb.getNorth(),
      });

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

      // Snapshot each overlay layer's base filter so the legend can isolate
      // one layer by AND-ing a legendLabel condition onto it (and restore it
      // on deselect) without re-deriving the geometry-type filters.
      baseFiltersRef.current = [
        "overlay-fill",
        ...hatchLayerIds,
        "overlay-line-casing",
        "overlay-line",
        "overlay-linestrings",
        "overlay-points",
        "overlay-stop-icons",
      ] // (overlay-line-casing = the polygon-boundary halo, e.g. catchments)
        .filter((id) => map.getLayer(id))
        .map((id) => [id, map.getFilter(id) ?? null]);
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

  // Apply the legend isolate: only features whose legendLabel matches the
  // tapped row stay visible (the property outline is a separate source, so
  // isolating it just hides every overlay). Deselect restores base filters.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      // The selected-property outline is its own source/layer, so it's never
      // filtered here — it stays visible regardless of the isolate.
      for (const [id, base] of baseFiltersRef.current) {
        if (!map.getLayer(id)) continue;
        let filter = base;
        if (isolated) {
          const cond = ["==", ["get", "legendLabel"], isolated];
          filter = base ? ["all", base, cond] : cond;
        }
        map.setFilter(id, (filter ?? undefined) as maplibregl.FilterSpecification | undefined);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [isolated]);

  const toggleIsolate = (label: string) =>
    setIsolated((prev) => (prev === label ? null : label));

  // Match on the LABEL alone: the property-scoped extraction can colour the
  // same layer slightly differently from the context pass (ramp
  // normalisation, per-feature grading), and keying on colour+label made
  // genuinely on-lot layers show as context-only.
  const applicableKeys = new Set(
    applicableOverlays.map((f) => f.properties.legendLabel),
  );
  const visibleLegendItems: { color: string; label: string; applies: boolean }[] = [];
  const seenVisible = new Set<string>();
  for (const f of overlays) {
    // Only layers actually visible in the fitted frame earn a legend row —
    // a row for an off-screen feature reads as "it's on this map somewhere"
    // and sends the reader hunting for a shape that isn't there.
    if (viewBox && !featureInView(f, viewBox)) continue;
    const key = `${f.properties.fillColor}|${f.properties.legendLabel}`;
    if (seenVisible.has(key)) continue;
    seenVisible.add(key);
    visibleLegendItems.push({
      color: f.properties.fillColor,
      label: f.properties.legendLabel,
      applies: applicableKeys.has(f.properties.legendLabel),
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
      <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[62%] sm:left-auto sm:right-3 sm:top-3 sm:max-w-[52%]">
        <div
          className="pointer-events-auto rounded-lg px-1.5 py-1 text-[8.5px] leading-tight shadow-[0_4px_18px_-6px_rgba(0,0,0,0.4)] sm:rounded-xl sm:px-2.5 sm:py-2 sm:text-[11px]"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "saturate(180%) blur(14px)",
            WebkitBackdropFilter: "saturate(180%) blur(14px)",
            color: "#1d1d1f",
          }}
        >
          <ul className="flex flex-col gap-0.5 sm:gap-1">
            {/* Selected property: always shown, never a toggle. */}
            <li className="flex items-center gap-1.5 px-0.5 sm:gap-2">
              <span
                className="size-1.5 shrink-0 rounded-sm sm:size-2.5"
                style={{
                  background: SELECTED_PROPERTY_STYLE.color,
                  outline: `1px solid color-mix(in oklab, ${SELECTED_PROPERTY_STYLE.color} 75%, transparent)`,
                }}
              />
              <span className="truncate font-medium">{SELECTED_PROPERTY_STYLE.label}</span>
            </li>
            {[...appliesItems, ...nearbyItems].map((item) => {
              const on = isolated === item.label;
              const dim = isolated != null && !on;
              return (
                <li key={`${item.color}-${item.label}`}>
                  <button
                    type="button"
                    onClick={() => toggleIsolate(item.label)}
                    aria-pressed={on}
                    title={
                      on ? `Showing ${item.label} only — tap to show all` : `Show ${item.label} only`
                    }
                    className={`flex w-full items-center gap-1.5 rounded px-1 py-px text-left transition sm:gap-2 ${dim ? "opacity-35" : ""} ${on ? "font-semibold" : "hover:bg-black/5"}`}
                    style={
                      on
                        ? {
                            background: `color-mix(in oklab, ${item.color} 20%, transparent)`,
                            // ring colour via boxShadow so it uses the item hue
                            boxShadow: `inset 0 0 0 1.5px ${item.color}`,
                          }
                        : undefined
                    }
                  >
                    {/* Plain colour key, uniformly styled. Whether a layer
                        touches the LOT is the module badge + summary's job;
                        the only ordering nod is applies-first (see
                        appliesItems/nearbyItems). */}
                    <span
                      className={`shrink-0 rounded-sm ${on ? "size-2 sm:size-3" : "size-1.5 sm:size-2.5"}`}
                      style={{
                        background: item.color,
                        outline: `1px solid color-mix(in oklab, ${item.color} 75%, transparent)`,
                      }}
                    />
                    <span className="truncate font-medium">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
