// Easements module — BCC high-voltage powerline easements overlay only.
//
// CLAUDE.md §3 + §5 are explicit: "public overlay only — NOT title search".
// QLD Title Search is paid per-lookup and legally distinct, so we scope
// this module to what BCC publishes as a public overlay:
//
//   .../Regional_infrastructure_corridors_and_substations_overlay_
//      High_voltage_easements/FeatureServer/0
//
// Layer "Major electricity infrastructure high voltage powerline easements".
// Native SRID: EPSG:28356.
// Fields: CAT_DESC, OVL_CAT, OVL2_DESC, OVL2_CAT, DESCRIPTION.
//
// Most easements on a Brisbane title (drainage, sewer, access) are NOT in
// this layer. The report must say so plainly so the buyer requests a
// title search.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/supabase";

const HIGH_VOLTAGE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Regional_infrastructure_corridors_and_substations_overlay_High_voltage_easements/FeatureServer/0/query";

const BCC_EASEMENTS_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Easements";

export type EasementSource = { name: string; url: string; layer: string };

export type EasementResult = {
  /** 'high' if the property sits inside a high-voltage easement polygon,
   * else 'none'. (Not a full easement picture — see notes above.) */
  riskLevel: RiskLevel;
  hasHighVoltageEasement: boolean;
  /** Raw OVL2_DESC if a polygon is hit. */
  description: string | null;
  /** Verbatim caveat so the report view can render it inline. */
  scopeNote: string;
  hasConsideration: boolean;
  sources: EasementSource[];
  /** Point-query GeoJSON — drives classification. */
  raw: unknown;
  /** Envelope-query GeoJSON (~280 m around property) for map context. */
  context: unknown;
};

const SCOPE_NOTE =
  "Public overlay layer only. Drainage, sewer, access, and other easements registered on title are NOT captured here. Confirm with a QLD Title Search via a conveyancer.";

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

export async function fetchEasementsData(
  lat: number,
  lng: number,
): Promise<EasementResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(HIGH_VOLTAGE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: false,
      // ~5m envelope. HV easement polygons are thin corridors and the
      // EPSG:28356→4326 reprojection drifts a few decimetres; exact
      // point queries miss boundaries. 5m stays well inside a typical
      // lot width.
      bufferDegrees: 0.00005,
    }),
    queryArcGIS(HIGH_VOLTAGE, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      maxAllowableOffset: 0.0001,
    }),
  ]);
  const hit = fc.features[0];
  const description =
    typeof attrs(hit).OVL2_DESC === "string"
      ? (attrs(hit).OVL2_DESC as string)
      : null;

  return {
    riskLevel: hit ? "high" : "none",
    hasHighVoltageEasement: Boolean(hit),
    description,
    scopeNote: SCOPE_NOTE,
    hasConsideration: Boolean(hit),
    sources: [
      {
        name: "BCC City Plan 2014 — High voltage easements overlay",
        url: BCC_EASEMENTS_DOC,
        layer: HIGH_VOLTAGE,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
