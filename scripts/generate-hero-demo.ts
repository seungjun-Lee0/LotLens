// npx tsx scripts/generate-hero-demo.ts
//
// Snapshots REAL report data for the landing-page hero loupe: the cadastre
// lot under the loupe centre, neighbouring lot lines, and every module's
// context overlay polygons — fetched from the exact same ArcGIS services
// the report pipeline queries, coloured by the exact same extractOverlays()
// classifiers. Output: lib/hero-demo-data.json (committed fixture, so the
// landing page stays fully static and never blocks on council servers).
//
// Coordinates are stored normalised to the hero aerial's bbox:
//   u = 0..1 left→right, v = 0..1 top→bottom
// so the client just multiplies by the SVG viewBox — no mercator math there.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { queryArcGIS } from "../lib/arcgis";
import { fetchPropertyParcel } from "../lib/property";
import { extractOverlays, type OverlayFeature } from "../lib/overlays";
import type { Module } from "../lib/db";

const R = 6378137;
const merX = (lon: number) => R * ((lon * Math.PI) / 180);
const merY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

// ── Demo lot + hero framing (Web-Mercator EPSG:3857) ─────────────────────
//
// The demo lot: Graceville riverside — floods in the river overlay AND the
// 2011/2022 historic events, sits in the traditional-character belt, near
// the rail noise corridor. Rich across many modules.
// Override for experiments: `npx tsx scripts/generate-hero-demo.ts -27.52,152.97`
const argCenter = process.argv[2]?.split(",").map(Number);
const CENTER =
  argCenter && argCenter.length === 2 && argCenter.every(Number.isFinite)
    ? { lat: argCenter[0], lng: argCenter[1] }
    : { lat: -27.519, lng: 152.9727 }; // 115RP73818 — Graceville character belt, river flood fringe

// Frame sizes (metres in mercator): hero 2800×1580 (16:9), loupe 320×320.
// The lot is NOT centred in the hero frame — it sits at (68%, 47%), which
// is where the loupe circle renders in the desktop layout. The lens
// therefore hovers over the actual spot it magnifies.
const HERO_W = 2800;
const HERO_H = 1580;
const LOT_FX = 0.68; // fraction from the left edge
const LOT_FY = 0.47; // fraction from the top edge
const CX = merX(CENTER.lng);
const CY = merY(CENTER.lat);
const HERO_BBOX = {
  xmin: Math.round(CX - LOT_FX * HERO_W),
  xmax: Math.round(CX + (1 - LOT_FX) * HERO_W),
  ymin: Math.round(CY - (1 - LOT_FY) * HERO_H),
  ymax: Math.round(CY + LOT_FY * HERO_H),
};
const LOUPE_BBOX = {
  xmin: Math.round(CX - 160),
  xmax: Math.round(CX + 160),
  ymin: Math.round(CY - 160),
  ymax: Math.round(CY + 160),
};

// Envelope half-width in degrees that covers the whole hero aerial
// (hero is ~2.8 km wide → half ~1.4 km ≈ 0.0126° lon at Brisbane).
const CONTEXT_BUFFER = 0.0135;
const OFFSET = 0.00008; // ~9 m server-side simplification
const PARCEL_LAYER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/property_boundaries_parcel/FeatureServer/0/query";

// Same service URLs as lib/modules/*.ts (constants there aren't exported;
// keep this table in sync if a module's source layer ever changes).
const SVC = {
  floodOverall: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Flood_Risk_Overall/FeatureServer/0/query",
  flood2022: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Historic_Brisbane_River_and_Creek_Floods_Feb2022/FeatureServer/0/query",
  flood2011: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Historic_Brisbane_River_Floods_Jan2011/FeatureServer/0/query",
  fpRiver: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Brisbane_River_flood_planning_area/FeatureServer/0/query",
  fpCreek: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_overlay_Creek_waterway_flood_planning_area/FeatureServer/0/query",
  overland: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Overland_Flow/FeatureServer/0/query",
  stormTide: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Flood_Awareness_Storm_Tide/FeatureServer/0/query",
  bushfire: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Bushfire_overlay/FeatureServer/0/query",
  vegetation: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Biodiversity_areas_overlay_Biodiversity_areas/FeatureServer/0/query",
  heritageState: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Heritage_overlay_State_heritage_area/FeatureServer/0/query",
  heritageLocal: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Hertiage_overlay_Local_heritage_area/FeatureServer/0/query",
  character: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Traditional_building_character_overlay/FeatureServer/0/query",
  easementHV: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements/FeatureServer/0/query",
  easementCad: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9/query",
  noiseTransport: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Transport_noise_corridor_overlay/FeatureServer/0/query",
  noiseAnef: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/City_Plan_2014_Airport_environs_overlay_Australian_Noise_Exposure_Forecast_ANEF/FeatureServer/0/query",
  schools: "https://services7.arcgis.com/NFcbS1pD4k19hD9O/arcgis/rest/services/State_school_catchments_by_Year_Level__Current/FeatureServer/0/query",
  zoning: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Zoning_opendata/FeatureServer/0/query",
  koalaPriority: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/KoalaPlan/MapServer/1/query",
  koalaCore: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/KoalaPlan/MapServer/3/query",
  koalaLocal: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/KoalaPlan/MapServer/5/query",
  msesWildlife: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/MattersOfStateEnvironmentalSignificance/MapServer/21/query",
  ass25k: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/SoilsAndLandResource/MapServer/1902/query",
  ass100k: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/SoilsAndLandResource/MapServer/2002/query",
  tenement: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Economy/MineralTenement/MapServer/0/query",
  kraResource: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/MiningResources/MapServer/9/query",
  kraSeparation: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/MiningResources/MapServer/10/query",
  bccLandslide: "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Landslide_overlay/FeatureServer/0/query",
} as const;

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

