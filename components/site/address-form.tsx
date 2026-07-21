"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Suggestion } from "@/app/api/geocode/suggest/route";

const STEPS = [
  { key: "geocode",  label: "Locating address",            tint: "var(--apple-blue)" },
  { key: "overlays", label: "Pulling council overlay data", tint: "var(--apple-orange)" },
  { key: "narrative", label: "Generating narrative",        tint: "var(--apple-purple)" },
  { key: "render",   label: "Preparing your report",       tint: "var(--apple-green)" },
] as const;
type StepKey = typeof STEPS[number]["key"];

type Phase = "idle" | "running" | "error" | "done";

export type AddressPreset = {
  label: string;
  address: string;
  /** CSS color expression for the chip accent. */
  tint?: string;
};

export function AddressForm({
  initial = "",
  presets,
}: {
  initial?: string;
  presets?: AddressPreset[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<StepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Suggestions state — debounced fetch on input change.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  // Tracks the address we last *selected* so re-rendering doesn't immediately
  // re-suggest the same string while typing-by-pick.
  const lastPickedRef = useRef<string>("");
  // Session cache: repeat queries (backspacing, re-typing) render instantly
  // without a network round-trip.
  const suggestCacheRef = useRef(new Map<string, Suggestion[]>());
  // The dropdown renders through a portal with fixed positioning — both
  // hosts of this form (hero, CTA card) sit inside overflow-clipped
  // containers that would otherwise cut it off.
  const dropRef = useRef<HTMLDivElement | null>(null);

  function applyPreset(addr: string) {
    setValue(addr);
    lastPickedRef.current = addr;
    setSuggestOpen(false);
    inputRef.current?.focus();
  }

  function applySuggestion(s: Suggestion) {
    setValue(s.displayName);
    lastPickedRef.current = s.displayName;
    setSuggestOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  // Debounced /api/geocode/suggest fetch. Cache hits render immediately.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || phase !== "idle" || q === lastPickedRef.current) {
      setSuggestions([]);
      return;
    }
    const cached = suggestCacheRef.current.get(q.toLowerCase());
    if (cached) {
      setSuggestions(cached);
      setSuggestOpen(true);
      setActiveIdx(-1);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const res = await fetch("/api/geocode/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const body = (await res.json()) as { suggestions: Suggestion[] };
        const list = body.suggestions ?? [];
        suggestCacheRef.current.set(q.toLowerCase(), list);
        setSuggestions(list);
        setSuggestOpen(true);
        setActiveIdx(-1);
      } catch {
        /* aborted or net err */
      } finally {
        setSuggestLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [value, phase]);

  // Close suggestions on outside click (the portal counts as inside).
  useEffect(() => {
    if (!suggestOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !dropRef.current?.contains(t)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [suggestOpen]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      applySuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  }

  // One straight run: geocode → overlays → narrative → navigate.
  async function submit() {
    const address = value.trim();
    if (!address) return;
    setSuggestOpen(false);
    setPhase("running");
    setError(null);

    try {
      setStep("geocode");
      const geo = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const geoBody = await geo.json();
      if (!geo.ok) throw new Error(geoBody.error ?? "geocoding failed");
      const addressId: string = geoBody.addressId;

      setStep("overlays");
      const fo = await fetch("/api/fetch-overlays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId }),
      });
      const foBody = await fo.json();
      if (!fo.ok) throw new Error(foBody.error ?? "overlay fetch failed");

      setStep("narrative");
      const gn = await fetch("/api/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId }),
      });
      const gnBody = await gn.json();
      if (!gn.ok) throw new Error(gnBody.error ?? "narrative generation failed");

      // Stay in "running" on the final step — the spinner keeps going while
      // Next.js loads the report route (the loading.tsx skeleton takes over
      // once navigation commits, and this component unmounts).
      setStep("render");
      router.push(`/report/${gnBody.reportId}`);
    } catch (err) {
      setPhase("error");
      setError((err as Error).message);
    }
  }

  const isBusy = phase === "running";
  const showDropdown =
    suggestOpen && phase === "idle" && (suggestions.length > 0 || suggestLoading);

  // Anchor the portal dropdown under the search pill. Position is written
  // straight to the portal's style (before paint, so it never flashes at
  // 0,0) and refreshed on resize; scrolling just closes the dropdown
  // (standard combobox behaviour) so a fixed box can never drift from its
  // anchor.
  useLayoutEffect(() => {
    if (!showDropdown) return;
    const el = wrapRef.current;
    const dd = dropRef.current;
    if (!el || !dd) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      dd.style.left = `${r.left}px`;
      dd.style.top = `${r.top + 64}px`;
      dd.style.width = `${r.width}px`;
      dd.style.visibility = "visible";
    };
    update();
    window.addEventListener("resize", update);
    const onScroll = () => setSuggestOpen(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", onScroll);
    };
  }, [showDropdown]);

  return (
    <div ref={wrapRef} className="relative flex w-full max-w-2xl flex-col items-center gap-4">
      <form
        className="glass-strong flex w-full items-center gap-2 rounded-full p-2 pl-4 sm:pl-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isBusy) submit();
        }}
      >
        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            lastPickedRef.current = "";
          }}
          onFocus={() => {
            if (suggestions.length > 0) setSuggestOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="e.g. 12 Oxley Rd, Graceville QLD 4075"
          disabled={isBusy}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          className="h-11 flex-1 min-w-0 border-0 bg-transparent px-2 text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent sm:text-[15px]"
          aria-label="Queensland address"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isBusy || value.trim().length === 0}
          className="h-11 shrink-0 rounded-full px-4 text-[13.5px] font-medium text-white disabled:opacity-70 sm:px-5 sm:text-[14px]"
          style={{
            background:
              "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
            boxShadow:
              "0 8px 20px -8px color-mix(in oklab, var(--apple-blue) 70%, transparent)",
          }}
        >
          {isBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span className="hidden sm:inline">Working</span>
            </>
          ) : (
            <>
              <span className="hidden sm:inline">Run report</span>
              <span className="sm:hidden">Run</span>
              <ArrowRight className="ml-1 size-4" />
            </>
          )}
        </Button>
      </form>

      {/* Suggestions dropdown — portalled to <body> so the hero's
          overflow-clip / the CTA card's overflow-hidden can't cut it off. */}
      {showDropdown && createPortal(
        <div
          ref={dropRef}
          role="listbox"
          style={{ position: "fixed", zIndex: 80, visibility: "hidden" }}
          className="glass-strong rounded-2xl p-1.5"
        >
          {/* Inner scroller: keeps the scrollbar inside the padding, clear
              of the rounded corners. ~4 rows tall (each row ≈ 56px). */}
          <div className="glass-scroll max-h-[232px] overflow-y-auto pr-1">
          {suggestLoading && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Searching Queensland addresses…
            </div>
          ) : (
            <ul className="flex flex-col">
              {suggestions.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => applySuggestion(s)}
                    className={
                      "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition " +
                      (i === activeIdx
                        ? "bg-foreground/5"
                        : "hover:bg-foreground/5")
                    }
                  >
                    <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-foreground">
                        {s.primary}
                      </span>
                      {s.secondary && (
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {s.secondary}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
          {/* Places API ToS: autocomplete shown without a Google map must
              carry Google attribution near the results. */}
          {suggestions.some((s) => s.id.startsWith("g:")) && (
            <div className="px-3 pb-1 pt-1.5 text-right text-[10px] text-muted-foreground/70">
              Powered by Google
            </div>
          )}
        </div>,
        document.body,
      )}

      {presets && presets.length > 0 && phase === "idle" && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px] sm:text-[13px]">
          {/* over the hero aerial: light mode needs near-foreground ink */}
          <span className="text-foreground/75 dark:text-muted-foreground">Try one of ours —</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.address)}
              className="glass-tint rounded-full px-3 py-1.5 font-medium transition hover:brightness-105"
              style={{ ["--tint" as string]: p.tint ?? "var(--apple-blue)" }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {(isBusy || phase === "error" || phase === "done") && (
        <div className="glass w-full rounded-2xl px-5 py-4 text-[13px]">
          {phase === "error" ? (
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 size-2 shrink-0 rounded-full"
                style={{ background: "var(--apple-red)" }}
              />
              <div>
                <div className="font-medium text-foreground">Something went wrong</div>
                <div className="mt-0.5 text-muted-foreground">{error}</div>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {STEPS.map((s) => {
                const active = step === s.key && phase === "running";
                const done =
                  phase === "done" ||
                  STEPS.findIndex((x) => x.key === step) > STEPS.findIndex((x) => x.key === s.key);
                return (
                  <li key={s.key} className="flex items-center gap-3">
                    {active ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" style={{ color: s.tint }} />
                    ) : (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          background: done ? s.tint : "var(--muted-foreground)",
                          opacity: done ? 1 : 0.3,
                        }}
                      />
                    )}
                    <span
                      className={
                        active
                          ? "font-medium text-foreground"
                          : done
                            ? "text-foreground/80"
                            : "text-muted-foreground"
                      }
                    >
                      {s.label}
                      {active ? "…" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
