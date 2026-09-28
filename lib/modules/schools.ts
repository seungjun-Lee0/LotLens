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

import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import type { RiskLevel } from "@/lib/db";

const SCHOOLS =
  "https://services7.arcgis.com/NFcbS1pD4k19hD9O/arcgis/rest/services/State_school_catchments_by_Year_Level__Current/FeatureServer/0/query";

const QLD_EDU_DOC =
  "https://www.qld.gov.au/education/schools/find/catchment";

// School LOCATIONS (points), same QLD DET org. Catchments answer "which
// state school must take me"; these answer "what schools are actually
// around here", including Catholic and independent schools that have no
// catchment at all.
const STATE_SCHOOL_POINTS =
  "https://services7.arcgis.com/NFcbS1pD4k19hD9O/arcgis/rest/services/QldStateSchools_Public_Open/FeatureServer/0/query";
const NONSTATE_SCHOOL_POINTS =
  "https://services7.arcgis.com/NFcbS1pD4k19hD9O/arcgis/rest/services/QLD_NonState_Schools_Current/FeatureServer/6/query";
const SCHOOLS_DIRECTORY_DOC = "https://schoolsdirectory.eq.edu.au/";
/** ±degrees searched for nearby schools (~2 km at Brisbane's latitude). */
const NEARBY_RADIUS_DEG = 0.018;
const NEARBY_MAX = 8;

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

export type NearbySchool = {
  name: string;
  /** "State" | "Catholic" | "Independent". */
  sector: string;
  /** "Primary" | "Secondary" | "Prep to Year 12" | "Special" … */
  type: string;
  /** "Prep to Year 6", "Years 7 to 12". */
  yearRange: string;
  /** Straight-line metres from the property. */
  distanceM: number;
  suburb: string | null;
  website: string | null;
  lat: number;
  lng: number;
};

export type SchoolsResult = {
  /** Schools is informational, not a risk axis: every address is inside
   * at least one catchment, so a severity here would fire on every single
   * report. 'informational' keeps the section and map but stays out of the
   * consideration count; 'none' is the couldn't-resolve fallback. */
  riskLevel: RiskLevel;
  schools: SchoolRow[];
  /** Closest schools of any sector, nearest first. */
  nearbySchools: NearbySchool[];
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
};

const EARTH_RADIUS_M = 6_371_000;
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** "Prep Year" → "Prep", "Year 6" → "Year 6"; joined as a range. */
function yearRangeOf(low: unknown, high: unknown): string {
  const norm = (v: unknown) =>
    typeof v === "string" ? v.replace(/^Prep Year$/i, "Prep").replace(/^Kindergarten$/i, "Kindy") : null;
  const lo = norm(low);
  const hi = norm(high);
  if (lo && hi) return lo === hi ? lo : `${lo} to ${hi}`;
  return lo ?? hi ?? "";
}

/** Both location layers share the DET centre schema; only the sector
 * field differs. Points carry explicit Latitude/Longitude attributes, so
 * geometry is not requested. */
function toNearby(
  f: Feature<Geometry | null, GeoJsonProperties>,
  sectorOf: (p: Record<string, unknown>) => string,
  from: { lat: number; lng: number },
): NearbySchool | null {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const name = typeof p.CentreName === "string" ? p.CentreName : null;
  const lat = typeof p.Latitude === "number" ? p.Latitude : null;
  const lng = typeof p.Longitude === "number" ? p.Longitude : null;
  if (!name || lat === null || lng === null) return null;
  const type =
    (typeof p.SchoolType === "string" && p.SchoolType) ||
    (typeof p.MPSIndicator === "string" && p.MPSIndicator) ||
    (typeof p.LimitedHighLow === "string" && p.LimitedHighLow) ||
    "School";
  return {
    name,
    sector: sectorOf(p),
    type: /^(PrimarySecondary|Primary\/Secondary|PriSec)$/i.test(type) ? "Prep to Year 12" : type,
    yearRange: yearRangeOf(p.LowYearLevelName, p.HighYearLevelName),
    distanceM: Math.round(haversineM(from, { lat, lng })),
    suburb: typeof p.Suburb === "string" ? p.Suburb : null,
    website: typeof p.Website === "string" && p.Website ? p.Website : null,
    lat,
    lng,
  };
}

