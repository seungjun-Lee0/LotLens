// POST /api/admin/bulk-import — admin-only bulk report generation.
//
// Body: { addresses: string[] } (free-text, one per line on the client).
// Streams one NDJSON line per address as it completes so the admin sees
// live progress instead of waiting on a single long request. Addresses are
// processed SEQUENTIALLY: each report already fans ~18 queries at the QLD
// servers, so running reports in parallel would just amplify the load the
// per-host concurrency cap is there to contain.

import { getSessionUser, isAdmin } from "@/lib/auth";
import { generateReportForQuery } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps serverless functions at 300 s. At ~7 s per address
// that bounds one run to roughly 40 addresses — the NDJSON stream still
// delivers every line that finished in time, so a bigger paste just needs
// a second run for the remainder.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: "admin only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let addresses: string[];
  try {
    const body = (await req.json()) as { addresses?: unknown };
    addresses = Array.isArray(body.addresses)
      ? body.addresses.map((a) => String(a).trim()).filter(Boolean)
      : [];
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (addresses.length === 0) {
    return new Response(JSON.stringify({ error: "no addresses" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // De-dupe while preserving order.
  addresses = [...new Set(addresses)];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      line({ type: "start", total: addresses.length });
      for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i];
        const t0 = Date.now();
        try {
          const { reportId, displayName } = await generateReportForQuery(
            address,
            user!.id,
          );
          line({
            type: "result",
            i,
            address,
            ok: true,
            reportId,
            displayName,
            ms: Date.now() - t0,
          });
        } catch (err) {
          line({
            type: "result",
            i,
            address,
            ok: false,
            error: (err as Error).message,
            ms: Date.now() - t0,
          });
        }
      }
      line({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
