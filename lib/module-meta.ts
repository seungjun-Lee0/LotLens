// Per-module presentation metadata.
//
// Mirrors the layout Develo uses for every module page in their property
// fact pack: name + clarifying question, "Things to know" educational
// paragraphs, a Note: caveat, a Legend with named colour swatches, and a
// data-source attribution. Web view and PDF both consume from here so the
// two stay in sync.

import type { LucideIcon } from "lucide-react";
import { CloudRain, Droplets, Flame, GraduationCap, Landmark, LayoutGrid, Leaf, Map, Mountain, PawPrint, ScrollText, TrainFront, TrendingUp, Volume2, Waves, Wind } from "lucide-react";

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
  /** Module accent colour: used for the map pin, icon, swatches. */
  tint: string;
  /** Hex equivalent of `tint` for React-PDF. */
  tintHex: string;
  icon: LucideIcon;
  /** Attribution shown above "Things to know". */
  sourceLabel: string;
  /** Two short paragraphs of generic educational content (NOT
   * property-specific: that's what the AI narrative is for). */
  thingsToKnow: string[];
  /** Caveat shown after Things to know, mirroring Develo's "Note:" block. */
  note: string;
  /** Map legend swatches. The "Selected property" pin is added separately
   * by the renderer so it's consistent across modules. */
  legend: LegendItem[];
};

// Apple system color hex equivalents: used wherever React-PDF can't
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
// We re-declare here to avoid a circular import: module-meta is consumed
// by the PDF too. Both files must move together when changing colours.
const D = {
  floodHigh: "#1e3a8a", floodMedium: "#2563eb", floodLow: "#60a5fa", floodVeryLow: "#bfdbfe",
  overlandHigh: "#c2410c", overlandMedium: "#f97316", overlandLow: "#fbbf24", overlandVeryLow: "#fde68a",
  stormHigh: "#0e7490", stormMedium: "#06b6d4", stormLow: "#67e8f9", stormVeryLow: "#cffafe",
  histFeb2022: "#c026d3", histJan2011: "#a855f7",
  fireVeryHigh: "#b91c1c", fireHigh: "#dc2626", fireBuffer: "#ea580c", fireMedium: "#f59e0b",
  heritageState: "#0050c0", heritageLocal: "#0070ff", heritageCharacter: "#7d007d",
  heritageDwelling: "#ffa4a4",
  easementHV: "#db2777", easementCadastre: "#a21caf",
  vegWaterway: "#0284c7", vegMSES: "#ea580c", vegBiodiversity: "#84cc16", vegCorridor: "#16a34a",
  catchmentPrimary: "#16a34a", catchmentSecondary: "#4f46e5",
  zoneCentre: "#dc2626", zoneMixed: "#f97316", zoneLowMediumResidential: "#d97706", zoneResidential: "#facc15", zoneOpenSpace: "#16a34a", zoneOther: "#6366f1",
  coastalErosion: "#d97706",
  rvmA: "#15803d", rvmB: "#16a34a", rvmC: "#84cc16", rvmR: "#0d9488",
  koalaCore: "#16a34a", koalaLocal: "#4ade80", koalaPriority: "#a3e635", wildlifeHabitat: "#f97316",
  assShallow: "#b45309", assMapped: "#eab308",
  tenement: "#a855f7", kraResource: "#dc2626", kraSeparation: "#f59e0b",
  steepHigh: "#9a3412", steep: "#f59e0b",
};