/** Nearest schools of every sector inside NEARBY_RADIUS_DEG. A layer
 * outage here loses the list, never the catchment result. */
async function fetchNearbySchools(lat: number, lng: number): Promise<NearbySchool[]> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const common = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    bufferDegrees: NEARBY_RADIUS_DEG,
  };
  const [state, nonState] = await Promise.all([
    queryArcGIS(STATE_SCHOOL_POINTS, {
      ...common,
      outFields: "CentreName,SchoolType,LowYearLevelName,HighYearLevelName,Latitude,Longitude,Suburb,Website,OperationalStatus",
    }).catch(() => null),
    queryArcGIS(NONSTATE_SCHOOL_POINTS, {
      ...common,
      outFields: "CentreName,MPSIndicator,LowYearLevelName,HighYearLevelName,Latitude,Longitude,Suburb,Website,NSSSchoolSector,CentreStatusCode",
    }).catch(() => null),
  ]);
  const from = { lat, lng };
  const all = [
    // Distance-education centres are enrolled statewide: their office being
    // 600 m away says nothing about local schooling.
    ...(state?.features ?? [])
      .filter((f) => !/distance education/i.test(String((f.properties as Record<string, unknown>)?.CentreName ?? "")))
      .filter((f) => (f.properties as Record<string, unknown>)?.OperationalStatus !== "Closed")
      .map((f) => toNearby(f, () => "State", from)),
    ...(nonState?.features ?? [])
      .filter((f) => (f.properties as Record<string, unknown>)?.CentreStatusCode !== "C")
      .filter((f) => !/distance education/i.test(String((f.properties as Record<string, unknown>)?.CentreName ?? "")))
      .map((f) =>
        toNearby(
          f,
          (p) => (typeof p.NSSSchoolSector === "string" && p.NSSSchoolSector) || "Non-state",
          from,
        ),
      ),
  ].filter((s): s is NearbySchool => s !== null);
  all.sort((a, b) => a.distanceM - b.distanceM);
  return all.slice(0, NEARBY_MAX);
}

/** Map points for the nearby schools, keyed so the overlay painter can
 * colour by sector. */
function nearbyFC(list: NearbySchool[]): FeatureCollection<Geometry, GeoJsonProperties> {
  return {
    type: "FeatureCollection",
    features: list.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { name: s.name, sector: s.sector, type: s.type, distanceM: s.distanceM },
    })),
  };
}

export async function fetchSchoolsData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<SchoolsResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const fields = "CentreName,CentreCode,YearLevel,CatchmentType";
  const [fc, ctx, nearbySchools] = await Promise.all([
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
      bufferDegrees: contextBuffer(lot, lat, lng),
      // Catchment polygons are huge: keep simplification generous to
      // bound payload.
      maxAllowableOffset: 0.0002,
    }),
    fetchNearbySchools(lat, lng),
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

  const nearby = nearbyFC(nearbySchools);
  return {
    riskLevel: schools.length > 0 || nearbySchools.length > 0 ? "informational" : "none",
    schools,
    nearbySchools,
    hasConsideration: schools.length > 0 || nearbySchools.length > 0,
    sources: [
      {
        name: "Queensland Department of Education: State school catchments",
        url: QLD_EDU_DOC,
        layer: SCHOOLS,
      },
      {
        name: "Queensland Department of Education: Schools Directory (state and non-state school locations)",
        url: SCHOOLS_DIRECTORY_DOC,
        layer: STATE_SCHOOL_POINTS,
      },
    ],
    // Catchment polygons + nearby school points. Rows written before the
    // nearby list was added store the catchment FeatureCollection directly;
    // the overlay painter accepts both shapes.
    raw: { catchments: fc, nearby },
    context: { catchments: ctx, nearby },
  };
}
