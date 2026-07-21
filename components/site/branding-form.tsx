"use client";

// Account → "Report branding" — subscribers put their own name, accent
// colour and logo on every PDF fact pack they export.

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BrandingForm({
  initialName,
  initialColor,
  initialLogoUrl,
}: {
  initialName: string;
  initialColor: string;
  initialLogoUrl: string;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor || "#0a84ff");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/account/branding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: name,
          brandColor: color,
          brandLogoUrl: logoUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "save failed");
      setState("saved");
      window.setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("error");
      setError((err as Error).message);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (state !== "saving") save();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">
            Business name (shown on the PDF)
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smith Buyer's Agents"
            maxLength={60}
            className="h-10"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">
            Accent
          </span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-16 cursor-pointer rounded-lg border border-border/60 bg-transparent p-1"
            aria-label="Brand accent colour"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">
          Logo URL (https, PNG/JPG — appears on the cover page)
        </span>
        <Input
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://your-site.com/logo.png"
          maxLength={300}
          className="h-10"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={state === "saving"}
          className="h-9 rounded-full px-4 text-[13px] font-medium text-white"
          style={{
            background:
              "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
          }}
        >
          {state === "saving" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving
            </>
          ) : (
            "Save branding"
          )}
        </Button>
        {state === "saved" && (
          <span className="text-[12.5px]" style={{ color: "var(--apple-green)" }}>
            Saved — applies to your next PDF export.
          </span>
        )}
        {state === "error" && (
          <span className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
