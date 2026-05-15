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

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ suggestions: [], provider: activeProvider() });
  }
  const suggestions = await suggestAddresses(parsed.query);
  return NextResponse.json({ suggestions, provider: activeProvider() });
}