async function context(url: string, outFields: string, offset = OFFSET) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await queryArcGIS(url, {
        geometry: { x: CENTER.lng, y: CENTER.lat, spatialReference: 4326 },
        geometryType: "esriGeometryPoint",
        inSR: 4326,
        outFields,
        returnGeometry: true,
        bufferDegrees: CONTEXT_BUFFER,
        maxAllowableOffset: offset,
      });
    } catch (err) {
      console.warn(`  ! attempt ${attempt} failed (${url.slice(0, 90)}…):`, (err as Error).message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { type: "FeatureCollection", features: [] } as FeatureCollection<Geometry | null>;
}

// ── Geometry → normalised hero-space rings ───────────────────────────────

type Ring = number[][]; // [[u,v], ...]

const HW = HERO_BBOX.xmax - HERO_BBOX.xmin;
const HH = HERO_BBOX.ymax - HERO_BBOX.ymin;
const toUV = ([lon, lat]: number[]): [number, number] => [
  (merX(lon) - HERO_BBOX.xmin) / HW,
  (HERO_BBOX.ymax - merY(lat)) / HH,
];

// Sutherland–Hodgman clip against the (slightly expanded) hero rectangle so
// suburb-scale polygons (school catchments…) don't bloat the fixture.
const CLIP = { min: -0.03, max: 1.03 };
function clipRing(ring: [number, number][]): [number, number][] {
  const edges: Array<(p: [number, number]) => number> = [
    (p) => p[0] - CLIP.min,
    (p) => CLIP.max - p[0],
    (p) => p[1] - CLIP.min,
    (p) => CLIP.max - p[1],
  ];
  let poly = ring;
  for (const inside of edges) {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    poly = out;
    if (poly.length === 0) break;
  }
  return poly;
}

// Ramer–Douglas–Peucker on a closed ring, tolerance in hero-normalised units.
function rdp(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 4) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let dmax = 0, idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function geometryToRings(geom: Geometry, tol = 0): Ring[] {
  const polys: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] :
    geom.type === "MultiPolygon" ? geom.coordinates : [];
  const rings: Ring[] = [];
  for (const poly of polys) {
    for (const raw of poly) {
      let pts = raw.map(toUV);
      // GeoJSON rings repeat the first vertex at the end. Drop it — we treat
      // rings as cyclic (the clipper wraps, SVG `Z` closes) and a zero-length
      // RDP anchor chord (first === last) would collapse the whole ring.
      if (pts.length > 1) {
        const [f, l] = [pts[0], pts[pts.length - 1]];
        if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
      }
      let clipped = clipRing(pts);
      if (clipped.length < 3) continue;
      if (tol > 0) clipped = rdp(clipped, tol);
      const rounded: Ring = [];
      for (const [u, v] of clipped) {
        const p = [Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4];
        const last = rounded[rounded.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p);
      }
      if (rounded.length >= 3) rings.push(rounded);
    }
  }
  return rings;
}

function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

// Ray-cast: is the demo point inside this (lon/lat) geometry?
function containsCenter(geom: Geometry): boolean {
  const polys: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] :
    geom.type === "MultiPolygon" ? geom.coordinates : [];
  const { lng: px, lat: py } = CENTER;
  for (const poly of polys) {
    let inside = false;
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
      }
      if (r === 0) inside = hit;
      else if (hit) inside = false; // in a hole
    }
    if (inside) return true;
  }
  return false;
}

