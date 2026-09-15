// Easements module: TWO public sources:
//
//   1) BCC City Plan high-voltage powerline easements overlay
//      (regional electricity infrastructure corridors).
//   2) QSpatial DCDB "Easement Parcels Only" layer
//      (every easement registered as a separate cadastral parcel:
//       drainage, sewer, access, party-wall, utility, etc.).
//
// Develo's report uses (2): "Qld Spatial": so adding it brings our
// coverage in line with theirs for the common easement types BCC's
// overlay misses.
//
// Neither source replaces a paid QLD Title Search. The cadastral
// polygon tells you an easement exists at this location, but the
// title attributes (who benefits/burdens, conditions, width) are
// only on the register.

import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import {
  councilOf,
  HV_ADAPTERS,
  overlayLabels,
  queryOverlayAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { insetParcelPolygon } from "@/lib/property";
import type { Region } from "@/lib/region";

const QSPATIAL_EASEMENTS =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9/query";

const QSPATIAL_DOC =
  "https://qldspatial.information.qld.gov.au/catalogue/custom/detail.page?fid=%7B6E2BFCB6-D3C8-4ED4-90D8-DEA09BE3F4F1%7D";

export type EasementSource = { name: string; url: string; layer: string };

export type CadastralEasement = {
  /** Lot/plan code, e.g. "ASP108564": A on SP108564. */
  lotplan: string | null;
  /** When non-null: feat_name from DCDB (often empty for easements). */
  description: string | null;
  /** parcel_typ: typically "Easement". */
  parcelType: string | null;
  /** Polygon area in m² from QSpatial. */
  areaSqm: number | null;
};

export type EasementResult = {
  /** Classification: 'high' if any registered easement intersects the
   * parcel (HV or QSpatial cadastre), 'low' if one only shares a boundary
   * with it (adjoining), 'none' otherwise. */
  riskLevel: RiskLevel;
  /** Inside a BCC high-voltage easement polygon. */
  hasHighVoltageEasement: boolean;
  /** Inside a DCDB easement parcel: drainage / sewer / access / etc. */
  hasCadastralEasement: boolean;
  /** A DCDB easement parcel touches the lot boundary without entering
   * it. Develo reports these as "considerations on site or adjoining":
   * a shared drainage or sewer easement along the fence still decides
   * where the neighbour's pipe runs and who can dig. */
  hasAdjoiningEasement: boolean;
  /** Raw OVL2_DESC if a HV polygon is hit. */
  description: string | null;
  /** DCDB easement parcels intersecting the property point. */
  cadastralEasements: CadastralEasement[];
  /** DCDB easement parcels sharing a boundary with the lot (not on it). */
  adjoiningEasements: CadastralEasement[];
  /** Verbatim caveat for inline rendering. */
  scopeNote: string;
  hasConsideration: boolean;
  sources: EasementSource[];
  /** Point-query GeoJSON for HV layer: drives classification. */
  raw: unknown;
  /** Envelope-query GeoJSON (~280 m) for HV map context. */
  context: unknown;
  /** Point-query GeoJSON for DCDB easements at the property. */
  cadastralRaw: unknown;
  /** Envelope-query GeoJSON for DCDB easements around the property. */
  cadastralContext: unknown;
};

const SCOPE_NOTE =
  "Public overlays + DCDB cadastre only. Polygons show where registered easements exist, not their legal terms (benefiting party, conditions, width). Confirm full details with a QLD Title Search via a conveyancer.";

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toCadastral(f: Feature<Geometry | null, GeoJsonProperties>): CadastralEasement {
  const a = attrs(f);
  return {
    lotplan: strOrNull(a.lotplan),
    description: strOrNull(a.feat_name) ?? strOrNull(a.alias_name),
    parcelType: strOrNull(a.parcel_typ),
    areaSqm: numOrNull(a.lot_area),
  };
}

const easementKey = (e: CadastralEasement) => `${e.lotplan}|${e.areaSqm}`;

/**
 * The lot pushed ~1 m past its true boundary. The polygon we receive is
 * the 0.3%-inset classification copy of a cadastre polygon that was
 * itself generalised to ~1 m on fetch, so a growth measured in
 * centimetres does not reliably reach a parcel snapped to the real
 * boundary. One metre does, and the nearest easement that is NOT on a
 * shared boundary sits a road width (15 m+) away.
 */
function growLotForAdjoining(lot: Geometry, metres = 1.0): Geometry {
  const rings: number[][][] =
    lot.type === "Polygon"
      ? (lot.coordinates as number[][][])
      : lot.type === "MultiPolygon"
        ? (lot.coordinates as number[][][][]).flat()
        : [];
  const verts = rings.flat();
  if (verts.length === 0) return lot;
  const cx = verts.reduce((s, [x]) => s + x, 0) / verts.length;
  const cy = verts.reduce((s, [, y]) => s + y, 0) / verts.length;
  const kx = Math.cos((cy * Math.PI) / 180) * 111_320;
  const ky = 111_320;
  // Nearest vertex to the centroid bounds how far the boundary sits from
  // it: scaling by 1 + m / that distance moves every edge out by ≥ m.
  const minR = Math.min(
    ...verts.map(([x, y]) => Math.hypot((x - cx) * kx, (y - cy) * ky)),
  );
  if (!Number.isFinite(minR) || minR <= 0) return lot;
  // Undo the classification inset first, then grow.
  return insetParcelPolygon(lot, (1 / 0.997) * (1 + metres / minR));
}

/**
 * Easement parcels that ADJOIN the lot: everything the cadastre layer
 * intersects with a copy of the lot pushed ~1 m past its true boundary
 * (growLotForAdjoining), minus what the inset (on-lot) query already
 * found. Done on the server rather than against the simplified context
 * geometry: the context query's 3 m generalisation moves vertices
 * further than the overlap we are testing for.
 */
function findAdjoining(
  grownHits: FeatureCollection<Geometry | null>,
  onLot: CadastralEasement[],
): CadastralEasement[] {
  const seen = new Set(onLot.map(easementKey));
  const out: CadastralEasement[] = [];
  for (const f of grownHits.features) {
    const e = toCadastral(f);
    if (seen.has(easementKey(e))) continue;
    seen.add(easementKey(e));
    out.push(e);
  }
  return out;
}

export async function fetchEasementsData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<EasementResult> {
  // The DCDB easement-parcel layer is statewide; the HV/major-electricity
  // corridor overlays are council planning-scheme layers, resolved through
  // HV_ADAPTERS (Brisbane, Gold Coast, Logan so far).
  const hvAdapters =
    HV_ADAPTERS[(region ? councilOf(region) : "brisbane") ?? "brisbane"] ?? [];
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const dcdbFields = "lotplan,feat_name,alias_name,parcel_typ,lot_area";

  const mergeFC = (
    list: Array<FeatureCollection<Geometry | null>>,
  ): FeatureCollection<Geometry | null> => ({
    type: "FeatureCollection",
    features: list.flatMap((fc) => fc.features),
  });

  const EMPTY: FeatureCollection<Geometry | null> = { type: "FeatureCollection", features: [] };
  const [hvResults, dcdbHit, dcdbCtx, dcdbGrown] = await Promise.all([
    Promise.all(hvAdapters.map((a) => queryOverlayAdapter(a, lat, lng, lot))),
    // DCDB easement parcels intersecting the property. With the cadastre
    // lot polygon (slightly inset: see insetParcelPolygon) this is exact:
    // easement parcels are snapped to the same cadastre, so lot-intersect
    // means "on this lot", full stop. The ~30 m point envelope remains the
    // fallback when the parcel lookup missed (road-centreline geocodes).
    queryArcGIS(QSPATIAL_EASEMENTS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: dcdbFields,
      returnGeometry: true,
      bufferDegrees: 0.00027,
      maxAllowableOffset: 0.00003,
      quantize: true,
      lotPolygon: lot,
    }),
    // Wider envelope for map context: neighbours' easements visible too.
    queryArcGIS(QSPATIAL_EASEMENTS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: dcdbFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
      quantize: true,
    }),
    // The lot grown just past its boundary: on-lot hits plus the parcels
    // that share a fence line with it (see findAdjoining). Only meaningful
    // with the real lot polygon: a point envelope has no boundary to share.
    lot
      ? queryArcGIS(QSPATIAL_EASEMENTS, {
          geometry: point,
          geometryType: "esriGeometryPoint",
          inSR: 4326,
          outFields: dcdbFields,
          returnGeometry: false,
          lotPolygon: growLotForAdjoining(lot),
        })
      : Promise.resolve(EMPTY),
  ]);

  const hvHit = mergeFC(hvResults.map((r) => r.point));
  const hvCtx = mergeFC(hvResults.map((r) => r.context));
  const hvFeature = hvHit.features[0];
  const description =
    hvResults
      .flatMap((r, i) => overlayLabels(r.point, hvAdapters[i].labelFields))
      .find(Boolean) ?? strOrNull(attrs(hvFeature).OVL2_DESC);

  const cadastralEasements: CadastralEasement[] = dcdbHit.features.map(toCadastral);
  const adjoiningEasements = findAdjoining(dcdbGrown, cadastralEasements);

  const hasHV = Boolean(hvFeature);
  const hasCadastral = cadastralEasements.length > 0;
  const hasAdjoining = adjoiningEasements.length > 0;
  const hit = hasHV || hasCadastral;

  return {
    riskLevel: hit ? "high" : hasAdjoining ? "low" : "none",
    hasHighVoltageEasement: hasHV,
    hasCadastralEasement: hasCadastral,
    hasAdjoiningEasement: hasAdjoining,
    description,
    cadastralEasements,
    adjoiningEasements,
    scopeNote: SCOPE_NOTE,
    hasConsideration: hit || hasAdjoining,
    sources: [
      {
        name: "Queensland DCDB: Easement parcels (QSpatial)",
        url: QSPATIAL_DOC,
        layer: QSPATIAL_EASEMENTS,
      },
      ...hvAdapters.map((a) => ({
        name: a.sourceName,
        url: a.docUrl,
        layer: a.url,
      })),
    ],
    raw: hvHit,
    context: hvCtx,
    cadastralRaw: dcdbHit,
    cadastralContext: dcdbCtx,
  };
}
