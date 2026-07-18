"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Suggestion } from "@/app/api/geocode/suggest/route";
import type { ParcelInfo } from "@/lib/property";

// MapLibre only loads if the user actually reaches the lot-confirmation
// step — keeps it out of the landing bundle.
const ModuleMap = dynamic(
  () => import("@/components/report/module-map").then((m) => m.ModuleMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-56 w-full items-center justify-center rounded-2xl bg-foreground/5">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const STEPS = [
  { key: "geocode",  label: "Locating address",            tint: "var(--apple-blue)" },
  { key: "overlays", label: "Pulling council overlay data", tint: "var(--apple-orange)" },
  { key: "narrative", label: "Generating narrative",        tint: "var(--apple-purple)" },
  { key: "render",   label: "Preparing your report",       tint: "var(--apple-green)" },
] as const;
type StepKey = typeof STEPS[number]["key"];

// "confirm" = geocode + parcel resolved; waiting for the user to confirm
// the lot before the (paid-for, slow) overlay + narrative phases run.
type Phase = "idle" | "running" | "confirm" | "error" | "done";

type PendingLot = {
  addressId: string;
  lat: number;
  lng: number;
  displayName: string;
  parcel: ParcelInfo | null;
};

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
  const [pending, setPending] = useState<PendingLot | null>(null);

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

  // Close suggestions on outside click.
  useEffect(() => {
    if (!suggestOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
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

  // Phase 1: geocode + parcel lookup, then STOP for lot confirmation.
  // The expensive overlay + narrative phases only run after the user
  // confirms the highlighted lot is the one they meant.
  async function submit() {
    const address = value.trim();
    if (!address) return;
    setSuggestOpen(false);
    setPhase("running");
    setError(null);
    setPending(null);

    try {
      setStep("geocode");
      const geo = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const geoBody = await geo.json();
      if (!geo.ok) throw new Error(geoBody.error ?? "geocoding failed");

      let parcel: ParcelInfo | null = null;
      try {
        const pr = await fetch("/api/parcel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: geoBody.lat, lng: geoBody.lng }),
        });
        if (pr.ok) parcel = ((await pr.json()) as { parcel: ParcelInfo }).parcel;
      } catch {
        // Confirmation still works without parcel facts — just no polygon.
      }

      setPending({
        addressId: geoBody.addressId,
        lat: geoBody.lat,
        lng: geoBody.lng,
        displayName: geoBody.displayName,
        parcel: parcel?.polygon ? parcel : null,
      });
      setPhase("confirm");
    } catch (err) {
      setPhase("error");
      setError((err as Error).message);
    }
  }

  // Phase 2 (after "Yes, run the report"): overlays + narrative + navigate.
  async function runReport(lot: PendingLot) {
    setPhase("running");
    setError(null);

    try {
      setStep("overlays");
      const fo = await fetch("/api/fetch-overlays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId: lot.addressId }),
      });
      const foBody = await fo.json();
      if (!fo.ok) throw new Error(foBody.error ?? "overlay fetch failed");

      setStep("narrative");
      const gn = await fetch("/api/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId: lot.addressId }),
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

  function cancelConfirm() {
    setPending(null);
    setPhase("idle");
    setStep(null);
    inputRef.current?.focus();
  }

  const isBusy = phase === "running";
  const isConfirm = phase === "confirm";
  const showDropdown =
    suggestOpen && phase === "idle" && (suggestions.length > 0 || suggestLoading);

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
          disabled={isBusy || isConfirm}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          className="h-11 flex-1 min-w-0 border-0 bg-transparent px-2 text-[14.5px] shadow-none focus-visible:ring-0 dark:bg-transparent sm:text-[15px]"
          aria-label="Queensland address"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isBusy || isConfirm || value.trim().length === 0}
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

      {/* Suggestions dropdown */}
      {showDropdown && (
        <div
          role="listbox"
          className="glass-strong absolute left-0 right-0 top-[60px] z-20 overflow-hidden rounded-2xl p-1.5"
        >
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
      )}

      {presets && presets.length > 0 && phase === "idle" && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[12.5px] sm:text-[13px]">
          <span className="text-muted-foreground">Try one of ours —</span>
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

      {/* Lot confirmation — the report only runs after this is accepted. */}
      {isConfirm && pending && (
        <div className="glass-strong w-full overflow-hidden rounded-2xl text-left">
          <ModuleMap
            lat={pending.lat}
            lng={pending.lng}
            zoom={17}
            className="h-56 w-full"
            propertyPolygon={pending.parcel?.polygon ?? null}
          />
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Is this the right lot?
              </div>
              <div className="mt-1 text-[15px] font-semibold tracking-tight">
                {pending.displayName}
              </div>
              {pending.parcel ? (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-muted-foreground">
                  {pending.parcel.lotPlan && (
                    <span>
                      Lot/Plan{" "}
                      <span className="font-mono text-foreground/80">{pending.parcel.lotPlan}</span>
                    </span>
                  )}
                  {pending.parcel.areaM2 && (
                    <span>{pending.parcel.areaM2.toLocaleString("en-AU")} m²</span>
                  )}
                  {pending.parcel.suburb && <span>{pending.parcel.suburb}</span>}
                  {pending.parcel.lga && <span>{pending.parcel.lga}</span>}
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  We couldn&apos;t match an exact cadastre lot at this point —
                  the pin may sit on a road or boundary. You can still run the
                  report (checks will use the pin location), or refine the
                  address.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => runReport(pending)}
                className="h-10 rounded-full px-5 text-[13.5px] font-medium text-white"
                style={{
                  background:
                    "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
                }}
              >
                Yes — run the report
                <ArrowRight className="ml-1 size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={cancelConfirm}
                className="h-10 rounded-full px-5 text-[13.5px] font-medium text-foreground/70"
              >
                Different lot? Edit address
              </Button>
            </div>
          </div>
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