// ── Fixture shapes ───────────────────────────────────────────────────────

type HeroFeature = { c: string; o?: number; p: Ring[] };
type HeroModule = { features: HeroFeature[]; note: string; hit: boolean };

const MAX_FEATURES = 250;
// Features entirely outside the loupe get dropped when smaller than ~3 px²
// on the 1600×900 background — invisible there, and the loupe never shows
// them. Anything overlapping the loupe window is kept regardless of size.
// (Kept permissive: layers like overland flow are made of hundreds of small
// street-scale slivers whose aggregate IS the background silhouette.)
const MIN_BG_AREA = 2e-6;

function loupeRect() {
  const pad = 0.02;
  return {
    u0: (LOUPE_BBOX.xmin - HERO_BBOX.xmin) / HW - pad,
    u1: (LOUPE_BBOX.xmax - HERO_BBOX.xmin) / HW + pad,
    v0: (HERO_BBOX.ymax - LOUPE_BBOX.ymax) / HH - pad,
    v1: (HERO_BBOX.ymax - LOUPE_BBOX.ymin) / HH + pad,
  };
}

function intersectsLoupe(rings: Ring[]): boolean {
  const L = loupeRect();
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const r of rings) for (const [u, v] of r) {
    if (u < umin) umin = u;
    if (u > umax) umax = u;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  return umax >= L.u0 && umin <= L.u1 && vmax >= L.v0 && vmin <= L.v1;
}

// Dual-resolution simplification: a feature the loupe can show keeps ~0.5 px
// (at loupe scale) fidelity; background-only silhouettes get ~1 px (at bg
// scale), which is 10× coarser in hero units.
const TOL_LOUPE = 1e-4; // ~0.8 px at loupe scale — visually lossless
const TOL_BG = 6e-4;

// Per-module feature caps: overland flow is thousands of street-scale
// slivers — beyond ~120 the extra ones stop changing the picture.
const MAX_OVERRIDE: Partial<Record<string, number>> = { overland_flow: 120 };

function pack(overlays: OverlayFeature[], moduleKey: string): HeroFeature[] {
  const all = overlays
    .map((f) => {
      // Extract at loupe fidelity first (a coarse first pass would collapse
      // building-scale features to nothing before we can classify them),
      // then downsample if the loupe can never show this feature. Giant
      // polygons that snake across the whole frame (creek flood planning
      // areas) get mid/coarse tolerances — full fidelity across 2.8 km of
      // fractal fringe is fixture bloat for sub-pixel gains.
      const fineRings = geometryToRings(f.geometry, TOL_LOUPE);
      if (fineRings.length === 0) return null;
      const fine = intersectsLoupe(fineRings);
      const bboxArea = (() => {
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const r of fineRings) for (const [u, v] of r) {
          if (u < u0) u0 = u; if (u > u1) u1 = u;
          if (v < v0) v0 = v; if (v > v1) v1 = v;
        }
        return (u1 - u0) * (v1 - v0);
      })();
      const giant = bboxArea > 0.02;
      // Overland flow is hundreds of intricate slivers — squash background
      // ones extra hard so the street-scale PATTERN survives the vertex
      // budget instead of three giant blobs eating it.
      const bgTol = moduleKey === "overland_flow" ? 1.5e-3 : giant ? 1.2e-3 : TOL_BG;
      const tol = fine ? (giant ? 4e-4 : TOL_LOUPE) : bgTol;
      let rings = tol === TOL_LOUPE ? fineRings : geometryToRings(f.geometry, tol);
      // Overland background: no single blob may hog the vertex budget —
      // the layer's value is the street-scale PATTERN of many slivers.
      if (moduleKey === "overland_flow" && !fine) {
        const n = rings.reduce((s, r) => s + r.length, 0);
        if (n > 200) rings = geometryToRings(f.geometry, 3e-3);
        if (rings.reduce((s, r) => s + r.length, 0) > 300) return null;
      }
      return {
        c: f.properties.fillColor,
        ...(f.properties.fillOpacity !== undefined ? { o: f.properties.fillOpacity } : {}),
        p: rings.length > 0 ? rings : fineRings,
      };
    })
    .filter((f): f is HeroFeature => f !== null && f.p.length > 0);
  const area = (f: HeroFeature) => f.p.reduce((s, r) => s + ringArea(r), 0);
  let packed = all.filter((f) => intersectsLoupe(f.p) || area(f) >= MIN_BG_AREA);
  // Never let the size filter empty out a module that HAS nearby data
  // (heritage sites are building-scale — individually sub-pixel on the
  // background, but a pinned layer must still show its dots).
  if (packed.length < 12 && all.length > packed.length) {
    const rest = all.filter((f) => !packed.includes(f)).sort((a, b) => area(b) - area(a));
    packed = packed.concat(rest.slice(0, 12 - packed.length));
  }
  // Loupe-relevant features survive the cap first, then largest-by-area.
  packed.sort((a, b) => {
    const la = intersectsLoupe(a.p) ? 1 : 0;
    const lb = intersectsLoupe(b.p) ? 1 : 0;
    if (la !== lb) return lb - la;
    return area(b) - area(a);
  });
  // Hard vertex budget per module so no layer can dominate the fixture —
  // loupe-relevant features are first in line; an oversized feature is
  // skipped rather than breaking, so smaller ones can still fill in.
  // Split the vertex budget between loupe-visible features and background
  // silhouette so neither starves the other (fine loupe features are ~10×
  // heavier per feature than coarse background ones). An oversized feature
  // is skipped rather than breaking, so smaller ones still fill in.
  const max = MAX_OVERRIDE[moduleKey] ?? MAX_FEATURES;
  const LOUPE_BUDGET = 1200;
  const BG_BUDGET = 900;
  const kept: HeroFeature[] = [];
  let ptsL = 0;
  let ptsB = 0;
  for (const f of packed) {
    if (kept.length >= max) break;
    const n = f.p.reduce((s, r) => s + r.length, 0);
    if (intersectsLoupe(f.p)) {
      if (kept.length > 0 && ptsL + n > LOUPE_BUDGET) continue;
      kept.push(f);
      ptsL += n;
    } else {
      if (kept.length > 0 && ptsB + n > BG_BUDGET) continue;
      kept.push(f);
      ptsB += n;
    }
  }
  if (kept.length < all.length) {
    console.warn(`  ! ${moduleKey}: ${all.length} → ${kept.length} features (loupe ${ptsL} + bg ${ptsB} pts)`);
  }
  return kept;
}

