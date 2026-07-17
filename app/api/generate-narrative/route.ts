// POST /api/generate-narrative
// Body: { addressId: string }
// Reads council_data for the address, generates a narrative per module
// (LLM stub in Task 4a — see lib/anthropic.ts), and writes one new
// reports row. Returns { reportId, narrative }.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth";
import { generateReportForAddress } from "@/lib/pipeline";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Currently fast (LLM stub). Set high so swapping in a real Anthropic
// call later doesn't require route surgery.
export const maxDuration = 60;

const BodySchema = z.object({ addressId: z.string().uuid() });

export async function POST(req: Request) {
  // Will call the Anthropic API once Task ④ lands — keep the same ceiling
  // as the fetch pipeline it always follows.
  const limited = enforceRateLimit("generate-narrative", req, { limit: 5, windowSec: 600 });
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
  try {
    const user = await getSessionUser();
    const result = await generateReportForAddress(parsed.addressId, user?.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[generate-narrative] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
