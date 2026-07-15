// Easements module — TWO public sources:
//
//   1) BCC City Plan high-voltage powerline easements overlay
//      (regional electricity infrastructure corridors).
//   2) QSpatial DCDB "Easement Parcels Only" layer
//      (every easement registered as a separate cadastral parcel:
//       drainage, sewer, access, party-wall, utility, etc.).
//
// Develo's report uses (2) — "Qld Spatial" — so adding it brings our
// coverage in line with theirs for the common easement types BCC's
// overlay misses.
//
// Neither source replaces a paid QLD Title Search. The cadastral
// polygon tells you an easement exists at this location, but the
// title attributes (who benefits/burdens, conditions, width) are
// only on the register.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import type { Region } from "@/lib/region";

const HIGH_VOLTAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements/FeatureServer/0/query";

const QSPATIAL_EASEMENTS =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9/query";

const BCC_EASEMENTS_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Easements";
const QSPATIAL_DOC =
  "https://qldspatial.information.qld.gov.au/catalogue/custom/detail.page?fid=%7B6E2BFCB6-D3C8-4ED4-90D8-DEA09BE3F4F1%7D";

export type EasementSource = { name: string; url: string; layer: string };

export type CadastralEasement = {
  /** Lot/plan code, e.g. "ASP108564" — A on SP108564. */
  lotplan: string | null;
  /** When non-null: feat_name from DCDB (often empty for easements). */
  description: string | null;
  /** parcel_typ — typically "Easement". */
  parcelType: string | null;
  /** Polygon area in m² from QSpatial. */
  areaSqm: number | null;
};

export type EasementResult = {
  /** Classification: 'high' if any registered easement intersects the
   * parcel (HV or QSpatial cadastre), 'none' otherwise. */
  riskLevel: RiskLevel;
  /** Inside a BCC high-voltage easement polygon. */
  hasHighVoltageEasement: boolean;
  /** Inside a DCDB easement parcel — drainage / sewer / access / etc. */
  hasCadastralEasement: boolean;
  /** Raw OVL2_DESC if a HV polygon is hit. */
  description: string | null;
  /** DCDB easement parcels intersecting the property point. */
  cadastralEasements: CadastralEasement[];
  /** Verbatim caveat for inline rendering. */
  scopeNote: string;
  hasConsideration: boolean;
  sources: EasementSource[];
  /** Point-query GeoJSON for HV layer — drives classification. */
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

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

export async function fetchEasementsData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<EasementResult> {
  // The DCDB easement-parcel layer is statewide; the HV powerline overlay
  // is a BCC City Plan layer, so only query it inside Brisbane LGA.
  const isBrisbane = region?.isBrisbane ?? true;
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const hvFields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const dcdbFields = "lotplan,feat_name,alias_name,parcel_typ,lot_area";

  const [hvHit, hvCtx, dcdbHit, dcdbCtx] = await Promise.all([
    !isBrisbane ? EMPTY_FC : queryArcGIS(HIGH_VOLTAGE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: hvFields,
      returnGeometry: false,
      bufferDegrees: 0.00005,
    }),
    !isBrisbane ? EMPTY_FC : queryArcGIS(HIGH_VOLTAGE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: hvFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
    // DCDB easement parcels intersecting the property — ~30 m envelope so
    // we catch easements anywhere on a typical Brisbane residential lot.
    // The geocoded point sits near the street frontage; lots are usually
    // 25 m deep × 20 m wide, so the back/side of the lot needs reach.
    // Closer than 30 m and we miss them; much wider and we start dragging
    // in immediate-neighbour easements.
    queryArcGIS(QSPATIAL_EASEMENTS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: dcdbFields,
      returnGeometry: true,
      bufferDegrees: 0.00027,
      maxAllowableOffset: 0.00003,
    }),
    // Wider envelope for map context — neighbours' easements visible too.
    queryArcGIS(QSPATIAL_EASEMENTS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: dcdbFields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.00003,
    }),
  ]);

  const hvFeature = hvHit.features[0];
  const description = strOrNull(attrs(hvFeature).OVL2_DESC);

  const cadastralEasements: CadastralEasement[] = dcdbHit.features.map((f) => {
    const a = attrs(f);
    return {
      lotplan: strOrNull(a.lotplan),
      description: strOrNull(a.feat_name) ?? strOrNull(a.alias_name),
      parcelType: strOrNull(a.parcel_typ),
      areaSqm: numOrNull(a.lot_area),
    };
  });

  const hasHV = Boolean(hvFeature);
  const hasCadastral = cadastralEasements.length > 0;
  const hit = hasHV || hasCadastral;

  return {
    riskLevel: hit ? "high" : "none",
    hasHighVoltageEasement: hasHV,
    hasCadastralEasement: hasCadastral,
    description,
    cadastralEasements,
    scopeNote: SCOPE_NOTE,
    hasConsideration: hit,
    sources: [
      {
        name: "Queensland DCDB — Easement parcels (QSpatial)",
        url: QSPATIAL_DOC,
        layer: QSPATIAL_EASEMENTS,
      },
      ...(isBrisbane
        ? [
            {
              name: "BCC City Plan 2014 — High voltage easements overlay",
              url: BCC_EASEMENTS_DOC,
              layer: HIGH_VOLTAGE,
            },
          ]
        : []),
    ],
    raw: hvHit,
    context: hvCtx,
    cadastralRaw: dcdbHit,
    cadastralContext: dcdbCtx,
  };
}
