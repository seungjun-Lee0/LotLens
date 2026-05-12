// Zoning module — BCC City Plan 2014 Zoning.
//
// Endpoint:
//   https://services2.arcgis.com/dEKgZETqwmDAh1rP/.../Zoning_opendata/FeatureServer/0
//   Native SRID: EPSG:28356.
//
// Fields (the ones we care about):
//   ZONE_CODE        e.g. "PC" / "OS" / "MU"
//   ZONE_PREC_DESC   e.g. "PC1 - Principal centre (City centre)" ← display label
//   ZONE_PREC        e.g. "City centre"
//   LVL1_ZONE        e.g. "Centre" / "Recreation and open space"
//   LVL2_ZONE        e.g. "Principal centre (City centre)"
//   LGA_CODE         1000 = Brisbane
//
// Every Brisbane parcel sits inside exactly one zone polygon — so the
// query effectively never returns 0 features for a valid Brisbane LGA
// point. We surface 'low' riskLevel when there *is* a zone (informational
// only — not a real risk axis) and 'none' as a "couldn't resolve" fallback.
//
// Verified: CBD → PC1; Rocklea Markets → OS Open space; Chermside → MU2
// Mixed use (Centre frame).

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/supabase";

const ZONING =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Zoning_opendata/FeatureServer/0/query";

const BCC_ZONING_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Zones";

export type ZoningSource = { name: string; url: string; layer: string };

export type ZoningResult = {
  /** Always 'low' when a zone is resolved (zoning is a context fact, not a
   * risk). 'none' only if the query somehow returns no feature. */
  riskLevel: RiskLevel;
  zoneCode: string | null;
  /** Human-readable precinct, e.g. "PC1 - Principal centre (City centre)". */
  zonePrecinct: string | null;
  /** Top-level zone family, e.g. "Centre". */
  lvl1Zone: string | null;
  /** Specific zone, e.g. "Principal centre (City centre)". */
  lvl2Zone: string | null;
  hasConsideration: boolean;
  sources: ZoningSource[];
  raw: unknown;
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchZoningData(
  lat: number,
  lng: number,
): Promise<ZoningResult> {
  const fc = await queryArcGIS(ZONING, {
    geometry: { x: lng, y: lat, spatialReference: 4326 },
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    outFields: "ZONE_CODE,ZONE_PREC_DESC,LVL1_ZONE,LVL2_ZONE",
    returnGeometry: true,
    // Zone polygons follow cadastre lots — smaller than flood/heritage
    // polygons and want sharper boundaries. ~3m simplification.
    maxAllowableOffset: 0.00003,
  });
  const a = attrs(fc.features[0]);
  const zoneCode = str(a.ZONE_CODE);
  const zonePrecinct = str(a.ZONE_PREC_DESC);
  const lvl1Zone = str(a.LVL1_ZONE);
  const lvl2Zone = str(a.LVL2_ZONE);
  const resolved = Boolean(zoneCode ?? lvl1Zone);

  return {
    riskLevel: resolved ? "low" : "none",
    zoneCode,
    zonePrecinct,
    lvl1Zone,
    lvl2Zone,
    hasConsideration: resolved,
    sources: [
      {
        name: "BCC City Plan 2014 — Zoning",
        url: BCC_ZONING_DOC,
        layer: ZONING,
      },
    ],
    raw: fc,
  };
}
