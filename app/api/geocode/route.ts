// POST /api/geocode
// Body: { address: string }
// Geocodes a free-text Brisbane LGA address via OSM Nominatim, restricted
// to the Brisbane LGA bounding box. Reuses an existing addresses row when
// the resolved display_name matches; otherwise inserts a new row.
//
// Nominatim usage policy compliance: User-Agent header (project + contact),
// max 1 req/s. Restaurant-demo traffic stays well inside fair use.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ address: z.string().min(3).max(300) });

// Brisbane LGA approximate bbox. Nominatim viewbox order: lon_min,lat_min,lon_max,lat_max.
const BRISBANE_BBOX = {
  lonMin: 152.65,
  latMin: -27.75,
  lonMax: 153.30,
  latMax: -27.20,
};

const NOMINATIM_UA =
  "PropAI/0.1 Brisbane-DD-prototype (https://github.com/propai - contact: jun@propai.dev)";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    county?: string;
  };
};

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

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", parsed.address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "1");
  url.searchParams.set(
    "viewbox",
    `${BRISBANE_BBOX.lonMin},${BRISBANE_BBOX.latMin},${BRISBANE_BBOX.lonMax},${BRISBANE_BBOX.latMax}`,
  );
  url.searchParams.set("bounded", "1");

  let results: NominatimResult[];
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": NOMINATIM_UA,
        "Accept-Language": "en-AU,en",
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `geocoder ${res.status}` },
        { status: 502 },
      );
    }
    results = (await res.json()) as NominatimResult[];
  } catch (err) {
    return NextResponse.json(
      { error: `geocoder error: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (results.length === 0) {
    return NextResponse.json(
      {
        error:
          "Address not found inside Brisbane LGA. Try a more specific Brisbane street address (e.g. \"12 Oxley Rd, Graceville\").",
      },
      { status: 404 },
    );
  }

  const hit = results[0];
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "geocoder returned non-numeric coords" }, { status: 502 });
  }

  // Reuse an existing addresses row when display_name matches exactly,
  // else insert a new one. Avoids piling up duplicate rows on demo replays.
  const sb = getServerSupabase();
  const { data: existing } = await sb
    .from("addresses")
    .select("id")
    .eq("address_text", hit.display_name)
    .maybeSingle();

  let addressId: string;
  if (existing?.id) {
    addressId = existing.id;
  } else {
    const ins = await sb
      .from("addresses")
      .insert({ address_text: hit.display_name, lat, lng })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      return NextResponse.json(
        { error: `failed to persist address: ${ins.error?.message}` },
        { status: 500 },
      );
    }
    addressId = ins.data.id;
  }

  return NextResponse.json({
    addressId,
    lat,
    lng,
    displayName: hit.display_name,
  });
}
