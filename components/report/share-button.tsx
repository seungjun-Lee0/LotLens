"use client";

// "Share" on a report: one click mints a read-only link (lib/share) and
// shows it with a QR code, so the owner can hand the report to a partner
// or a conveyancer, or let someone scan it off their screen at an open
// home. The link works without an account for 90 days.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, QrCode, Share2, X } from "lucide-react";

type ShareState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; url: string; qr: string; expiresIn: string }
  | { phase: "error"; message: string };

export function ShareButton({
  reportId,
  addressLabel,
}: {
  reportId: string;
  /** Used for the native share sheet title and the QR filename. */
  addressLabel: string;
}) {
  const [state, setState] = useState<ShareState>({ phase: "idle" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    return () => {
      alive.current = false;
    };
  }, []);

  async function share() {
    setOpen(true);
    if (state.phase === "ready" || state.phase === "loading") return;
    setState({ phase: "loading" });
    try {
      const res = await fetch(`/api/report/${reportId}/share`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; qr?: string; expiresIn?: string; error?: string }
        | null;
      if (!res.ok || !body?.url || !body.qr) {
        throw new Error(body?.error ?? `Couldn't create a link (${res.status})`);
      }
      if (alive.current) {
        setState({ phase: "ready", url: body.url, qr: body.qr, expiresIn: body.expiresIn ?? "90 days" });
      }
    } catch (err) {
      if (alive.current) setState({ phase: "error", message: (err as Error).message });
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (http, permissions): the field below is selectable.
    }
  }

  async function nativeShare(url: string) {
    if (!navigator.share) return copy(url);
    try {
      await navigator.share({ title: `LotLens report · ${addressLabel}`, url });
    } catch {
      // user dismissed the sheet
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={share}
        className="glass inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium text-foreground/80 transition hover:text-foreground sm:text-[13.5px]"
      >
        <Share2 className="size-4" />
        Share
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Share this report"
          className="glass-strong absolute right-0 top-12 z-30 w-[min(92vw,360px)] rounded-2xl p-4 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13.5px] font-semibold">Share this report</div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                Anyone with the link can read it, no account needed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          {state.phase === "loading" && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {state.phase === "error" && (
            <p className="mt-3 text-[12.5px] text-[var(--apple-red)]">{state.message}</p>
          )}
          {state.phase === "ready" && (
            <>
              <div className="mt-3 flex justify-center rounded-xl bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.qr} alt="QR code for the share link" width={200} height={200} className="size-[200px]" />
              </div>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
                <QrCode className="size-3.5" />
                Scan with a phone camera · link valid for {state.expiresIn}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                <input
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-2.5 text-[12px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => copy(state.url)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-white"
                  style={{ background: copied ? "var(--apple-green)" : "var(--apple-blue)" }}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2 flex gap-1.5">
                <a
                  href={state.qr}
                  download={`lotlens-share-${addressLabel.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.png`}
                  className="glass inline-flex h-8 flex-1 items-center justify-center rounded-full text-[12px] font-medium"
                >
                  Save QR image
                </a>
                <button
                  type="button"
                  onClick={() => nativeShare(state.url)}
                  className="glass inline-flex h-8 flex-1 items-center justify-center rounded-full text-[12px] font-medium"
                >
                  Send…
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
