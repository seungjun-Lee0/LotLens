"use client";

// Account → "Report branding": subscribers put their own name, accent
// colour and logo on every PDF fact pack they export.
//
// The logo can be uploaded from disk (stored as a data: URI in the same
// brand_logo_url column — no blob storage to run) or referenced by https
// URL. The PDF route accepts both.

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Uploads are resized client-side before storing, so the file-size gate is
// generous — it only guards against absurd inputs, not ordinary photos.
const MAX_SOURCE_BYTES = 10_000_000;
// Stored data:-URI ceiling, matched to the API's cap. A cover logo renders
// ~4 cm wide; 1024 px is already more resolution than print needs.
const MAX_STORED_CHARS = 4_000_000;
const RESIZE_STEPS = [1024, 512, 256];

/** Downscale to ≤1024 px (longest side) and re-encode, stepping down until
 * the data URI fits the storage cap. PNG stays PNG (transparency survives);
 * everything else becomes JPEG. */
async function resizeToDataURL(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const dim of RESIZE_STEPS) {
      const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const isPng = file.type === "image/png";
      const url = canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85);
      if (url.length <= MAX_STORED_CHARS) return url;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Could not shrink that image enough. Try a simpler logo file.");
}

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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isUploaded = logoUrl.startsWith("data:image/");

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setState("error");
      setError("Logo must be a PNG or JPG image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setState("error");
      setError("Logo must be 10 MB or smaller.");
      return;
    }
    try {
      setLogoUrl(await resizeToDataURL(file));
      setState("idle");
    } catch (err) {
      setState("error");
      setError((err as Error).message || "Could not read that file.");
    }
  }

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

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">
          Logo (PNG/JPG, appears on the cover page)
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            // Same file picked twice in a row still fires onChange.
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          {logoUrl && (
            <span className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny
                  preview of a user-supplied data:/https image; next/image
                  adds nothing here. */}
              <img
                src={logoUrl}
                alt="Logo preview"
                className="max-h-7 max-w-[96px] object-contain"
              />
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                aria-label="Remove logo"
                className="rounded-full p-1 text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="h-10 rounded-lg px-3.5 text-[13px]"
          >
            {logoUrl ? (
              <>
                <ImageIcon className="size-3.5" /> Replace
              </>
            ) : (
              <>
                <Upload className="size-3.5" /> Upload from this device
              </>
            )}
          </Button>
        </div>
        {/* Remote-URL alternative, hidden once a file has been uploaded —
            showing a kilobyte-long data: URI in a text input helps no one. */}
        {!isUploaded && (
          <Input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="or paste an https URL: https://your-site.com/logo.png"
            maxLength={300}
            className="h-10"
          />
        )}
      </div>

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
            Saved: applies to your next PDF export.
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
