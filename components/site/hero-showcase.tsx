"use client";

// Landing hero — blurred QLD aerial full-bleed with a sharp circular loupe.
//
// Everything drawn here is REAL report output for the demo lot under the
// loupe (Stafford, lot 10SP348436): the amber outline is the actual cadastre
// parcel, and every module layer is the same ArcGIS context data, coloured
// by the same classifiers, that a paid report renders. The fixture is
// snapshotted by `scripts/generate-hero-demo.ts` into lib/hero-demo-data.json
// with coordinates normalised to the hero aerial's bbox (u right, v down).
//
// Interaction: chips cycle in three groups (existing 14 s CSS loop). Clicking
// any chip — or a dot on the rail below — pins that module: the cycle stops
// and the pinned layer paints both the loupe AND the background aerial, so
// the layer's suburb-scale silhouette reads. Clicking the active dot (or
// AUTO) resumes the cycle.

import { useMemo, useRef, useState, type ReactNode } from "react";

// ── Fixture types (shape written by scripts/generate-hero-demo.ts) ──────
type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number };
export type HeroFeature = { c: string; o?: number; p: number[][][] };
export type HeroModuleData = { features: HeroFeature[]; note: string; hit: boolean };
export type HeroDemoData = {
  heroBbox: Bbox;
  loupeBbox: Bbox;
  /** Loupe rect in hero-normalised space (u right, v down). */
  loupe: { u0: number; u1: number; v0: number; v1: number };
  parcel: number[][][];
  parcelLines: number[][][];
  modules: Record<string, HeroModuleData>;
  lotPlan?: string | null;
  suburb?: string | null;
};

// Aerials are baked to /public by scripts/bake-hero-images.ts with the
// blur pre-applied — identical pixels, none of the runtime CSS-filter
// cost, and no LCP dependency on the QLD imagery server.
const HERO_AERIAL_SRC = "/hero-aerial.jpg";
// Same bbox, more pixels, lighter baked blur — phones draw the canvas ~1.7×
// larger than desktop, which fattens the desktop bake's σ=2 into a smear.
const HERO_AERIAL_MOBILE_SRC = "/hero-aerial-m.jpg";
const LOUPE_AERIAL_SRC = "/hero-loupe.jpg";

// ── Module registry (icon tints mirror the report overlay palette) ──────
type ModuleKey =
  | "flooding" | "flood_planning" | "overland_flow" | "storm_tide"
  | "bushfire" | "vegetation" | "environment" | "heritage" | "easements"
  | "noise" | "steep_land" | "acid_sulfate" | "mining"
  | "schools" | "zoning";

const RAIL: { key: ModuleKey; label: string; hex: string }[] = [
  { key: "flooding", label: "Flooding", hex: "#3b82f6" },
  { key: "flood_planning", label: "Flood Planning", hex: "#2563eb" },
  { key: "overland_flow", label: "Overland Flow", hex: "#f97316" },
  { key: "storm_tide", label: "Coastal Hazards", hex: "#06b6d4" },
  { key: "bushfire", label: "Bushfire", hex: "#dc2626" },
  { key: "vegetation", label: "Vegetation", hex: "#16a34a" },
  { key: "environment", label: "Environment & Koala", hex: "#10b981" },
  { key: "heritage", label: "Heritage", hex: "#7e22ce" },
  { key: "easements", label: "Easements", hex: "#db2777" },
  { key: "noise", label: "Noise", hex: "#f59e0b" },
  { key: "steep_land", label: "Steep Land", hex: "#d97706" },
  { key: "acid_sulfate", label: "Acid Sulfate Soils", hex: "#eab308" },
  { key: "mining", label: "Mining & Resources", hex: "#a855f7" },
  { key: "schools", label: "Schools", hex: "#14b8a6" },
  { key: "zoning", label: "Zoning", hex: "#6366f1" },
];
const META = Object.fromEntries(RAIL.map((m) => [m.key, m])) as Record<
  ModuleKey,
  (typeof RAIL)[number]
>;

