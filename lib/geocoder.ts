// Geocoder abstraction.
//
// Three providers, picked by env at runtime:
//   - Google Maps (Geocoding + Places Autocomplete) when
//     GOOGLE_GEOCODING_API_KEY is set. Best AU data — handles
//     unit / apartment numbers, full street addresses, points of
//     interest.
//   - Queensland Government composite address locator (QSpatial) —
//     free, no key, authoritative for QLD addresses, and QLD-only by
//     construction. Primary when Google isn't keyed.
//   - OSM Nominatim as the last resort.
//
// All providers are restricted to the Queensland bbox.

import { QLD_BBOX as BBOX } from "@/lib/region";

const QLD_LOCATOR_BASE =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/QldCompositeLocator/GeocodeServer";
const QLD_LOCATOR = `${QLD_LOCATOR_BASE}/findAddressCandidates`;

const NOMINATIM_UA =
  "LotLens/0.1 QLD-DD (contact: hello@lotlens.au)";

export type Suggestion = {
  id: string;
  displayName: string;
  /** May be null when the suggestion came from Places Autocomplete
   * (Google doesn't return coords until you call Place Details).
   * Always set for Nominatim suggestions. */
  lat: number | null;
  lng: number | null;
  /** Bold first line in the dropdown. */
  primary: string;
  /** Muted second line. */
  secondary: string;
};

export type GeocodeHit = {
  lat: number;
  lng: number;
  displayName: string;
};

function splitDisplayName(s: string): { primary: string; secondary: string } {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const primary = parts[0] ?? s;
  const secondary = parts.slice(1, 4).join(", ");
  return { primary, secondary };
}

// ── Queensland Government composite locator ─────────────────────────────
//
// Quirks worth knowing (verified against the live service):
//   - Candidates come back grouped PER SOURCE LOCATOR, not globally ranked
//     — with a small maxLocations the best match can be cut off entirely.
//     Always over-fetch and sort by score ourselves.
//   - Gazetteer sources (PLACE_NAME_Gaz, TERRAINPOINTS) contribute
//     mountains, capes and duplicate place points that are useless for a
//     property search — drop them, except gazetteer SUBURB entries which
//     make good locality suggestions.
//   - `attributes.LongLabel` carries the human context ("Hastings Street,
//     Annerley, Brisbane City") that the bare `address` field lacks.

type QldCandidate = {
  address: string;
  score: number;
  location: { x: number; y: number };
  attributes?: Record<string, unknown>;
};

const QLD_JUNK_LOCATORS = new Set(["TERRAINPOINTS"]);

function qldAttr(c: QldCandidate, key: string): string {
  const v = c.attributes?.[key];
  return typeof v === "string" ? v : "";
}

/** Human label with context — suburb + LGA where the service provides it. */
function qldLabel(c: QldCandidate): string {
  const long = qldAttr(c, "LongLabel");
  const locName = qldAttr(c, "Loc_name");
  if (locName === "PLACE_NAME_Gaz") {
    // "Kangaroo Point, Gazetteer Reference No: 52191, Type: Suburb, Brisbane City"
    const lga = long.split(",").map((s) => s.trim()).pop() ?? "";
    return lga ? `${c.address}, ${lga}, QLD` : `${c.address}, QLD`;
  }
  if (c.address.includes(",") || /\d/.test(c.address)) {
    return c.address.replace(/,\s*Property area:.*?m²/i, "");
  }
  return long || c.address;
}

async function qldFindCandidates(
  query: string,
  maxLocations: number,
  magicKey?: string,
): Promise<QldCandidate[]> {
  const url = new URL(QLD_LOCATOR);
  url.searchParams.set("SingleLine", query);
  if (magicKey) url.searchParams.set("magicKey", magicKey);
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxLocations", String(maxLocations));
  url.searchParams.set("outFields", "Loc_name,LongLabel");
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const body = (await res.json()) as { candidates?: QldCandidate[] };
  return (body.candidates ?? [])
    .filter(
      (c) =>
        c.location &&
        c.location.y >= BBOX.latMin &&
        c.location.y <= BBOX.latMax &&
        c.location.x >= BBOX.lonMin &&
        c.location.x <= BBOX.lonMax,
    )
    .filter((c) => {
      const locName = qldAttr(c, "Loc_name");
      if (QLD_JUNK_LOCATORS.has(locName)) return false;
      // Gazetteer points are noise except actual suburb entries.
      if (locName === "PLACE_NAME_Gaz")
        return /Type: Suburb/i.test(qldAttr(c, "LongLabel"));
      return true;
    })
    .sort((a, b) => {
      // Street-number candidates are what a property search wants first.
      const aAddr = /^\d/.test(a.address) ? 1 : 0;
      const bAddr = /^\d/.test(b.address) ? 1 : 0;
      if (aAddr !== bAddr) return bAddr - aAddr;
      return b.score - a.score;
    });
}

