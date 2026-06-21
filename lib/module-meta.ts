// Per-module presentation metadata.
//
// Mirrors the layout Develo uses for every module page in their property
// fact pack: name + clarifying question, "Things to know" educational
// paragraphs, a Note: caveat, a Legend with named colour swatches, and a
// data-source attribution. Web view and PDF both consume from here so the
// two stay in sync.

import type { LucideIcon } from "lucide-react";
import { CloudRain, Flame, Landmark, LayoutGrid, Leaf, ScrollText, Waves, Wind } from "lucide-react";

import type { Module } from "@/lib/db";

export type LegendItem = {
  label: string;
  /** CSS color expression (CSS-var based, for the web view). */
  color: string;
  /** Hex equivalent for environments that can't resolve CSS variables
   * (React-PDF). Should track `color` semantically. */
  colorHex: string;
};

export type ModuleMeta = {
  name: string;
  /** "Easements" → "What access rights exist over the property?" */
  question: string;
  /** Module accent colour — used for the map pin, icon, swatches. */
  tint: string;
  /** Hex equivalent of `tint` for React-PDF. */
  tintHex: string;
  icon: LucideIcon;
  /** Attribution shown above "Things to know". */
  sourceLabel: string;
  /** Two short paragraphs of generic educational content (NOT
   * property-specific — that's what the AI narrative is for). */
  thingsToKnow: string[];
  /** Caveat shown after Things to know, mirroring Develo's "Note:" block. */
  note: string;
  /** Map legend swatches. The "Selected property" pin is added separately
   * by the renderer so it's consistent across modules. */
  legend: LegendItem[];
};

// Apple system color hex equivalents — used wherever React-PDF can't
// resolve CSS variables. Match :root in app/globals.css.
export const APPLE_HEX = {
  blue:   "#007aff",
  green:  "#34c759",
  indigo: "#5856d6",
  orange: "#ff9500",
  pink:   "#ff2d55",
  purple: "#af52de",
  red:    "#ff3b30",
  teal:   "#5ac8fa",
  yellow: "#ffcc00",
  gray:   "#8e8e93",
};

// Develo-mirrored overlay palette (kept in sync with lib/overlays.ts).
// We re-declare here to avoid a circular import — module-meta is consumed
// by the PDF too. Both files must move together when changing colours.
const D = {
  floodHigh: "#1e3a8a", floodMedium: "#2563eb", floodLow: "#60a5fa", floodVeryLow: "#bfdbfe",
  overlandHigh: "#c2410c", overlandMedium: "#f97316", overlandLow: "#fbbf24", overlandVeryLow: "#fde68a",
  stormHigh: "#0e7490", stormMedium: "#06b6d4", stormLow: "#67e8f9", stormVeryLow: "#cffafe",
  histFeb2022: "#c026d3", histJan2011: "#a855f7",
  fireVeryHigh: "#b91c1c", fireHigh: "#dc2626", fireBuffer: "#ea580c", fireMedium: "#f59e0b",
  heritageState: "#7e22ce", heritageLocal: "#db2777", heritageCharacter: "#a855f7",
  easementHV: "#db2777",
  vegWaterway: "#0284c7", vegMSES: "#ea580c", vegBiodiversity: "#84cc16", vegCorridor: "#16a34a",
  zoneCentre: "#dc2626", zoneMixed: "#f97316", zoneResidential: "#facc15", zoneOpenSpace: "#16a34a", zoneOther: "#6366f1",
};