// Chips orbiting the loupe — three cycling groups, four anchor slots.
// Slot positions are phone-safe at base (chips must stay INSIDE the
// container — a 390px screen has no bleed room; anything past the edge
// widens the hero grid track and clips the whole page), with the roomier
// desktop offsets restored at sm+.
const SLOT_POS = [
  "left-[11%] top-[5%] sm:left-[7%] sm:top-[9%]",
  "right-[1%] top-[24%] sm:right-[-6%] sm:top-[26%]",
  "right-[2%] bottom-[24%] sm:right-[-2%] sm:bottom-[26%]",
  "left-[11%] bottom-[10%] sm:left-[5%] sm:bottom-[11%]",
];
const CHIPS: { key: ModuleKey; group: string; i: number }[] = [
  { key: "flooding", group: "cycle-g1", i: 0 },
  { key: "flood_planning", group: "cycle-g1", i: 1 },
  { key: "overland_flow", group: "cycle-g1", i: 2 },
  { key: "storm_tide", group: "cycle-g1", i: 3 },
  { key: "bushfire", group: "cycle-g2", i: 0 },
  { key: "vegetation", group: "cycle-g2", i: 1 },
  { key: "heritage", group: "cycle-g2", i: 2 },
  { key: "easements", group: "cycle-g2", i: 3 },
  { key: "noise", group: "cycle-g3", i: 0 },
  { key: "schools", group: "cycle-g3", i: 1 },
  { key: "zoning", group: "cycle-g3", i: 3 },
];

// Auto-cycle groups — derived from CHIPS so the chips on screen and the
// layers painting the map are always the SAME set of modules.
const GROUPS: ModuleKey[][] = [1, 2, 3].map((g) =>
  CHIPS.filter((c) => c.group === `cycle-g${g}`).map((c) => c.key),
);

const CAPTIONS = [
  "Water & flood layers · 1/3",
  "Hazard & heritage layers · 2/3",
  "Planning & lifestyle layers · 3/3",
];

// ── Geometry → SVG paths ─────────────────────────────────────────────────

type Project = (u: number, v: number) => [number, number];

// Background SVG is 1600×900 (same as the hero aerial export).
const bgPx: Project = (u, v) => [u * 1600, v * 900];

function pathFor(rings: number[][][], px: Project): string {
  let d = "";
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = px(ring[i][0], ring[i][1]);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    d += "Z";
  }
  return d;
}

type Painted = { d: string; c: string; o: number };

function paint(features: HeroFeature[], px: Project): Painted[] {
  return features.map((f) => ({ d: pathFor(f.p, px), c: f.c, o: f.o ?? 0.35 }));
}

function LayerPaths({ paths, lineWidth = 1.8, lineOpacity = 0.95 }: {
  paths: Painted[];
  lineWidth?: number;
  lineOpacity?: number;
}) {
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.c}
          fillOpacity={p.o}
          fillRule="evenodd"
          stroke={p.c}
          strokeOpacity={lineOpacity}
          strokeWidth={lineWidth}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────────

