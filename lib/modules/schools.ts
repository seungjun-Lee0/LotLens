// School Catchments module — Queensland Department of Education
// "State school catchments by Year Level — Current". Every Brisbane
// address sits inside multiple catchment polygons (one per year level
// the school covers). We group by school so the report shows one row
// per school plus the year range it serves.
//
// Endpoint (QLD DET, owner QLD_DET on ArcGIS Online):
//   services7.arcgis.com/NFcbS1pD4k19hD9O/.../State_school_catchments_by_Year_Level__Current/FeatureServer/0
// Fields: CentreName, CentreCode, YearLevel, CatchmentType, Jurisdiction,
//   CalendarYear.

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const SCHOOLS =
  "https://services7.arcgis.com/NFcbS1pD4k19hD9O/arcgis/rest/services/State_school_catchments_by_Year_Level__Current/FeatureServer/0/query";

const QLD_EDU_DOC =
  "https://www.qld.gov.au/education/schools/find/catchment";

export type SchoolRow = {
  name: string;          // CentreName (e.g. "Wynnum SHS")
  code: string;          // CentreCode (e.g. "2021")
  type: string;          // CatchmentType e.g. "Senior Secondary" / "Primary"
  yearLevels: string[];  // e.g. ["7","8","9","10","11","12"]
};

export type SchoolsResult = {
  /** Schools is informational, not a risk axis. We surface 'low' when
   * any catchment was matched (every address is in at least one) and
   * 'none' as a couldn't-resolve fallback. */
  riskLevel: RiskLevel;
  schools: SchoolRow[];
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
};

export async function fetchSchoolsData(
  lat: number,
  lng: number,
): Promise<SchoolsResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CentreName,CentreCode,YearLevel,CatchmentType";
  const [fc, ctx] = await Promise.all([
    queryArcGIS(SCHOOLS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: false,
    }),
    queryArcGIS(SCHOOLS, {
      geometry: point,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: fields,
      returnGeometry: true,
      bufferDegrees: 0.0025,
      // Catchment polygons are huge — keep simplification generous to
      // bound payload.
      maxAllowableOffset: 0.0002,
    }),
  ]);

  // Group features by CentreCode -> SchoolRow.
  const grouped = new Map<string, SchoolRow>();
  for (const f of fc.features) {
    const a = (f.properties ?? {}) as Record<string, unknown>;
    const code = typeof a.CentreCode === "string" ? a.CentreCode : null;
    const name = typeof a.CentreName === "string" ? a.CentreName : null;
    const type = typeof a.CatchmentType === "string" ? a.CatchmentType : null;
    const year = typeof a.YearLevel === "string" ? a.YearLevel : null;
    if (!code || !name) continue;
    let row = grouped.get(code);
    if (!row) {
      row = { name, code, type: type ?? "", yearLevels: [] };
      grouped.set(code, row);
    }
    if (year && !row.yearLevels.includes(year)) row.yearLevels.push(year);
  }
  // Sort year levels naturally (P then 1..12)
  for (const row of grouped.values()) {
    row.yearLevels.sort((a, b) => {
      const pa = a === "P" ? -1 : parseInt(a, 10);
      const pb = b === "P" ? -1 : parseInt(b, 10);
      return pa - pb;
    });
  }
  const schools = Array.from(grouped.values());

  return {
    riskLevel: schools.length > 0 ? "low" : "none",
    schools,
    hasConsideration: schools.length > 0,
    sources: [
      {
        name: "Queensland Department of Education — State school catchments",
        url: QLD_EDU_DOC,
        layer: SCHOOLS,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
