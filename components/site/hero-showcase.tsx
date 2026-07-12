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
};

const QLD_EXPORT =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage";

const bboxUrl = (b: Bbox, size: string) =>
  `${QLD_EXPORT}?bbox=${b.xmin},${b.ymin},${b.xmax},${b.ymax}&bboxSR=3857&imageSR=3857&size=${size}&format=jpeg&transparent=false&f=image`;

// ── Module registry (icon tints mirror the report overlay palette) ──────
type ModuleKey =
  | "flooding" | "flood_planning" | "overland_flow" | "storm_tide"
  | "bushfire" | "vegetation" | "heritage" | "easements"
  | "noise" | "schools" | "zoning";

const RAIL: { key: ModuleKey; label: string; hex: string }[] = [
  { key: "flooding", label: "Flooding", hex: "#3b82f6" },
  { key: "flood_planning", label: "Flood Planning", hex: "#2563eb" },
  { key: "overland_flow", label: "Overland Flow", hex: "#f97316" },
  { key: "storm_tide", label: "Storm Tide", hex: "#06b6d4" },
  { key: "bushfire", label: "Bushfire", hex: "#dc2626" },
  { key: "vegetation", label: "Vegetation", hex: "#16a34a" },
  { key: "heritage", label: "Heritage", hex: "#7e22ce" },
  { key: "easements", label: "Easements", hex: "#db2777" },
  { key: "noise", label: "Noise", hex: "#f59e0b" },
  { key: "schools", label: "Schools", hex: "#14b8a6" },
  { key: "zoning", label: "Zoning", hex: "#6366f1" },
];
const META = Object.fromEntries(RAIL.map((m) => [m.key, m])) as Record<
  ModuleKey,
  (typeof RAIL)[number]
>;

// Chips orbiting the loupe — three cycling groups, four anchor slots.
const CHIPS: { key: ModuleKey; group: string; pos: string; i: number }[] = [
  { key: "flooding", group: "cycle-g1", pos: "left-[-4%] top-[8%]", i: 0 },
  { key: "flood_planning", group: "cycle-g1", pos: "right-[-6%] top-[26%]", i: 1 },
  { key: "overland_flow", group: "cycle-g1", pos: "right-[-2%] bottom-[26%]", i: 2 },
  { key: "storm_tide", group: "cycle-g1", pos: "left-[-1%] bottom-[10%]", i: 3 },
  { key: "bushfire", group: "cycle-g2", pos: "left-[-4%] top-[8%]", i: 0 },
  { key: "vegetation", group: "cycle-g2", pos: "right-[-6%] top-[26%]", i: 1 },
  { key: "heritage", group: "cycle-g2", pos: "right-[-2%] bottom-[26%]", i: 2 },
  { key: "easements", group: "cycle-g2", pos: "left-[-1%] bottom-[10%]", i: 3 },
  { key: "noise", group: "cycle-g3", pos: "left-[-4%] top-[8%]", i: 0 },
  { key: "schools", group: "cycle-g3", pos: "right-[-6%] top-[26%]", i: 1 },
  { key: "zoning", group: "cycle-g3", pos: "left-[-1%] bottom-[10%]", i: 2 },
];