export function HeroShowcase({ data, children }: { data: HeroDemoData; children: ReactNode }) {
  // `shown` lags behind `pinned` so the background layer fades out in place
  // instead of vanishing the moment the user returns to AUTO.
  const [sel, setSel] = useState<{ pinned: ModuleKey | null; shown: ModuleKey }>({
    pinned: null,
    shown: "flooding",
  });
  const { pinned, shown } = sel;
  const railRef = useRef<HTMLDivElement | null>(null);
  const pin = (k: ModuleKey | null) => {
    setSel((s) => ({ pinned: k, shown: k ?? s.shown }));
    // On phones the rail is a horizontal scroller — centre the pinned pill
    // so tapping a loupe chip visibly selects something the user can find.
    // Scroll the rail element DIRECTLY: scrollIntoView walks every
    // scrollable ancestor, and the hero section (which clips the oversized
    // aerial canvas) is programmatically scrollable — it shifted the whole
    // hero sideways.
    const rail = railRef.current;
    const btn = k && rail?.querySelector(`[data-rail="${k}"]`);
    if (btn && rail && window.matchMedia("(max-width: 639.98px)").matches) {
      const b = btn.getBoundingClientRect();
      const r = rail.getBoundingClientRect();
      rail.scrollTo({
        left: rail.scrollLeft + (b.left - r.left) - (r.width - b.width) / 2,
        behavior: "smooth",
      });
    }
  };

  const L = data.loupe;
  const loupePx: Project = useMemo(
    () => (u, v) => [((u - L.u0) / (L.u1 - L.u0)) * 900, ((v - L.v0) / (L.v1 - L.v0)) * 900],
    [L.u0, L.u1, L.v0, L.v1],
  );

  // All path strings are precomputed once — pinning just toggles <g> nodes.
  const layers = useMemo(() => {
    const out = {} as Record<ModuleKey, { loupe: Painted[]; bg: Painted[] }>;
    for (const m of RAIL) {
      const feats = data.modules[m.key]?.features ?? [];
      out[m.key] = { loupe: paint(feats, loupePx), bg: paint(feats, bgPx) };
    }
    return out;
  }, [data, loupePx]);

  const parcelLoupe = useMemo(() => pathFor(data.parcel, loupePx), [data.parcel, loupePx]);
  // Hero-normalised horizontal centre of the loupe target — the demo lot's
  // spot on the background aerial. Phones slide the aerial canvas so this
  // point sits at the horizontal centre of the screen, under the loupe.
  const mu = (L.u0 + L.u1) / 2;
  const lotLinesLoupe = useMemo(() => pathFor(data.parcelLines, loupePx), [data.parcelLines, loupePx]);

  const note = (k: ModuleKey) => data.modules[k]?.note ?? "";
  const toggle = (k: ModuleKey) => pin(pinned === k ? null : k);
  // The pinned chip stays in the slot its cycling chip occupied instead of
  // jumping to a fixed corner. Modules without a cycling chip (the newer
  // rail-only ones) fall back to the top-left slot.
  const pinnedPos = SLOT_POS[pinned ? CHIPS.find((c) => c.key === pinned)?.i ?? 0 : 0];

  return (
    <>
      {/* ── full-bleed aerial + live layer silhouette + veil ── */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ ["--hero-shift" as string]: `-${(mu * 100).toFixed(2)}%` }}
      >
        {/* Aerial canvas. Phones can't cover a portrait screen with the wide
            16:9 export and still keep the demo lot in frame — a plain
            object-cover centres on unrelated suburb. So below sm the canvas
            keeps the image's own aspect, oversized to 160% height, and is
            aligned so the lot the loupe magnifies sits under the loupe
            itself: horizontally centred via --hero-shift, and vertically by
            the top offset (lot v=0.47 of the canvas → ≈72% of the hero,
            where the loupe circle renders in the stacked layout). Like
            desktop, the lens sits ON the spot it magnifies — no separate
            marker needed. sm+ restores the plain full-bleed cover. */}
        <div className="absolute left-1/2 top-[-3%] aspect-video h-[160%] translate-x-[var(--hero-shift)] sm:left-0 sm:top-0 sm:aspect-auto sm:h-full sm:w-full sm:translate-x-0">
          <picture>
            <source media="(max-width: 639.98px)" srcSet={HERO_AERIAL_MOBILE_SRC} />
            <img
              src={HERO_AERIAL_SRC}
              alt=""
              fetchPriority="high"
              className="h-full w-full scale-105 object-cover brightness-[1.04] saturate-[0.15] contrast-[0.92] dark:brightness-[0.42] dark:saturate-[0.9] dark:contrast-100"
            />
          </picture>
        </div>

        {/* phone layer silhouette — one svg on the same shifted 16:9 canvas
            as the aerial (scale-105 matches the img), so the overlays land
            on the actual streets. No marker/parcel: the canvas alignment
            puts the loupe on the very spot it magnifies, hiding anything
            drawn there (same reasoning as desktop). Deliberately UNDER the
            veils (unlike the desktop pair): the veil's bottom ramp to solid
            --background buries the silhouette before the section seam the
            same proven way it buries the aerial, so layer paint can never
            poke out past the rail. overflow-hidden hard-clips the oversized
            canvas at the hero bounds; the soft vertical fade sits on the
            svg itself with stops in canvas space:
            cf = (hf + 0.03) / 1.6 for hero-fraction hf. */}
        <div className="absolute inset-0 overflow-hidden sm:hidden">
          <div className="absolute left-1/2 top-[-3%] aspect-video h-[160%] translate-x-[var(--hero-shift)]">
            {/* Hero-space intent: silent above ~46% (copy/backdrop-blur
                zone), full 64–80% (loupe centre ≈72%), gone by 92%. */}
            <svg
              viewBox="0 0 1600 900"
              className="h-full w-full scale-105"
              style={{
                maskImage:
                  "linear-gradient(180deg, transparent 0%, transparent 30%, rgba(0,0,0,.5) 37%, #000 42%, #000 52%, transparent 60%)",
                WebkitMaskImage:
                  "linear-gradient(180deg, transparent 0%, transparent 30%, rgba(0,0,0,.5) 37%, #000 42%, #000 52%, transparent 60%)",
              }}
            >
              {!pinned &&
                GROUPS.map((grp, gi) => (
                  <g key={`m-grp-${gi}`} className={`lens-fade${gi + 1}`}>
                    <g style={{ opacity: "var(--hero-layer)" }}>
                      {grp.map((k) => (
                        <LayerPaths key={k} paths={layers[k].bg} lineWidth={1} lineOpacity={0.5} />
                      ))}
                    </g>
                  </g>
                ))}
              <g
                className="transition-opacity duration-700"
                style={{ opacity: pinned ? "var(--hero-layer-pinned)" : 0 }}
              >
                <LayerPaths paths={layers[shown].bg} lineWidth={1} lineOpacity={0.5} />
              </g>
            </svg>
          </div>
        </div>

        {/* veil: fade the aerial into the page background — gradients live
            in globals.css (.hero-veil-*) because the horizontal wash that
            clears the desktop text column must drop out on phones, where
            the copy stacks ABOVE the map and the lot sits centred. */}
        <div className="hero-veil-light absolute inset-0 dark:hidden" />
        <div className="hero-veil-dark absolute inset-0 hidden dark:block" />
        {/* layer silhouette + lot marker — masked down on the text side.
            The wrapper's VERTICAL mask dissolves the overlay before the
            section edges so it never cuts off in a hard line. */}
        <div
          className="absolute inset-0 hidden sm:block"
          style={{
            maskImage:
              "linear-gradient(180deg, transparent 0%, #000 14%, #000 72%, transparent 94%)",
            WebkitMaskImage:
              "linear-gradient(180deg, transparent 0%, #000 14%, #000 72%, transparent 94%)",
          }}
        >
        {/* auto: the ENTIRE cycling group paints the map — the exact
            modules the chips are announcing — but a radial mask keeps the
            silhouette hugging the detail circle and fading out towards the
            page edges/text. Pinning (next svg) opens up the full suburb. */}
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full scale-105"
          style={{
            maskImage:
              "radial-gradient(46% 66% at 68% 47%, #000 28%, rgba(0,0,0,.4) 58%, transparent 88%)",
            WebkitMaskImage:
              "radial-gradient(46% 66% at 68% 47%, #000 28%, rgba(0,0,0,.4) 58%, transparent 88%)",
          }}
        >
          {!pinned &&
            GROUPS.map((grp, gi) => (
              <g key={`bg-grp-${gi}`} className={`lens-fade${gi + 1}`}>
                <g style={{ opacity: "var(--hero-layer)" }}>
                  {grp.map((k) => (
                    <LayerPaths key={k} paths={layers[k].bg} lineWidth={1} lineOpacity={0.5} />
                  ))}
                </g>
              </g>
            ))}
        </svg>
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full scale-105"
          style={{
            maskImage:
              "linear-gradient(90deg, rgba(0,0,0,.07) 0%, rgba(0,0,0,.2) 38%, rgba(0,0,0,.8) 62%, #000 80%)",
            WebkitMaskImage:
              "linear-gradient(90deg, rgba(0,0,0,.07) 0%, rgba(0,0,0,.2) 38%, rgba(0,0,0,.8) 62%, #000 80%)",
          }}
        >
          <g
            className="transition-opacity duration-700"
            style={{ opacity: pinned ? "var(--hero-layer-pinned)" : 0 }}
          >
            <LayerPaths paths={layers[shown].bg} lineWidth={1} lineOpacity={0.5} />
          </g>
          {/* No geographic marker/parcel here: on desktop the loupe sits on
              (or drifts near — the crop and the layout use different
              coordinate spaces) the very spot it magnifies, so anything
              drawn there is hidden behind the lens. */}
        </svg>
        </div>

        {/* phones: calm the (sharper) mobile aerial behind the copy and
            address form — a masked backdrop blur over the top half that
            dissolves before the loupe zone. Sits last so it also softens
            any layer paint reaching up there. Kept clear of the animating
            layer band (mask ends ~52%, layers start ~46% at near-zero
            alpha) so the blur isn't re-filtering animated content every
            frame. */}
        <div
          className="absolute inset-x-0 top-0 h-[52%] backdrop-blur-[5px] sm:hidden"
          style={{
            maskImage: "linear-gradient(180deg, #000 0%, #000 62%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 62%, transparent 100%)",
          }}
        />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 pb-10 pt-8 sm:gap-10 sm:px-6 sm:pb-14 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:pb-20">
        {/* copy + live address form (server-rendered) */}
        {children}

        {/* loupe + chips + module rail. min-w-0 is load-bearing: the rail's
            non-wrapping pills would otherwise set this grid item's
            min-content width, widening the WHOLE hero track past the phone
            viewport and clipping the copy column with it. */}
        <div className="flex min-w-0 flex-col">
          <div className="relative mx-auto h-[320px] w-full max-w-[460px] sm:h-[420px]">
            {/* detail circle — a clean zoomed-in viewport over the marked lot */}
            <div aria-hidden className="absolute left-1/2 top-[47%] aspect-square w-[min(260px,70%)] -translate-x-1/2 -translate-y-1/2 sm:w-[min(340px,78%)]">
              {/* lens */}
              <div
                className="absolute inset-0 overflow-hidden rounded-full"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(255,255,255,.45), 0 0 0 5px color-mix(in oklab, var(--background) 45%, transparent), 0 0 0 6px color-mix(in oklab, var(--foreground) 10%, transparent), 0 36px 80px -28px rgba(0,0,0,.55)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size remote render, next/image adds nothing here */}
                <img
                  src={LOUPE_AERIAL_SRC}
                  alt=""
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full object-cover"
                />

                {/* real report overlays, projected into the loupe window.
                    The circular clip lives on this HTML wrapper — not the
                    svg root and not the parent's rounded overflow —
                    because Firefox resolves clip-path percentages on SVG
                    elements against the CONTENT bbox (the paths sprawl
                    far past the viewBox, so the "circle" was enormous)
                    and also skips the border-radius overflow clip on this
                    stacked child. A div's clip-path uses border-box in
                    every engine. */}
                <div className="absolute inset-0 z-[1] [clip-path:circle(50%)]">
                <svg viewBox="0 0 900 900" className="h-full w-full">
                  {pinned ? (
                    <g>
                      {pinned === "zoning" && (
                        <path
                          d={lotLinesLoupe}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={0.8}
                          strokeOpacity={0.55}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                      <LayerPaths paths={layers[pinned].loupe} />
                    </g>
                  ) : (
                    GROUPS.map((grp, gi) => (
                      <g key={`loupe-grp-${gi}`} className={`lens-fade${gi + 1}`}>
                        {grp.includes("zoning") && (
                          <path
                            d={lotLinesLoupe}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth={0.8}
                            strokeOpacity={0.55}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {grp.map((k) => (
                          <LayerPaths key={k} paths={layers[k].loupe} />
                        ))}
                      </g>
                    ))
                  )}
                  {/* selected lot — the amber outline every report map carries */}
                  <path
                    d={parcelLoupe}
                    fillOpacity={0.12}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      fill: "var(--selected-property)",
                      stroke: "var(--selected-property)",
                      filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--selected-property) 65%, transparent))",
                    }}
                  />
                </svg>
                </div>

              </div>
            </div>

            {/* cycling chips — click one to pin its layer. Phones show the
                label only; the data note joins at sm+ where there's room. */}
            {!pinned &&
              CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => pin(c.key)}
                  className={`${c.group} ${SLOT_POS[c.i]} glass-solid absolute z-[6] inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium text-foreground sm:text-[12px]`}
                  style={{ ["--i" as string]: c.i }}
                >
                  <span
                    className="size-[7px] rounded-full"
                    style={{
                      background: META[c.key].hex,
                      boxShadow: `0 0 8px color-mix(in oklab, ${META[c.key].hex} 70%, transparent)`,
                    }}
                  />
                  {META[c.key].label}{" "}
                  <span className="hidden font-normal text-muted-foreground sm:inline">{note(c.key)}</span>
                </button>
              ))}

            {/* pinned chip — click to resume the cycle */}
            {pinned && (
              <button
                type="button"
                onClick={() => pin(null)}
                className={`${pinnedPos} glass-solid absolute z-[6] inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-medium text-foreground sm:text-[12px]`}
                style={{ boxShadow: `0 0 0 1.5px color-mix(in oklab, ${META[pinned].hex} 55%, transparent), var(--glass-shadow)` }}
              >
                <span
                  className="size-[7px] rounded-full"
                  style={{
                    background: META[pinned].hex,
                    boxShadow: `0 0 8px color-mix(in oklab, ${META[pinned].hex} 70%, transparent)`,
                  }}
                />
                {META[pinned].label}{" "}
                <span className="hidden font-normal text-muted-foreground sm:inline">{note(pinned)}</span>
                <span aria-hidden className="ml-0.5 text-muted-foreground">×</span>
              </button>
            )}

            {/* caption */}
            {pinned ? (
              <span className="absolute bottom-0 left-1/2 max-w-[96%] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
                {META[pinned].label} · {note(pinned)}
              </span>
            ) : (
              CAPTIONS.map((t, gi) => (
                <span
                  key={t}
                  className={`cycle-g${gi + 1} absolute bottom-0 left-1/2 max-w-[96%] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground`}
                >
                  {t}
                </span>
              ))
            )}
          </div>

          {/* module rail — pin any of the layers; AUTO resumes the cycle.
              Phones have no orbiting chips (they'd overflow the screen), so
              the rail carries the labels there: an edge-to-edge horizontal
              scroller of named pills. sm+ collapses back to the dot rail. */}
          <div
            ref={railRef}
            className="rail-fade -mx-4 mt-4 pt-1 flex items-center gap-1.5 overflow-x-auto px-5 pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-auto sm:max-w-[460px] sm:flex-wrap sm:justify-center sm:overflow-x-visible sm:px-0 sm:pb-0"
          >
            {RAIL.map((m) => {
              const empty = (data.modules[m.key]?.features.length ?? 0) === 0;
              const active = pinned === m.key;
              return (
                <button
                  key={m.key}
                  data-rail={m.key}
                  type="button"
                  onClick={() => toggle(m.key)}
                  aria-pressed={active}
                  title={`${m.label} — ${note(m.key)}`}
                  className={`glass-solid flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 transition-transform hover:scale-110 sm:size-7 sm:justify-center sm:gap-0 sm:px-0 ${empty && !active ? "opacity-45" : ""}`}
                  style={active ? { boxShadow: `0 0 0 2px ${m.hex}, var(--glass-shadow)` } : undefined}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: m.hex }} />
                  <span className="text-[11.5px] font-medium sm:sr-only">{m.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => pin(null)}
              className={`glass-solid h-8 shrink-0 cursor-pointer rounded-full px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors sm:h-7 sm:px-2.5 sm:text-[9.5px] ${pinned ? "text-foreground" : "text-muted-foreground"}`}
              title="Resume the layer cycle"
            >
              Auto
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
