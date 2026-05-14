// POST /api/fetch-overlays
// Body: { addressId: string }
// Runs all 5 ArcGIS module fetches for the address and writes results to
// council_data. Idempotent: existing rows for the address are replaced.

import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchOverlaysForAddress } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 5 modules × (point + envelope) = 10 ArcGIS calls in parallel. Usually
// 1-3 s; allow a wide safety margin for tile / endpoint slowness.
export const maxDuration = 60;

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
