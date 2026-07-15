// Vegetation module.
//
// Statewide backbone: the regulated vegetation management map (VM Act
// 1999) — QSpatial Biota/VegetationManagement layer 109 "RVM - all"
// (verified live 2026-07, field `rvm_cat` ∈ A/B/C/R/X/water). Category
// A/B (remnant), C (high-value regrowth) and R (GBR riverine) constrain
// clearing anywhere in Queensland; X = exempt.
//
// Plus statewide essential habitat (layer 5 of the same service).
//
// Brisbane enhancement: inside Brisbane LGA we also query the BCC City
// Plan 2014 Biodiversity areas overlay (waterway corridors, MSES lines,
// council biodiversity areas) — the layer conveyancers cite for BCC lots.

import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";
import type { Region } from "@/lib/region";

const VM =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Biota/VegetationManagement/MapServer";
const RVM_ALL = `${VM}/109/query`;
const ESSENTIAL_HABITAT = `${VM}/5/query`;
const BCC_BIODIVERSITY =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/Biodiversity_areas_overlay_Biodiversity_areas/FeatureServer/0/query";

const QLD_VEG_DOC =
  "https://www.qld.gov.au/environment/land/management/vegetation/maps";
const BCC_BIODIVERSITY_DOC =
  "https://cityplan.brisbane.qld.gov.au/eplan/property/0/0/Biodiversity";

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

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

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

function classifyCouncil(desc: string | null): RiskLevel {
  if (!desc) return "none";
  const s = desc.toLowerCase();
  if (s.includes("waterway") || s.includes("wetland")) return "high";
  if (s.includes("biodiversity") && s.includes("matter")) return "high";
  if (s.includes("biodiversity")) return "medium";
  if (s.includes("ecological corridor")) return "medium";
  return "low";
}

export async function fetchVegetationData(
  lat: number,
  lng: number,
  region?: Region,
): Promise<VegetationResult> {
  const isBrisbane = region?.isBrisbane ?? true;
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;
  const bccFields = "CAT_DESC,OVL_CAT,OVL2_DESC,OVL2_CAT,DESCRIPTION";
  const pointParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: false,
    bufferDegrees: 0.00045,
  });
  const contextParams = (outFields: string) => ({
    geometry: point,
    geometryType: "esriGeometryPoint" as const,
    inSR: 4326,
    outFields,
    returnGeometry: true,
    bufferDegrees: 0.0025,
    maxAllowableOffset: 0.00003,
  });

  const [rvm, habitat, council, rvmCtx, habitatCtx, councilCtx] =
    await Promise.all([
      queryArcGIS(RVM_ALL, pointParams("rvm_cat")),
      queryArcGIS(ESSENTIAL_HABITAT, pointParams("*")),
      isBrisbane ? queryArcGIS(BCC_BIODIVERSITY, pointParams(bccFields)) : EMPTY_FC,
      queryArcGIS(RVM_ALL, contextParams("rvm_cat")),
      queryArcGIS(ESSENTIAL_HABITAT, contextParams("*")),
      isBrisbane
        ? queryArcGIS(BCC_BIODIVERSITY, contextParams(bccFields))
        : EMPTY_FC,
    ]);

  const rvmCat = worstRvmCat(rvm.features);
  const hasEssentialHabitat = habitat.features.length > 0;
  const councilAttrs = attrs(council.features[0]);
  const councilDesc =
    typeof councilAttrs.OVL2_DESC === "string" ? councilAttrs.OVL2_DESC : null;

  // Regulated categories A/B → high (clearing assessable), C/R → medium,
  // essential habitat → at least medium, council overlay per its own scale.
  const rvmRisk: RiskLevel =
    rvmCat === "A" || rvmCat === "B"
      ? "high"
      : rvmCat === "C" || rvmCat === "R"
        ? "medium"
        : "none";
  const councilRisk = classifyCouncil(councilDesc);
  const rank: RiskLevel[] = ["none", "very_low", "low", "medium", "high"];
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
  if (isBrisbane) {
    sources.push({
      name: "BCC City Plan 2014 — Biodiversity areas overlay",
      url: BCC_BIODIVERSITY_DOC,
      layer: BCC_BIODIVERSITY,
    });
  }

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
