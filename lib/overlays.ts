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
  { fillColor: string; legendLabel: string; fillOpacity?: number }
>;

type Classified = { fillColor: string; legendLabel: string; fillOpacity?: number };
type OverlayScope = "context" | "property";

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
  easementCadastre: "#a21caf",

  // Vegetation — Develo's multi-colour scheme
  vegWaterway:    "#0284c7",
  vegMSES:        "#ea580c",
  vegBiodiversity: "#84cc16",
  vegCorridor:    "#16a34a",

  // Zoning — keep multi-family
  zoneCentre:   "#dc2626",
  zoneMixed:    "#f97316",
  zoneLowMediumResidential: "#d97706",
  zoneResidential: "#facc15",
  zoneOpenSpace: "#16a34a",
  zoneOther:    "#6366f1",

  // Coastal erosion prone area (paired with the storm-tide cyan family)
  coastalErosion: "#d97706",

  // Regulated vegetation (statewide RVM categories)
  rvmA: "#15803d",
  rvmB: "#16a34a",
  rvmC: "#84cc16",
  rvmR: "#0d9488",

  // Environment — koala / wildlife habitat
  koalaCore:     "#16a34a",
  koalaLocal:    "#4ade80",
  koalaPriority: "#a3e635",
  wildlifeHabitat: "#f97316",

  // Acid sulfate soils
  assShallow: "#b45309",
  assMapped:  "#eab308",

  // Mining & resources
  tenement:      "#a855f7",
  kraResource:   "#dc2626",
  kraSeparation: "#f59e0b",

  // Steep land / landslide
  steepHigh: "#9a3412",
  steep:     "#f59e0b",
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
  classify: (props: Record<string, unknown>) => Classified,
) {
  if (!isFC(fc)) return;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    out.push({
      type: "Feature",
      geometry: f.geometry,
      properties: classify(props),
    });
  }
}

// ── Per-module classifiers ──────────────────────────────────────────────

function floodingColor(props: Record<string, unknown>) {
  // BCC uses FLOOD_RISK; council adapters use OVL2_DESC / LABEL /
  // Flood_Risk — accept all and keyword-match.
  const label = String(
    props.FLOOD_RISK ?? props.OVL2_DESC ?? props.LABEL ?? props.Flood_Risk ?? props.CLASS ?? "",
  );
  const r = label.toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.floodHigh,    legendLabel: "High possibility (5.0% AEP)" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.floodMedium,  legendLabel: "Moderate possibility (1.0% AEP)" };
  if (r === "low")      return { fillColor: DEVELO_HEX.floodLow,     legendLabel: "Low possibility (0.2% AEP)" };
  if (r === "very low") return { fillColor: DEVELO_HEX.floodVeryLow, legendLabel: "Very low (0.05% AEP)" };
  if (r.includes("extreme") || r.includes("very high") || r.includes("high"))
    return { fillColor: DEVELO_HEX.floodHigh, legendLabel: label };
  if (r.includes("moderate") || r.includes("medium"))
    return { fillColor: DEVELO_HEX.floodMedium, legendLabel: label };
  if (r.includes("very low"))
    return { fillColor: DEVELO_HEX.floodVeryLow, legendLabel: label };
  if (r.includes("low"))
    return { fillColor: DEVELO_HEX.floodLow, legendLabel: label };
  if (label)
    return { fillColor: DEVELO_HEX.floodMedium, legendLabel: label };
  return { fillColor: "#94a3b8", legendLabel: "Unclassified" };
}

function overlandFlowColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.overlandHigh,    legendLabel: "High impact" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.overlandMedium,  legendLabel: "Moderate impact" };
  if (r === "low")      return { fillColor: DEVELO_HEX.overlandLow,     legendLabel: "Low impact" };
  if (r === "very low") return { fillColor: DEVELO_HEX.overlandVeryLow, legendLabel: "Very low" };
  return { fillColor: "#94a3b8", legendLabel: "Overland flow" };
}

function stormTideColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")     return { fillColor: DEVELO_HEX.stormHigh,    legendLabel: "High risk" };
  if (r === "medium")   return { fillColor: DEVELO_HEX.stormMedium,  legendLabel: "Medium risk" };
  if (r === "low")      return { fillColor: DEVELO_HEX.stormLow,     legendLabel: "Low risk" };
  if (r === "very low") return { fillColor: DEVELO_HEX.stormVeryLow, legendLabel: "Very low risk" };
  return { fillColor: "#94a3b8", legendLabel: "Storm tide" };
}

