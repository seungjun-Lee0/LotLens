// Vegetation module.
//
// Statewide backbone: the regulated vegetation management map (VM Act
// 1999): QSpatial Biota/VegetationManagement layer 109 "RVM - all"
// (verified live 2026-07, field `rvm_cat` ∈ A/B/C/R/X/water). Category
// A/B (remnant), C (high-value regrowth) and R (GBR riverine) constrain
// clearing anywhere in Queensland; X = exempt.
//
// Plus statewide essential habitat (layer 5 of the same service).
//
// Council enhancement: the council biodiversity instruments conveyancers
// cite locally, through VEGETATION_ADAPTERS (Brisbane, Gold Coast,
// Sunshine Coast, Redland, Logan). Brisbane also carries the four Natural
// Assets Local Law 2003 protected-vegetation layers: the biodiversity
// overlay alone left most NALL-mapped suburban lots reading "clear".

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
  overlayLabels,
  queryOverlayAdapter,
  VEGETATION_ADAPTERS,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import type { Region } from "@/lib/region";

const VM =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Biota/VegetationManagement/MapServer";
const RVM_ALL = `${VM}/109/query`;
const ESSENTIAL_HABITAT = `${VM}/5/query`;

const QLD_VEG_DOC =
  "https://www.qld.gov.au/environment/land/management/vegetation/maps";

export type VegetationResult = {
  riskLevel: RiskLevel;
  /** Human summary, e.g. "RVM Category B (remnant)" or council OVL2_DESC. */
  category: string | null;
  /** RVM category code (A/B/C/R/X) at the point. */
  code: string | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: { rvm: unknown; essentialHabitat: unknown; council: unknown };
  context: { rvm: unknown; essentialHabitat: unknown; council: unknown };
};


const RVM_LABEL: Record<string, string> = {
  A: "RVM Category A (compliance/offset area)",
  B: "RVM Category B (remnant vegetation)",
  C: "RVM Category C (high-value regrowth)",
  R: "RVM Category R (GBR riverine regrowth)",
  X: "RVM Category X (exempt)",
};

function attrs(
  f: Feature<Geometry | null, GeoJsonProperties> | undefined,
): Record<string, unknown> {
  return (f?.properties ?? {}) as Record<string, unknown>;
}

/** Worst regulated category wins when polygons stack. */
function worstRvmCat(
  features: Feature<Geometry | null, GeoJsonProperties>[],
): string | null {
  const order = ["A", "B", "C", "R", "X"];
  let best: string | null = null;
  for (const f of features) {
    const c = String(attrs(f).rvm_cat ?? "").toUpperCase();
    if (!order.includes(c)) continue;
    if (best === null || order.indexOf(c) < order.indexOf(best)) best = c;
  }
  return best;
}

// Council vegetation vocabularies vary widely ("Matters of State
// Environmental Significance", "MLES - Urban Habitat and Amenity Area",
// "Primary Vegetation Management Area", "Bushland Habitat"), so grade on
// what the label asserts, worst tier first.
function classifyCouncil(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  // State/national significance and waterway or wetland corridors: the
  // clearing triggers that gate a development application outright.
  if (s.includes("waterway") || s.includes("wetland")) return "high";
  if (s.includes("mses") || s.includes("mnes")) return "high";
  if (s.includes("state environmental significance")) return "high";
  if (s.includes("state significant")) return "high";
  if (s.includes("biodiversity") && s.includes("matter")) return "high";
  if (s.includes("remnant")) return "high";
  // Matters of LOCAL significance are mapped city-wide and cover ordinary
  // suburban blocks: real, but not the same order of constraint. Checked
  // before the habitat/biodiversity rules below, whose keywords they
  // also contain ("MLES - Urban Habitat and Amenity Area").
  if (s.includes("mles") || s.includes("locally significant")) return "low";
  // BCC Natural Assets Local Law: clearing the mapped vegetation needs a
  // permit, on any lot. Council-owned vegetation is a neighbour's
  // constraint more than the buyer's, so it grades lowest.
  if (s.includes("significant native") || s.includes("significant urban")) return "medium";
  if (s.includes("council vegetation")) return "low";
  if (s.includes("koala")) return "medium";
  if (s.includes("corridor")) return "medium";
  if (s.includes("vegetation management")) return "medium";
  if (s.includes("regulated vegetation")) return "medium";
  if (s.includes("habitat")) return "medium";
  if (s.includes("biodiversity")) return "medium";
  return "low";
}

export async function fetchVegetationData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<VegetationResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const pointParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: false,
    bufferDegrees: 0.00045,
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
  const adapters = (councilId ? VEGETATION_ADAPTERS[councilId] : undefined) ?? [];

  const [rvm, habitat, rvmCtx, habitatCtx, councilResults] = await Promise.all([
    queryArcGIS(RVM_ALL, pointParams("rvm_cat")),
    queryArcGIS(ESSENTIAL_HABITAT, pointParams("*")),
    queryArcGIS(RVM_ALL, contextParams("rvm_cat")),
    queryArcGIS(ESSENTIAL_HABITAT, contextParams("*")),
    Promise.all(adapters.map((a) => queryOverlayAdapter(a, lat, lng, lot))),
  ]);
  const merge = (
    key: "point" | "context",
  ): FeatureCollection<Geometry | null> => ({
    type: "FeatureCollection",
    features: councilResults.flatMap((r) => r[key].features),
  });
  const council = merge("point");
  const councilCtx = merge("context");

  const rvmCat = worstRvmCat(rvm.features);
  const hasEssentialHabitat = habitat.features.length > 0;
  // A lot can sit under several council overlays at once (a koala
  // corridor inside an MSES area): grade them all and keep the worst.
  const rank: RiskLevel[] = ["none", "very_low", "low", "medium", "high"];
  const councilDesc = councilResults
    .flatMap((r, i) => overlayLabels(r.point, adapters[i].labelFields))
    .reduce<string | null>(
      (worst, l) =>
        rank.indexOf(classifyCouncil(l)) > rank.indexOf(classifyCouncil(worst))
          ? l
          : worst,
      null,
    );

  // Regulated categories A/B → high (clearing assessable), C/R → medium,
  // essential habitat → at least medium, council overlay per its own scale.
  const rvmRisk: RiskLevel =
    rvmCat === "A" || rvmCat === "B"
      ? "high"
      : rvmCat === "C" || rvmCat === "R"
        ? "medium"
        : "none";
  const councilRisk = classifyCouncil(councilDesc);
  const candidates: RiskLevel[] = [
    rvmRisk,
    councilRisk,
    hasEssentialHabitat ? "medium" : "none",
  ];
  const riskLevel = candidates.reduce<RiskLevel>(
    (a, b) => (rank.indexOf(b) > rank.indexOf(a) ? b : a),
    "none",
  );

  const category =
    (rvmCat && rvmCat !== "X" ? RVM_LABEL[rvmCat] : null) ??
    councilDesc ??
    (hasEssentialHabitat ? "Essential habitat" : null);

  const sources: VegetationResult["sources"] = [
    {
      name: "QLD Regulated Vegetation Management Map",
      url: QLD_VEG_DOC,
      layer: RVM_ALL,
    },
  ];
  sources.push(
    ...adapters.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
  );

  return {
    riskLevel,
    category,
    code: rvmCat,
    hasConsideration: riskLevel !== "none",
    sources,
    raw: { rvm, essentialHabitat: habitat, council },
    context: { rvm: rvmCtx, essentialHabitat: habitatCtx, council: councilCtx },
  };
}
