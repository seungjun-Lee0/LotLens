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
  //
  // Council-overlay modules outside adapted LGAs mark themselves
  // `available: false` — render an honest "not integrated here" narrative
  // instead of a false "no considerations identified".
  const rawAvail = (input.councilData.raw_response ?? {}) as Record<string, unknown>;
  // A source that couldn't be reached this run (pipeline wrote a
  // fetchFailed row) is different again from "not integrated for this
  // LGA" — it's transient, so the narrative should say "re-run", not
  // "ask your conveyancer".
  if (rawAvail.fetchFailed === true) {
    return renderStubFetchFailed(input);
  }
  if (rawAvail.available === false) {
    return renderStubUnavailable(input, rawAvail);
  }
  switch (input.module) {
    case "flooding":       return renderStubFlooding(input);
    case "flood_planning": return renderStubFloodPlanning(input);
    case "overland_flow":  return renderStubOverlandFlow(input);
    case "storm_tide":     return renderStubStormTide(input);
    case "bushfire":       return renderStubBushfire(input);
    case "vegetation":     return renderStubVegetation(input);
    case "environment":    return renderStubEnvironment(input);
    case "heritage":       return renderStubHeritage(input);
    case "easements":      return renderStubEasements(input);
    case "noise":          return renderStubNoise(input);
    case "steep_land":     return renderStubSteepLand(input);
    case "acid_sulfate":   return renderStubAcidSulfate(input);
    case "mining":         return renderStubMining(input);
    case "schools":        return renderStubSchools(input);
    case "zoning":         return renderStubZoning(input);
  }
}

function renderStubFetchFailed(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  return {
    summary: `This check couldn't be completed for ${input.address} — the data source didn't respond.`,
    detail:
      "The government/council mapping service for this module was unreachable when the report ran. No finding here means \"not checked\", not \"clear\". Re-run the checks to retry — these outages are usually brief.",
    questions_to_ask: [
      "Re-run the report checks to retry this source.",
      "If it keeps failing, check the source's own website directly — the link is on the module card.",
    ],
    sources: [],
  };
}