function bushfireColor(props: Record<string, unknown>) {
  // Statewide BPA uses `class`; the old BCC overlay used OVL2_DESC —
  // accept both so historical council_data rows still paint.
  const label = String(props.class ?? props.OVL2_DESC ?? "");
  const d = label.toLowerCase();
  if (d.includes("very high"))        return { fillColor: DEVELO_HEX.fireVeryHigh, legendLabel: "Very high potential intensity" };
  if (d.includes("high hazard area")) return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "High hazard area" };
  if (d.includes("high"))             return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "High potential intensity" };
  if (d.includes("medium"))           return { fillColor: DEVELO_HEX.fireMedium,   legendLabel: "Medium potential intensity" };
  if (d.includes("buffer") || d.includes("impact"))
                                      return { fillColor: DEVELO_HEX.fireBuffer,   legendLabel: "Potential impact buffer" };
  // QFD awareness vector tiles (fallback source) carry no intensity class.
  if (d.includes("prone"))            return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "Bushfire prone area" };
  return { fillColor: "#94a3b8", legendLabel: label || "Hazard area" };
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
  if (n === 1) return { fillColor: DEVELO_HEX.floodHigh,    legendLabel: "Planning area 1 - strictest" };
  if (n === 2) return { fillColor: DEVELO_HEX.floodMedium,  legendLabel: "Planning area 2" };
  if (n === 3) return { fillColor: DEVELO_HEX.floodLow,     legendLabel: "Planning area 3" };
  if (n >= 4) return { fillColor: DEVELO_HEX.floodVeryLow, legendLabel: "Planning area 4 - mildest" };
  return { fillColor: "#94a3b8", legendLabel: d || "Planning area" };
}

function noiseColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? props.LABEL ?? props.CLASS ?? "");
  const isAnef = /anef/i.test(d);
  if (isAnef) {
    const n = parseInt(d.replace(/\D/g, ""), 10);
    if (n >= 30) return { fillColor: DEVELO_HEX.fireVeryHigh, legendLabel: "Aircraft 30+ ANEF" };
    if (n >= 25) return { fillColor: DEVELO_HEX.fireHigh,     legendLabel: "Aircraft 25-30 ANEF" };
    if (n >= 20) return { fillColor: DEVELO_HEX.fireBuffer,   legendLabel: "Aircraft 20-25 ANEF" };
    return { fillColor: DEVELO_HEX.fireMedium, legendLabel: d };
  }
  // QDC MP4.4 "noise category N" — HIGHER = louder (opposite of the BCC
  // legacy corridor numbering below).
  const qdc = /categor(?:y|ies)\s*(\d)/i.exec(d);
  if (qdc) {
    const n = Number(qdc[1]);
    if (n >= 3) return { fillColor: DEVELO_HEX.fireHigh,   legendLabel: "Noise category 3-4 (loudest)" };
    if (n === 2) return { fillColor: DEVELO_HEX.fireBuffer, legendLabel: "Noise category 2" };
    return { fillColor: DEVELO_HEX.fireMedium, legendLabel: "Noise category 0-1" };
  }
  const corridor = /corridor\s*(\d)/i.exec(d);
  const n = corridor ? Number(corridor[1]) : NaN;
  if (n === 1) return { fillColor: DEVELO_HEX.fireHigh,    legendLabel: "Transport corridor 1 - loudest" };
  if (n === 2) return { fillColor: DEVELO_HEX.fireBuffer,  legendLabel: "Transport corridor 2" };
  if (n >= 3) return { fillColor: DEVELO_HEX.fireMedium, legendLabel: "Transport corridor 3-4" };
  return { fillColor: "#94a3b8", legendLabel: d || "Noise corridor" };
}

// Catchments are suburb-scale polygons stacked per year level — a filled
// wash drowns the whole map in green. The information is the BOUNDARY, so
// paint outlines only (fillOpacity 0).
function schoolsColor(props: Record<string, unknown>) {
  const t = String(props.CatchmentType ?? "").toLowerCase();
  if (t.includes("primary"))
    return { fillColor: DEVELO_HEX.vegBiodiversity, legendLabel: "Primary catchment", fillOpacity: 0 };
  // Treat any secondary type (Junior/Senior Secondary) as one band.
  if (t.includes("secondary"))
    return { fillColor: DEVELO_HEX.vegCorridor, legendLabel: "Secondary catchment", fillOpacity: 0 };
  return { fillColor: "#94a3b8", legendLabel: t || "School catchment", fillOpacity: 0 };
}

function rvmColor(props: Record<string, unknown>): Classified {
  const c = String(props.rvm_cat ?? "").toUpperCase();
  if (c === "A") return { fillColor: DEVELO_HEX.rvmA, legendLabel: "RVM Category A" };
  if (c === "B") return { fillColor: DEVELO_HEX.rvmB, legendLabel: "RVM Category B (remnant)" };
  if (c === "C") return { fillColor: DEVELO_HEX.rvmC, legendLabel: "RVM Category C (regrowth)" };
  if (c === "R") return { fillColor: DEVELO_HEX.rvmR, legendLabel: "RVM Category R (riverine)" };
  // Category X / water are exempt — paint nothing visible.
  return { fillColor: "#94a3b8", legendLabel: "Exempt (Category X)", fillOpacity: 0 };
}

