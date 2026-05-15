"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Suggestion } from "@/app/api/geocode/suggest/route";

const STEPS = [
  { key: "geocode",  label: "Locating address",            tint: "var(--apple-blue)" },
  { key: "overlays", label: "Pulling council overlay data", tint: "var(--apple-orange)" },
  { key: "narrative", label: "Generating narrative",        tint: "var(--apple-purple)" },
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

  // Debounced /api/geocode/suggest fetch.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || phase !== "idle" || q === lastPickedRef.current) {
      setSuggestions([]);
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
        setSuggestions(body.suggestions ?? []);
        setSuggestOpen(true);
        setActiveIdx(-1);
      } catch {
        /* aborted or net err */
      } finally {
        setSuggestLoading(false);
      }
    }, 280);
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

      setPhase("done");
      router.push(`/report/${gnBody.reportId}`);
    } catch (err) {
      setPhase("error");
      setError((err as Error).message);
    }
  }

  const isBusy = phase === "running";
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
          disabled={isBusy}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          className="h-11 flex-1 min-w-0 border-0 bg-transparent px-2 text-[14.5px] shadow-none focus-visible:ring-0 dark:bg-transparent sm:text-[15px]"
          aria-label="Brisbane LGA address"
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

      {/* Suggestions dropdown */}
      {showDropdown && (
        <div
          role="listbox"
          className="glass-strong absolute left-0 right-0 top-[60px] z-20 overflow-hidden rounded-2xl p-1.5"
        >
          {suggestLoading && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Searching Brisbane addresses…
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
