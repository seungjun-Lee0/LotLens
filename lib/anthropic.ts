// LLM narrative generator.
//
// ⚠ STUB IMPLEMENTATION (Task 4a). This file deliberately does NOT call
// Anthropic. It produces deterministic, RAG-style summaries built from the
// council_data row attributes, in the exact shape Task 4b's real Claude
// integration will return. When Task 4b lands, replace `renderStub*`
// functions with an Anthropic SDK call using the system prompt in
// CLAUDE.md §7. The route handlers, pipeline, and report renderer do not
// change.

import type { CouncilDataRow, Module } from "@/lib/db";

export type ModuleNarrative = {
  summary: string;
  detail: string;
  questions_to_ask: string[];
  sources: string[];
};

export type GenerateModuleNarrativeInput = {
  module: Module;
  address: string;
  councilData: CouncilDataRow;
};

const DISCLAIMER_FALLBACK_QUESTIONS = [
  "Confirm with a conveyancer or the relevant council before relying on this for any decision.",
  "Request a current title search to see anything not in the public overlay.",
];

export async function generateModuleNarrative(
  input: GenerateModuleNarrativeInput,
): Promise<ModuleNarrative> {
  // Kept `async` to match the signature Task 4b will need. Stub returns
  // immediately.
  switch (input.module) {
    case "flooding":       return renderStubFlooding(input);
    case "flood_planning": return renderStubFloodPlanning(input);
    case "overland_flow":  return renderStubOverlandFlow(input);
    case "storm_tide":     return renderStubStormTide(input);
    case "bushfire":       return renderStubBushfire(input);
    case "vegetation":     return renderStubVegetation(input);
    case "heritage":       return renderStubHeritage(input);
    case "easements":      return renderStubEasements(input);
    case "noise":          return renderStubNoise(input);
    case "schools":        return renderStubSchools(input);
    case "zoning":         return renderStubZoning(input);
  }
}

// ── Per-module stub renderers ─────────────────────────────────────────────

type RawAttrs = Record<string, unknown>;

function readRaw(input: GenerateModuleNarrativeInput): RawAttrs {
  return (input.councilData.raw_response ?? {}) as RawAttrs;
}