// The locator's /suggest endpoint is the proper typeahead: it matches
// partial input against the address index directly ("10 hastings street
// noosa" → "10 Hastings Street, Noosa Heads, Noosa Shire, QLD" first),
// which findAddressCandidates alone cannot do reliably.
type QldSuggestion = { text: string; magicKey: string; isCollection?: boolean };

async function qldSuggest(text: string, max: number): Promise<QldSuggestion[]> {
  const url = new URL(`${QLD_LOCATOR_BASE}/suggest`);
  url.searchParams.set("text", text);
  url.searchParams.set("maxSuggestions", String(max));
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const body = (await res.json()) as { suggestions?: QldSuggestion[] };
  return (body.suggestions ?? []).filter((s) => !s.isCollection);
}

/** Some sources repeat the name ("2 Hastings St, 2 Hastings St, …"). */
function cleanSuggestText(t: string): string {
  const out: string[] = [];
  for (const part of t.split(",").map((s) => s.trim())) {
    if (part && part !== out[out.length - 1]) out.push(part);
  }
  return out.join(", ");
}

/** The rural-property-name source embeds the parcel size in the label
 * ("Westfield, Property area: 10,554,361.23 m², Rural Property, Drillham
 * South…") — and the thousands separators then confuse every comma-based
 * split downstream. Strip the area segment; keep the place itself. */
function stripPropertyArea(label: string): string {
  return label.replace(/,\s*Property area:.*?m²/i, "");
}

async function suggestQld(query: string): Promise<Suggestion[]> {
  const sugs = await qldSuggest(locatorQuery(query), 10);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of sugs) {
    let label = stripPropertyArea(cleanSuggestText(s.text));
    // Gazetteer entries leak through /suggest ("Lakes Creek, Gazetteer
    // Reference No: 18835, Type: Watercourse, …"). Keep only locality-type
    // entries and strip the register boilerplate from the label.
    if (/Gazetteer Reference No:/i.test(label)) {
      if (!/Type: (Suburb|Population centre|Locality)/i.test(label)) continue;
      label = label.replace(/,\s*Gazetteer Reference No: \d+,\s*Type: [^,]+/i, "");
    }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { primary, secondary } = splitDisplayName(label);
    out.push({
      // Labels are de-duplicated above, so they make a safe unique id
      // (magicKey prefixes collide — they encode the source locator).
      id: `qld:${key}`,
      displayName: label,
      // Coords resolve at geocode time (same contract as Google
      // autocomplete suggestions).
      lat: null,
      lng: null,
      primary,
      secondary: secondary || "Queensland",
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** The locator's /suggest treats a trailing postcode as a literal prefix
 * token and matches lot-plan ids ("4005SP297533") and survey benchmarks
 * ("40058") instead of addresses — and "QLD"/"Australia" suffixes only
 * dilute the match. Strip them before asking the locator. */
function locatorQuery(query: string): string {
  return query
    .replace(/\b(?:qld|queensland|australia)\b/gi, " ")
    .replace(/\b4\d{3}\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*)+$/g, "")
    .trim();
}

async function geocodeQld(query: string): Promise<GeocodeHit | null> {
  const q = locatorQuery(query);
  const tokens = queryTokens(query);
  // Resolve through /suggest + magicKey first — it handles partial and
  // suburb-fuzzy input far better than a raw candidate search. Never
  // trust the single top suggestion blindly: /suggest ranks per source
  // locator, and for "50 Macquarie Street, Teneriffe" its first row can
  // be a Macquarie Street 300 km away. Prefer the first suggestion that
  // mentions every word the user typed (street AND suburb); when none
  // does (legit at suburb boundaries — typed Graceville, official
  // address says Chelmer) keep the locator's own order.
  try {
    const sugs = await qldSuggest(q, 8);
    const top =
      sugs.find((s) => coversTokens(cleanSuggestText(s.text), tokens)) ??
      sugs[0];
    if (top) {
      const cands = await qldFindCandidates(top.text, 6, top.magicKey);
      const best = cands[0];
      if (best) {
        return {
          lat: best.location.y,
          lng: best.location.x,
          displayName: qldLabel(best),
        };
      }
    }
  } catch {
    /* fall through to the direct candidate search */
  }
  const candidates = await qldFindCandidates(q, 15);
  // Same locality preference on the direct path.
  const covering = candidates.filter((c) => coversTokens(qldLabel(c), tokens));
  const pool = covering.length > 0 ? covering : candidates;
  const best = pool.find((c) => c.score >= 70) ?? pool[0];
  if (!best) return null;
  return {
    lat: best.location.y,
    lng: best.location.x,
    displayName: qldLabel(best),
  };
}

// ── Nominatim ────────────────────────────────────────────────────────────

type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  place_id?: number;
};

async function suggestNominatim(query: string): Promise<Suggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "5");
  url.searchParams.set(
    "viewbox",
    `${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`,
  );
  url.searchParams.set("bounded", "1");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "en-AU,en" },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as NominatimRow[];
  return rows.map((r) => {
    const { primary, secondary } = splitDisplayName(r.display_name);
    return {
      id: `nom:${r.place_id ?? `${r.lat},${r.lon}`}`,
      displayName: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      primary,
      secondary,
    };
  });
}