// Auto-cycle representatives: while chips of a group are up, the loupe shows
// the first module of that group that actually has mapped features here.
const GROUP_CANDIDATES: ModuleKey[][] = [
  ["flooding", "flood_planning", "overland_flow", "storm_tide"],
  ["bushfire", "heritage", "vegetation", "easements"],
  ["zoning", "noise", "schools"],
];

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
  const [pinned, setPinned] = useState<ModuleKey | null>(null);
  // Remember the last pinned module so the background layer can fade out
  // in place instead of vanishing when the user returns to AUTO.
  const lastPinnedRef = useRef<ModuleKey>("flooding");
  if (pinned) lastPinnedRef.current = pinned;
  const shown = pinned ?? lastPinnedRef.current;

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
  const parcelBg = pathFor(data.parcel, bgPx);
  const lotLinesLoupe = useMemo(() => pathFor(data.parcelLines, loupePx), [data.parcelLines, loupePx]);

  const reps = useMemo(
    () =>
      GROUP_CANDIDATES.map(
        (grp) => grp.find((k) => (data.modules[k]?.features.length ?? 0) > 0) ?? grp[0],
      ),
    [data],
  );

  const note = (k: ModuleKey) => data.modules[k]?.note ?? "—";
  const toggle = (k: ModuleKey) => setPinned((cur) => (cur === k ? null : k));

  return (
    <>
      {/* ── full-bleed aerial + live layer silhouette + veil ── */}
      <div aria-hidden className="absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size remote render, next/image adds nothing here */}
        <img
          src={bboxUrl(data.heroBbox, "1600,900")}
          alt=""
          className="h-full w-full scale-105 object-cover blur-[2px] brightness-[0.88] saturate-[1.0] dark:brightness-[0.42] dark:saturate-[0.9]"
        />
        {/* veil: fade the aerial into the page background on all edges */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--background) 78%, transparent) 0%, color-mix(in oklab, var(--background) 30%, transparent) 30%, color-mix(in oklab, var(--background) 26%, transparent) 62%, var(--background) 100%), linear-gradient(90deg, color-mix(in oklab, var(--background) 94%, transparent) 0%, color-mix(in oklab, var(--background) 76%, transparent) 42%, color-mix(in oklab, var(--background) 24%, transparent) 68%, transparent 84%)",
          }}
        />
        {/* pinned layer over the whole suburb — masked down on the text side */}
        <svg
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full scale-105 transition-opacity duration-700"
          style={{
            opacity: pinned ? 1 : 0,
            maskImage:
              "linear-gradient(90deg, rgba(0,0,0,.14) 0%, rgba(0,0,0,.32) 38%, rgba(0,0,0,.85) 62%, #000 80%)",
            WebkitMaskImage:
              "linear-gradient(90deg, rgba(0,0,0,.14) 0%, rgba(0,0,0,.32) 38%, rgba(0,0,0,.85) 62%, #000 80%)",
          }}
        >
          <g>
            <LayerPaths paths={layers[shown].bg} lineWidth={1} lineOpacity={0.7} />
          </g>
          <path
            d={parcelBg}
            fill="none"
            stroke="var(--selected-property)"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:pb-20">
        {/* copy + live address form (server-rendered) */}
        {children}

        {/* loupe + chips + module rail */}
        <div className="flex flex-col">
          <div className={`relative mx-auto h-[340px] w-full max-w-[460px] sm:h-[420px] ${pinned ? "hero-pinned" : ""}`}>
            {/* magnifier: angled handle + lens + metal rim */}
            <div aria-hidden className="absolute left-1/2 top-[47%] aspect-square w-[min(340px,78%)] -translate-x-1/2 -translate-y-1/2">
              {/* handle — sits behind the lens so the rim caps its neck */}
              <div
                className="absolute left-[70%] top-[70%] h-[12%] w-[50%] origin-left rotate-45 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #4a5058, #23262b 72%)",
                  boxShadow:
                    "0 12px 22px -8px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.2), inset 0 -1px 0 rgba(0,0,0,.45)",
                }}
              />
              {/* lens */}
              <div
                className="absolute inset-0 overflow-hidden rounded-full"
                style={{
                  boxShadow: "0 50px 90px -34px rgba(0,0,0,.85), 0 0 0 1px rgba(0,0,0,.5)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size remote render, next/image adds nothing here */}
                <img
                  src={bboxUrl(data.loupeBbox, "900,900")}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />

                {/* real report overlays, projected into the loupe window */}
                <svg viewBox="0 0 900 900" className="absolute inset-0 z-[1] h-full w-full">
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
                    reps.map((rep, gi) => (
                      <g key={`${rep}-${gi}`} className={`lens-fade${gi + 1}`}>
                        {rep === "zoning" && (
                          <path
                            d={lotLinesLoupe}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth={0.8}
                            strokeOpacity={0.55}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        <LayerPaths paths={layers[rep].loupe} />
                      </g>
                    ))
                  )}
                  {/* selected lot — the amber outline every report map carries */}
                  <path
                    d={parcelLoupe}
                    fill="var(--selected-property)"
                    fillOpacity={0.12}
                    stroke="var(--selected-property)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--selected-property) 65%, transparent))" }}
                  />
                </svg>
              </div>
              {/* metal rim frame over the lens */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    "inset 0 0 0 5px #2b2f36, inset 0 0 0 6px rgba(255,255,255,.14), inset 0 0 26px 8px rgba(0,0,0,.45)",
                }}
              />
            </div>

            {/* cycling chips — click one to pin its layer */}
            {!pinned &&
              CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setPinned(c.key)}
                  className={`${c.group} ${c.pos} glass-solid absolute z-[6] hidden cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[12px] font-medium text-foreground sm:inline-flex`}
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
                  <span className="font-normal text-muted-foreground">{note(c.key)}</span>
                </button>
              ))}

            {/* pinned chip — click to resume the cycle */}
            {pinned && (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className="glass-solid absolute left-[-4%] top-[8%] z-[6] hidden cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[12px] font-medium text-foreground sm:inline-flex"
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
                <span className="font-normal text-muted-foreground">{note(pinned)}</span>
                <span aria-hidden className="ml-0.5 text-muted-foreground">×</span>
              </button>
            )}

            {/* caption */}
            {pinned ? (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
                {META[pinned].label} · {note(pinned)}
              </span>
            ) : (
              CAPTIONS.map((t, gi) => (
                <span
                  key={t}
                  className={`cycle-g${gi + 1} absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground`}
                >
                  {t}
                </span>
              ))
            )}
          </div>

          {/* module rail — pin any of the 11 layers; AUTO resumes the cycle */}
          <div className="mx-auto mt-4 flex max-w-[460px] flex-wrap items-center justify-center gap-1.5">
            {RAIL.map((m) => {
              const empty = (data.modules[m.key]?.features.length ?? 0) === 0;
              const active = pinned === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggle(m.key)}
                  aria-pressed={active}
                  title={`${m.label} — ${note(m.key)}`}
                  className={`glass-solid flex size-7 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 ${empty && !active ? "opacity-45" : ""}`}
                  style={active ? { boxShadow: `0 0 0 2px ${m.hex}, var(--glass-shadow)` } : undefined}
                >
                  <span className="size-2 rounded-full" style={{ background: m.hex }} />
                  <span className="sr-only">{m.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPinned(null)}
              className={`glass-solid h-7 cursor-pointer rounded-full px-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] transition-colors ${pinned ? "text-foreground" : "text-muted-foreground"}`}
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