function shortLabel(label: string): string {
  return label
    .replace(/\s*\(.*\)$/, "")
    .replace(/^Transport corridor/i, "corridor")
    .replace("Low-medium density residential", "LMR · 2–3 storey")
    .replace("General residential", "residential")
    .replace("Open space / Recreation", "open space")
    .toLowerCase()
    .replace("lmr", "LMR")
    .replace("anef", "ANEF");
}

function note(
  overlays: OverlayFeature[],
  inFrameCount: number,
  moduleKey: Module,
): { note: string; hit: boolean } {
  const hits = overlays.filter((f) => containsCenter(f.geometry));
  if (moduleKey === "schools") {
    return hits.length > 0
      ? { note: `${hits.length} catchment${hits.length > 1 ? "s" : ""}`, hit: true }
      : { note: "none mapped", hit: false };
  }
  if (hits.length > 0) return { note: shortLabel(hits[0].properties.legendLabel), hit: true };
  return inFrameCount > 0
    ? { note: `${Math.min(inFrameCount, 99)} nearby`, hit: false }
    : { note: "clear", hit: false };
}

async function main() {
  console.log(`Hero demo point: ${CENTER.lat.toFixed(6)}, ${CENTER.lng.toFixed(6)}`);

  const parcel = await fetchPropertyParcel(CENTER.lat, CENTER.lng);
  if (!parcel.polygon) throw new Error("No cadastre parcel at the loupe centre — adjust LOUPE_BBOX.");
  console.log(`Parcel: ${parcel.lotPlan} · ${parcel.street ?? "?"} ${parcel.suburb ?? ""} · ${parcel.areaM2 ?? "?"} m²`);

  // Neighbouring lot hairlines — cover the full loupe (~160 m half-width).
  const linesFC = await queryArcGIS(PARCEL_LAYER, {
    geometry: { x: CENTER.lng, y: CENTER.lat, spatialReference: 4326 },
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outFields: "LOTPLAN",
    returnGeometry: true,
    bufferDegrees: 0.0022,
    maxAllowableOffset: 0.00001,
  });

  console.log("Fetching module context overlays…");
  const [
    floodOverall, flood2022, flood2011,
    fpRiver, fpCreek,
    overland, stormTide, bushfire, vegetation,
    hState, hLocal, hCharacter,
    eHV, eCad,
    nTransport, nAnef,
    schools, zoning,
    kPriority, kCore, kLocal, mWildlife,
    ass25, ass100,
    tenements, kraRes, kraSep,
    landslide,
  ] = await Promise.all([
    context(SVC.floodOverall, "FLOOD_RISK", 0.00014),
    context(SVC.flood2022, "OBJECTID", 0.00014),
    context(SVC.flood2011, "OBJECTID", 0.00014),
    context(SVC.fpRiver, "OVL2_DESC"),
    context(SVC.fpCreek, "OVL2_DESC"),
    context(SVC.overland, "FLOOD_RISK", 0.00014),
    context(SVC.stormTide, "FLOOD_RISK"),
    context(SVC.bushfire, "OVL2_DESC"),
    context(SVC.vegetation, "OVL2_DESC"),
    context(SVC.heritageState, "OBJECTID"),
    context(SVC.heritageLocal, "OBJECTID"),
    context(SVC.character, "OBJECTID"),
    context(SVC.easementHV, "OBJECTID"),
    context(SVC.easementCad, "OBJECTID", 0.00003),
    context(SVC.noiseTransport, "OVL2_DESC"),
    context(SVC.noiseAnef, "OVL2_DESC"),
    context(SVC.schools, "CatchmentType", 0.0003),
    context(SVC.zoning, "LVL1_ZONE,LVL2_ZONE,ZONE_PREC_DESC,ZONE_CODE"),
    context(SVC.koalaPriority, "kpa", 0.0003),
    context(SVC.koalaCore, "objectid"),
    context(SVC.koalaLocal, "objectid"),
    context(SVC.msesWildlife, "objectid"),
    context(SVC.ass25k, "map_code,map_code_meaning"),
    context(SVC.ass100k, "map_code,map_code_meaning"),
    context(SVC.tenement, "tenid,tentype,tenmineral,tenowner,tenstatus"),
    context(SVC.kraResource, "objectid"),
    context(SVC.kraSeparation, "objectid"),
    context(SVC.bccLandslide, "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT"),
  ]);

  // Assemble raw shapes exactly as extractOverlays() expects them.
  // (Partial: the hero demo shows the original 11 modules — the newer
  // statewide modules can be added here when the loupe needs them.)
  const rawByModule: Partial<Record<Module, unknown>> = {
    flooding: { context: { overall: floodOverall, historic2022: flood2022, historic2011: flood2011 } },
    flood_planning: { context: { river: fpRiver, creek: fpCreek } },
    overland_flow: { context: overland },
    storm_tide: { context: stormTide },
    bushfire: { context: bushfire },
    vegetation: { context: vegetation },
    heritage: { context: { state: hState, local: hLocal, character: hCharacter } },
    easements: { context: eHV, cadastralContext: eCad },
    noise: { context: { transport: nTransport, anef: nAnef } },
    schools: { context: schools },
    zoning: { context: zoning },
    environment: {
      context: { priority: kPriority, core: kCore, local: kLocal, wildlife: mWildlife },
    },
    acid_sulfate: { context: { k25: ass25, k50: EMPTY_FC, k100: ass100 } },
    mining: {
      context: { tenements, kraResource: kraRes, kraSeparation: kraSep },
    },
    steep_land: { context: landslide },
  };

  const modules: Record<string, HeroModule> = {};
  for (const key of Object.keys(rawByModule) as Module[]) {
    const overlays = extractOverlays(key, rawByModule[key], { scope: "context" });
    const features = pack(overlays, key);
    const n = note(overlays, features.length, key);
    modules[key] = { features, ...n };
    console.log(`  ${key.padEnd(15)} ${String(overlays.length).padStart(4)} features · ${n.hit ? "ON LOT" : "off lot"} · "${n.note}"`);
  }

  const parcelRings = geometryToRings(parcel.polygon, TOL_LOUPE);
  const parcelLines = (linesFC.features as Feature<Geometry | null>[])
    .filter((f): f is Feature<Geometry> => f.geometry != null)
    .flatMap((f) => geometryToRings(f.geometry, TOL_LOUPE));

  const out = {
    generatedAt: new Date().toISOString(),
    point: CENTER,
    lotPlan: parcel.lotPlan,
    suburb: parcel.suburb,
    heroBbox: HERO_BBOX,
    loupeBbox: LOUPE_BBOX,
    // Loupe rect in hero-normalised space (u right, v down).
    loupe: {
      u0: (LOUPE_BBOX.xmin - HERO_BBOX.xmin) / HW,
      u1: (LOUPE_BBOX.xmax - HERO_BBOX.xmin) / HW,
      v0: (HERO_BBOX.ymax - LOUPE_BBOX.ymax) / HH,
      v1: (HERO_BBOX.ymax - LOUPE_BBOX.ymin) / HH,
    },
    parcel: parcelRings,
    parcelLines,
    modules,
  };

  const path = join(process.cwd(), "lib", "hero-demo-data.json");
  const json = JSON.stringify(out);
  writeFileSync(path, json);
  console.log(`\nWrote ${path} (${(json.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
