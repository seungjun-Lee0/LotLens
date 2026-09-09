// Local Plans module: BCC City Plan 2014 neighbourhood plans.
//
// Zoning answers "what is this land for". The neighbourhood plan answers
// "and what does THIS suburb do differently": it sits inside the planning
// scheme and can override the zone's height, density and built-form rules.
// A buyer reading the zone code alone gets half the answer, which is why
// Develo prints the two side by side.
//
// Endpoints (BCC open data, ArcGIS Online org dEKgZETqwmDAh1rP):
//   Neighbourhood_Plan_boundaries/FeatureServer/0
//     Fields: LP (plan name), DESCRIPTION
//   Neighbourhood_Plan_precints/FeatureServer/0        [sic: BCC's spelling]
//     Fields: LP, LP_PREC, LP_PREC_CODE, DESCRIPTION
//   Neighbourhood_Plan_sub_precints/FeatureServer/0    [sic]
//     Fields: LP, LP_PREC, LP_PREC_CODE, LP_SUB_PREC, LP_SUB_PREC_CODE
//
// Verified live 2026-07: East Brisbane → "East Brisbane-Coorparoo district
// neighbourhood plan"; Newstead → "Newstead north neighbourhood plan",
// precinct "Evelyn Street industrial" (NPP-004).
//
// This is a facts module, not a risk axis: being inside a neighbourhood
// plan is neither good nor bad, it just changes which rules apply. It
// reports `informational` so it keeps a full section without raising a
// warning. Most of Brisbane's inner and middle ring is inside one.

