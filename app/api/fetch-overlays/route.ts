// POST /api/fetch-overlays
// Body: { addressId: string }
// Runs all 5 ArcGIS module fetches for the address and writes results to
// council_data. Idempotent: existing rows for the address are replaced.

import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchOverlaysForAddress } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ addressId: z.string().uuid() });

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
  try {
    const summary = await fetchOverlaysForAddress(parsed.addressId);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