export const MODULE_META: Record<Module, ModuleMeta> = {
  flooding: {
    name: "Flooding",
    question: "Is the property in a potential flood area?",
    tint: "var(--apple-blue)",
    tintHex: APPLE_HEX.blue,
    icon: Waves,
    sourceLabel: "Council flood-risk and historic flood mapping",
    thingsToKnow: [
      "Flood mapping shows the modelled likelihood and source of inundation, including river, creek and historic flood extents. A 1% Annual Exceedance Probability event has a 1% chance of occurring in any year.",
      "A mapped result can affect floor levels, building design, insurance enquiries and development assessment. Confirm the relevant flood level before relying on the map for design or purchase decisions.",
    ],
    note: "Flood maps are modelled, not property surveys. Site levels, drainage works and updated modelling can change the practical exposure, so confirm material findings with the council and an appropriately qualified professional.",
    legend: [
      { label: "High possibility (5.0% AEP)",     color: D.floodHigh,    colorHex: D.floodHigh },
      { label: "Moderate possibility (1.0% AEP)", color: D.floodMedium,  colorHex: D.floodMedium },
      { label: "Low possibility (0.2% AEP)",      color: D.floodLow,     colorHex: D.floodLow },
      { label: "Very low (0.05% AEP)",            color: D.floodVeryLow, colorHex: D.floodVeryLow },
      { label: "Feb 2022 historic event",         color: D.histFeb2022,  colorHex: D.histFeb2022 },
      { label: "Jan 2011 historic event",         color: D.histJan2011,  colorHex: D.histJan2011 },
    ],
  },

  flood_planning: {
    name: "Flood Planning",
    question: "What planning overlays will affect future building work?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Waves,
    sourceLabel: "Council planning scheme · Flood planning overlays",
    thingsToKnow: [
      "Flood planning overlays are separate from flood awareness maps. They identify the planning controls Council may apply to new buildings, extensions, filling, drainage and minimum floor levels.",
      "The mapped planning-area number indicates the applicable control category. Use the exact category with the planning scheme code when assessing proposed work.",
    ],
    note: "Read this statutory planning layer alongside flood-risk mapping. One describes development controls; the other describes modelled exposure.",
    legend: [
      { label: "Planning area 1 - strictest", color: D.floodHigh,    colorHex: D.floodHigh },
      { label: "Planning area 2",             color: D.floodMedium,  colorHex: D.floodMedium },
      { label: "Planning area 3",             color: D.floodLow,     colorHex: D.floodLow },
      { label: "Planning area 4 - mildest",   color: D.floodVeryLow, colorHex: D.floodVeryLow },
    ],
  },

  overland_flow: {
    name: "Overland Flow",
    question: "Does a mapped overland flow path affect the property?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: CloudRain,
    sourceLabel: "Council planning scheme · Overland flow mapping",
    thingsToKnow: [
      "Overland flow is stormwater moving across the ground during heavy rain rather than flooding from a river or creek. Even a narrow mapped path can affect yards, garages and low floor levels.",
      "Building work should preserve lawful drainage paths and may require site-specific stormwater design. Do not assume a clear river-flood result also means the property is clear of overland flow.",
    ],
    note: "The mapping is modelled and may not capture small retaining walls, blocked drains or recent earthworks. Inspect the site and obtain drainage advice where the mapped path affects proposed work.",
    legend: [
      { label: "High impact",     color: D.overlandHigh,    colorHex: D.overlandHigh },
      { label: "Moderate impact", color: D.overlandMedium,  colorHex: D.overlandMedium },
      { label: "Low impact",      color: D.overlandLow,     colorHex: D.overlandLow },
      { label: "Very low",        color: D.overlandVeryLow, colorHex: D.overlandVeryLow },
    ],
  },

  storm_tide: {
    name: "Coastal Hazards",
    question: "Is the property exposed to storm-tide inundation or coastal erosion?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Wind,
    sourceLabel: "Queensland Government · Coastal hazard area mapping",
    thingsToKnow: [
      "Storm-tide mapping identifies land that may be inundated when storm surge combines with the normal tide. Erosion-prone mapping identifies land exposed to shoreline movement or permanent tidal effects.",
      "Mapped coastal hazards can influence floor levels, setbacks and development assessment. The applicable response depends on the council planning scheme and the proposed work.",
    ],
    note: "Coastal modelling is regional. Site levels, seawalls and local coastal processes require separate confirmation for material development or purchase decisions.",
    legend: [
      { label: "Storm tide (high hazard)",   color: D.stormHigh,      colorHex: D.stormHigh },
      { label: "Storm tide (medium hazard)", color: D.stormMedium,    colorHex: D.stormMedium },
      { label: "Erosion prone area",         color: D.coastalErosion, colorHex: D.coastalErosion },
    ],
  },

  bushfire: {
    name: "Bushfire",
    question: "Is the property in a potential bushfire area?",
    tint: "var(--apple-orange)",
    tintHex: APPLE_HEX.orange,
    icon: Flame,
    sourceLabel: "Queensland Government · Bushfire Prone Area (State Planning Policy)",
    thingsToKnow: [
      "Bushfire-prone area mapping considers vegetation, slope and proximity to potential fuel. A mapped property may require a Bushfire Attack Level assessment for new building work.",
      "The result can influence construction materials, defendable space, access and vegetation management. Requirements depend on the site and proposed development.",
    ],
    note: "This report uses statewide mapping. Council overlays and a site-specific BAL assessment may provide more detailed requirements.",
    legend: [
      { label: "Very high potential intensity", color: D.fireVeryHigh, colorHex: D.fireVeryHigh },
      { label: "High potential intensity",      color: D.fireHigh,     colorHex: D.fireHigh },
      { label: "Medium potential intensity",    color: D.fireMedium,   colorHex: D.fireMedium },
      { label: "Potential impact buffer",       color: D.fireBuffer,   colorHex: D.fireBuffer },
    ],
  },

  vegetation: {
    name: "Vegetation",
    question: "Is the property covered by protected vegetation or biodiversity overlays?",
    tint: "var(--apple-green)",
    tintHex: APPLE_HEX.green,
    icon: Leaf,
    sourceLabel: "QLD Regulated Vegetation Map + council biodiversity overlays",
    thingsToKnow: [
      "Vegetation and biodiversity overlays identify areas where clearing, tree removal or habitat disturbance may be regulated. They can affect the location of buildings, driveways and services.",
      "A mapped result does not prohibit all work, but it should be checked before assuming a clear building envelope or removing vegetation.",
    ],
    note: "The mapped layers do not identify every protected tree or local control. Confirm proposed clearing with the council and obtain specialist advice where significant vegetation or waterways are present.",
    legend: [
      { label: "RVM Category B (remnant)",  color: D.rvmB,            colorHex: D.rvmB },
      { label: "RVM Category C (regrowth)", color: D.rvmC,            colorHex: D.rvmC },
      { label: "Essential habitat",         color: D.vegWaterway,     colorHex: D.vegWaterway },
      { label: "Waterway / wetland",        color: D.vegWaterway,     colorHex: D.vegWaterway },
      { label: "Biodiversity area",         color: D.vegBiodiversity, colorHex: D.vegBiodiversity },
      { label: "Ecological corridor",       color: D.vegCorridor,     colorHex: D.vegCorridor },
    ],
  },

  environment: {
    name: "Environment & Koala",
    question: "Does koala or wildlife habitat mapping affect the property?",
    tint: "var(--apple-green)",
    tintHex: APPLE_HEX.green,
    icon: PawPrint,
    sourceLabel: "QLD Koala Plan mapping + Matters of State Environmental Significance",
    thingsToKnow: [
      "Koala and wildlife habitat mapping identifies areas where clearing or disturbing habitat may require additional assessment. It can affect trees, driveways, pools and the available building envelope.",
      "Koala Priority Areas, core habitat and Matters of State Environmental Significance have different functions. The property-specific result below identifies which mapping applies.",
    ],
    note: "Habitat mapping can be refined over time and does not itself confirm vegetation on the ground. Check proposed clearing or development against current state and council requirements.",
    legend: [
      { label: "Core koala habitat",        color: D.koalaCore,       colorHex: D.koalaCore },
      { label: "Locally refined habitat",   color: D.koalaLocal,      colorHex: D.koalaLocal },
      { label: "Koala priority area",       color: D.koalaPriority,   colorHex: D.koalaPriority },
      { label: "MSES wildlife habitat",     color: D.wildlifeHabitat, colorHex: D.wildlifeHabitat },
    ],
  },

  heritage: {
    name: "Heritage & Character",
    question: "Is the property in a heritage or character area?",
    tint: "var(--apple-purple)",
    tintHex: APPLE_HEX.purple,
    icon: Landmark,
    sourceLabel: "Queensland Heritage Register + council heritage/character overlays",
    thingsToKnow: [
      "Heritage listings protect identified places, while character overlays generally protect the streetscape and traditional building form. The approval implications differ, so the mapped category matters.",
      "Brisbane runs two separate character overlays. The Traditional building character overlay protects pre-1947 housing and controls demolition and external work. The Dwelling house character overlay (City Plan 2014 Part 9) instead imposes height and form controls on houses, including houses on small lots, to protect an area's residential character, so a new build or extension can face extra assessment even where nothing old is being removed.",
      "External alterations, demolition and visible additions may require assessment. Confirm the controls before assuming an existing building can be removed or substantially changed.",
    ],
    note: "A clear overlay result does not replace a property-specific heritage or building-age check. Confirm demolition and major alteration rights with the council before relying on development potential.",
    legend: [
      { label: "State heritage area",         color: D.heritageState,     colorHex: D.heritageState },
      { label: "Local heritage area",         color: D.heritageLocal,     colorHex: D.heritageLocal },
      { label: "Character (pre-1947)",         color: D.heritageCharacter, colorHex: D.heritageCharacter },
      { label: "Dwelling house character",     color: D.heritageDwelling,  colorHex: D.heritageDwelling },
    ],
  },

  easements: {
    name: "Easements",
    question: "What access rights exist over the property?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: ScrollText,
    sourceLabel: "BCC high-voltage overlay + QSpatial cadastre (NOT title search)",
    thingsToKnow: [
      "An easement gives another party rights over part of the land, commonly for drainage, utilities or access. It can limit permanent structures and must remain accessible for its stated purpose.",
      "The position of an easement is only part of the answer. Its beneficiary, terms and building restrictions are recorded in the title documents.",
    ],
    note: "This is a public mapping check, not a title search. Obtain the current title and easement instruments through your conveyancer before making legal or building decisions.",
    legend: [
      { label: "High-voltage easement", color: D.easementHV, colorHex: D.easementHV },
      { label: "Registered easement (cadastre)", color: D.easementCadastre, colorHex: D.easementCadastre },
    ],
  },

  noise: {
    name: "Noise",
    question: "Is the property exposed to road, rail or aircraft noise corridors?",
    tint: "var(--apple-yellow)",
    tintHex: APPLE_HEX.yellow,
    icon: Volume2,
    sourceLabel: "Council transport noise and aircraft ANEF mapping",
    thingsToKnow: [
      "Transport noise corridors and aircraft ANEF contours indicate modelled long-term exposure. Higher mapped categories can trigger acoustic requirements for new or altered buildings.",
      "The practical response may include acoustic glazing, insulation or room-layout changes. The overlay does not describe the noise experienced at every time of day.",
    ],
    note: "Visit the property at relevant times and check current road, rail and flight activity. Mapping should support, not replace, an on-site assessment.",
    legend: [
      { label: "Transport corridor 1 - loudest", color: D.fireHigh,    colorHex: D.fireHigh },
      { label: "Transport corridor 2",           color: D.fireBuffer,  colorHex: D.fireBuffer },
      { label: "Transport corridor 3-4",         color: D.fireMedium,  colorHex: D.fireMedium },
      { label: "Aircraft 30+ ANEF",              color: D.fireVeryHigh, colorHex: D.fireVeryHigh },
      { label: "Aircraft 25-30 ANEF",            color: D.fireHigh,    colorHex: D.fireHigh },
      { label: "Aircraft 20-25 ANEF",            color: D.fireBuffer,  colorHex: D.fireBuffer },
    ],
  },

  steep_land: {
    name: "Steep Land",
    question: "Is the property on steep or landslide-prone land?",
    tint: "var(--apple-orange)",
    tintHex: APPLE_HEX.orange,
    icon: TrendingUp,
    sourceLabel: "Council landslide / steep land overlays",
    thingsToKnow: [
      "Council mapping identifies land where slope, geology or soil conditions may require landslide assessment. Building work can require geotechnical advice on stability, excavation, retaining and drainage.",
      "The measured elevation range helps show the shape of the lot even where no hazard overlay applies. Significant fall can still affect design and site works.",
    ],
    note: "This check combines two sources. Statewide LiDAR contours show the elevation range, while council planning schemes define landslide and steep-land thresholds for each local government area. A property outside a mapped hazard area can still have significant fall, so consider both the council classification and the measured elevation range.",
    legend: [
      { label: "Landslide hazard / high slope", color: D.steepHigh, colorHex: D.steepHigh },
      { label: "Steep land overlay area",        color: D.steep,     colorHex: D.steep },
      { label: "Higher ground (contour)",        color: "#ef4444",    colorHex: "#ef4444" },
      { label: "Mid slope (contour)",            color: "#4ade80",    colorHex: "#4ade80" },
      { label: "Lower ground (contour)",         color: "#38bdf8",    colorHex: "#38bdf8" },
    ],
  },

  acid_sulfate: {
    name: "Acid Sulfate Soils",
    question: "Could excavation on this lot disturb acid sulfate soils?",
    tint: "var(--apple-yellow)",
    tintHex: APPLE_HEX.yellow,
    icon: Droplets,
    sourceLabel: "Queensland Government · Acid sulfate soils mapping",
    thingsToKnow: [
      "Acid sulfate soils can produce acidic runoff when excavated or drained. The issue is generally associated with earthworks rather than ordinary occupation of the property.",
      "Pools, basements, deep footings and drainage work in mapped areas may require soil investigation and an approved management approach.",
    ],
    note: "The mapping indicates potential occurrence, not a confirmed site condition. Soil testing is the appropriate next step before substantial excavation.",
    legend: [
      { label: "Shallow sulfidic material", color: D.assShallow, colorHex: D.assShallow },
      { label: "Mapped acid sulfate soils", color: D.assMapped,  colorHex: D.assMapped },
    ],
  },

  mining: {
    name: "Mining & Resources",
    question: "Do resource tenures or quarry buffers affect the property?",
    tint: "var(--apple-purple)",
    tintHex: APPLE_HEX.purple,
    icon: Mountain,
    sourceLabel: "Queensland Government · Resource tenures + Key Resource Areas",
    thingsToKnow: [
      "Resource authorities are separate from land ownership and vary in significance. Exploration permits, mining leases and other tenure types should not be interpreted as equivalent findings.",
      "Key Resource Areas and their separation areas protect extractive operations and can constrain sensitive development because of noise, dust, blasting or haulage impacts.",
    ],
    note: "This check covers public tenure and Key Resource Area mapping. Use GeoResGlobe and legal advice to investigate the status, rights and practical effect of any mapped authority.",
    legend: [
      { label: "KRA resource/processing area", color: D.kraResource,   colorHex: D.kraResource },
      { label: "KRA separation buffer",        color: D.kraSeparation, colorHex: D.kraSeparation },
      { label: "Resource authority (tenure)",  color: D.tenement,      colorHex: D.tenement },
    ],
  },

  stormwater: {
    name: "Stormwater",
    question: "Are there stormwater pipes on or near the property?",
    tint: "var(--apple-blue)",
    tintHex: APPLE_HEX.blue,
    icon: Waves,
    sourceLabel: "Brisbane City Council · Stormwater assets (existing)",
    thingsToKnow: [
      "Public stormwater assets can cross private land and affect where structures, pools or excavation can be placed. Approval may be required for work over or near an asset.",
      "Public mains and private property drainage have different implications. The property-specific result distinguishes them where ownership information is available.",
    ],
    note: "Mapped alignments and depths are indicative. Obtain current service plans and locate the asset on site before design or excavation.",
    legend: [
      { label: "Council stormwater pipe", color: D.floodMedium, colorHex: D.floodMedium },
      { label: "Private drainage pipe",   color: D.floodLow,    colorHex: D.floodLow },
      { label: "Manhole / gully / outlet", color: D.floodHigh,  colorHex: D.floodHigh },
    ],
  },

  water_sewer: {
    name: "Water & Sewer",
    question: "Are there water or sewer mains on the property?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: Droplets,
    sourceLabel: "Urban Utilities · Water and sewer network (open data)",
    thingsToKnow: [
      "Water and sewer mains can constrain pools, extensions and other work over or near their alignment. The asset owner may require setbacks, protection works or separate approval.",
      "Pressure and trunk mains generally carry more significant constraints than local service assets. Confirm the asset type, depth and applicable building requirements before design.",
    ],
    note: "Mapped alignments and depths are indicative. Obtain current service plans and have relevant assets located before design or excavation.",
    legend: [
      { label: "Sewer gravity main",  color: D.easementCadastre, colorHex: D.easementCadastre },
      { label: "Sewer pressure main", color: D.easementHV,       colorHex: D.easementHV },
      { label: "Water main",          color: D.stormMedium,      colorHex: D.stormMedium },
      { label: "Sewer manhole",       color: D.heritageState,    colorHex: D.heritageState },
      { label: "Service connection",  color: D.stormLow,         colorHex: D.stormLow },
    ],
  },

  local_plans: {
    name: "Local Plans",
    question: "Is the property in a neighbourhood or local area plan?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Map,
    sourceLabel: "Brisbane City Council · City Plan 2014 neighbourhood plans",
    thingsToKnow: [
      "A local or neighbourhood plan adds area-specific controls to the underlying zone. It can change building height, density, land use or built-form requirements.",
      "Properties in the same zone can have different development outcomes when they fall in different plan areas or precincts. Read both layers together.",
    ],
    note: "Planning schemes are amended over time. Confirm the current plan, precinct and applicable code before relying on development potential.",
    legend: [
      { label: "Neighbourhood plan area", color: D.zoneOther, colorHex: D.zoneOther },
      { label: "Plan precinct",           color: D.zoneMixed, colorHex: D.zoneMixed },
    ],
  },

  transport: {
    name: "Public Transport",
    question: "What public transport is within walking distance?",
    tint: "var(--apple-green)",
    tintHex: APPLE_HEX.green,
    icon: TrainFront,
    sourceLabel: "TransLink stops (Queensland Government)",
    thingsToKnow: [
      "Nearby stops show access to the public transport network, but distance alone does not indicate service quality. Frequency, operating hours and route usefulness also matter.",
      "The reported distances are a starting point for comparison. Check the walking route and current timetable for the services you expect to use.",
    ],
    note: "Distances are straight-line measurements, not walking routes. Confirm access, accessibility and current services with the TransLink journey planner.",
    legend: [
      { label: "Train station",  color: D.zoneCentre,      colorHex: D.zoneCentre },
      { label: "Ferry terminal", color: D.vegWaterway,     colorHex: D.vegWaterway },
      { label: "Bus stop",       color: D.vegBiodiversity, colorHex: D.vegBiodiversity },
    ],
  },

  schools: {
    name: "School Catchments",
    question: "Which state schools is this property zoned for?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: GraduationCap,
    sourceLabel: "Queensland Department of Education · State school catchments",
    thingsToKnow: [
      "State school catchments determine the local primary and secondary schools associated with an address. Enrolment rules differ for in-catchment, out-of-catchment and specialist programs.",
      "Catchment boundaries and school capacity can change. Use the listed school and mapping year as the basis for direct enrolment confirmation.",
    ],
    note: "This layer covers Queensland state schools only. Confirm eligibility, intake year and program requirements directly with the school before relying on the result.",
    legend: [
      { label: "Primary catchment",   color: D.catchmentPrimary,   colorHex: D.catchmentPrimary },
      { label: "Secondary catchment", color: D.catchmentSecondary, colorHex: D.catchmentSecondary },
    ],
  },

  zoning: {
    name: "Zoning",
    question: "What can the land be used for?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: LayoutGrid,
    sourceLabel: "Council planning scheme zoning (SEQ Regional Plan outside adapted LGAs)",
    thingsToKnow: [
      "The planning scheme zone sets the primary land-use and development framework for the property. It informs permissible uses, assessment pathways and key built-form controls.",
      "Precincts and overlays can modify the zone outcome. The zone should therefore be read with any local plan, precinct and relevant overlay code.",
    ],
    note: "Zoning is not a development approval or yield assessment. Confirm the current planning scheme provisions and site-specific constraints with the council or a qualified planner.",
    // City Plan colours, density-graded like the official map: residential
    // darkens with intensity, centres deepen with rank.
    legend: [
      { label: "Low density residential",      color: "#ffdcdc", colorHex: "#ffdcdc" },
      { label: "Low-medium density residential", color: "#ffa4a4", colorHex: "#ffa4a4" },
      { label: "Medium density residential",   color: "#ff6565", colorHex: "#ff6565" },
      { label: "High density residential",     color: "#aa0000", colorHex: "#aa0000" },
      { label: "Centre (Neighbourhood → Principal)", color: "#426bff", colorHex: "#426bff" },
      { label: "Mixed use",                    color: "#ff7800", colorHex: "#ff7800" },
      { label: "Industry",                     color: "#c88fc8", colorHex: "#c88fc8" },
      { label: "Open space / Recreation",      color: "#6eaf4b", colorHex: "#6eaf4b" },
    ],
  },
};