import type { FeatureCollection, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import {
  councilOf,
  LOCAL_PLAN_ADAPTERS,
  queryOverlayAdapter,
  type LocalPlanAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const BASE =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services";
const BOUNDARIES = `${BASE}/Neighbourhood_Plan_boundaries/FeatureServer/0/query`;
const PRECINCTS = `${BASE}/Neighbourhood_Plan_precints/FeatureServer/0/query`;
const SUB_PRECINCTS = `${BASE}/Neighbourhood_Plan_sub_precints/FeatureServer/0/query`;

const BCC_NP_DOC =
  "https://www.brisbane.qld.gov.au/planning-and-building/planning-guidelines-and-tools/brisbane-city-plan-2014/neighbourhood-planning";

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

export type LocalPlanPrecinct = {
  /** e.g. "Evelyn Street industrial" */
  name: string;
  /** e.g. "NPP-004" */
  code: string | null;
  /** Sub-precinct name when the lot sits in one. */
  subPrecinct: string | null;
  subPrecinctCode: string | null;
};

export type LocalPlansResult = {
  riskLevel: RiskLevel;
  /** Neighbourhood plan name, or null when the lot is outside every plan. */
  planName: string | null;
  precincts: LocalPlanPrecinct[];
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function attrs(f: { properties?: unknown } | undefined): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

/** Non-Brisbane councils: one or two plain polygon layers (plan boundary,
 * precinct) whose field names the adapter names. No sub-precinct tier
 * outside BCC, and no code field that every council agrees on, so the
 * precinct rows carry name + optional code only. */
async function fetchAdapterLocalPlans(
  lat: number,
  lng: number,
  adapters: LocalPlanAdapter[],
  lot?: Geometry | null,
): Promise<LocalPlansResult> {
  const results = await Promise.all(
    adapters.map((a) =>
      queryOverlayAdapter(
        { url: a.url, sourceName: a.sourceName, docUrl: a.docUrl },
        lat,
        lng,
        lot,
      ),
    ),
  );
  const merge = (
    key: "point" | "context",
    want: (a: LocalPlanAdapter) => boolean,
  ): FeatureCollection<Geometry | null> => ({
    type: "FeatureCollection",
    features: results.flatMap((r, i) =>
      want(adapters[i]) ? r[key].features : [],
    ),
  });
  const isPrecinct = (a: LocalPlanAdapter) => Boolean(a.precinctFields);

  let planName: string | null = null;
  const precincts: LocalPlanPrecinct[] = [];
  const seen = new Set<string>();
  results.forEach((r, i) => {
    const a = adapters[i];
    for (const f of r.point.features) {
      const props = attrs(f);
      planName ??= pickField(props, a.planFields);
      if (!a.precinctFields) continue;
      const name = pickField(props, a.precinctFields);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      precincts.push({ name, code: null, subPrecinct: null, subPrecinctCode: null });
    }
  });

  const inPlan = planName !== null || precincts.length > 0;
  return {
    riskLevel: inPlan ? "informational" : "none",
    planName,
    precincts,
    hasConsideration: inPlan,
    sources: adapters.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
    raw: {
      boundary: merge("point", (a) => !isPrecinct(a)),
      precinct: merge("point", isPrecinct),
    },
    context: {
      boundary: merge("context", (a) => !isPrecinct(a)),
      precinct: merge("context", isPrecinct),
    },
    available: true,
    availabilityNote: inPlan
      ? undefined
      : "This property sits outside every local plan area in the council's planning scheme.",
  };
}

function pickField(
  props: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const f of fields) {
    const v = props[f];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

export async function fetchLocalPlansData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<LocalPlansResult> {
  // Neighbourhood plans are a City Plan 2014 construct. Other SEQ councils
  // publish the same idea under different names (local plans, structure
  // plans) on their own services: those land as adapters later.
  const isBrisbane = region?.isBrisbane ?? true;
  // Logan: the Property Report layer carries the LPS2015 local plan (LP)
  // and local plan precinct (LP_PREC) per lot. Data only: Logan publishes
  // no plan-boundary polygons, so the map shows the lot without a plan
  // outline: the facts and narrative still carry the plan and precinct.
  const councilId = region ? councilOf(region) : "brisbane";
  const adapters = (councilId ? LOCAL_PLAN_ADAPTERS[councilId] : undefined) ?? [];
  if (!isBrisbane && adapters.length > 0) {
    return fetchAdapterLocalPlans(lat, lng, adapters, lot);
  }
  if (!isBrisbane) {
    return {
      riskLevel: "none",
      planName: null,
      precincts: [],
      hasConsideration: false,
      sources: [
        { name: "Council planning scheme: local/neighbourhood plans", url: BCC_NP_DOC, layer: "" },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(
        region ?? { lga: null, isBrisbane: false },
        "The neighbourhood / local plan layer",
      ),
    };
  }

  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  // Plan boundaries are suburb-scale, so the lot polygon and the point
  // agree in practice: but precinct lines DO run through blocks, and a
  // lot straddling two precincts should list both.
  const pointParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    lotPolygon: lot,
  };
  const contextParams = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
    quantize: true,
  };

  const [boundary, precinct, subPrecinct, boundaryCtx, precinctCtx] =
    await Promise.all([
      queryArcGIS(BOUNDARIES, { ...pointParams, outFields: "LP,DESCRIPTION" }),
      queryArcGIS(PRECINCTS, { ...pointParams, outFields: "LP,LP_PREC,LP_PREC_CODE" }),
      queryArcGIS(SUB_PRECINCTS, {
        ...pointParams,
        outFields: "LP,LP_PREC,LP_PREC_CODE,LP_SUB_PREC,LP_SUB_PREC_CODE",
      }),
      queryArcGIS(BOUNDARIES, { ...contextParams, outFields: "LP" }),
      queryArcGIS(PRECINCTS, { ...contextParams, outFields: "LP,LP_PREC,LP_PREC_CODE" }),
    ]);

  const planName = str(attrs(boundary.features[0]).LP);

  // Sub-precincts are keyed by their parent precinct code, so fold them in
  // rather than listing them as separate rows: "Evelyn Street industrial
  // (sub-precinct b)" reads as one place, which is what it is.
  const subByPrecinctCode = new Map<string, Record<string, unknown>>();
  for (const f of subPrecinct.features) {
    const a = attrs(f);
    const code = str(a.LP_PREC_CODE);
    if (code) subByPrecinctCode.set(code, a);
  }

  const precincts: LocalPlanPrecinct[] = [];
  const seen = new Set<string>();
  for (const f of precinct.features) {
    const a = attrs(f);
    const name = str(a.LP_PREC);
    if (!name) continue;
    const code = str(a.LP_PREC_CODE);
    const key = `${name}|${code ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sub = code ? subByPrecinctCode.get(code) : undefined;
    precincts.push({
      name,
      code,
      subPrecinct: sub ? str(sub.LP_SUB_PREC) : null,
      subPrecinctCode: sub ? str(sub.LP_SUB_PREC_CODE) : null,
    });
  }

  const inPlan = planName !== null || precincts.length > 0;

  return {
    // Being inside a neighbourhood plan is a fact about which rules apply,
    // not a hazard: and roughly half of Brisbane is inside one, so a
    // severity here would fire constantly while warning of nothing.
    riskLevel: inPlan ? "informational" : "none",
    planName,
    precincts,
    hasConsideration: inPlan,
    sources: [
      {
        name: "BCC City Plan 2014: Neighbourhood plan boundaries",
        url: BCC_NP_DOC,
        layer: BOUNDARIES,
      },
      {
        name: "BCC City Plan 2014: Neighbourhood plan precincts",
        url: BCC_NP_DOC,
        layer: PRECINCTS,
      },
    ],
    raw: { boundary, precinct, subPrecinct },
    context: { boundary: boundaryCtx, precinct: precinctCtx },
    available: true,
  };
}
