// Extract module-specific overlay polygons from a council_data row's
// raw_response and tag each feature with a `fillColor` property so the
// MapLibre layer can paint everything in one source with a `get` expression.
//
// Colour palette mirrors Develo's property fact pack so the same property
// renders with the same visual logic — buyers comparing reports recognise
// the language immediately. Each module gets a single colour FAMILY, with
// 4 lightness/saturation tiers when the layer has a 4-step risk scale:
//
//   Flooding overall   navy / blue family
//   Overland Flow      orange / yellow family
//   Storm Tide         cyan / teal family (distinct from Flooding's blue)
//   Flood History      bright magenta / purple (single)
//   Bushfire           red / orange family
//   Heritage           purple / pink / indigo
//   Easements          magenta / pink (single)
//   Vegetation         mixed (water=blue, MSES=orange, biodiversity=yellow,
//                            corridor=green) — Develo uses the same scheme
//   Zoning             multi (Centre / Mixed / Residential / Open space)
//
// Module ICON tints stay on the Apple system palette (see module-meta.ts).
// Only the overlay polygons use the Develo-mirrored hexes below.

import type { Feature, FeatureCollection, Geometry } from "geojson";

import type { Module } from "@/lib/db";

export type OverlayFeature = Feature<
  Geometry,
  { fillColor: string; legendLabel: string }
>;

// ── Develo-style overlay palette ─────────────────────────────────────────

export const DEVELO_HEX = {
  // Flooding overall — navy/blue family
  floodHigh:    "#1e3a8a",
  floodMedium:  "#2563eb",
  floodLow:     "#60a5fa",
  floodVeryLow: "#bfdbfe",

  // Overland Flow — orange/yellow family
  overlandHigh:    "#c2410c",
  overlandMedium:  "#f97316",
  overlandLow:     "#fbbf24",
  overlandVeryLow: "#fde68a",

  // Storm Tide — cyan/teal family (distinct from main Flooding)
  stormHigh:    "#0e7490",
  stormMedium:  "#06b6d4",
  stormLow:     "#67e8f9",
  stormVeryLow: "#cffafe",

  // Flood History — Develo's signature bright magenta
  histFeb2022: "#c026d3",
  histJan2011: "#a855f7",

  // Bushfire — orange/red family
  fireVeryHigh: "#b91c1c",
  fireHigh:     "#dc2626",
  fireBuffer:   "#ea580c",
  fireMedium:   "#f59e0b",

  // Heritage / Character — purple family
  heritageState:     "#7e22ce",
  heritageLocal:     "#db2777",
  heritageCharacter: "#a855f7",

  // Easements — magenta/pink
  easementHV: "#db2777",

  // Vegetation — Develo's multi-colour scheme
  vegWaterway:    "#0284c7",
  vegMSES:        "#ea580c",
  vegBiodiversity: "#84cc16",
  vegCorridor:    "#16a34a",

  // Zoning — keep multi-family
  zoneCentre:   "#dc2626",
  zoneMixed:    "#f97316",
  zoneResidential: "#facc15",
  zoneOpenSpace: "#16a34a",
  zoneOther:    "#6366f1",
};

// ── Helpers ──────────────────────────────────────────────────────────────

function isFC(v: unknown): v is FeatureCollection<Geometry, Record<string, unknown>> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "FeatureCollection"
  );
}

function pushFC(
  out: OverlayFeature[],
  fc: unknown,
  classify: (props: Record<string, unknown>) => { fillColor: string; legendLabel: string },
) {
  if (!isFC(fc)) return;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const { fillColor, legendLabel } = classify(props);
    out.push({
      type: "Feature",
      geometry: f.geometry,
      properties: { fillColor, legendLabel },
    });
  }
}

// ── Per-module classifiers ──────────────────────────────────────────────

function floodingColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.floodHigh,    legendLabel: "High possibility (5.0% AEP)" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.floodMedium,  legendLabel: "Moderate possibility (1.0% AEP)" };
  if (r === "low")      return { fillColor: DEVELO_HEX.floodLow,     legendLabel: "Low possibility (0.2% AEP)" };
  if (r === "very low") return { fillColor: DEVELO_HEX.floodVeryLow, legendLabel: "Very low possibility (0.05% AEP)" };
  return { fillColor: "#94a3b8", legendLabel: "Unclassified" };
}

function overlandFlowColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.overlandHigh,    legendLabel: "Overland flow — high impact" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.overlandMedium,  legendLabel: "Overland flow — moderate impact" };
  if (r === "low")      return { fillColor: DEVELO_HEX.overlandLow,     legendLabel: "Overland flow — low impact" };
  if (r === "very low") return { fillColor: DEVELO_HEX.overlandVeryLow, legendLabel: "Overland flow — very low" };
  return { fillColor: "#94a3b8", legendLabel: "Overland flow" };
}

function stormTideColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.stormHigh,    legendLabel: "Storm tide — high" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.stormMedium,  legendLabel: "Storm tide — medium" };
  if (r === "low")      return { fillColor: DEVELO_HEX.stormLow,     legendLabel: "Storm tide — low" };
  if (r === "very low") return { fillColor: DEVELO_HEX.stormVeryLow, legendLabel: "Storm tide — very low" };
  return { fillColor: "#94a3b8", legendLabel: "Storm tide" };
}

function bushfireColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? "").toLowerCase();
  if (d.includes("very high"))        return { fillColor: DEVELO_HEX.fireVeryHigh, legendLabel: "Very high potential" };
  if (d.includes("high hazard area")) return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "High hazard area" };
  if (d.includes("high hazard"))      return { fillColor: DEVELO_HEX.fireBuffer,   legendLabel: "High hazard buffer" };
  if (d.includes("medium"))           return { fillColor: DEVELO_HEX.fireMedium,   legendLabel: "Medium hazard area" };
  return { fillColor: "#94a3b8", legendLabel: String(props.OVL2_DESC ?? "Hazard area") };
}

function vegetationColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? "").toLowerCase();
  if (d.includes("waterway") || d.includes("wetland"))
    return { fillColor: DEVELO_HEX.vegWaterway,    legendLabel: "Waterway / wetland vegetation" };
  if (d.includes("matter"))
    return { fillColor: DEVELO_HEX.vegMSES,        legendLabel: "Matters of state interest" };
  if (d.includes("corridor"))
    return { fillColor: DEVELO_HEX.vegCorridor,    legendLabel: "Ecological corridor" };
  return { fillColor: DEVELO_HEX.vegBiodiversity,  legendLabel: "Biodiversity area" };
}

function floodPlanningColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? "");
  const n = parseInt(d.replace(/\D/g, ""), 10);
  if (n === 1) return { fillColor: DEVELO_HEX.floodHigh,    legendLabel: "Planning area 1 — strictest" };
  if (n === 2) return { fillColor: DEVELO_HEX.floodMedium,  legendLabel: "Planning area 2" };
  if (n === 3) return { fillColor: DEVELO_HEX.floodLow,     legendLabel: "Planning area 3" };
  if (n >= 4) return { fillColor: DEVELO_HEX.floodVeryLow, legendLabel: "Planning area 4 — mildest" };
  return { fillColor: "#94a3b8", legendLabel: d || "Planning area" };
}

function noiseColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? "");
  const isAnef = /anef/i.test(d);
  const n = parseInt(d.replace(/\D/g, ""), 10);
  if (isAnef) {
    if (n >= 30) return { fillColor: DEVELO_HEX.fireVeryHigh, legendLabel: "Aircraft 30+ ANEF" };
    if (n >= 25) return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "Aircraft 25–30 ANEF" };
    if (n >= 20) return { fillColor: DEVELO_HEX.fireBuffer,   legendLabel: "Aircraft 20–25 ANEF" };
    return { fillColor: DEVELO_HEX.fireMedium, legendLabel: d };
  }
  if (n === 1) return { fillColor: DEVELO_HEX.fireHigh,    legendLabel: "Transport corridor 1" };
  if (n === 2) return { fillColor: DEVELO_HEX.fireBuffer,  legendLabel: "Transport corridor 2" };
  if (n === 3) return { fillColor: DEVELO_HEX.fireMedium,  legendLabel: "Transport corridor 3" };
  if (n >= 4) return { fillColor: "#fde68a",               legendLabel: "Transport corridor 4" };
  return { fillColor: "#94a3b8", legendLabel: d || "Noise corridor" };
}