function assColor(props: Record<string, unknown>): Classified {
  const code = String(props.map_code ?? "");
  const meaning = String(props.map_code_meaning ?? "");
  const shallow = /s[0-2]/i.test(code) || /sulfid/i.test(meaning);
  return shallow
    ? { fillColor: DEVELO_HEX.assShallow, legendLabel: "Acid sulfate soils (shallow sulfidic)" }
    : { fillColor: DEVELO_HEX.assMapped, legendLabel: "Acid sulfate soils (mapped)", fillOpacity: 0.25 };
}

function steepColor(props: Record<string, unknown>): Classified {
  const label = String(
    props.OVL2_DESC ?? props.LABEL ?? props.CLASS ?? props.Class ?? "Landslide / steep land",
  );
  const s = label.toLowerCase();
  const high = s.includes("high") || s.includes("landslide");
  return {
    fillColor: high ? DEVELO_HEX.steepHigh : DEVELO_HEX.steep,
    legendLabel: label,
  };
}

function tenementColor(props: Record<string, unknown>): Classified {
  const status = String(props.tenstatus ?? "").toLowerCase();
  const type = String(props.tentype ?? "Resource authority");
  return {
    fillColor: DEVELO_HEX.tenement,
    legendLabel: `${type}${status ? ` (${status})` : ""}`,
    fillOpacity: status.includes("granted") ? 0.25 : 0.12,
  };
}

// Zone polygons are dissolved by zone-precinct — a single feature spans a
// whole block of lots, so they blanket the whole viewport. Keep the fill
// faint (the per-lot cadastre lines carry the structure) so the satellite
// imagery stays legible instead of drowning under a pink wash.
const ZONE_FILL_OPACITY = 0.18;