async function geocodeNominatim(query: string): Promise<GeocodeHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "1");
  url.searchParams.set(
    "viewbox",
    `${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`,
  );
  url.searchParams.set("bounded", "1");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "en-AU,en" },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as NominatimRow[];
  if (rows.length === 0) return null;
  const r = rows[0];
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: r.display_name };
}

// ── Google ───────────────────────────────────────────────────────────────

type NewPlacePrediction = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
};

async function suggestGoogle(
  query: string,
  key: string,
): Promise<Suggestion[]> {
  // Places API (New) autocomplete — the legacy
  // maps/api/place/autocomplete endpoint returns REQUEST_DENIED for
  // projects created after the deprecation cutoff, so this must use the
  // v1 places:autocomplete surface. Covers addresses AND establishments
  // ("westfield chermside") in one call, AU-restricted + QLD-biased.
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["AU"],
      locationBias: {
        rectangle: {
          low: { latitude: BBOX.latMin, longitude: BBOX.lonMin },
          high: { latitude: BBOX.latMax, longitude: BBOX.lonMax },
        },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn("[geocoder] google places autocomplete:", res.status, err.slice(0, 200));
    return [];
  }
  const body = (await res.json()) as { suggestions?: NewPlacePrediction[] };
  const out: Suggestion[] = [];
  for (const s of body.suggestions ?? []) {
    const p = s.placePrediction;
    const text = p?.text?.text;
    if (!p?.placeId || !text) continue;
    out.push({
      id: `g:${p.placeId}`,
      displayName: text,
      lat: null,
      lng: null,
      primary: p.structuredFormat?.mainText?.text ?? splitDisplayName(text).primary,
      secondary:
        p.structuredFormat?.secondaryText?.text ?? splitDisplayName(text).secondary,
    });
    if (out.length >= 6) break;
  }
  return out;
}

type GeocodingResult = {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};

async function geocodeGoogle(
  query: string,
  key: string,
): Promise<GeocodeHit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  url.searchParams.set("components", "country:AU");
  // Strict bounds so non-Brisbane addresses still get filtered. Format
  // for Google: sw|ne as `lat,lng|lat,lng`.
  url.searchParams.set(
    "bounds",
    `${BBOX.latMin},${BBOX.lonMin}|${BBOX.latMax},${BBOX.lonMax}`,
  );
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const body = (await res.json()) as {
    status: string;
    results?: GeocodingResult[];
    error_message?: string;
  };
  if (body.status !== "OK") {
    if (body.status !== "ZERO_RESULTS") {
      console.warn(
        "[geocoder] google geocoding:",
        body.status,
        body.error_message,
      );
    }
    return null;
  }
  // Filter to the Queensland bbox — Google ignores bounds when the
  // address is unambiguous globally.
  const hit = body.results?.find((r) => {
    const { lat, lng } = r.geometry.location;
    return (
      lat >= BBOX.latMin &&
      lat <= BBOX.latMax &&
      lng >= BBOX.lonMin &&
      lng <= BBOX.lonMax
    );
  });
  if (!hit) return null;
  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    displayName: hit.formatted_address,
  };
}

// ── Public surface ───────────────────────────────────────────────────────

const GOOGLE_KEY = () => process.env.GOOGLE_GEOCODING_API_KEY ?? "";

// ── Token coverage ───────────────────────────────────────────────────────
//
// The QLD locator's /suggest happily prefix-matches on the FIRST word and
// ignores the rest: "westfield chermside" returns Westfield (Longreach) and
// Westfield Station (Kumbarilla) — nothing in Chermside. A suggestion that
// doesn't mention every meaningful word the user typed is a weak match, and
// when NONE of them do we let OSM (which indexes POIs) take the top slots.

const TOKEN_STOPWORDS = new Set(["qld", "queensland", "australia", "the"]);

function queryTokens(query: string): string[] {
  return (query.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
    (t) => !TOKEN_STOPWORDS.has(t),
  );
}

function coversTokens(label: string, tokens: string[]): boolean {
  const l = label.toLowerCase();
  return tokens.every((t) => l.includes(t));
}

/** Street-address-shaped input ("12 Oxley Rd …"). For these the QLD
 * locator is authoritative and token mismatches are usually just suburb
 * boundary naming (typed Graceville, official address says Chelmer) — do
 * NOT let an OSM street centroid outrank an exact lot address. */