export const MODULE_META: Record<Module, ModuleMeta> = {
  flooding: {
    name: "Flooding",
    question: "Is the property in a potential flood area?",
    tint: "var(--apple-blue)",
    tintHex: APPLE_HEX.blue,
    icon: Waves,
    sourceLabel: "Brisbane City Council — Flood Awareness Mapping",
    thingsToKnow: [
      "If your property is in a potential flood area, it's important to understand the possible risks, impacts and causes of flooding. Flooding most commonly happens when prolonged or heavy rainfall causes creeks and waterways to rise and overflow into nearby properties.",
      "The likelihood of a flood is often described using Annual Exceedance Probability (AEP) — a 1% AEP flood has a 1-in-100 chance of occurring in any given year. Building, renovating, or developing in flood-prone areas may require government assessment; floor heights might need to sit above the defined flood level, or structures designed to allow water to flow beneath raised buildings.",
    ],
    note: "Government flood risk models are broad guides that estimate flood probability and acceptable risk but do not guarantee site-specific accuracy. Newly subdivided lots may have already considered flooding risk and been built above acceptable flood levels. For specific concerns, consult your local authority or a qualified professional.",
    legend: [
      { label: "High possibility (5.0% AEP)",     color: D.floodHigh,    colorHex: D.floodHigh },
      { label: "Moderate possibility (1.0% AEP)", color: D.floodMedium,  colorHex: D.floodMedium },
      { label: "Low possibility (0.2% AEP)",      color: D.floodLow,     colorHex: D.floodLow },
      { label: "Very low (0.05% AEP)",            color: D.floodVeryLow, colorHex: D.floodVeryLow },
      { label: "Feb 2022 historic event",         color: D.histFeb2022,  colorHex: D.histFeb2022 },
      { label: "Jan 2011 historic event",         color: D.histJan2011,  colorHex: D.histJan2011 },
    ],
  },

  overland_flow: {
    name: "Overland Flow",
    question: "Are there any major rainfall issues for this property?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: CloudRain,
    sourceLabel: "Brisbane City Council — Overland Flow mapping",
    thingsToKnow: [
      "Overland flow is water running over the ground's surface during heavy rain — distinct from creek or river flooding. It happens when stormwater systems are overwhelmed, drainage paths are blocked, or the land cannot absorb water quickly enough.",
      "Overland flow is usually localised but can damage structures and flood yards and low-lying areas. Urban properties with hard surfaces nearby (roads, concrete) are particularly vulnerable. Future development of an overland-flow lot may require specific drainage and landscaping measures.",
    ],
    note: "Overland flow models are broad guides and may not reflect site-specific conditions. Flooding can still occur outside mapped areas due to local factors. Newly subdivided lots may have engineered drainage that supersedes the mapping.",
    legend: [
      { label: "High impact",     color: D.overlandHigh,    colorHex: D.overlandHigh },
      { label: "Moderate impact", color: D.overlandMedium,  colorHex: D.overlandMedium },
      { label: "Low impact",      color: D.overlandLow,     colorHex: D.overlandLow },
      { label: "Very low",        color: D.overlandVeryLow, colorHex: D.overlandVeryLow },
    ],
  },

  storm_tide: {
    name: "Storm Tide",
    question: "Is the property exposed to coastal storm-tide flooding?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Wind,
    sourceLabel: "Brisbane City Council — Storm Tide mapping",
    thingsToKnow: [
      "Storm tide is the sea-level rise caused by a severe storm combined with the normal astronomical tide. Bayside Brisbane (Wynnum, Manly, Sandgate) and tidal creek mouths are exposed to storm-tide inundation during cyclones and east-coast lows.",
      "Building in a storm-tide area triggers council planning controls — habitable floor levels must sit above the defined storm-tide level, and there can be requirements around the building envelope's resilience to wave action and saltwater inundation.",
    ],
    note: "Storm-tide modelling combines historical events, projected sea-level rise, and bathymetry. Site-specific factors (sea walls, elevation surveys) may change the practical risk. Confirm with the council or a qualified coastal engineer before relying on this for a major decision.",
    legend: [
      { label: "High risk",     color: D.stormHigh,    colorHex: D.stormHigh },
      { label: "Medium risk",   color: D.stormMedium,  colorHex: D.stormMedium },
      { label: "Low risk",      color: D.stormLow,     colorHex: D.stormLow },
      { label: "Very low risk", color: D.stormVeryLow, colorHex: D.stormVeryLow },
    ],
  },

  bushfire: {
    name: "Bushfire",
    question: "Is the property in a potential bushfire area?",
    tint: "var(--apple-orange)",
    tintHex: APPLE_HEX.orange,
    icon: Flame,
    sourceLabel: "Brisbane City Council — City Plan Bushfire overlay",
    thingsToKnow: [
      "Bushfire prone areas are mapped where vegetation type, slope, and proximity to bushland create an elevated fire risk. The classification affects how new buildings must be constructed (Bushfire Attack Level / BAL standards), what vegetation must be cleared around dwellings, and how access for emergency vehicles is designed.",
      "If a property sits in a bushfire hazard area or its buffer, building approvals usually require a BAL assessment and may impose specific construction requirements. Insurance premiums for bushfire-affected properties can also be materially higher than for non-affected addresses.",
    ],
    note: "BCC's overlay is council-scope. Some properties on the statewide Queensland Fire Department mapping fall outside the council overlay. For high-stakes decisions, also check the QFD bushfire prone area map.",
    legend: [
      { label: "Very high potential",   color: D.fireVeryHigh, colorHex: D.fireVeryHigh },
      { label: "High hazard area",      color: D.fireHigh,     colorHex: D.fireHigh },
      { label: "High hazard buffer",    color: D.fireBuffer,   colorHex: D.fireBuffer },
      { label: "Medium hazard area",    color: D.fireMedium,   colorHex: D.fireMedium },
    ],
  },

  vegetation: {
    name: "Vegetation",
    question: "Is the property covered by protected vegetation or biodiversity overlays?",
    tint: "var(--apple-green)",
    tintHex: APPLE_HEX.green,
    icon: Leaf,
    sourceLabel: "Brisbane City Council — Biodiversity areas overlay",
    thingsToKnow: [
      "The Biodiversity areas overlay protects native vegetation that supports threatened species, wildlife corridors, and ecological communities. Council assessment is required before removing significant trees, clearing understorey, or substantially altering habitat in these areas.",
      "Owning a property in the overlay does not stop you renovating or extending, but it constrains where buildings can sit, what trees can be removed, and what landscaping can replace cleared vegetation. Many Brisbane renovations are stalled mid-project by overlooked vegetation controls.",
    ],
    note: "The overlay does not include every individual tree of value. Pre-1947 dwellings, Natural Assets Local Law trees, and protected wetlands may impose extra controls. For any work near trees or waterways, an arborist report or council pre-lodgement meeting is the safer path.",
    legend: [
      { label: "Waterway / wetland",        color: D.vegWaterway,     colorHex: D.vegWaterway },
      { label: "Matters of state interest", color: D.vegMSES,         colorHex: D.vegMSES },
      { label: "Biodiversity area",         color: D.vegBiodiversity, colorHex: D.vegBiodiversity },
      { label: "Ecological corridor",       color: D.vegCorridor,     colorHex: D.vegCorridor },
    ],
  },

  heritage: {
    name: "Heritage & Character",
    question: "Is the property in a heritage or character area?",
    tint: "var(--apple-purple)",
    tintHex: APPLE_HEX.purple,
    icon: Landmark,
    sourceLabel: "Brisbane City Council — Heritage + Character overlays",
    thingsToKnow: [
      "Brisbane protects two distinct kinds of buildings and areas. Heritage register listings (state or local) cover places with explicit cultural or historic significance — external work and demolition normally require Council assessment, and demolition can be refused. The Traditional Building Character overlay protects pre-1947 housing across whole suburbs to preserve street-facing form.",
      "Owning a property in either overlay does not stop you renovating, but it constrains what you can do and how it must look. Common impacts: street-facing facades cannot be altered freely, demolition usually requires impact assessment, and additions must respect the original built form.",
    ],
    note: "Even properties outside both overlays can carry character significance if the house was built before 1947. Council can take an interest in pre-1947 demolition applications case-by-case.",
    legend: [
      { label: "State heritage area",  color: D.heritageState,     colorHex: D.heritageState },
      { label: "Local heritage area",  color: D.heritageLocal,     colorHex: D.heritageLocal },
      { label: "Character (pre-1947)", color: D.heritageCharacter, colorHex: D.heritageCharacter },
    ],
  },

  easements: {
    name: "Easements",
    question: "What access rights exist over the property?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: ScrollText,
    sourceLabel: "Brisbane City Council — public overlay (NOT title search)",
    thingsToKnow: [
      "Easements are legal rights allowing a person or authority to access a specific portion of land for a particular purpose. They are commonly required for the maintenance of utilities — large water and sewer pipes, stormwater drains, and power lines — and may also exist for shared vehicle access or built-to-boundary walls.",
      "Easements are recorded on land title at the time of subdivision and remain on title when the property is sold. A landowner cannot usually build permanent structures within an easement area or obstruct the authorised party's access without approval from the easement owner.",
    ],
    note: "This module shows only Council-mapped high-voltage easements. The majority of easements — drainage, sewerage, access, party walls — are recorded on land title and require a QLD Title Search via a conveyancer to discover. The absence of a result here is not proof the property has no easements.",
    legend: [
      { label: "High-voltage easement", color: D.easementHV, colorHex: D.easementHV },
    ],
  },

  zoning: {
    name: "Zoning",
    question: "What can the land be used for?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: LayoutGrid,
    sourceLabel: "Brisbane City Council — City Plan 2014 Zoning",
    thingsToKnow: [
      "Brisbane's City Plan 2014 places every parcel in a specific zone — for example Low density residential, Mixed use, Centre, or Open space. The zone determines what you can build on the land, what the building can be used for, height and density limits, and whether a proposal is code-assessable or impact-assessable.",
      "Some zones are further divided into precincts that fine-tune the rules for that area's character — Centre frame is different from Principal centre even though both are in the Centre family. The precinct description below tells you the exact precinct that applies.",
    ],
    note: "Zone codes alone don't tell the full story. Each zone has a code in the City Plan that specifies development standards. Read it alongside any precinct overlay before making any subdivision or building decision.",
    legend: [
      { label: "Centre",                  color: D.zoneCentre,      colorHex: D.zoneCentre },
      { label: "Mixed use",               color: D.zoneMixed,       colorHex: D.zoneMixed },
      { label: "General residential",     color: D.zoneResidential, colorHex: D.zoneResidential },
      { label: "Open space / Recreation", color: D.zoneOpenSpace,   colorHex: D.zoneOpenSpace },
      { label: "Industry / Other",        color: D.zoneOther,       colorHex: D.zoneOther },
    ],
  },
};
