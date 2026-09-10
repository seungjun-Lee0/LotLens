// Boundary module: the lot's own dimensions, from the cadastre polygon
// the report already fetched.
//
// Develo's "Boundary" page: the lot outline with a length on every side,
// plus area and perimeter. No new data source: the QSpatial DCDB parcel
// (lib/property.ts) is the geometry, and its `lot_area` is the registered
// area. Everything here is arithmetic on that polygon, so the module never
// touches the network and can't fail for a source reason. It is a facts
// page, not a risk axis: it grades `informational`.
//
// Side lengths are estimates from the DCDB geometry, not survey
// dimensions. The DCDB is a spatial index of the cadastre, not the plan of
// survey; its vertices are typically within ~0.5 m in urban areas but the
// registered plan is the only authoritative source for a boundary. The
// module says so, and rounds to 0.1 m rather than pretending to more.

import type { Geometry, Position } from "geojson";

import type { RiskLevel } from "@/lib/db";
import type { ParcelInfo } from "@/lib/property";

export type BoundaryEdge = {
  /** Length in metres, rounded to 0.1. */
  lengthM: number;
  /** Midpoint of the edge (by length), for the map label. */
  midLng: number;
  midLat: number;
  /** True when the "edge" is a run of short segments that curve (a
   * cul-de-sac frontage, a truncated corner): the length is the arc, and
   * the label carries a "~". */
  approx: boolean;
  /** Bearing of the edge in degrees clockwise from north, for the
   * label's orientation. */
  bearingDeg: number;
};

