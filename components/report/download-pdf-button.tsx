"use client";

// The PDF is assembled server-side: one tile pass per module map, sharp
// compositing, then renderToBuffer. Nothing reaches the browser until the
// whole document is finished, so a plain <a href> spends those seconds
// looking like a dead link and invites a second click (which starts a
// second render).
//
// Fetching it ourselves buys the spinner, and the blob hand-off keeps the
// browser's own "save file" behaviour intact.

import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";

export function DownloadPdfButton({
  reportId,
  filename,
}: {
  reportId: string;
  /** Falls back to the Content-Disposition name the route already sets. */
  filename?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A download that outlives the component would leak its object URL and
  // setState on an unmounted node; both are cleaned up here.
  const objectUrl = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    return () => {
      alive.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/report/${reportId}/pdf`);
      if (!res.ok) {
        // The route answers JSON on 402/403/404 and a PDF otherwise.
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `Download failed (${res.status})`);
      }

      // Prefer the filename the server chose: it carries the address.
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];

      const blob = await res.blob();
      if (!alive.current) return;

      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const a = document.createElement("a");
      a.href = url;
      a.download = named ?? filename ?? "lotlens-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick: doing it synchronously races the click in
      // Safari and produces an empty file.
      setTimeout(() => {
        URL.revokeObjectURL(url);
        if (objectUrl.current === url) objectUrl.current = null;
      }, 60_000);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="glass inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full px-4 text-[13px] font-medium text-foreground/80 transition hover:text-foreground disabled:cursor-progress disabled:opacity-70 sm:self-end sm:text-[13.5px]"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        {busy ? "Preparing PDF…" : "Download PDF"}
      </button>
      {error && (
        <p className="text-[11.5px] text-[var(--apple-red)]">{error}</p>
      )}
    </div>
  );
}
