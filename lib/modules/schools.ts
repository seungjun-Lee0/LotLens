// School Catchments module: Queensland Department of Education
// "State school catchments by Year Level: Current". Every Brisbane
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
  /** Expanded for reading: the source says "Wynnum SHS", we print
   * "Wynnum State High School". */
  name: string;
  code: string;          // CentreCode (e.g. "2021")
  /** Merged CatchmentType. A school with both a Junior Secondary and a
   * Senior Secondary catchment reads as "Secondary", not whichever row
   * the service happened to return first. */
  type: string;
  /** Raw levels as published: "07".."12", or the literal "Primary". */
  yearLevels: string[];
  /** Reader-facing range, e.g. "Prep to Year 6" or "Years 7 to 12". */
  yearRange: string;
};

/** QLD DET publishes school names abbreviated. Expand the trailing token
 * so the report reads like prose instead of an asset register. */
const NAME_SUFFIXES: Array<[RegExp, string]> = [
  [/\bSHS$/, "State High School"],
  [/\bSSC$/, "State Secondary College"],
  [/\bSDE$/, "School of Distance Education"],
  [/\bEEC$/, "Environmental Education Centre"],
  [/\bSC$/, "State College"],
  [/\bSS$/, "State School"],
];

function expandSchoolName(name: string): string {
  for (const [re, full] of NAME_SUFFIXES) {
    if (re.test(name)) return name.replace(re, full);
  }
  return name;
}

/**
 * "07".."12" and the literal "Primary" become something a person would say.
 * Contiguous runs collapse to a range; gaps stay listed, because a school
 * that covers 7-9 and 11-12 shouldn't claim 7-12.
 */
function formatYearRange(levels: string[]): string {
  const nums = levels
    .map((l) => parseInt(l, 10))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const hasPrimary = levels.some((l) => /primary/i.test(l));
  if (nums.length === 0) return hasPrimary ? "Prep to Year 6" : "";
  const contiguous = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1);
  const range = contiguous
    ? `Years ${nums[0]} to ${nums[nums.length - 1]}`
    : `Years ${nums.join(", ")}`;
  return hasPrimary ? `Prep to Year 6, ${range}` : range;
}

export type SchoolsResult = {
  /** Schools is informational, not a risk axis: every address is inside
   * at least one catchment, so a severity here would fire on every single
   * report. 'informational' keeps the section and map but stays out of the
   * consideration count; 'none' is the couldn't-resolve fallback. */
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
      // Catchment polygons are huge: keep simplification generous to
      // bound payload.
      maxAllowableOffset: 0.0002,
    }),
  ]);

  // Group features by CentreCode. The service returns one row per school
  // per year level, so a secondary school arrives as up to six rows split
  // across a Junior and a Senior catchment.
  const grouped = new Map<string, { row: SchoolRow; types: Set<string> }>();
  for (const f of fc.features) {
    const a = (f.properties ?? {}) as Record<string, unknown>;
    const code = typeof a.CentreCode === "string" ? a.CentreCode : null;
    const name = typeof a.CentreName === "string" ? a.CentreName : null;
    const type = typeof a.CatchmentType === "string" ? a.CatchmentType : null;
    const year = typeof a.YearLevel === "string" ? a.YearLevel : null;
    if (!code || !name) continue;
    let entry = grouped.get(code);
    if (!entry) {
      entry = {
        row: { name: expandSchoolName(name), code, type: "", yearLevels: [], yearRange: "" },
        types: new Set<string>(),
      };
      grouped.set(code, entry);
    }
    if (type) entry.types.add(type);
    if (year && !entry.row.yearLevels.includes(year)) entry.row.yearLevels.push(year);
  }

  const schools: SchoolRow[] = [];
  for (const { row, types } of grouped.values()) {
    row.yearLevels.sort((a, b) => {
      const pa = /primary/i.test(a) ? -1 : parseInt(a, 10);
      const pb = /primary/i.test(b) ? -1 : parseInt(b, 10);
      return pa - pb;
    });
    // Taking the first row's type produced "Junior Secondary, years 7 to 12"
    // for any school holding both secondary catchments. Collapse instead.
    const list = [...types];
    const secondary = list.filter((t) => /secondary/i.test(t));
    row.type =
      secondary.length > 1 ? "Secondary" : (list[0] ?? "Catchment");
    row.yearRange = formatYearRange(row.yearLevels);
    schools.push(row);
  }

  return {
    riskLevel: schools.length > 0 ? "informational" : "none",
    schools,
    hasConsideration: schools.length > 0,
    sources: [
      {
        name: "Queensland Department of Education: State school catchments",
        url: QLD_EDU_DOC,
        layer: SCHOOLS,
      },
    ],
    raw: fc,
    context: ctx,
  };
}