function zoningColor(props: Record<string, unknown>): Classified {
  // SEQ Regional Plan land use category (non-Brisbane baseline).
  if (typeof props.rluc2023 === "string" && props.rluc2023) {
    const r = props.rluc2023.toLowerCase();
    const o = ZONE_FILL_OPACITY;
    if (r.includes("urban"))
      return { fillColor: DEVELO_HEX.zoneResidential, legendLabel: "Urban Footprint (SEQ Regional Plan)", fillOpacity: o };
    if (r.includes("rural living"))
      return { fillColor: DEVELO_HEX.zoneLowMediumResidential, legendLabel: "Rural Living Area (SEQ Regional Plan)", fillOpacity: o };
    return { fillColor: DEVELO_HEX.zoneOpenSpace, legendLabel: props.rluc2023, fillOpacity: o };
  }
  // BCC fields first; council adapter fields (GC ZONE/LVL1_ZONE, MBRC
  // ZONE_PREC, SCC LABEL/HEADING, Redland ZONEDESC) folded in after.
  const f = String(props.LVL1_ZONE ?? props.HEADING ?? props.ZONEDESC ?? props.ZONE_PREC ?? props.LABEL ?? "").toLowerCase();
  const z = [
    props.LVL2_ZONE,
    props.ZONE_PREC_DESC,
    props.ZONE_CODE,
    props.ZONE,
    props.ZONE_PREC,
    props.LABEL,
    props.ZONEDESC,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  const o = ZONE_FILL_OPACITY;
  if (f.includes("centre"))               return { fillColor: DEVELO_HEX.zoneCentre,    legendLabel: "Centre", fillOpacity: o };
  if (f.includes("mixed"))                return { fillColor: DEVELO_HEX.zoneMixed,     legendLabel: "Mixed use", fillOpacity: o };
  if (z.includes("low-medium") || z.includes("low medium") || z.includes("2 or 3 storey"))
                                          return { fillColor: DEVELO_HEX.zoneLowMediumResidential, legendLabel: "Low-medium density residential", fillOpacity: o };
  if (f.includes("residential") || f.includes("neighbourhood"))
                                          return { fillColor: DEVELO_HEX.zoneResidential, legendLabel: "Residential", fillOpacity: o };
  if (f.includes("open space") || f.includes("recreation") || f.includes("rural") || f.includes("environment") || f.includes("conservation"))
                                          return { fillColor: DEVELO_HEX.zoneOpenSpace, legendLabel: "Open space / Rural / Environment", fillOpacity: o };
  return { fillColor: DEVELO_HEX.zoneOther, legendLabel: String(props.LVL1_ZONE ?? props.ZONEDESC ?? props.LABEL ?? props.ZONE_PREC ?? "Other"), fillOpacity: o };
}

// ── Public extractor ─────────────────────────────────────────────────────

export function extractOverlays(
  module: Module,
  raw: unknown,
  { scope = "context" }: { scope?: OverlayScope } = {},
): OverlayFeature[] {
  const out: OverlayFeature[] = [];
  if (!raw || typeof raw !== "object") return out;
  // Use context for visible map polygons, but property scope for legends:
  // customers should only see legend entries that actually affect the lot.
  const r = raw as Record<string, unknown>;
  const inner = scope === "context" ? r.context ?? r.raw : r.raw;
  if (inner === undefined) return out;

  switch (module) {
    case "flooding": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.overall, floodingColor);
      pushFC(out, i.historic2022, () => ({
        fillColor: DEVELO_HEX.histFeb2022,
        legendLabel: "Flood event (Feb 2022)",
      }));
      pushFC(out, i.historic2011, () => ({
        fillColor: DEVELO_HEX.histJan2011,
        legendLabel: "Flood event (Jan 2011)",
      }));
      return out;
    }
    case "overland_flow":
      pushFC(out, inner, overlandFlowColor);
      return out;
    case "storm_tide": {
      // Statewide coastal-hazard shape: { stormHigh, stormMedium, erosion }.
      // Legacy BCC rows were a single FC — keep painting those too.
      if (isFC(inner)) {
        pushFC(out, inner, stormTideColor);
        return out;
      }
      const i = inner as Record<string, unknown>;
      pushFC(out, i.stormHigh, () => ({
        fillColor: DEVELO_HEX.stormHigh,
        legendLabel: "Storm tide (high hazard area)",
      }));
      pushFC(out, i.stormMedium, () => ({
        fillColor: DEVELO_HEX.stormMedium,
        legendLabel: "Storm tide (medium hazard area)",
      }));
      pushFC(out, i.erosion, () => ({
        fillColor: DEVELO_HEX.coastalErosion,
        legendLabel: "Erosion prone area",
      }));
      return out;
    }
    case "bushfire":
      pushFC(out, inner, bushfireColor);
      return out;
    case "vegetation": {
      // Statewide shape: { rvm, essentialHabitat, council }. Legacy BCC
      // rows were a single FC.
      if (isFC(inner)) {
        pushFC(out, inner, vegetationColor);
        return out;
      }
      const i = inner as Record<string, unknown>;
      pushFC(out, i.rvm, rvmColor);
      pushFC(out, i.essentialHabitat, () => ({
        fillColor: DEVELO_HEX.vegWaterway,
        legendLabel: "Essential habitat",
      }));
      pushFC(out, i.council, vegetationColor);
      return out;
    }
    case "environment": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.core, () => ({
        fillColor: DEVELO_HEX.koalaCore,
        legendLabel: "Core koala habitat area",
      }));
      pushFC(out, i.local, () => ({
        fillColor: DEVELO_HEX.koalaLocal,
        legendLabel: "Locally refined koala habitat",
      }));
      pushFC(out, i.priority, () => ({
        fillColor: DEVELO_HEX.koalaPriority,
        legendLabel: "Koala priority area",
        fillOpacity: 0.15,
      }));
      pushFC(out, i.wildlife, () => ({
        fillColor: DEVELO_HEX.wildlifeHabitat,
        legendLabel: "MSES wildlife habitat",
      }));
      return out;
    }
    case "steep_land":
      pushFC(out, inner, steepColor);
      return out;
    case "acid_sulfate": {
      const i = inner as Record<string, unknown>;
      // Finest scale wins visually; paint 25k over 100k.
      pushFC(out, i.k100, assColor);
      pushFC(out, i.k50, assColor);
      pushFC(out, i.k25, assColor);
      return out;
    }
    case "mining": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.kraResource, () => ({
        fillColor: DEVELO_HEX.kraResource,
        legendLabel: "KRA resource/processing area",
      }));
      pushFC(out, i.kraSeparation, () => ({
        fillColor: DEVELO_HEX.kraSeparation,
        legendLabel: "KRA separation area",
        fillOpacity: 0.2,
      }));
      pushFC(out, i.tenements, tenementColor);
      return out;
    }
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
    case "easements": {
      // Easements has two parallel layers: high-voltage (BCC) and
      // cadastral easement parcels (QSpatial). Render both with distinct
      // legend labels so the map differentiates them.
      pushFC(out, scope === "context" ? r.context : r.raw, () => ({
        fillColor: DEVELO_HEX.easementHV,
        legendLabel: "High-voltage easement",
      }));
      pushFC(out, scope === "context" ? r.cadastralContext : r.cadastralRaw, () => ({
        fillColor: DEVELO_HEX.easementCadastre,
        legendLabel: "Registered easement (cadastre)",
      }));
      return out;
    }
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
