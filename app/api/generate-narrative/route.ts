// POST /api/generate-narrative
// Body: { addressId: string }
// Reads council_data for the address, generates a narrative per module
// (LLM stub in Task 4a — see lib/anthropic.ts), and writes one new
// reports row. Returns { reportId, narrative }.

import { NextResponse } from "next/server";
import { z } from "zod";

import { generateReportForAddress } from "@/lib/pipeline";

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
    const result = await generateReportForAddress(parsed.addressId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
