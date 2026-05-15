// POST /api/geocode/suggest
// Body: { query: string }
// Returns up to 5 Nominatim matches inside the Brisbane LGA viewbox.
// Used by the address-form dropdown — does NOT touch Supabase, never
// inserts anything. Cheaper and faster than /api/geocode.

import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({ query: z.string().min(2).max(200) });

// Same bbox as /api/geocode — keep them in sync.
const BBOX = { lonMin: 152.65, latMin: -27.75, lonMax: 153.30, latMax: -27.20 };
const NOMINATIM_UA =
  "PropAI/0.1 Brisbane-DD-prototype (contact: jun@propai.dev)";

type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  place_id?: number;
  type?: string;
  class?: string;
};

export type Suggestion = {
  id: string;
  displayName: string;
  lat: number;
  lng: number;
  /** First component of display_name — usually street / place. */
  primary: string;
  /** Rest, joined with comma — suburb, state, postcode. */
  secondary: string;
};

function splitDisplayName(s: string): { primary: string; secondary: string } {
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const primary = parts[0] ?? s;
  const secondary = parts.slice(1, 4).join(", ");
  return { primary, secondary };
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ suggestions: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", parsed.query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "5");
  url.searchParams.set(
    "viewbox",
    `${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`,
  );
  url.searchParams.set("bounded", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "en-AU,en" },
    });
    if (!res.ok) return NextResponse.json({ suggestions: [] });
    const rows = (await res.json()) as NominatimRow[];
    const suggestions: Suggestion[] = rows.map((r) => {
      const { primary, secondary } = splitDisplayName(r.display_name);
      return {
        id: `${r.place_id ?? `${r.lat},${r.lon}`}`,
        displayName: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        primary,
        secondary,
      };
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
