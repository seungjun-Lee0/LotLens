// Per-module presentation metadata.
//
// Mirrors the layout Develo uses for every module page in their property
// fact pack: name + clarifying question, "Things to know" educational
// paragraphs, a Note: caveat, a Legend with named colour swatches, and a
// data-source attribution. Web view and PDF both consume from here so the
// two stay in sync.

import type { LucideIcon } from "lucide-react";
import { CloudRain, Droplets, Flame, GraduationCap, Landmark, LayoutGrid, Leaf, Mountain, PawPrint, ScrollText, TrendingUp, Volume2, Waves, Wind } from "lucide-react";

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
  easementHV: "#db2777", easementCadastre: "#a21caf",
  vegWaterway: "#0284c7", vegMSES: "#ea580c", vegBiodiversity: "#84cc16", vegCorridor: "#16a34a",
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

  flood_planning: {
    name: "Flood Planning",
    question: "What planning overlays will affect future building work?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Waves,
    sourceLabel: "Brisbane City Council — Flood planning overlays",
    thingsToKnow: [
      "Brisbane's City Plan 2014 has statutory flood planning overlays separate from the Flood Awareness Mapping. The planning overlays are the controls Council actually applies when assessing a development application — minimum habitable floor levels, fill volumes, excluded structures, drainage and connection requirements.",
      "Each planning polygon is labelled 1 through 4 — number 1 is the strictest, 4 is the mildest. A property in area 1 will typically need a substantially raised floor level, while area 4 is a lighter touch. The overlay applies to extensions and new builds as much as new construction.",
    ],
    note: "The planning overlay is the statutory layer — i.e. it is what Council will use when assessing your application. Always check it alongside the Flood Awareness Mapping which describes risk probability rather than planning controls.",
    legend: [
      { label: "Planning area 1 - strictest", color: D.floodHigh,    colorHex: D.floodHigh },
      { label: "Planning area 2",             color: D.floodMedium,  colorHex: D.floodMedium },
      { label: "Planning area 3",             color: D.floodLow,     colorHex: D.floodLow },
      { label: "Planning area 4 - mildest",   color: D.floodVeryLow, colorHex: D.floodVeryLow },
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
    name: "Coastal Hazards",
    question: "Is the property exposed to storm-tide inundation or coastal erosion?",
    tint: "var(--apple-indigo)",
    tintHex: APPLE_HEX.indigo,
    icon: Wind,
    sourceLabel: "Queensland Government — Coastal hazard area mapping",
    thingsToKnow: [
      "Storm tide is the sea-level rise caused by a severe storm combined with the normal astronomical tide. Bayside and tidal-creek addresses anywhere on the Queensland coast are exposed during cyclones and east-coast lows. The state's coastal hazard maps model inundation out to 2100, including projected sea-level rise.",
      "Erosion prone areas mark land that could be lost to long-term coastal erosion or permanent tidal inundation. Building in a storm-tide or erosion prone area triggers planning controls — habitable floor levels above the defined storm-tide level, and constraints on how close to the shoreline you can build.",
    ],
    note: "Coastal hazard modelling combines historical events, projected sea-level rise, and bathymetry. Site-specific factors (sea walls, elevation surveys) may change the practical risk. Confirm with the council or a qualified coastal engineer before relying on this for a major decision.",
    legend: [
      { label: "Storm tide — high hazard",   color: D.stormHigh,      colorHex: D.stormHigh },
      { label: "Storm tide — medium hazard", color: D.stormMedium,    colorHex: D.stormMedium },
      { label: "Erosion prone area",         color: D.coastalErosion, colorHex: D.coastalErosion },
    ],
  },

  bushfire: {
    name: "Bushfire",
    question: "Is the property in a potential bushfire area?",
    tint: "var(--apple-orange)",
    tintHex: APPLE_HEX.orange,
    icon: Flame,
    sourceLabel: "Queensland Government — Bushfire Prone Area (State Planning Policy)",
    thingsToKnow: [
      "Bushfire prone areas are mapped where vegetation type, slope, and proximity to bushland create an elevated fire risk. The classification affects how new buildings must be constructed (Bushfire Attack Level / BAL standards), what vegetation must be cleared around dwellings, and how access for emergency vehicles is designed.",
      "If a property sits in a bushfire hazard area or its buffer, building approvals usually require a BAL assessment and may impose specific construction requirements. Insurance premiums for bushfire-affected properties can also be materially higher than for non-affected addresses.",
    ],
    note: "This is the statewide Bushfire Prone Area mapping used by the State Planning Policy. Councils may also apply their own bushfire overlay with local refinements — check the council planning scheme for LGA-specific provisions.",
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
      "The Biodiversity areas overlay protects native vegetation that supports threatened species, wildlife corridors, and ecological communities. Council assessment is required before removing significant trees, clearing understorey, or substantially altering habitat in these areas.",
      "Owning a property in the overlay does not stop you renovating or extending, but it constrains where buildings can sit, what trees can be removed, and what landscaping can replace cleared vegetation. Many Brisbane renovations are stalled mid-project by overlooked vegetation controls.",
    ],
    note: "The overlay does not include every individual tree of value. Pre-1947 dwellings, Natural Assets Local Law trees, and protected wetlands may impose extra controls. For any work near trees or waterways, an arborist report or council pre-lodgement meeting is the safer path.",
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
      "South East Queensland has regulatory koala habitat mapping under the Nature Conservation (Koala) Plan 2020. Inside a Koala Priority Area, interfering with koala habitat trees in mapped core habitat is assessable development — a genuine constraint on clearing, driveways, pools and building envelopes.",
      "Matters of State Environmental Significance (MSES) wildlife habitat marks areas mapped for endangered or vulnerable species statewide. Development in MSES areas can trigger state referral and offset requirements on top of council rules.",
    ],
    note: "Habitat mapping is periodically refined and councils may hold locally refined versions. A property inside the mapping is not frozen — most ordinary residential use continues unaffected — but tree removal and new development need checking against the koala and MSES frameworks first.",
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
    sourceLabel: "BCC high-voltage overlay + QSpatial cadastre (NOT title search)",
    thingsToKnow: [
      "Easements are legal rights allowing a person or authority to access a specific portion of land for a particular purpose. They are commonly required for the maintenance of utilities — large water and sewer pipes, stormwater drains, and power lines — and may also exist for shared vehicle access or built-to-boundary walls.",
      "Easements are recorded on land title at the time of subdivision and remain on title when the property is sold. A landowner cannot usually build permanent structures within an easement area or obstruct the authorised party's access without approval from the easement owner.",
    ],
    note: "This module reads two public sources: BCC's high-voltage powerline overlay and the QSpatial DCDB easement-parcel layer (which catches drainage, sewer, access and other registered easements as separate cadastral parcels). The polygons tell you an easement exists — they don't tell you its legal terms. The benefiting party, conditions and width are only on the land title, which still requires a QLD Title Search via a conveyancer.",
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
    sourceLabel: "Brisbane City Council — Transport noise + ANEF overlays",
    thingsToKnow: [
      "Brisbane has two noise overlays. The Transport noise corridor covers major roads and rail lines and is numbered 1 (loudest) through 4 (mildest). The Australian Noise Exposure Forecast (ANEF) covers the Brisbane Airport flight paths and is given in noise contours — 20 ANEF and above triggers acoustic construction requirements under AS2021.",
      "Noise overlays don't stop you living there, but they affect new builds: doors and windows need acoustic-rated glass, walls need extra mass, and habitable rooms can be restricted. Insurance for noise-affected properties is not typically more expensive, but resale can suffer.",
    ],
    note: "Subjective noise depends on traffic mix, time of day, and prevailing wind direction. Visit at peak commute, late evening, and on a Sunday before relying on a daytime impression. The mapped corridors are based on modelled long-term equivalent noise level (LAeq).",
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
      "Councils map land where slope, soil and geology create landslide risk — typically slopes above 15%. Building on mapped steep land usually triggers geotechnical assessment requirements: a site-specific report on stability, cut-and-fill limits, retaining design and drainage before approval.",
      "Steep lots also cost more to build on regardless of hazard mapping: benched slabs or pole homes, engineered retaining walls, and more complex stormwater management. If you're comparing a flat lot and a steep lot at similar prices, the steep one usually carries a five-figure construction premium.",
    ],
    note: "Landslide overlays are council planning-scheme layers and their thresholds differ by LGA. A lot outside the overlay can still be steep — check the contours and get a site inspection for anything visibly sloping. This module is available where a council adapter exists (Brisbane, Moreton Bay, Sunshine Coast, Redland today).",
    legend: [
      { label: "Landslide hazard / high slope", color: D.steepHigh, colorHex: D.steepHigh },
      { label: "Steep land overlay area",        color: D.steep,     colorHex: D.steep },
    ],
  },

  acid_sulfate: {
    name: "Acid Sulfate Soils",
    question: "Could excavation on this lot disturb acid sulfate soils?",
    tint: "var(--apple-yellow)",
    tintHex: APPLE_HEX.yellow,
    icon: Droplets,
    sourceLabel: "Queensland Government — Acid sulfate soils mapping",
    thingsToKnow: [
      "Acid sulfate soils are natural coastal-lowland soils (typically below 5 m elevation) containing iron sulfides. Left undisturbed they are harmless — but when excavated or drained they react with air to produce sulfuric acid, which corrodes concrete and steel, kills vegetation, and can trigger costly environmental management obligations.",
      "For buyers the practical impact lands on earthworks: pools, basements, canal-front works, deep footings and major drainage in mapped areas usually need an acid sulfate soil investigation and a management plan as part of development approval.",
    ],
    note: "State mapping is broad-scale (1:25,000 at best) and marks the probability of occurrence, not a confirmed on-site condition. Lots outside mapped areas can still contain acid sulfate soils at depth. Site-specific soil testing is the only definitive answer before major excavation.",
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
    sourceLabel: "Queensland Government — Resource tenures + Key Resource Areas",
    thingsToKnow: [
      "Queensland land can carry resource authorities — mining leases, exploration permits, mineral development licences — that exist separately from surface ownership. An exploration permit blanketing a region is common and usually low-impact; a granted mining lease on or beside a lot is a serious flag for noise, dust, subsidence and access rights.",
      "Key Resource Areas (KRAs) protect extractive resources (quarries, sand, gravel) under the State Planning Policy. A KRA separation area is a buffer where sensitive uses like new dwellings can be constrained because blasting, dust and haulage traffic are expected to continue long-term.",
    ],
    note: "This module reads the public statewide tenure and KRA layers. Historical mines, abandoned workings and current applications are searchable in more depth on GeoResGlobe. Tenure over a lot does not by itself grant surface access — but it is exactly the kind of encumbrance to raise with a conveyancer.",
    legend: [
      { label: "KRA resource/processing area", color: D.kraResource,   colorHex: D.kraResource },
      { label: "KRA separation buffer",        color: D.kraSeparation, colorHex: D.kraSeparation },
      { label: "Resource authority (tenure)",  color: D.tenement,      colorHex: D.tenement },
    ],
  },

  schools: {
    name: "School Catchments",
    question: "Which state schools is this property zoned for?",
    tint: "var(--apple-teal)",
    tintHex: APPLE_HEX.teal,
    icon: GraduationCap,
    sourceLabel: "Queensland Department of Education — State school catchments",
    thingsToKnow: [
      "Queensland state schools have legal catchment boundaries. If you live inside a school's catchment your child is guaranteed a place there. Out-of-catchment enrolment depends on places being available and is not guaranteed.",
      "Every Brisbane property typically sits inside one primary and one secondary catchment. Some addresses fall into specialist or selective catchments too. The catchment maps are updated annually so this report reflects the calendar year listed by the QLD Department of Education.",
    ],
    note: "Private and Catholic schools are not on this layer. Out-of-catchment applications, sibling rules, and specialist programs (e.g. arts, sport) are handled by the school directly. Confirm enrolment before contract if school choice is decisive.",
    legend: [
      { label: "Primary catchment",   color: D.vegBiodiversity, colorHex: D.vegBiodiversity },
      { label: "Secondary catchment", color: D.vegCorridor,     colorHex: D.vegCorridor },
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
      "Brisbane's City Plan 2014 places every parcel in a specific zone — for example Low density residential, Mixed use, Centre, or Open space. The zone determines what you can build on the land, what the building can be used for, height and density limits, and whether a proposal is code-assessable or impact-assessable.",
      "Some zones are further divided into precincts that fine-tune the rules for that area's character — Centre frame is different from Principal centre even though both are in the Centre family. The precinct description below tells you the exact precinct that applies.",
    ],
    note: "Zone codes alone don't tell the full story. Each zone has a code in the City Plan that specifies development standards. Read it alongside any precinct overlay before making any subdivision or building decision.",
    legend: [
      { label: "Centre",                  color: D.zoneCentre,      colorHex: D.zoneCentre },
      { label: "Mixed use",               color: D.zoneMixed,       colorHex: D.zoneMixed },
      { label: "Low-medium residential",  color: D.zoneLowMediumResidential, colorHex: D.zoneLowMediumResidential },
      { label: "General residential",     color: D.zoneResidential, colorHex: D.zoneResidential },
      { label: "Open space / Recreation", color: D.zoneOpenSpace,   colorHex: D.zoneOpenSpace },
      { label: "Industry / Other",        color: D.zoneOther,       colorHex: D.zoneOther },
    ],
  },
};
