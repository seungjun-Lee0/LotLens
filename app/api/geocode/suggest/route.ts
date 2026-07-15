// POST /api/geocode/suggest
// Body: { query: string }
// Returns up to 5 address suggestions. Google Places Autocomplete when
// GOOGLE_GEOCODING_API_KEY is set (handles unit / apartment numbers
// for AU), Nominatim otherwise (street-level only).

import { NextResponse } from "next/server";
import { z } from "zod";

import { activeProvider, suggestAddresses, type Suggestion } from "@/lib/geocoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({ query: z.string().min(2).max(200) });

export type { Suggestion };

// Per-instance micro-cache: repeated keystroke queries (and backspacing)
// hit the same strings constantly; addresses don't change minute-to-minute.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; suggestions: Suggestion[] }>();

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ suggestions: [], provider: activeProvider() });
  }
  const key = parsed.query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({
      suggestions: hit.suggestions,
      provider: activeProvider(),
    });
  }
  const suggestions = await suggestAddresses(parsed.query);
  cache.set(key, { at: Date.now(), suggestions });
  if (cache.size > CACHE_MAX) {
    // Map iterates in insertion order — drop the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return NextResponse.json({ suggestions, provider: activeProvider() });
}
