// Per-module presentation metadata.
//
// Mirrors the layout Develo uses for every module page in their property
// fact pack: name + clarifying question, "Things to know" educational
// paragraphs, a Note: caveat, a Legend with named colour swatches, and a
// data-source attribution. Web view and PDF both consume from here so the
// two stay in sync.

import type { LucideIcon } from "lucide-react";
import { Flame, Landmark, LayoutGrid, ScrollText, Waves } from "lucide-react";

import type { Module } from "@/lib/supabase";

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
      { label: "High risk",     color: "var(--apple-red)",    colorHex: APPLE_HEX.red },
      { label: "Medium risk",   color: "var(--apple-orange)", colorHex: APPLE_HEX.orange },
      { label: "Low risk",      color: "var(--apple-teal)",   colorHex: APPLE_HEX.teal },
      { label: "Very low risk", color: "var(--apple-yellow)", colorHex: APPLE_HEX.yellow },
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
      { label: "Very high potential",   color: "var(--apple-red)",    colorHex: APPLE_HEX.red },
      { label: "High hazard area",      color: "var(--apple-orange)", colorHex: APPLE_HEX.orange },
      { label: "High hazard buffer",    color: "var(--apple-yellow)", colorHex: APPLE_HEX.yellow },
      { label: "Medium hazard area",    color: "var(--apple-teal)",   colorHex: APPLE_HEX.teal },
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
      { label: "State heritage area",  color: "var(--apple-purple)", colorHex: APPLE_HEX.purple },
      { label: "Local heritage area",  color: "var(--apple-pink)",   colorHex: APPLE_HEX.pink },
      { label: "Character (pre-1947)", color: "var(--apple-indigo)", colorHex: APPLE_HEX.indigo },
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
      { label: "High-voltage easement", color: "var(--apple-teal)", colorHex: APPLE_HEX.teal },
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
      { label: "Centre",                  color: "var(--apple-red)",    colorHex: APPLE_HEX.red },
      { label: "Mixed use",               color: "var(--apple-orange)", colorHex: APPLE_HEX.orange },
      { label: "General residential",     color: "var(--apple-yellow)", colorHex: APPLE_HEX.yellow },
      { label: "Open space / Recreation", color: "var(--apple-green)",  colorHex: APPLE_HEX.green },
      { label: "Industry / Other",        color: "var(--apple-indigo)", colorHex: APPLE_HEX.indigo },
    ],
  },
};