function sourcesFromRaw(raw: RawAttrs): string[] {
  const list = Array.isArray(raw.sources) ? (raw.sources as RawAttrs[]) : [];
  return list.map((s) => (typeof s.url === "string" ? s.url : "")).filter(Boolean);
}

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function renderStubFlooding(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const risk = (raw.riskLevel as string) ?? "none";
  const historic = asArr<RawAttrs>(raw.historicEvents);
  const historicLabel = historic.map((e) => String(e.event)).filter(Boolean);

  if (risk === "none" && historic.length === 0) {
    return {
      summary: `No flooding consideration was identified at ${input.address}.`,
      detail:
        "Brisbane City Council's Flood Awareness Mapping does not place this address inside any creek, river, or storm tide flood polygon, and the property is not within the 2011 or 2022 historic flood extents we checked.",
      questions_to_ask: [
        "Ask the seller about any localised drainage issues — public overlays can miss yard-scale ponding.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  const riskWord =
    risk === "high"
      ? "high flood risk"
      : risk === "medium"
        ? "medium flood risk"
        : risk === "low"
          ? "low flood risk"
          : "very low flood risk";

  const historicSentence =
    historicLabel.length > 0
      ? ` The property is also inside the historic flood extents for ${historicLabel.join(" and ")}.`
      : " No historic flood extent matched.";

  return {
    summary: `${input.address} carries ${riskWord} per BCC Flood Awareness Mapping.${
      historicLabel.length > 0 ? ` Historic floods: ${historicLabel.join(", ")}.` : ""
    }`,
    detail: `Brisbane City Council classifies this property as "${raw.riskLevel}" on the combined creek / river / storm tide overlay.${historicSentence} Flood risk affects insurability, build form (raised floor levels), and resale.`,
    questions_to_ask: [
      "What habitable floor level does the property currently sit at, vs the defined flood event level?",
      "Has the property been physically flooded in recent events? Request photos and insurance claim history.",
      "What does flood insurance cost on this address — get a quote before contract.",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubOverlandFlow(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const risk = (raw.riskLevel as string) ?? "none";
  if (risk === "none") {
    return {
      summary: `No overland flow consideration was identified at ${input.address}.`,
      detail:
        "Brisbane City Council's Overland Flow mapping does not place this address inside any polygon. The lot is unlikely to be affected by mapped stormwater run-off.",
      questions_to_ask: [
        "Ask about local drainage problems anyway — overland flow models can miss yard-scale ponding.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `${input.address} carries ${risk} overland flow risk per BCC mapping.`,
    detail: `Brisbane City Council classifies this property as "${risk}" on the Overland Flow overlay. Building or extending may require specific drainage measures so stormwater can pass through the lot safely.`,
    questions_to_ask: [
      "Are there visible drainage marks, gullies or yard erosion from past storms?",
      "Have any extensions on this lot needed Council overland-flow assessment?",
      "What does the stormwater pathway look like at the back of the lot — fence-line drains, easements, neighbour batters?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubStormTide(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const risk = (raw.riskLevel as string) ?? "none";
  if (risk === "none") {
    return {
      summary: `No storm tide consideration was identified at ${input.address}.`,
      detail:
        "Brisbane City Council's Storm Tide mapping does not place this address inside any polygon. The lot is unlikely to be exposed to coastal storm-tide inundation as currently modelled.",
      questions_to_ask: [
        "If the property is near the bay, ask about historic king tide / east-coast low events anyway.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `${input.address} sits in a ${risk} storm tide area per BCC mapping.`,
    detail: `Brisbane City Council classifies this property as "${risk}" on the Storm Tide overlay. Habitable floor levels, building envelope resilience, and certain materials may be regulated. Insurance premiums for coastal storm-exposed properties can be materially higher.`,
    questions_to_ask: [
      "What is the habitable floor level versus the defined storm tide event level?",
      "Has insurance been quoted with explicit storm tide / cyclone coverage?",
      "Is there a sea wall, levee, or natural buffer affecting the practical risk?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubVegetation(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const cat = (raw.category as string | null) ?? null;
  if (!cat) {
    return {
      summary: `No biodiversity overlay applies to ${input.address}.`,
      detail:
        "BCC's Biodiversity areas overlay does not cover this address. Standard tree-removal and landscaping rules still apply (Natural Assets Local Law can catch individual significant trees even outside the overlay).",
      questions_to_ask: [
        "Is there a large or old tree on the lot that might trigger Natural Assets Local Law protections?",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `${input.address} is mapped as "${cat}" on the BCC Biodiversity areas overlay.`,
    detail: `The property sits inside a "${cat}" polygon under BCC's City Plan 2014. Council assessment is required before clearing protected vegetation, and building envelopes may be constrained by the overlay's vegetation rules.`,
    questions_to_ask: [
      "What native species are on the lot, and are any protected at the state level?",
      "Are there existing approved disturbance areas — driveway, building envelope, fire trail?",
      "Would a renovation require an arborist report or a Council pre-lodgement meeting?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubFloodPlanning(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const river = raw.riverArea as string | null;
  const creek = raw.creekArea as string | null;
  if (!river && !creek) {
    return {
      summary: `No statutory flood planning overlay applies to ${input.address}.`,
      detail:
        "Neither the Brisbane River flood planning area nor the Creek/waterway planning area covers this address. Future building work won't be gated by the planning flood overlay.",
      questions_to_ask: DISCLAIMER_FALLBACK_QUESTIONS,
      sources: sourcesFromRaw(raw),
    };
  }
  const areas = [river, creek].filter((x): x is string => Boolean(x));
  return {
    summary: `${input.address} sits in ${areas.join(" + ")}.`,
    detail: `Brisbane City Council's statutory flood planning overlay applies — ${areas.join(" + ")}. The numbered suffix (1 strictest, 4 mildest) determines minimum habitable floor levels, fill volumes, and excluded structures for any new build or extension. This is the legally binding control, distinct from the awareness-mapping risk indicator.`,
    questions_to_ask: [
      "What habitable floor level will any new build / extension need to be raised to?",
      "Are there fill, excavation or excluded-structure limits that affect the build envelope?",
      "If renovating, will the new floor area trigger the planning provisions?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubBushfire(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const cat = raw.hazardCategory as string | null;
  if (!cat) {
    return {
      summary: `No bushfire overlay applies to ${input.address}.`,
      detail:
        "The address does not fall inside any polygon of BCC's City Plan 2014 Bushfire overlay (which captures medium and high hazard areas plus their buffers).",
      questions_to_ask: [
        "Confirm with QFD if the property is on the statewide Bushfire Prone Area mapping — BCC's overlay is council-scope, the state map can be wider.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `${input.address} is mapped as "${cat}" on the BCC bushfire overlay.`,
    detail: `The property sits inside a "${cat}" polygon under BCC's City Plan 2014. This classification triggers planning-scheme provisions affecting new builds, vegetation management, and access — and may affect insurance premiums.`,
    questions_to_ask: [
      "What asset-protection-zone (vegetation clearance) is required for this hazard class?",
      "Is the existing dwelling compliant with BAL (Bushfire Attack Level) construction standards?",
      "Has bushfire insurance been quoted for this property?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubZoning(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const zoneCode = raw.zoneCode as string | null;
  const zonePrecinct = raw.zonePrecinct as string | null;
  const lvl1 = raw.lvl1Zone as string | null;
  const lvl2 = raw.lvl2Zone as string | null;
  if (!zoneCode && !lvl1) {
    return {
      summary: `Zoning could not be resolved for ${input.address}.`,
      detail:
        "The BCC City Plan 2014 zoning layer returned no polygon for this point. This is unusual for a Brisbane LGA address; check the address text and re-run.",
      questions_to_ask: DISCLAIMER_FALLBACK_QUESTIONS,
      sources: sourcesFromRaw(raw),
    };
  }
  const specific = lvl2 ?? zonePrecinct ?? zoneCode ?? lvl1;
  return {
    summary: `Zoned ${specific} under BCC City Plan 2014.`,
    detail: `Specific zone: ${lvl2 ?? "—"}. Top-level zone: ${lvl1 ?? "—"}. Precinct: ${zonePrecinct ?? "—"} (${zoneCode ?? "—"}). Zoning governs what can be built, run as a business, or subdivided on the lot. Brisbane's Centre, Mixed use, and residential zones each carry different precinct overlays — check the specific zone and precinct description against your intended use.`,
    questions_to_ask: [
      "What is the maximum height / GFA / site cover under this zone?",
      "Is a granny flat / dual occupancy permitted as code-assessable or impact-assessable?",
      "Are there any precinct-specific overlays that constrain renovation?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubHeritage(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const entries = asArr<RawAttrs>(raw.entries);
  if (entries.length === 0) {
    return {
      summary: `No heritage or character overlay applies to ${input.address}.`,
      detail:
        "BCC's State heritage area, Local heritage area, and Traditional building character overlays all return no polygons for this address. Renovation and demolition controls tied to those overlays do not apply.",
      questions_to_ask: [
        "Even with no overlay, individual pre-1947 dwellings can attract Council interest — confirm the house's construction year.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  const types = Array.from(new Set(entries.map((e) => String(e.type))));
  const desc = entries
    .map((e) => `${e.type} (${e.description ?? "—"})`)
    .join("; ");
  return {
    summary: `${input.address} is captured by ${types.join(" + ")} overlay${types.length > 1 ? "s" : ""}.`,
    detail: `Entries: ${desc}. State or local heritage listing typically requires development approval for any external work and may block demolition. Traditional building character protection (pre-1947) restricts demolition and constrains alterations to street-facing form. Confirm the exact controls with BCC eplan.`,
    questions_to_ask: [
      "What demolition / external alteration approvals will be needed?",
      "If buying to renovate, what design constraints apply to the street-facing facade?",
      "Have any heritage exemptions been granted on this property previously?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubNoise(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const t = raw.transportCorridor as string | null;
  const a = raw.anefCategory as string | null;
  if (!t && !a) {
    return {
      summary: `No noise corridor applies to ${input.address}.`,
      detail:
        "Neither the Transport noise corridor overlay nor the Airport ANEF noise overlay covers this address. New builds won't be triggered into acoustic-attenuation requirements by the overlay.",
      questions_to_ask: [
        "Visit the property at peak commute and late evening anyway — modelled noise differs from felt noise.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  const parts = [t, a].filter((x): x is string => Boolean(x));
  return {
    summary: `${input.address} sits in ${parts.join(" + ")}.`,
    detail: `Brisbane noise overlay flags this property: ${parts.join(" + ")}. New construction will trigger acoustic-attenuation requirements — rated glazing, denser walls, restrictions on habitable rooms facing the source. Practical felt noise depends on prevailing wind, time of day, and traffic mix.`,
    questions_to_ask: [
      "What rated windows and walls would a new build require here?",
      "Is the noise mostly road, rail, or aircraft? — solutions differ.",
      "Have you visited at peak hours? Modelled noise isn't always perceived noise.",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubSchools(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const schools = asArr<RawAttrs>(raw.schools);
  if (schools.length === 0) {
    return {
      summary: `No state school catchment was matched for ${input.address}.`,
      detail:
        "The QLD Department of Education catchment layer returned no polygons for this address. That's unusual — confirm the address sits inside Brisbane LGA and re-run.",
      questions_to_ask: DISCLAIMER_FALLBACK_QUESTIONS,
      sources: sourcesFromRaw(raw),
    };
  }
  const lines = schools
    .map((s) => {
      const name = String(s.name ?? "?");
      const yr = Array.isArray(s.yearLevels) ? (s.yearLevels as string[]).join(", ") : "?";
      return `${name} (years ${yr})`;
    })
    .join("; ");
  return {
    summary: `${input.address} is zoned for ${schools.map((s) => s.name).join(" + ")}.`,
    detail: `In-catchment for: ${lines}. State schools must accept in-catchment enrolments — choosing this address gives the listed schools as the guaranteed option. Out-of-catchment placements are place-dependent.`,
    questions_to_ask: [
      "Are the catchment schools at NAPLAN / OP performance you're happy with? Check MySchool.",
      "If you're moving for school, confirm enrolment with the school before contract.",
      "Are there specialist programs or sibling-priority rules you should know?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubEasements(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const hv = raw.hasHighVoltageEasement === true;
  const cadastral = raw.hasCadastralEasement === true;
  const cadastralList = Array.isArray(raw.cadastralEasements)
    ? (raw.cadastralEasements as Array<{ lotplan?: string | null }>)
    : [];
  const lotplans = cadastralList
    .map((e) => e.lotplan)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  const scope = (raw.scopeNote as string | null) ?? "";

  if (!hv && !cadastral) {
    return {
      summary: `No registered easement polygons cover ${input.address}.`,
      detail: `Neither BCC's high-voltage powerline overlay nor the QSpatial DCDB easement-parcel layer places a polygon on this address. ${scope}`,
      questions_to_ask: [
        "Order a QLD Title Search anyway — the polygon coverage misses very narrow or recently registered easements, and only the title shows the legal terms.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  const parts: string[] = [];
  if (hv) parts.push("a high-voltage powerline easement (BCC overlay)");
  if (cadastral) {
    const lotplanText = lotplans.length
      ? ` (lot/plan: ${lotplans.slice(0, 3).join(", ")})`
      : "";
    parts.push(
      `${cadastralList.length} registered cadastral easement parcel${cadastralList.length === 1 ? "" : "s"}${lotplanText}`,
    );
  }
  const summary = `${input.address} sits on ${parts.join(" and ")}.`;
  const detail = [
    hv &&
      "The high-voltage overlay restricts what can be built or grown near the conductor — the easement holder can enforce vegetation clearance and prohibit habitable structures.",
    cadastral &&
      "QSpatial's DCDB shows registered easement parcels at this location. These are commonly drainage, sewerage, access or party-wall easements — the polygons tell you they exist; only the title shows the conditions.",
    scope,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    summary,
    detail,
    questions_to_ask: [
      "Order a QLD Title Search to read each easement's instrument — type, purpose, benefiting party, and any conditions.",
      hv
        ? "What is the distance from any dwelling to the live powerline conductor?"
        : "Can you build over or fence within the easement, and who pays if the authority needs to dig it up?",
      "Has the easement holder ever issued a notice or restoration order on this lot?",
    ],
    sources: sourcesFromRaw(raw),
  };
}
