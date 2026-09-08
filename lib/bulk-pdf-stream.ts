// Bundle several reports' PDFs into one ZIP, streamed as NDJSON progress.
//
// Shared by the admin bulk importer (/api/admin/bulk-pdf) and the "My
// reports" multi-select download (/api/reports/bulk-pdf): each route does
// its own authorisation and hands the vetted ids here.
//
// Renders each report's PDF SEQUENTIALLY (each render fans map-tile fetches
// + a sharp composite; parallel renders would spike memory and the tile
// host) and streams NDJSON progress while building the archive in memory,
// then emits the finished ZIP as base64 chunks so the client can show a
// live "N / total" counter instead of staring at a stalled download.
//
// Line protocol (one JSON object per line):
//   {type:"start", total}
//   {type:"result", i, reportId, ok, filename?|error?}   ×N
//   {type:"zipping", count}
//   {type:"zip-start", count, filename}
//   {type:"zip-chunk", data}   ×M   (base64, each on a 3-byte boundary)
//   {type:"zip-end"}
//   {type:"error", error}      (instead of the zip lines when nothing rendered)

import JSZip from "jszip";

import { renderReportPdf } from "@/lib/render-report-pdf";

/** Each PDF is held in memory (~3 MB) until the ZIP streams out, and 60
 * reports ≈ 5 min of rendering — already brushing a 300 s route budget.
 * Beyond this, split into multiple requests. */
export const BULK_PDF_MAX_BATCH = 60;

export const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Parse `{ reportIds: string[] }` from a request body: trimmed, uuid-shaped,
 * de-duplicated in order. Returns null on a malformed body. */
export async function parseReportIds(req: Request): Promise<string[] | null> {
  try {
    const body = (await req.json()) as { reportIds?: unknown };
    const ids = Array.isArray(body.reportIds)
      ? body.reportIds.map((r) => String(r).trim()).filter((r) => UUID_RE.test(r))
      : [];
    return [...new Set(ids)];
  } catch {
    return null;
  }
}

export function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function streamBulkPdfZip(reportIds: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let rendered = 0;

      line({ type: "start", total: reportIds.length });

      for (let i = 0; i < reportIds.length; i++) {
        const reportId = reportIds[i];
        try {
          const out = await renderReportPdf(reportId);
          if (!out) {
            line({ type: "result", i, reportId, ok: false, error: "not found" });
            continue;
          }
          // Guarantee unique names inside the archive (two reports for the
          // same address would otherwise collide).
          let name = out.filename;
          if (usedNames.has(name)) {
            name = name.replace(/\.pdf$/i, `-${reportId.slice(0, 6)}.pdf`);
          }
          usedNames.add(name);
          zip.file(name, out.buffer);
          rendered += 1;
          line({ type: "result", i, reportId, ok: true, filename: name });
        } catch (err) {
          line({
            type: "result",
            i,
            reportId,
            ok: false,
            error: (err as Error).message,
          });
        }
      }

      if (rendered === 0) {
        line({ type: "error", error: "No reports could be rendered." });
        controller.close();
        return;
      }

      line({ type: "zipping", count: rendered });
      // Build the ZIP as a STORE (no-compression) STREAM, not a single
      // generateAsync() call. Two hard-won reasons:
      //   • DEFLATE gains ~nothing on a bag of PDFs (they're already
      //     JPEG-compressed inside) yet made JSZip balloon the heap by
      //     ~500 MB for just 6 reports — a 40-report batch OOMed here.
      //   • Streaming lets us base64-encode and flush in small chunks, so
      //     the whole binary ZIP and its base64 copy never coexist.
      // We stream base64 to the client as zip-chunk lines and accumulate
      // there, keeping this route's memory flat during delivery.
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `lotlens-reports-${ts}.zip`;
      line({ type: "zip-start", count: rendered, filename });
      await new Promise<void>((resolve, reject) => {
        // Carry the <3 leftover bytes between chunks so each base64 slice
        // stays on a 3-byte boundary and the pieces concatenate cleanly.
        let carry = Buffer.alloc(0);
        zip
          .generateInternalStream({ type: "uint8array", compression: "STORE" })
          .on("data", (data: Uint8Array) => {
            const buf = carry.length
              ? Buffer.concat([carry, Buffer.from(data)])
              : Buffer.from(data);
            const usable = buf.length - (buf.length % 3);
            if (usable > 0) {
              line({ type: "zip-chunk", data: buf.subarray(0, usable).toString("base64") });
            }
            carry = buf.subarray(usable);
          })
          .on("error", reject)
          .on("end", () => {
            if (carry.length) line({ type: "zip-chunk", data: carry.toString("base64") });
            line({ type: "zip-end" });
            resolve();
          })
          .resume();
      });
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