function renderStubUnavailable(
  input: GenerateModuleNarrativeInput,
  raw: Record<string, unknown>,
): ModuleNarrative {
  const note =
    typeof raw.availabilityNote === "string"
      ? raw.availabilityNote
      : "This overlay is published per-council and has not been integrated for this local government area yet.";
  return {
    summary: `This check is not yet available for ${input.address}'s council area.`,
    detail: `${note} No finding here means "not checked", not "clear" — treat it as an open item for your conveyancer.`,
    questions_to_ask: [
      "Ask the local council (or check its online planning-scheme mapping) what this overlay shows for the lot.",
      "Ask your conveyancer to include this check in their searches.",
    ],
    sources: sourcesFromRaw(raw),
  };
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

function renderStubEnvironment(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const category = (raw.category as string | null) ?? null;
  const priority = raw.inKoalaPriorityArea === true;
  const habitat = raw.hasKoalaHabitat === true;
  const wildlife = raw.hasWildlifeHabitat === true;

  if (!priority && !habitat && !wildlife) {
    return {
      summary: `No koala or state wildlife habitat mapping covers ${input.address}.`,
      detail:
        "The property is outside the SEQ koala habitat mapping (core and locally refined) and outside MSES endangered/vulnerable wildlife habitat. Ordinary tree removal and building work is not constrained by these state environmental frameworks.",
      questions_to_ask: [
        "Council local laws can still protect individual trees — check before removing anything substantial.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  return {
    summary: `${input.address} is affected by environmental habitat mapping: ${category ?? "koala/wildlife habitat"}.`,
    detail: `${
      habitat
        ? "Mapped koala habitat covers part of the lot — inside a Koala Priority Area, interfering with koala habitat trees is assessable development under the Nature Conservation (Koala) Plan 2020. "
        : priority
          ? "The lot sits inside a Koala Priority Area, though no koala habitat is mapped on the lot itself. "
          : ""
    }${
      wildlife
        ? "MSES wildlife habitat (endangered or vulnerable species) is also mapped here, which can trigger state referral and offset requirements for new development."
        : ""
    } Day-to-day residential use is unaffected; clearing, pools, sheds and extensions in mapped habitat need checking first.`,
    questions_to_ask: [
      "Which trees on the lot are koala habitat trees, and what would removing one require?",
      "Has any previous development application on this lot triggered koala or MSES conditions?",
      "If you plan to extend or add a pool: get a fauna/vegetation assessment quote before contract.",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubSteepLand(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const category = (raw.category as string | null) ?? null;
  const risk = (raw.riskLevel as string) ?? "none";

  if (risk === "none") {
    return {
      summary: `No landslide or steep-land overlay covers ${input.address}.`,
      detail:
        "The council's landslide / steep land overlay does not place a polygon on this address. That doesn't guarantee flat ground — it means the site is outside the mapped hazard thresholds.",
      questions_to_ask: [
        "If the block is visibly sloping, budget for a contour survey before designing anything.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  return {
    summary: `${input.address} sits in a landslide / steep land overlay${category ? ` (${category})` : ""}.`,
    detail:
      "Mapped steep land means development assessment will usually require a geotechnical report — slope stability, cut-and-fill limits, retaining and drainage design. Existing dwellings are unaffected day-to-day, but extensions, pools and secondary dwellings on the slope face extra engineering cost and approval time.",
    questions_to_ask: [
      "Has a geotechnical report ever been done for this lot? Ask the seller for a copy.",
      "Are the existing retaining walls engineered and approved, and who owns each one?",
      "Any signs of movement — cracked slabs, leaning fences, doors that stopped closing?",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubAcidSulfate(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const mapCode = (raw.mapCode as string | null) ?? null;
  const meaning = (raw.meaning as string | null) ?? null;
  const scale = (raw.scale as string | null) ?? null;
  const risk = (raw.riskLevel as string) ?? "none";

  if (risk === "none") {
    return {
      summary: `No mapped acid sulfate soils at ${input.address}.`,
      detail:
        "The Queensland acid sulfate soils mapping does not place this address inside a mapped ASS polygon. Note the state mapping covers coastal lowlands — being unmapped is expected for elevated or inland lots.",
      questions_to_ask: [
        "If you plan deep excavation (pool, basement) near the coast, ask whether any soil testing has been done regardless.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  return {
    summary: `${input.address} sits on mapped acid sulfate soils${mapCode ? ` (map code ${mapCode})` : ""}.`,
    detail: `State mapping${scale ? ` at ${scale} scale` : ""} classifies this land as ${
      meaning ?? "an acid sulfate soil area"
    }. Undisturbed, this changes nothing day-to-day — but excavation or drainage works (pools, basements, deep footings, canal work) can oxidise sulfidic material and produce sulfuric acid, so development approval typically requires an ASS investigation and management plan, which adds cost.`,
    questions_to_ask: [
      "Have previous works on the lot (pool, retaining walls) done ASS testing? Ask for the report.",
      "For planned excavation: get an indicative quote for an ASS investigation and management plan.",
      "Ask council what depth/volume of excavation triggers ASS assessment in this area.",
    ],
    sources: sourcesFromRaw(raw),
  };
}

function renderStubMining(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const tenements = Array.isArray(raw.tenements)
    ? (raw.tenements as Array<{ type?: string | null; status?: string | null; owner?: string | null; mineral?: string | null }>)
    : [];
  const kraResource = raw.inKraResourceArea === true;
  const kraSeparation = raw.inKraSeparationArea === true;

  if (tenements.length === 0 && !kraResource && !kraSeparation) {
    return {
      summary: `No resource tenures or Key Resource Areas affect ${input.address}.`,
      detail:
        "The statewide tenure layer shows no mining lease, exploration permit or mineral development licence over this lot, and it is outside every Key Resource Area footprint and separation buffer.",
      questions_to_ask: [
        "For rural or fringe lots, GeoResGlobe can additionally show historical workings and current applications nearby.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }

  const parts: string[] = [];
  if (kraResource) parts.push("a Key Resource Area resource/processing footprint (active or future quarry land)");
  if (kraSeparation) parts.push("a Key Resource Area separation buffer (dust/noise/blast constraints on sensitive uses)");
  for (const t of tenements.slice(0, 2)) {
    parts.push(
      `${t.type ?? "a resource authority"}${t.status ? ` — ${String(t.status).toLowerCase()}` : ""}${t.owner ? ` (${t.owner})` : ""}`,
    );
  }

  return {
    summary: `${input.address} is affected by: ${parts.join("; ")}.`,
    detail: `Resource interests exist separately from surface ownership in Queensland. ${
      kraResource || kraSeparation
        ? "KRA mapping means extractive industry (quarrying and haulage) is protected here by state policy — expect long-term noise, dust and truck movements, and constraints on adding new dwellings inside the buffer. "
        : ""
    }${
      tenements.length > 0
        ? "A tenure over the lot does not by itself grant surface access, but granted mining leases carry real activity rights — the exact terms live with the Department of Resources."
        : ""
    }`,
    questions_to_ask: [
      "Look the tenure up on GeoResGlobe: what is authorised, until when, and how close is active work?",
      kraSeparation
        ? "Ask council whether a new dwelling or extension is assessable inside the KRA separation area."
        : "Has the tenure holder ever exercised access or compensation rights over this lot?",
      "Ask neighbours about blasting, dust or haulage traffic patterns.",
    ],
    sources: sourcesFromRaw(raw),
  };
}
