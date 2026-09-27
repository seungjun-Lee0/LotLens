// Heritage / Character module.
//
// Statewide backbone: the Queensland Heritage Register boundaries
// (QSpatial AdminBoundariesFramework layer 78: verified live 2026-07,
// fields: placename, place_id, entrydate, status). Works for any QLD
// address.
//
// Council enhancement: local heritage registers and character controls are
// council instruments, so they arrive through HERITAGE_ADAPTERS
// (Brisbane, Gold Coast, Moreton Bay, Sunshine Coast, Redland, Logan).
// Each adapter declares whether its layer is a listing (`local`, grades
// high) or a form control (`character`, grades medium).

import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import { contextBuffer } from "@/lib/context-window";
import {
  councilOf,
  HERITAGE_ADAPTERS,
  queryOverlayAdapter,
  type HeritageAdapter,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import type { Region } from "@/lib/region";

const QHR_LAYER =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdminBoundariesFramework/MapServer/78/query";

const QHR_DOC = "https://qhr.detsi.qld.gov.au/";

export type HeritageEntry = {
  /** "state" = QLD Heritage Register place, "local" = council local
   * heritage area, "character" = traditional building character
   * (pre-1947) protection, "dwelling_character" = dwelling house character
   * overlay (height/form controls on houses). */
  type: "state" | "local" | "character" | "dwelling_character";
  category: string | null;
  description: string | null;
  code: string | null;
  notes: string | null;
};

export type HeritageSource = { name: string; url: string; layer: string };

export type HeritageResult = {
  /** 'high' = on a heritage register (renovation/demo constrained),
   * 'medium' = traditional building character (pre-1947 protection),
   * 'informational' = dwelling house character overlay only (height/form
   * controls, no listing), 'none' = nothing. */
  riskLevel: RiskLevel;
  entries: HeritageEntry[];
  hasConsideration: boolean;
  sources: HeritageSource[];
  raw: { state: unknown; local: unknown; character: unknown; dwellingCharacter: unknown };
  context: { state: unknown; local: unknown; character: unknown; dwellingCharacter: unknown };
};


function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

const pick = (a: Record<string, unknown>, fields: string[]): string | null => {
  for (const f of fields) {
    const v = a[f];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
};

/** Map one council heritage feature onto an entry. Field names differ per
 * council (BCC/GC/MBRC use the OVL2_DESC schema, Sunshine Coast LABEL,
 * Redland CLASS/Significance, Logan Heritage_Reference), so try each
 * vocabulary in turn rather than assuming one schema. */
function councilEntry(
  type: HeritageEntry["type"],
  f: Feature<Geometry | null, GeoJsonProperties>,
  labelFields?: string[],
): HeritageEntry {
  const a = attrs(f);
  const description =
    pick(a, labelFields ?? []) ??
    pick(a, [
      "OVL2_DESC",
      "Ovl2_Desc",
      "LABEL",
      "Heritage_Reference",
      "Significance",
      "CLASS",
    ]);
  // Some councils put "on a listing" and "next to a listing" in the SAME
  // layer, separated only by the label (Redland's Significance field
  // reads "State Significance" or "Adjoining State Significance"). Being
  // next door triggers assessment of impacts on the neighbour; it does
  // not list this property, so it must not grade as one.
  const adjoining = /adjoin|proximity|vicinity/i.test(description ?? "");
  return {
    type: type === "local" && adjoining ? "character" : type,
    category: pick(a, ["CAT_DESC", "HEADING", "DESCRIPT"]),
    description,
    code: pick(a, ["OVL2_CAT", "Heritage_Reference_Code"]),
    notes: pick(a, ["DESCRIPTION", "PS_Policy_Name", "Description"]),
  };
}

function qhrEntry(f: Feature<Geometry | null, GeoJsonProperties>): HeritageEntry {
  const a = attrs(f);
  return {
    type: "state",
    category: typeof a.status === "string" ? a.status : "State heritage place",
    description: typeof a.placename === "string" ? a.placename : null,
    code: a.place_id != null ? String(a.place_id) : null,
    notes: null,
  };
}

export async function fetchHeritageData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<HeritageResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const qhrFields = "placename,place_id,entrydate,status";
  const pointParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: false,
    lotPolygon: lot,
  });
  const contextParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: true,
    bufferDegrees: contextBuffer(lot, lat, lng),
    maxAllowableOffset: 0.00003,
    quantize: true,
  });

  const councilId = region ? councilOf(region) : "brisbane";
  const adapters: HeritageAdapter[] =
    (councilId ? HERITAGE_ADAPTERS[councilId] : undefined) ?? [];

  const [state, stateCtx, councilResults] = await Promise.all([
    queryArcGIS(QHR_LAYER, pointParams(qhrFields)),
    queryArcGIS(QHR_LAYER, contextParams(qhrFields)),
    Promise.all(adapters.map((a) => queryOverlayAdapter(a, lat, lng, lot))),
  ]);

  // The report's raw/context shape predates the adapter table and keeps
  // one slot per entry kind, so fold each adapter's features into the
  // slot its entryType names.
  const bucket = (
    kind: HeritageEntry["type"],
    key: "point" | "context",
  ): FeatureCollection<Geometry | null> => ({
    type: "FeatureCollection",
    features: councilResults.flatMap((r, i) =>
      adapters[i].entryType === kind ? r[key].features : [],
    ),
  });
  const local = bucket("local", "point");
  const character = bucket("character", "point");
  const dwelling = bucket("dwelling_character", "point");
  const localCtx = bucket("local", "context");
  const characterCtx = bucket("character", "context");
  const dwellingCtx = bucket("dwelling_character", "context");

  const entries: HeritageEntry[] = [
    ...state.features.map(qhrEntry),
    ...councilResults.flatMap((r, i) =>
      r.point.features.map((f) =>
        councilEntry(adapters[i].entryType, f, adapters[i].labelFields),
      ),
    ),
  ];
  const hasState = entries.some((e) => e.type === "state");
  const hasLocal = entries.some((e) => e.type === "local");
  const hasCharacter = entries.some((e) => e.type === "character");
  const hasDwellingCharacter = entries.some((e) => e.type === "dwelling_character");
  // The Dwelling house character overlay blankets most of Brisbane's
  // low-density suburbs and only bites on a pre-1946 house or a new build
  // on a small lot: it is not a heritage listing and not a demolition
  // control, and Develo does not flag it at all. Grading it as a warning
  // turned 31 of 40 sampled Brisbane lots into "character considerations",
  // so on its own it is informational: shown, never flagged.
  const riskLevel: RiskLevel =
    hasState || hasLocal
      ? "high"
      : hasCharacter
        ? "medium"
        : hasDwellingCharacter
          ? "informational"
          : "none";

  const sources: HeritageSource[] = [
    {
      name: "Queensland Heritage Register",
      url: QHR_DOC,
      layer: QHR_LAYER,
    },
  ];
  sources.push(
    ...adapters.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
  );

  return {
    riskLevel,
    entries,
    hasConsideration: entries.length > 0,
    sources,
    raw: { state, local, character, dwellingCharacter: dwelling },
    context: {
      state: stateCtx,
      local: localCtx,
      character: characterCtx,
      dwellingCharacter: dwellingCtx,
    },
  };
}
