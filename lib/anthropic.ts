// LLM narrative generator.
//
// ⚠ STUB IMPLEMENTATION (Task 4a). This file deliberately does NOT call
// Anthropic. It produces deterministic, RAG-style summaries built from the
// council_data row attributes, in the exact shape Task 4b's real Claude
// integration will return. When Task 4b lands, replace `renderStub*`
// functions with an Anthropic SDK call using the system prompt in
// CLAUDE.md §7. The route handlers, pipeline, and report renderer do not
// change.

import type { Database, Module } from "@/lib/supabase";

export type ModuleNarrative = {
  summary: string;
  detail: string;
  questions_to_ask: string[];
  sources: string[];
};

export type GenerateModuleNarrativeInput = {
  module: Module;
  address: string;
  councilData: Database["public"]["Tables"]["council_data"]["Row"];
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
    case "flooding":   return renderStubFlooding(input);
    case "bushfire":   return renderStubBushfire(input);
    case "heritage":   return renderStubHeritage(input);
    case "easements":  return renderStubEasements(input);
    case "zoning":     return renderStubZoning(input);
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
  if (!zoneCode && !lvl1) {
    return {
      summary: `Zoning could not be resolved for ${input.address}.`,
      detail:
        "The BCC City Plan 2014 zoning layer returned no polygon for this point. This is unusual for a Brisbane LGA address; check the address text and re-run.",
      questions_to_ask: DISCLAIMER_FALLBACK_QUESTIONS,
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `Zoned ${zonePrecinct ?? zoneCode ?? lvl1} under BCC City Plan 2014.`,
    detail: `Top-level zone: ${lvl1 ?? "—"}. Precinct: ${zonePrecinct ?? "—"} (${zoneCode ?? "—"}). Zoning governs what can be built, run as a business, or subdivided on the lot. Brisbane's Centre, Mixed use, and Character residential zones each carry different precinct overlays — check the precinct description against your intended use.`,
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

function renderStubEasements(
  input: GenerateModuleNarrativeInput,
): ModuleNarrative {
  const raw = readRaw(input);
  const hit = raw.hasHighVoltageEasement === true;
  const scope = (raw.scopeNote as string | null) ?? "";
  if (!hit) {
    return {
      summary: `No public high-voltage easement overlay applies to ${input.address}.`,
      detail: `BCC's high-voltage powerline easement overlay does not cover this address. ${scope}`,
      questions_to_ask: [
        "Order a QLD Title Search — drainage, sewerage, and access easements live there, not on the public overlay.",
        ...DISCLAIMER_FALLBACK_QUESTIONS,
      ],
      sources: sourcesFromRaw(raw),
    };
  }
  return {
    summary: `${input.address} sits on a high-voltage powerline easement.`,
    detail: `BCC's Major electricity infrastructure overlay places this address inside a high-voltage easement polygon. Build envelope, vegetation, and dwelling habitability can all be restricted by the easement holder. ${scope}`,
    questions_to_ask: [
      "What does the easement instrument actually prohibit — ask the conveyancer to read it.",
      "What is the distance from any dwelling to the live powerline conductor?",
      "Has the easement holder ever issued a notice on this lot?",
    ],
    sources: sourcesFromRaw(raw),
  };
}