function looksLikeStreetAddress(query: string): boolean {
  return /^\s*\d/.test(query);
}

export async function suggestAddresses(query: string): Promise<Suggestion[]> {
  if (query.trim().length < 3) return [];
  const key = GOOGLE_KEY();
  if (key) {
    try {
      const out = await suggestGoogle(query, key);
      if (out.length > 0) return out;
    } catch (err) {
      console.error("[geocoder] google suggest failed, falling back:", err);
    }
  }
  const tokens = queryTokens(query);
  let qld: Suggestion[] = [];
  try {
    qld = await suggestQld(query);
  } catch (err) {
    console.error("[geocoder] qld locator suggest failed, falling back:", err);
  }
  // Address-shaped queries: trust the locator's own ordering outright.
  if (looksLikeStreetAddress(query) && qld.length > 0) return qld;
  const covering = qld.filter((s) => coversTokens(s.displayName, tokens));
  if (covering.length > 0) {
    // Good matches exist — surface them first, weak prefix-matches after.
    const rest = qld.filter((s) => !coversTokens(s.displayName, tokens));
    return [...covering, ...rest].slice(0, 6);
  }
  // No QLD suggestion mentions every word — landmark/POI-style query.
  // Merge OSM results (QLD-bounded) ahead of the weak prefix matches.
  try {
    const nom = await suggestNominatim(query);
    const seen = new Set<string>();
    const merged: Suggestion[] = [];
    for (const s of [...nom, ...qld]) {
      const k = s.displayName.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(s);
      if (merged.length >= 6) break;
    }
    if (merged.length > 0) return merged;
  } catch {
    /* fall through */
  }
  return qld;
}

export async function geocodeAddress(query: string): Promise<GeocodeHit | null> {
  const key = GOOGLE_KEY();

  // Provider order is deliberate, and NOT Google-first:
  //
  //   1. QLD locator, but only when it produces an EXACT street-number
  //      match. Its address points come from the state address register
  //      and sit on the parcel itself, so for parcel-based due diligence
  //      it beats Google's geometric rooftop — which can land on the
  //      neighbour (33 Heath St pinned 66 m off, flipping the resolved
  //      lot from 240/RP11234 to 248/RP11234 and the character verdict
  //      with it).
  //   2. Google for everything the locator can't nail exactly: unlisted
  //      street numbers (50 Macquarie St Teneriffe), house numbers on
  //      big sites (1019 Ann St Newstead resolves street-level only),
  //      POIs, unit addresses.
  //   3. QLD partial hit, then Nominatim, as before.
  //
  // (Google Places still powers the suggestion dropdown — this order is
  // about the final coordinates only.)
  const streetNum = query.match(/^\s*(\d+)[a-z]?\b(?!\s*\/)/i)?.[1] ?? null;
  let qldHit: GeocodeHit | null = null;
  let qldTried = false;
  if (streetNum) {
    qldTried = true;
    try {
      qldHit = await geocodeQld(query);
      if (
        qldHit &&
        new RegExp(`^${streetNum}\\b`).test(qldHit.displayName.trim())
      ) {
        return qldHit;
      }
    } catch (err) {
      console.error("[geocoder] qld locator geocode failed:", err);
    }
  }

  if (key) {
    try {
      const hit = await geocodeGoogle(query, key);
      if (hit) return hit;
    } catch (err) {
      console.error("[geocoder] google geocode failed, falling back:", err);
    }
  }
  // Locator's inexact hit (street/complex level) is still better than
  // nothing when Google is unavailable.
  if (qldTried && qldHit) return qldHit;
  try {
    const hit = await geocodeQld(query);
    if (hit) {
      // Landmark-style query resolved to something that doesn't mention the
      // words the user typed (the locator prefix-matches the first word and
      // can land hundreds of km away — "Westfield Chermside" → Westfield
      // homestead, Longreach). Prefer an OSM hit that actually matches.
      const tokens = queryTokens(query);
      if (
        !looksLikeStreetAddress(query) &&
        tokens.length > 0 &&
        !coversTokens(hit.displayName, tokens)
      ) {
        try {
          const nom = await geocodeNominatim(query);
          if (nom && coversTokens(nom.displayName, tokens)) return nom;
        } catch {
          /* keep the QLD hit */
        }
      }
      return hit;
    }
  } catch (err) {
    console.error("[geocoder] qld locator geocode failed, falling back:", err);
  }
  try {
    return await geocodeNominatim(query);
  } catch {
    return null;
  }
}

/** Which provider answers first. Useful for the UI to surface
 * provider-specific caveats when Google isn't keyed. */
export function activeProvider(): "google" | "qld" {
  return GOOGLE_KEY() ? "google" : "qld";
}
