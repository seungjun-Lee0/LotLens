// Browser side of the bulk-PDF ZIP stream (see lib/bulk-pdf-stream for the
// line protocol). Used by the admin bulk importer and the "My reports"
// multi-select download.
//
// The ZIP arrives as base64 chunks (zip-start → many zip-chunk → zip-end)
// so the server never holds the whole archive in memory. Each chunk is
// decoded to bytes AS IT ARRIVES and kept as a small Uint8Array: joining
// every chunk into one ~170 MB base64 string and running a single atob +
// per-byte Uint8Array.from over ~130 MB froze the tab on a 40-report
// batch; a Blob built from an array of small chunks streams to disk
// instead. (Server flushes each chunk on a 3-byte boundary, so each
// decodes independently.)

export type BulkPdfProgress =
  | { phase: "rendering"; done: number; total: number }
  | { phase: "zipping"; count: number };

export type BulkPdfResult = {
  /** Object URL of the finished archive. Caller revokes it when done. */
  url: string;
  filename: string;
  /** Reports that rendered into the ZIP. */
  rendered: number;
  /** Reports the server skipped or failed on. */
  failed: number;
};

type Line =
  | { type: "start"; total: number }
  | { type: "result"; ok: boolean; reportId: string; error?: string }
  | { type: "zipping"; count: number }
  | { type: "zip-start"; count: number; filename: string }
  | { type: "zip-chunk"; data: string }
  | { type: "zip-end" }
  | { type: "error"; error: string };

export async function downloadBulkPdfZip(opts: {
  endpoint: string;
  reportIds: string[];
  signal?: AbortSignal;
  onProgress?: (p: BulkPdfProgress) => void;
}): Promise<BulkPdfResult> {
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportIds: opts.reportIds }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const zipParts: Uint8Array[] = [];
  let buf = "";
  let total = opts.reportIds.length;
  let done = 0;
  let rendered = 0;
  let failed = 0;
  let filename = "lotlens-reports.zip";
  let finished = false;

  for (;;) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      const evt = JSON.parse(l) as Line;
      switch (evt.type) {
        case "start":
          total = evt.total;
          break;
        case "result":
          done += 1;
          if (evt.ok) rendered += 1;
          else failed += 1;
          opts.onProgress?.({ phase: "rendering", done, total });
          break;
        case "zipping":
          opts.onProgress?.({ phase: "zipping", count: evt.count });
          break;
        case "zip-start":
          filename = evt.filename;
          break;
        case "zip-chunk": {
          const bin = atob(evt.data);
          const bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          zipParts.push(bytes);
          break;
        }
        case "zip-end":
          finished = true;
          break;
        case "error":
          throw new Error(evt.error);
      }
    }
  }
  if (!finished) throw new Error("download ended before the archive was complete");

  // Blob from the array of decoded chunks — no giant string.
  const url = URL.createObjectURL(
    new Blob(zipParts as BlobPart[], { type: "application/zip" }),
  );
  return { url, filename, rendered, failed };
}

/**
 * Best-effort automatic download. Browsers block a second automatic
 * download from the same page, and a click this long after the original
 * button press may no longer count as a user gesture — callers should
 * ALSO surface a manual link to `url`, which always works.
 */
export function triggerDownload(url: string, filename: string): void {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    /* manual link is the guaranteed path */
  }
}
