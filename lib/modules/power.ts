// Power module: electricity network on and around the lot. DARK until
// licensing clears - see POWER_ENABLED in lib/db.ts.
//
// Why this earns a page: a sub-transmission line (33kV+) crossing a lot
// almost always rides an easement, constrains building height/placement,
// and affects resale; even an 11kV street feeder spanning a rear corner
// matters to a pool or shed. Develo pages this ("Sources: Energex").
//
// Source: Energex's public network extract (Energy Queensland AGOL org) -
// zone/distribution substations, poles, pillars, 132/110/33kV
// sub-transmission, 11kV HV and LV lines & cables, snapshot 12/09/2022.
//
// ⚠ LICENCE GATE (the reason for the flag): Energex publishes this under
// a NON-COMMERCIAL licence - "must not … use the Supplied Data for any
// commercial or external purpose", no derivative products, mandatory
// "©Energex Limited 2019" notice. A paid report is squarely commercial,
// so POWER_ENABLED stays false until Energex grants an alternative
// licence (their terms name gisdata@energyq.com.au for exactly that
// conversation). Regional QLD (Ergon) publishes an openly-licensed
// network series on data.qld.gov.au that can join later.

import type { Feature, Geometry } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import { unavailableForLga, type Region } from "@/lib/region";

const ENERGEX =
  "https://services.arcgis.com/bfVzktoY0OhzQCDj/arcgis/rest/services/Network_Energex/FeatureServer";

const ENERGEX_DOC = "https://www.energex.com.au/";

// Energex distributes for South East Queensland only; Ergon covers the
// rest of the state (different retailer, different data source).
const ENERGEX_LGA_PATTERN =
  /brisbane|gold coast|logan|ipswich|moreton bay|redland|sunshine coast|noosa|somerset|scenic rim|lockyer/i;

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

/** Line layers, worst-first. `klass` feeds classification + the legend. */
const LINE_LAYERS = [
  { id: 4, kind: "132kV sub-transmission line", klass: "subtransmission" },
  { id: 5, kind: "132kV sub-transmission cable", klass: "subtransmission" },
  { id: 6, kind: "110kV sub-transmission line", klass: "subtransmission" },
  { id: 7, kind: "110kV sub-transmission cable", klass: "subtransmission" },
  { id: 8, kind: "33kV sub-transmission line", klass: "subtransmission" },
  { id: 9, kind: "33kV sub-transmission cable", klass: "subtransmission" },
  { id: 10, kind: "11kV high-voltage line", klass: "hv" },
  { id: 11, kind: "11kV high-voltage cable", klass: "hv" },
  { id: 12, kind: "Low-voltage line", klass: "lv" },
  { id: 13, kind: "Low-voltage cable", klass: "lv" },
] as const;

const SUBSTATION_LAYERS = [
  { id: 0, kind: "Zone substation" },
  { id: 1, kind: "Distribution substation" },
] as const;

export type PowerAsset = {
  /** e.g. "33kV sub-transmission line", "Distribution substation". */
  kind: string;
  /** "subtransmission" | "hv" | "lv" | "substation" */
  klass: string;
};

export type PowerResult = {
  riskLevel: RiskLevel;
  /** Network elements intersecting the lot. */
  assets: PowerAsset[];
  /** A 33kV+ sub-transmission line/cable crosses the lot: the
   * easement-grade constraint. */
  hasSubTransmissionOnLot: boolean;
  /** An 11kV feeder crosses the lot. */
  hasHvOnLot: boolean;
  networkNearby: boolean;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

function tag(
  fc: { features: Feature<Geometry | null, unknown>[] },
  kind: string,
  klass: string,
) {
  for (const f of fc.features) {
    f.properties = { ...(f.properties ?? {}), kind, klass } as never;
  }
  return fc;
}

export async function fetchPowerData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<PowerResult> {
  const inServiceArea = region?.lga ? ENERGEX_LGA_PATTERN.test(region.lga) : true;
  if (!inServiceArea) {
    return {
      riskLevel: "none",
      assets: [],
      hasSubTransmissionOnLot: false,
      hasHvOnLot: false,
      networkNearby: false,
      hasConsideration: false,
      sources: [
        { name: "Electricity distributor network", url: ENERGEX_DOC, layer: "" },
      ],
      raw: EMPTY_FC,
      context: EMPTY_FC,
      ...unavailableForLga(
        region ?? { lga: null, isBrisbane: false },
        "The electricity network layer",
      ),
    };
  }

  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const onLot = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: false,
    // ~30 m fallback for road-centreline geocodes with no cadastre lot.
    bufferDegrees: 0.00027,
    lotPolygon: lot,
    outFields: "OBJECTID",
  };
  const nearby = {
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
    outFields: "OBJECTID",
  };

  const [lineHits, subHits, lineCtx, subCtx] = await Promise.all([
    Promise.all(
      LINE_LAYERS.map((l) => queryArcGIS(`${ENERGEX}/${l.id}/query`, onLot)),
    ),
    Promise.all(
      SUBSTATION_LAYERS.map((l) => queryArcGIS(`${ENERGEX}/${l.id}/query`, onLot)),
    ),
    Promise.all(
      LINE_LAYERS.map((l) => queryArcGIS(`${ENERGEX}/${l.id}/query`, nearby)),
    ),
    Promise.all(
      SUBSTATION_LAYERS.map((l) => queryArcGIS(`${ENERGEX}/${l.id}/query`, nearby)),
    ),
  ]);

  const assets: PowerAsset[] = [];
  LINE_LAYERS.forEach((l, i) => {
    for (let k = 0; k < lineHits[i].features.length; k++) {
      assets.push({ kind: l.kind, klass: l.klass });
    }
  });
  SUBSTATION_LAYERS.forEach((l, i) => {
    for (let k = 0; k < subHits[i].features.length; k++) {
      assets.push({ kind: l.kind, klass: "substation" });
    }
  });

  const hasSubTransmissionOnLot = assets.some((a) => a.klass === "subtransmission");
  const hasHvOnLot = assets.some((a) => a.klass === "hv" || a.klass === "substation");
  const networkNearby =
    lineCtx.some((fc) => fc.features.length > 0) ||
    subCtx.some((fc) => fc.features.length > 0);

  // Grading mirrors stormwater: only on-lot infrastructure earns a flag.
  // Every urban street has LV overhead, so an LV service crossing rates
  // informational; the street network alone rates nothing.
  const riskLevel: RiskLevel = hasSubTransmissionOnLot
    ? "medium"
    : hasHvOnLot
      ? "low"
      : assets.length > 0
        ? "informational"
        : "none";

  const merged = (list: Array<{ features: Feature<Geometry | null, unknown>[] }>, defs: ReadonlyArray<{ kind: string; klass?: string }>) => ({
    type: "FeatureCollection" as const,
    features: list.flatMap((fc, i) =>
      tag(fc as never, defs[i].kind, (defs[i] as { klass?: string }).klass ?? "substation").features,
    ),
  });

  return {
    riskLevel,
    assets,
    hasSubTransmissionOnLot,
    hasHvOnLot,
    networkNearby,
    hasConsideration: riskLevel !== "none",
    sources: [
      {
        name: "Energex network extract (©Energex Limited 2019)",
        url: ENERGEX_DOC,
        layer: ENERGEX,
      },
    ],
    raw: { lines: merged(lineHits, LINE_LAYERS), substations: merged(subHits, SUBSTATION_LAYERS) },
    context: { lines: merged(lineCtx, LINE_LAYERS), substations: merged(subCtx, SUBSTATION_LAYERS) },
    available: true,
  };
}
