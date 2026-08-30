"use client";

// Admin-only bulk report generator. Paste addresses (one per line), submit,
// and watch each report generate live — the API streams NDJSON, one line per
// address, so long runs show progress instead of hanging.

import { useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FileArchive,
} from "lucide-react";

type Row = {
  address: string;
  status: "pending" | "ok" | "error";
  reportId?: string;
  displayName?: string;
  error?: string;
  ms?: number;
};

// null = idle; number = reports rendered into the ZIP so far; "zipping" =
// compressing the archive.
type ZipState =
  | { phase: "idle" }
  | { phase: "rendering"; done: number; total: number }
  | { phase: "zipping"; count: number }
  | { phase: "ready"; url: string; filename: string }
  | { phase: "error"; message: string };

export function BulkImport() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [zip, setZip] = useState<ZipState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);
  // Object URL of the last built ZIP, revoked when a new one is built.
  const zipUrlRef = useRef<string | null>(null);

  const done = rows.filter((r) => r.status !== "pending").length;
  const okCount = rows.filter((r) => r.status === "ok").length;
  const errCount = rows.filter((r) => r.status === "error").length;
  const okReportIds = rows
    .filter((r) => r.status === "ok" && r.reportId)
    .map((r) => r.reportId!);
  const zipBusy = zip.phase === "rendering" || zip.phase === "zipping";

  async function run() {
    const addresses = [
      ...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean)),
    ];
    if (addresses.length === 0 || running) return;
    setRunning(true);
    setRows(addresses.map((a) => ({ address: a, status: "pending" as const })));
    setTotal(addresses.length);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(`request failed (${res.status}) ${msg}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const evt = JSON.parse(l) as
            | { type: "start"; total: number }
            | { type: "done" }
            | {
                type: "result";
                i: number;
                address: string;
                ok: boolean;
                reportId?: string;
                displayName?: string;
                error?: string;
                ms?: number;
              };
          if (evt.type === "result") {
            setRows((prev) => {
              const next = [...prev];
              next[evt.i] = {
                address: evt.address,
                status: evt.ok ? "ok" : "error",
                reportId: evt.reportId,
                displayName: evt.displayName,
                error: evt.error,
                ms: evt.ms,
              };
              return next;
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setRows((prev) =>
          prev.map((r) =>
            r.status === "pending"
              ? { ...r, status: "error", error: (err as Error).message }
              : r,
          ),
        );
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  // Bundle every successfully-generated report's PDF into one ZIP. Streams
  // NDJSON progress (a live "N / total" render counter) then a final line
  // carrying the base64 ZIP, which we turn into a download.
  async function downloadZip() {
    if (okReportIds.length === 0 || zipBusy) return;
    // Drop any previously built ZIP so we don't leak object URLs.
    if (zipUrlRef.current) {
      URL.revokeObjectURL(zipUrlRef.current);
      zipUrlRef.current = null;
    }
    setZip({ phase: "rendering", done: 0, total: okReportIds.length });
    const ac = new AbortController();
    zipAbortRef.current = ac;
    try {
      const res = await fetch("/api/admin/bulk-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds: okReportIds }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(`request failed (${res.status}) ${msg}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let doneCount = 0;
      // The ZIP arrives as base64 chunks (zip-start → many zip-chunk →
      // zip-end) so the server never holds the whole archive in memory.
      let zipName = "lotlens-reports.zip";
      // Decode each base64 chunk to bytes AS IT ARRIVES and keep the small
      // Uint8Array pieces. Joining every chunk into one ~170 MB base64
      // string and running a single atob + per-byte Uint8Array.from over
      // ~130 MB froze the tab on a 40-report batch; a Blob built from an
      // array of small chunks streams to disk instead. (Server flushes each
      // chunk on a 3-byte boundary, so each decodes independently.)
      const zipParts: Uint8Array[] = [];
      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const evt = JSON.parse(l) as
            | { type: "start"; total: number }
            | { type: "result"; ok: boolean }
            | { type: "zipping"; count: number }
            | { type: "zip-start"; count: number; filename: string }
            | { type: "zip-chunk"; data: string }
            | { type: "zip-end" }
            | { type: "error"; error: string };
          if (evt.type === "result") {
            doneCount += 1;
            setZip({
              phase: "rendering",
              done: doneCount,
              total: okReportIds.length,
            });
          } else if (evt.type === "zipping") {
            setZip({ phase: "zipping", count: evt.count });
          } else if (evt.type === "error") {
            throw new Error(evt.error);
          } else if (evt.type === "zip-start") {
            zipName = evt.filename;
          } else if (evt.type === "zip-chunk") {
            const bin = atob(evt.data);
            const bytes = new Uint8Array(bin.length);
            for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
            zipParts.push(bytes);
          } else if (evt.type === "zip-end") {
            // Blob from the array of decoded chunks — no giant string.
            const url = URL.createObjectURL(
              new Blob(zipParts as BlobPart[], { type: "application/zip" }),
            );
            zipUrlRef.current = url;
            // Best-effort auto-download. Browsers block a second automatic
            // download from the same page, and a click this long after the
            // original button press may no longer count as a user gesture —
            // so we ALSO surface a manual link (phase "ready") that always
            // works.
            try {
              const a = document.createElement("a");
              a.href = url;
              a.download = zipName;
              document.body.appendChild(a);
              a.click();
              a.remove();
            } catch {
              /* manual link below is the guaranteed path */
            }
            setZip({ phase: "ready", url, filename: zipName });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setZip({ phase: "error", message: (err as Error).message });
      } else {
        setZip({ phase: "idle" });
      }
    } finally {
      zipAbortRef.current = null;
    }
  }

  return (
    <div className="glass rounded-2xl p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Bulk report import</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        One address per line. Each is geocoded and a full report is generated
        and stored. Runs sequentially — a large batch can take a while.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
        rows={7}
        spellCheck={false}
        placeholder={"12 Oxley Rd, Graceville QLD\n33 Heath St, East Brisbane\n…"}
        className="mt-4 w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2 font-mono text-[12.5px] outline-none focus:border-foreground/30"
      />

      <div className="mt-3 flex items-center gap-3">
        {!running ? (
          <button
            type="button"
            onClick={run}
            disabled={text.trim().length === 0}
            className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition hover:brightness-105 disabled:opacity-50"
            style={{
              background:
                "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
            }}
          >
            Generate reports
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-[13px] font-medium transition hover:bg-foreground/5"
          >
            <Loader2 className="size-4 animate-spin" />
            Stop
          </button>
        )}
        {total > 0 && (
          <span className="text-[12.5px] text-muted-foreground">
            {done}/{total} done · {okCount} ok · {errCount} failed
          </span>
        )}
      </div>

      {!running && okReportIds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadZip}
            disabled={zipBusy}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-[13px] font-medium transition hover:bg-foreground/5 disabled:opacity-60"
          >
            {zipBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileArchive className="size-4" />
            )}
            Download all as ZIP ({okReportIds.length})
          </button>
          {/* Live counter: how many reports have been rendered into the ZIP. */}
          {zip.phase === "rendering" && (
            <span className="text-[12.5px] tabular-nums text-muted-foreground">
              Rendering {zip.done}/{zip.total} reports…
            </span>
          )}
          {zip.phase === "zipping" && (
            <span className="text-[12.5px] tabular-nums text-muted-foreground">
              Compressing {zip.count} reports…
            </span>
          )}
          {zip.phase === "error" && (
            <span className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
              {zip.message}
            </span>
          )}
          {/* Guaranteed manual download: the auto-click above can be blocked
              by the browser (repeat download / stale gesture), so once the
              ZIP is built we always offer a real link the user can click. */}
          {zip.phase === "ready" && (
            <a
              href={zip.url}
              download={zip.filename}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium text-white transition hover:brightness-105"
              style={{ background: "var(--apple-green)" }}
            >
              <FileArchive className="size-4" />
              Save {zip.filename}
            </a>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li
              key={`${i}-${r.address}`}
              className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-[12.5px]"
            >
              {r.status === "pending" && (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {r.status === "ok" && (
                <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--apple-green)" }} />
              )}
              {r.status === "error" && (
                <XCircle className="size-4 shrink-0" style={{ color: "var(--apple-red)" }} />
              )}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.displayName ?? r.address}</span>
                {r.status === "error" && (
                  <span className="text-muted-foreground"> — {r.error}</span>
                )}
              </span>
              {r.ms != null && r.status !== "pending" && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {(r.ms / 1000).toFixed(1)}s
                </span>
              )}
              {r.reportId && (
                <a
                  href={`/report/${r.reportId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground transition hover:text-foreground"
                  title="Open report"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
