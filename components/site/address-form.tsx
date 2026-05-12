"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [value, setValue] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<StepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(addr: string) {
    setValue(addr);
    inputRef.current?.focus();
  }

  async function submit() {
    const address = value.trim();
    if (!address) return;
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

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <form
        className="glass-strong flex w-full items-center gap-2 rounded-full p-2 pl-5"
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
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 12 Oxley Rd, Graceville QLD 4075"
          disabled={isBusy}
          className="h-11 flex-1 border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="Brisbane LGA address"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isBusy || value.trim().length === 0}
          className="h-11 rounded-full px-5 text-[14px] font-medium text-white disabled:opacity-70"
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
              Working
            </>
          ) : (
            <>
              Run report
              <ArrowRight className="ml-1 size-4" />
            </>
          )}
        </Button>
      </form>

      {presets && presets.length > 0 && phase === "idle" && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
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
