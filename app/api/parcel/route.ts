// POST /api/parcel
// Body: { lat: number, lng: number }
// Returns the DCDB cadastre parcel at the point — polygon + lot/plan +
// area + tenure + suburb + LGA. Drives the "is this the right lot?"
// confirmation step between geocoding and running the report, so a bad
// geocode (road centreline, wrong number) is caught BEFORE ~25 upstream
// fetches and a narrative run are spent on it.

import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchPropertyParcel } from "@/lib/property";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  lat: z.number().min(-29.5).max(-9),   // Queensland bounds, roughly
  lng: z.number().min(137.9).max(154.5),
});

export async function POST(req: Request) {
  const limited = enforceRateLimit("parcel", req, { limit: 30, windowSec: 600 });
  if (limited) return limited;

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid body", details: String(err) },
      { status: 400 },
    );
  }

  // Never throws — returns an EMPTY parcel (all nulls) when the lookup
  // misses; the client treats polygon:null as "couldn't identify the lot".
  const parcel = await fetchPropertyParcel(parsed.lat, parsed.lng);
  return NextResponse.json({ parcel });
}