function schoolsColor(props: Record<string, unknown>) {
  const t = String(props.CatchmentType ?? "").toLowerCase();
  if (t.includes("primary")) return { fillColor: DEVELO_HEX.vegBiodiversity, legendLabel: "Primary catchment" };
  // Treat any secondary type (Junior/Senior Secondary) as one band.
  if (t.includes("secondary")) return { fillColor: DEVELO_HEX.vegCorridor, legendLabel: "Secondary catchment" };
  return { fillColor: "#94a3b8", legendLabel: t || "School catchment" };
}

function zoningColor(props: Record<string, unknown>) {
  const f = String(props.LVL1_ZONE ?? "").toLowerCase();
  if (f.startsWith("centre"))             return { fillColor: DEVELO_HEX.zoneCentre,    legendLabel: "Centre" };
  if (f.startsWith("mixed"))              return { fillColor: DEVELO_HEX.zoneMixed,     legendLabel: "Mixed use" };
  if (f.includes("residential"))          return { fillColor: DEVELO_HEX.zoneResidential, legendLabel: "General residential" };
  if (f.includes("open space") || f.includes("recreation"))
                                          return { fillColor: DEVELO_HEX.zoneOpenSpace, legendLabel: "Open space / Recreation" };
  return { fillColor: DEVELO_HEX.zoneOther, legendLabel: String(props.LVL1_ZONE ?? "Other") };
}

// ── Public extractor ─────────────────────────────────────────────────────

export function extractOverlays(module: Module, raw: unknown): OverlayFeature[] {
  const out: OverlayFeature[] = [];
  if (!raw || typeof raw !== "object") return out;
  // Prefer `context` (envelope query — ~280 m around property, always has
  // features when any exist nearby) over `raw` (point query — only has
  // features the property is inside).
  const r = raw as Record<string, unknown>;
  const inner = r.context ?? r.raw;
  if (inner === undefined) return out;

  switch (module) {
    case "flooding": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.overall, floodingColor);
      pushFC(out, i.historic2022, () => ({
        fillColor: DEVELO_HEX.histFeb2022,
        legendLabel: "Flood event — Feb 2022",
      }));
      pushFC(out, i.historic2011, () => ({
        fillColor: DEVELO_HEX.histJan2011,
        legendLabel: "Flood event — Jan 2011",
      }));
      return out;
    }
    case "overland_flow":
      pushFC(out, inner, overlandFlowColor);
      return out;
    case "storm_tide":
      pushFC(out, inner, stormTideColor);
      return out;
    case "bushfire":
      pushFC(out, inner, bushfireColor);
      return out;
    case "vegetation":
      pushFC(out, inner, vegetationColor);
      return out;
    case "heritage": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.state, () => ({
        fillColor: DEVELO_HEX.heritageState,
        legendLabel: "State heritage area",
      }));
      pushFC(out, i.local, () => ({
        fillColor: DEVELO_HEX.heritageLocal,
        legendLabel: "Local heritage area",
      }));
      pushFC(out, i.character, () => ({
        fillColor: DEVELO_HEX.heritageCharacter,
        legendLabel: "Character (pre-1947)",
      }));
      return out;
    }
    case "easements":
      pushFC(out, inner, () => ({
        fillColor: DEVELO_HEX.easementHV,
        legendLabel: "High-voltage easement",
      }));
      return out;
    case "flood_planning": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.river, floodPlanningColor);
      pushFC(out, i.creek, floodPlanningColor);
      return out;
    }
    case "noise": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.transport, noiseColor);
      pushFC(out, i.anef, noiseColor);
      return out;
    }
    case "schools":
      pushFC(out, inner, schoolsColor);
      return out;
    case "zoning":
      pushFC(out, inner, zoningColor);
      return out;
  }
}
