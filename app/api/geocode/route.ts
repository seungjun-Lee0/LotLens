// POST /api/geocode
// Body: { address: string }
// Geocodes a Brisbane LGA address. Google Maps Geocoding (best AU
// unit / apartment resolution) when GOOGLE_GEOCODING_API_KEY is set,
// Nominatim fallback otherwise. Reuses an existing addresses row when
// the resolved display name matches; otherwise inserts a new row.

import { NextResponse } from "next/server";
import { z } from "zod";

import { geocodeAddress } from "@/lib/geocoder";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({ address: z.string().min(3).max(300) });

export async function POST(req: Request) {
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
          "Address not found inside Brisbane LGA. Try a more specific Brisbane street address (e.g. \"12 Oxley Rd, Graceville\").",
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
    const sb = getServerSupabase();
    const { data: existing, error: selErr } = await sb
      .from("addresses")
      .select("id")
      .eq("address_text", hit.displayName)
      .maybeSingle();
    if (selErr) {
      console.error("[geocode] select failed:", selErr);
      return NextResponse.json(
        { error: `db read failed: ${selErr.message}` },
        { status: 500 },
      );
    }
    if (existing?.id) {
      addressId = existing.id;
    } else {
      const ins = await sb
        .from("addresses")
        .insert({ address_text: hit.displayName, lat, lng })
        .select("id")
        .single();
      if (ins.error || !ins.data) {
        console.error("[geocode] insert failed:", ins.error);
        return NextResponse.json(
          { error: `failed to persist address: ${ins.error?.message}` },
          { status: 500 },
        );
      }
      addressId = ins.data.id;
    }
  } catch (err) {
    console.error("[geocode] supabase setup failed:", err);
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
