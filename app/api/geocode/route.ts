// POST /api/geocode
// Body: { address: string }
// Geocodes a Queensland address. Google Maps Geocoding (best AU
// unit / apartment resolution) when GOOGLE_GEOCODING_API_KEY is set,
// then the QLD Government composite locator, then Nominatim. Reuses an
// existing addresses row when the resolved display name matches;
// otherwise inserts a new row.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocoder";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({ address: z.string().min(3).max(300) });

export async function POST(req: Request) {
  // Full geocodes are one-per-report-flow; 30 per 10 min per IP is ample
  // for a human and stops scripted scraping of the geocoder.
  const limited = enforceRateLimit("geocode", req, { limit: 30, windowSec: 600 });
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

  let hit: { lat: number; lng: number; displayName: string } | null;
  try {
    hit = await geocodeAddress(parsed.address);
  } catch (err) {
    console.error("[geocode] provider error:", err);
    return NextResponse.json(
      { error: `geocoder error: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (!hit) {
    return NextResponse.json(
      {
        error:
          "Address not found in Queensland. Try a more specific street address (e.g. \"12 Oxley Rd, Graceville QLD\").",
      },
      { status: 404 },
    );
  }

  const lat = hit.lat;
  const lng = hit.lng;

  // Reuse an existing addresses row when display_name matches exactly,
  // else insert a new one. Avoids piling up duplicate rows on demo replays.
  let addressId: string;
  try {
    const sql = getDb();
    const existing = (await sql`
      SELECT id FROM addresses WHERE address_text = ${hit.displayName} LIMIT 1
    `) as Array<{ id: string }>;
    if (existing.length > 0) {
      addressId = existing[0].id;
    } else {
      const inserted = (await sql`
        INSERT INTO addresses (address_text, lat, lng)
        VALUES (${hit.displayName}, ${lat}, ${lng})
        RETURNING id
      `) as Array<{ id: string }>;
      addressId = inserted[0].id;
    }
  } catch (err) {
    console.error("[geocode] db failed:", err);
    return NextResponse.json(
      { error: `db setup failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    addressId,
    lat,
    lng,
    displayName: hit.displayName,
  });
}