export type BoundaryResult = {
  riskLevel: RiskLevel;
  /** Registered lot area (DCDB lot_area) when present, else the geodesic
   * area of the polygon. */
  areaM2: number | null;
  /** True when areaM2 came from the DCDB attribute rather than geometry. */
  areaFromRegister: boolean;
  perimeterM: number | null;
  edges: BoundaryEdge[];
  lotPlan: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

const DCDB_DOC =
  "https://qldspatial.information.qld.gov.au/catalogue/custom/detail.page?fid=%7B6E2BFCB6-D3C8-4ED4-90D8-DEA09BE3F4F1%7D";
const DCDB_LAYER =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/8";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

// ── Geometry helpers ─────────────────────────────────────────────────────
//
// Lots are tens of metres across, so a local equirectangular projection
// (metres east/north of the ring's first vertex) is accurate to well under
// a centimetre: no need for full geodesics.

const EARTH_R = 6371008.8;

function toLocalMetres(ring: Position[]): Array<[number, number]> {
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const kx = (Math.PI / 180) * EARTH_R * Math.cos(lat0);
  const ky = (Math.PI / 180) * EARTH_R;
  return ring.map(([lng, lat]) => [(lng - ring[0][0]) * kx, (lat - ring[0][1]) * ky]);
}

function fromLocalMetres(ring: Position[], x: number, y: number): [number, number] {
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const kx = (Math.PI / 180) * EARTH_R * Math.cos(lat0);
  const ky = (Math.PI / 180) * EARTH_R;
  return [ring[0][0] + x / kx, ring[0][1] + y / ky];
}

/** Shoelace area of a ring in local metres. */
function ringAreaM2(pts: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function outerRings(g: Geometry | null | undefined): Position[][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

/** Drop the GeoJSON closing vertex and any exact-duplicate neighbours. */
function openRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

/**
 * Turn a ring's segments into labelled sides. A straight boundary drawn
 * with an intermediate vertex is ONE side; a run of short segments that
 * keep turning the same way is one curved side (labelled "~"); a turn of
 * CORNER_DEG or more starts a new side. Sides shorter than MIN_LABEL_M
 * (chamfered corners) are kept in the perimeter but not labelled.
 */
const CORNER_DEG = 25;
const MIN_LABEL_M = 2;

function sidesOf(ring: Position[]): { edges: BoundaryEdge[]; perimeterM: number } {
  const open = openRing(ring);
  if (open.length < 3) return { edges: [], perimeterM: 0 };
  const pts = toLocalMetres(open);
  const n = pts.length;
  type Seg = { i: number; len: number; bearing: number };
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    // Compass bearing: clockwise from north.
    const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    segs.push({ i, len, bearing });
  }
  const perimeterM = segs.reduce((a, s) => a + s.len, 0);
  if (segs.length === 0) return { edges: [], perimeterM: 0 };

  const turn = (a: number, b: number) => {
    const d = Math.abs(b - a) % 360;
    return d > 180 ? 360 - d : d;
  };

  // Start the walk at a corner so a side isn't split across the ring's
  // arbitrary first vertex.
  let start = 0;
  for (let k = 0; k < segs.length; k++) {
    const prev = segs[(k - 1 + segs.length) % segs.length];
    if (turn(prev.bearing, segs[k].bearing) >= CORNER_DEG) {
      start = k;
      break;
    }
  }

  const groups: Seg[][] = [];
  let cur: Seg[] = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[(start + k) % segs.length];
    const prev = cur[cur.length - 1];
    if (prev && turn(prev.bearing, s.bearing) >= CORNER_DEG) {
      groups.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) groups.push(cur);

  const edges: BoundaryEdge[] = [];
  for (const g of groups) {
    const len = g.reduce((a, s) => a + s.len, 0);
    if (len < MIN_LABEL_M) continue;
    // Total sweep across the group: a straight side with a mid vertex
    // sweeps ~0°, a cul-de-sac arc sweeps tens of degrees.
    let sweep = 0;
    for (let k = 1; k < g.length; k++) sweep += turn(g[k - 1].bearing, g[k].bearing);
    const approx = g.length > 1 && sweep >= 8;
    // Midpoint by length along the group.
    let acc = 0;
    let mid: [number, number] = pts[g[0].i];
    for (const s of g) {
      if (acc + s.len >= len / 2) {
        const t = (len / 2 - acc) / s.len;
        const [x1, y1] = pts[s.i];
        const [x2, y2] = pts[(s.i + 1) % n];
        mid = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
        break;
      }
      acc += s.len;
    }
    const [midLng, midLat] = fromLocalMetres(open, mid[0], mid[1]);
    // Bearing of the side as a whole: first to last vertex of the group.
    const [ax, ay] = pts[g[0].i];
    const [bx, by] = pts[(g[g.length - 1].i + 1) % n];
    const bearingDeg = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
    edges.push({
      lengthM: Math.round(len * 10) / 10,
      midLng,
      midLat,
      approx,
      bearingDeg,
    });
  }
  return { edges, perimeterM };
}

// ── Module ───────────────────────────────────────────────────────────────

export function computeBoundary(parcel: ParcelInfo): BoundaryResult {
  const polygon = parcel.polygon;
  const rings = outerRings(polygon);
  if (rings.length === 0) {
    return {
      riskLevel: "none",
      areaM2: parcel.areaM2 ?? null,
      areaFromRegister: parcel.areaM2 != null,
      perimeterM: null,
      edges: [],
      lotPlan: parcel.lotPlan ?? null,
      hasConsideration: false,
      sources: [{ name: "Queensland Government: Digital Cadastral Database", url: DCDB_DOC, layer: DCDB_LAYER }],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      available: false,
      availabilityNote:
        "No cadastre lot polygon was found at this location (the address may sit on a road reserve or an unregistered parcel), so boundary dimensions cannot be measured.",
    };
  }

  let perimeterM = 0;
  let geomArea = 0;
  const edges: BoundaryEdge[] = [];
  for (const ring of rings) {
    const r = sidesOf(ring);
    perimeterM += r.perimeterM;
    edges.push(...r.edges);
    geomArea += ringAreaM2(toLocalMetres(openRing(ring)));
  }

  const areaFromRegister = parcel.areaM2 != null && parcel.areaM2 > 0;
  const areaM2 = areaFromRegister ? parcel.areaM2! : Math.round(geomArea);

  return {
    riskLevel: "informational",
    areaM2,
    areaFromRegister,
    perimeterM: Math.round(perimeterM * 10) / 10,
    edges,
    lotPlan: parcel.lotPlan ?? null,
    hasConsideration: true,
    sources: [{ name: "Queensland Government: Digital Cadastral Database", url: DCDB_DOC, layer: DCDB_LAYER }],
    // The lot outline itself is drawn by the map's property highlight;
    // the raw payload carries the polygon so the overlay extractor can
    // place one label per side.
    raw: { polygon, edges, areaM2, perimeterM: Math.round(perimeterM * 10) / 10 },
    context: { polygon, edges },
    available: true,
  };
}

/** Pipeline entry: same signature shape as the network fetchers. Never
 * rejects: the geometry is already in hand. */
export async function fetchBoundaryData(parcel: ParcelInfo): Promise<BoundaryResult> {
  return computeBoundary(parcel);
}
