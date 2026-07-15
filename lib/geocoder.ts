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

const QLD_LOCATOR =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/QldCompositeLocator/GeocodeServer/findAddressCandidates";

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

type QldCandidate = {
  address: string;
  score: number;
  location: { x: number; y: number };
};

async function qldFindCandidates(
  query: string,
  maxLocations: number,
): Promise<QldCandidate[]> {
  const url = new URL(QLD_LOCATOR);
  url.searchParams.set("SingleLine", query);
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxLocations", String(maxLocations));
  url.searchParams.set("f", "json");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const body = (await res.json()) as { candidates?: QldCandidate[] };
  return (body.candidates ?? []).filter(
    (c) =>
      c.location &&
      c.location.y >= BBOX.latMin &&
      c.location.y <= BBOX.latMax &&
      c.location.x >= BBOX.lonMin &&
      c.location.x <= BBOX.lonMax,
  );
}

async function suggestQld(query: string): Promise<Suggestion[]> {
  const candidates = await qldFindCandidates(query, 6);
  return candidates.map((c) => {
    const { primary, secondary } = splitDisplayName(c.address);
    return {
      id: `qld:${c.location.x.toFixed(6)},${c.location.y.toFixed(6)}`,
      displayName: c.address,
      lat: c.location.y,
      lng: c.location.x,
      primary,
      secondary,
    };
  });
}

async function geocodeQld(query: string): Promise<GeocodeHit | null> {
  const candidates = await qldFindCandidates(query, 3);
  const best = candidates.find((c) => c.score >= 70) ?? candidates[0];
  if (!best) return null;
  return {
    lat: best.location.y,
    lng: best.location.x,
    displayName: best.address,
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

type AutocompletePrediction = {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

async function suggestGoogle(
  query: string,
  key: string,
): Promise<Suggestion[]> {
  // Places Autocomplete — designed for type-as-you-search. Returns
  // predictions with place_id; coords come from Geocoding/Details on
  // pick. Restricted to AU + biased to Brisbane LGA.
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/autocomplete/json",
  );
  url.searchParams.set("input", query);
  url.searchParams.set("key", key);
  url.searchParams.set("components", "country:au");
  url.searchParams.set("types", "geocode");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const body = (await res.json()) as {
    status: string;
    predictions?: AutocompletePrediction[];
    error_message?: string;
  };
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    console.warn(
      "[geocoder] google places autocomplete:",
      body.status,
      body.error_message,
    );
    return [];
  }
  return (body.predictions ?? []).slice(0, 6).map((p) => ({
    id: `g:${p.place_id}`,
    displayName: p.description,
    lat: null,
    lng: null,
    primary: p.structured_formatting?.main_text ?? splitDisplayName(p.description).primary,
    secondary:
      p.structured_formatting?.secondary_text ??
      splitDisplayName(p.description).secondary,
  }));
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
  try {
    const out = await suggestQld(query);
    if (out.length > 0) return out;
  } catch (err) {
    console.error("[geocoder] qld locator suggest failed, falling back:", err);
  }
  try {
    return await suggestNominatim(query);
  } catch {
    return [];
  }
}

export async function geocodeAddress(query: string): Promise<GeocodeHit | null> {
  const key = GOOGLE_KEY();
  if (key) {
    try {
      const hit = await geocodeGoogle(query, key);
      if (hit) return hit;
    } catch (err) {
      console.error("[geocoder] google geocode failed, falling back:", err);
    }
  }
  try {
    const hit = await geocodeQld(query);
    if (hit) return hit;
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
