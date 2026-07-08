import {
  CloudRain,
  Download,
  FileText,
  Flame,
  GraduationCap,
  Landmark,
  Layers,
  LayoutGrid,
  Leaf,
  ScrollText,
  Search,
  Volume2,
  Waves,
  Wind,
} from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { AddressForm } from "@/components/site/address-form";

// ── QLD Government aerial imagery (same ImageServer the report maps use) ──
// Web-Mercator bboxes centred on a Paddington-ish Brisbane block. The hero
// gets a wide crop (blurred via CSS); the loupe gets a tight, sharp crop.
const QLD_EXPORT =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage";
const HERO_AERIAL = `${QLD_EXPORT}?bbox=17030370,-3175190,17033170,-3173610&bboxSR=3857&imageSR=3857&size=1600,900&format=jpeg&transparent=false&f=image`;
const LOUPE_AERIAL = `${QLD_EXPORT}?bbox=17031610,-3174560,17031930,-3174240&bboxSR=3857&imageSR=3857&size=900,900&format=jpeg&transparent=false&f=image`;

// ── Landing module registry ───────────────────────────────────────────────
// `hex` mirrors the overlay colour the report map paints for that module;
// `clip` shapes the mini layer-preview polygon; `tag` labels the preview.
type LandingModule = {
  icon: typeof Waves;
  name: string;
  blurb: string;
  hex: string;
  clip: string;
  tag: string;
};

const MODULES: LandingModule[] = [
  {
    icon: Waves,
    name: "Flooding",
    blurb: "River, creek & storm-tide risk, plus 2011 & 2022 historic events.",
    hex: "#3b82f6",
    clip: "polygon(0 58%,22% 46%,45% 60%,68% 47%,100% 60%,100% 100%,0 100%)",
    tag: "BCC flood overlay",
  },
  {
    icon: Waves,
    name: "Flood Planning",
    blurb: "Which statutory flood planning area the lot sits in, and what it restricts.",
    hex: "#2563eb",
    clip: "polygon(0 70%,30% 58%,60% 72%,100% 56%,100% 100%,0 100%)",
    tag: "Planning area",
  },
  {
    icon: CloudRain,
    name: "Overland Flow",
    blurb: "Stormwater run-off paths crossing the property.",
    hex: "#f97316",
    clip: "polygon(38% 0,52% 0,44% 38%,58% 36%,40% 100%,30% 100%,40% 55%,28% 58%)",
    tag: "Flow path",
  },
  {
    icon: Wind,
    name: "Storm Tide",
    blurb: "Coastal storm-tide inundation exposure for bayside lots.",
    hex: "#06b6d4",
    clip: "polygon(0 76%,25% 68%,55% 78%,100% 66%,100% 100%,0 100%)",
    tag: "Tide extent",
  },
  {
    icon: Flame,
    name: "Bushfire",
    blurb: "Queensland bushfire hazard rating for the site.",
    hex: "#dc2626",
    clip: "polygon(58% 0,100% 0,100% 62%,74% 74%,55% 40%)",
    tag: "Hazard area",
  },
  {
    icon: Leaf,
    name: "Vegetation",
    blurb: "Protected vegetation, waterway & biodiversity overlays.",
    hex: "#16a34a",
    clip: "polygon(64% 12%,88% 4%,100% 30%,92% 66%,68% 74%,52% 48%)",
    tag: "Biodiversity",
  },
  {
    icon: Landmark,
    name: "Heritage & Character",
    blurb: "State/local heritage & pre-1947 character controls.",
    hex: "#7e22ce",
    clip: "polygon(6% 18%,40% 10%,46% 52%,34% 88%,4% 78%)",
    tag: "Character area",
  },
  {
    icon: ScrollText,
    name: "Easements",
    blurb: "High-voltage & registered cadastral easements on the lot.",
    hex: "#db2777",
    clip: "polygon(0 40%,100% 30%,100% 46%,0 56%)",
    tag: "Easement strip",
  },
  {
    icon: Volume2,
    name: "Noise",
    blurb: "Transport-corridor & aircraft (ANEF) noise bands.",
    hex: "#f59e0b",
    clip: "polygon(0 22%,100% 6%,100% 34%,0 50%)",
    tag: "Corridor band",
  },
  {
    icon: GraduationCap,
    name: "School Catchments",
    blurb: "State primary & secondary catchment zones.",
    hex: "#14b8a6",
    clip: "polygon(0 0,100% 0,100% 100%,0 100%)",
    tag: "Catchment-wide",
  },
  {
    icon: LayoutGrid,
    name: "Zoning",
    blurb: "City Plan zone, precinct & what you're allowed to build.",
    hex: "#6366f1",
    clip: "polygon(0 0,52% 0,52% 100%,0 100%)",
    tag: "Zone fill",
  },
];

// Chips that orbit the loupe — three groups pop in/out on a 14 s cycle so
// all eleven modules get shown. `pos` picks one of four fixed anchor slots.
const LOUPE_CHIPS: {
  group: "cycle-g1" | "cycle-g2" | "cycle-g3";
  pos: string;
  i: number;
  hex: string;
  label: string;
  note: string;
}[] = [
  { group: "cycle-g1", pos: "left-[-4%] top-[8%]", i: 0, hex: "#3b82f6", label: "Flooding", note: "none mapped" },
  { group: "cycle-g1", pos: "right-[-6%] top-[26%]", i: 1, hex: "#2563eb", label: "Flood Planning", note: "outside area" },
  { group: "cycle-g1", pos: "right-[-2%] bottom-[26%]", i: 2, hex: "#f97316", label: "Overland Flow", note: "clear" },
  { group: "cycle-g1", pos: "left-[-1%] bottom-[10%]", i: 3, hex: "#06b6d4", label: "Storm Tide", note: "not exposed" },
  { group: "cycle-g2", pos: "left-[-4%] top-[8%]", i: 0, hex: "#dc2626", label: "Bushfire", note: "not in hazard" },
  { group: "cycle-g2", pos: "right-[-6%] top-[26%]", i: 1, hex: "#16a34a", label: "Vegetation", note: "no overlay" },
  { group: "cycle-g2", pos: "right-[-2%] bottom-[26%]", i: 2, hex: "#7e22ce", label: "Heritage", note: "not listed" },
  { group: "cycle-g2", pos: "left-[-1%] bottom-[10%]", i: 3, hex: "#db2777", label: "Easements", note: "1 registered" },
  { group: "cycle-g3", pos: "left-[-4%] top-[8%]", i: 0, hex: "#f59e0b", label: "Noise", note: "corridor 3" },
  { group: "cycle-g3", pos: "right-[-6%] top-[26%]", i: 1, hex: "#14b8a6", label: "Schools", note: "2 catchments" },
  { group: "cycle-g3", pos: "left-[-1%] bottom-[10%]", i: 2, hex: "#6366f1", label: "Zoning", note: "LMR · 2–3 storey" },
];

const STEPS = [
  {
    n: "01",
    icon: Search,
    title: "Enter an address",
    body: "Any property in the Brisbane City Council area.",
  },
  {
    n: "02",
    icon: Layers,
    title: "We pull 11 layers",
    body: "Council & state overlays queried live against the parcel, in seconds.",
  },
  {
    n: "03",
    icon: FileText,
    title: "Read plain English",
    body: "Every finding on one map — no planning jargon, every claim cited.",
  },
  {
    n: "04",
    icon: Download,
    title: "Download the PDF",
    body: "A branded A4 fact pack to share with your conveyancer.",
  },
];

const FAQS = [
  {
    q: "Is this legal or planning advice?",
    a: "No. LotLens aggregates public council & state data into plain English for your own research. It's not legal, financial or planning advice — always confirm details with a qualified professional, conveyancer or the relevant Council before you act.",
  },
  {
    q: "How accurate is the data?",
    a: "Every layer is queried live, straight from Brisbane City Council and Queensland Government sources at the moment you run the report — not a stale cached copy. Each finding cites its exact source layer.",
  },
  {
    q: "Which areas are covered?",
    a: "The Brisbane City Council local government area today, on authoritative Queensland state aerial imagery. Coverage across South-East Queensland is rolling out next.",
  },
  {
    q: "Do I get a PDF I can share?",
    a: "Yes — the full report includes a branded A4 fact pack with the maps, narrative and sources, ready to forward to your conveyancer or partner.",
  },
  {
    q: "How long does it take?",
    a: "Seconds. Enter an address and the report generates on the spot — no waiting on an email.",
  },
];

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

// Satellite-styled mini tile used behind each module's layer preview.
const MINI_TILE_BG =
  "repeating-linear-gradient(90deg, rgba(255,255,255,.055) 0 1px, transparent 1px 30px), repeating-linear-gradient(0deg, rgba(255,255,255,.055) 0 1px, transparent 1px 22px), linear-gradient(115deg, #26301f, #161d19)";

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* ── HERO — blurred aerial full-bleed, sharp loupe on the right ── */}
      <section
        id="top"
        className="relative -mt-16 overflow-hidden pt-16 sm:-mt-[72px] sm:pt-[72px]"
      >
        <div aria-hidden className="absolute inset-0 -z-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size remote render, next/image adds nothing here */}
          <img
            src={HERO_AERIAL}
            alt=""
            className="h-full w-full scale-105 object-cover blur-[9px] brightness-[1.0] saturate-[1.02] dark:brightness-[0.5] dark:saturate-[0.95]"
          />
          {/* veil: fade the aerial into the page background on all edges */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in oklab, var(--background) 62%, transparent) 0%, transparent 26%, transparent 62%, var(--background) 100%), linear-gradient(90deg, color-mix(in oklab, var(--background) 72%, transparent) 0%, color-mix(in oklab, var(--background) 34%, transparent) 45%, transparent 78%)",
            }}
          />
          <div className="hero-beam" />
        </div>

        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:pb-20">
          {/* copy + live address form */}
          <div className="flex flex-col items-start gap-6">
            <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium text-foreground/70 sm:text-[12px]">
              <span
                className="size-1.5 rounded-full"
                style={{ background: "var(--apple-green)" }}
              />
              Public council + Queensland state data
            </span>

            <h1 className="text-balance text-[2.5rem] font-semibold leading-[1.03] tracking-tight sm:text-6xl">
              Brisbane property,
              <br />
              brought into{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, var(--apple-blue), var(--apple-purple))",
                }}
              >
                focus.
              </span>
            </h1>

            <p className="max-w-lg text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-[16.5px]">
              Flood, bushfire, heritage, easements, zoning and more — every
              council &amp; state layer for an address, on one map and explained
              in plain English. Before you sign.
            </p>

            <AddressForm
              presets={[
                {
                  label: "Property A · Chermside (clean)",
                  address: "Westfield Chermside, Chermside QLD 4032",
                  tint: "var(--apple-teal)",
                },
                {
                  label: "Property B · Rocklea (flood)",
                  address: "250 Sherwood Road, Rocklea QLD 4106",
                  tint: "var(--apple-orange)",
                },
              ]}
            />

            <p className="text-[12.5px] text-muted-foreground">
              <b className="font-medium text-foreground">
                Flooding preview free
              </b>{" "}
              · full report $29 · no signup to preview
            </p>
          </div>

          {/* loupe: sharp aerial in a circle + cycling module chips */}
          <div
            aria-hidden
            className="relative mx-auto h-[340px] w-full max-w-[460px] sm:h-[420px]"
          >
            <div
              className="absolute left-1/2 top-[47%] aspect-square w-[min(340px,78%)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
              style={{
                boxShadow:
                  "0 50px 90px -38px rgba(0,0,0,.8), 0 0 0 1px color-mix(in oklab, var(--foreground) 16%, transparent), 0 0 80px -26px color-mix(in oklab, var(--apple-blue) 45%, transparent)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size remote render, next/image adds nothing here */}
              <img
                src={LOUPE_AERIAL}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* layer washes — synced to the chip groups */}
              <div
                className="lay-g1 absolute inset-0 z-[1]"
                style={{
                  background:
                    "linear-gradient(200deg, transparent 38%, color-mix(in oklab, #2563eb 55%, transparent) 74%, color-mix(in oklab, #06b6d4 55%, transparent) 100%)",
                  clipPath:
                    "polygon(0 52%,18% 47%,34% 55%,52% 48%,70% 58%,86% 50%,100% 60%,100% 100%,0 100%)",
                }}
              />
              <div
                className="lay-g2 absolute inset-0 z-[1]"
                style={{
                  background:
                    "radial-gradient(38% 30% at 74% 26%, color-mix(in oklab, #dc2626 60%, transparent), transparent 72%), radial-gradient(30% 26% at 22% 30%, color-mix(in oklab, #7e22ce 55%, transparent), transparent 72%), radial-gradient(34% 28% at 30% 74%, color-mix(in oklab, #16a34a 55%, transparent), transparent 72%)",
                }}
              />
              <div
                className="lay-g3 absolute inset-0 z-[1]"
                style={{
                  background: "color-mix(in oklab, #6366f1 34%, transparent)",
                  WebkitMaskImage:
                    "repeating-linear-gradient(90deg, #000 0 34px, rgba(0,0,0,.55) 34px 35px), repeating-linear-gradient(0deg, #000 0 26px, rgba(0,0,0,.55) 26px 27px)",
                  maskImage:
                    "repeating-linear-gradient(90deg, #000 0 34px, rgba(0,0,0,.55) 34px 35px), repeating-linear-gradient(0deg, #000 0 26px, rgba(0,0,0,.55) 26px 27px)",
                }}
              />

              <div className="loupe-radar" />
              {/* vignette + selected lot + crosshair ticks + scan line */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle at 50% 42%, transparent 54%, rgba(0,0,0,.3) 100%)",
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 z-[3] h-[29%] w-[44%] -translate-x-1/2 -translate-y-1/2 -rotate-[17deg] rounded-[2px] border-2"
                style={{
                  borderColor: "var(--selected-property)",
                  background:
                    "color-mix(in oklab, var(--selected-property) 12%, transparent)",
                  boxShadow:
                    "0 0 0 1px rgba(0,0,0,.45), 0 0 20px -6px var(--selected-property)",
                }}
              />
              <div
                className="pointer-events-none absolute inset-0 z-[4] opacity-50"
                style={{
                  background:
                    "linear-gradient(var(--foreground),var(--foreground)) 50% 10px/1px 10px no-repeat, linear-gradient(var(--foreground),var(--foreground)) 50% calc(100% - 10px)/1px 10px no-repeat, linear-gradient(var(--foreground),var(--foreground)) 10px 50%/10px 1px no-repeat, linear-gradient(var(--foreground),var(--foreground)) calc(100% - 10px) 50%/10px 1px no-repeat",
                }}
              />
              <div className="loupe-scan" />
            </div>

            {/* cycling chips — all 11 modules across three groups */}
            {LOUPE_CHIPS.map((c) => (
              <span
                key={`${c.group}-${c.label}`}
                className={`${c.group} ${c.pos} glass absolute z-[6] hidden items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[12px] font-medium text-foreground sm:inline-flex`}
                style={{ ["--i" as string]: c.i }}
              >
                <span
                  className="size-[7px] rounded-full"
                  style={{
                    background: c.hex,
                    boxShadow: `0 0 8px color-mix(in oklab, ${c.hex} 70%, transparent)`,
                  }}
                />
                {c.label}{" "}
                <span className="font-normal text-muted-foreground">
                  {c.note}
                </span>
              </span>
            ))}

            {/* cycling caption */}
            {[
              { g: "cycle-g1", t: "Water & flood layers · 1/3" },
              { g: "cycle-g2", t: "Hazard & heritage layers · 2/3" },
              { g: "cycle-g3", t: "Planning & lifestyle layers · 3/3" },
            ].map((c) => (
              <span
                key={c.g}
                className={`${c.g} absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground`}
              >
                {c.t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOURCES STRIP ── */}
      <div className="border-y border-border/50 py-6">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="text-center font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground">
            Sourced directly from
          </div>
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[14px] font-medium text-foreground/60">
            <span>Brisbane City Council</span>
            <span>Queensland Government</span>
            <span>QSpatial</span>
            <span>Translink</span>
            <span>Dept of Education</span>
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 pb-16 pt-14 sm:gap-24 sm:px-6 sm:pb-24 sm:pt-20">
        {/* ── HOW IT WORKS ── */}
        <section id="how" className="flex flex-col gap-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              How it works
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              An address in. A full picture out.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-[14px] leading-relaxed text-muted-foreground">
              No logins, no 40-page council PDFs. Type an address and LotLens
              does the digging across every public layer.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm"
              >
                <div
                  className="font-mono text-[12px]"
                  style={{ color: "var(--apple-blue)" }}
                >
                  {s.n}
                </div>
                <s.icon className="mb-3 mt-2 size-5 text-foreground" />
                <div className="text-[15px] font-semibold tracking-tight">
                  {s.title}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── MODULES — distinctive cards with live layer previews ── */}
        <section id="modules" className="flex flex-col gap-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              What&rsquo;s checked
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Eleven layers, one report.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-[14px] leading-relaxed text-muted-foreground">
              Each card shows how that overlay actually renders on your
              report&rsquo;s map — same colours, same lot outline.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m, i) => (
              <div
                key={m.name}
                className="mod-card group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm"
                style={{ ["--c" as string]: m.hex }}
              >
                {/* soft colour glow, brightens on hover */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-[20%] -top-[40%] -z-10 h-[80%] w-[70%] rounded-full opacity-[0.12] blur-[14px] transition-opacity duration-200 group-hover:opacity-[0.28]"
                  style={{
                    background: `radial-gradient(circle, color-mix(in oklab, ${m.hex} 55%, transparent), transparent 70%)`,
                  }}
                />
                <div className="flex items-center justify-between">
                  <span
                    className="flex size-8 items-center justify-center rounded-[10px]"
                    style={{
                      color: m.hex,
                      background: `color-mix(in oklab, ${m.hex} 16%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.hex} 30%, transparent)`,
                    }}
                  >
                    <m.icon className="size-4" />
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight">
                  {m.name}
                </h3>
                <p className="mt-1.5 min-h-[37px] text-[12.5px] leading-relaxed text-muted-foreground">
                  {m.blurb}
                </p>
                {/* mini layer preview — the module's overlay on a map tile */}
                <div
                  className="relative mt-3 h-14 overflow-hidden rounded-[10px] border"
                  style={{
                    borderColor: `color-mix(in oklab, ${m.hex} 22%, var(--border))`,
                    background: MINI_TILE_BG,
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-40 transition-opacity duration-200 group-hover:opacity-60"
                    style={{ background: m.hex, clipPath: m.clip }}
                  />
                  <div
                    className="absolute inset-0 opacity-80"
                    style={{
                      clipPath: m.clip,
                      boxShadow: `inset 0 0 0 1.5px ${m.hex}`,
                    }}
                  />
                  <div
                    className="absolute left-[12%] top-[28%] h-[42%] w-[20%] rounded-[2px] border-[1.5px]"
                    style={{
                      borderColor: "var(--selected-property)",
                      background:
                        "color-mix(in oklab, var(--selected-property) 10%, transparent)",
                    }}
                  />
                  <span className="absolute bottom-1 right-1.5 rounded-full bg-black/45 px-1.5 py-0.5 font-mono text-[8.5px] tracking-wide text-white backdrop-blur-[2px]">
                    {m.tag}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 p-4 text-[13.5px] text-muted-foreground">
              + more layers added each sprint
            </div>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="flex flex-col gap-6 sm:gap-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              Pricing
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              One property. One flat price.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-[14px] leading-relaxed text-muted-foreground">
              No subscription. Preview the flood layer free, unlock the full
              fact pack when you&rsquo;re serious.
            </p>
          </div>

          <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Free preview */}
            <div className="flex flex-col gap-5 rounded-3xl border border-border/60 bg-card/60 p-7 backdrop-blur-sm">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/70">
                  Free preview
                </div>
                <div className="text-[12px] text-muted-foreground">
                  No card required
                </div>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-tight">$0</span>
                <span className="text-[13px] text-muted-foreground">AUD</span>
              </div>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-muted-foreground">
                <li>· Flooding module unlocked (BCC + QLD historic)</li>
                <li>· Per-lot aerial with the property outlined</li>
                <li>· Lot, area, suburb metadata</li>
                <li className="text-foreground/40">· Other 10 modules blurred</li>
              </ul>
            </div>

            {/* Paid */}
            <div
              className="relative flex flex-col gap-5 rounded-3xl p-7 text-foreground"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in oklab, var(--apple-blue) 12%, transparent), color-mix(in oklab, var(--apple-purple) 14%, transparent))",
                border:
                  "1px solid color-mix(in oklab, var(--apple-blue) 28%, transparent)",
              }}
            >
              <div className="flex items-baseline justify-between">
                <div
                  className="text-[11px] font-medium uppercase tracking-[0.18em]"
                  style={{ color: "var(--apple-blue)" }}
                >
                  Full report
                </div>
                <div className="text-[12px] text-muted-foreground">
                  One-time · per address
                </div>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-tight">
                  $29
                </span>
                <span className="text-[13px] text-muted-foreground">AUD</span>
              </div>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-foreground/80">
                <li>· All 11 modules unlocked</li>
                <li>· Per-module map with overlay polygons</li>
                <li>· Cited ArcGIS source rows on every claim</li>
                <li>· A4 PDF export, branded cover page</li>
                <li>· Lifetime access to the report URL</li>
              </ul>
              <div className="text-[12px] text-muted-foreground">
                Secure checkout via Stripe · Apple Pay &amp; cards accepted
              </div>
            </div>
          </div>

          <p className="text-center text-[12px] text-muted-foreground">
            Buying multiple properties?{" "}
            <a
              href="mailto:hello@lotlens.au"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Email us
            </a>{" "}
            for bulk pricing — buyer&rsquo;s agents and conveyancers get a
            volume discount.
          </p>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="flex flex-col gap-6">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              FAQ
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Good questions.
            </h2>
          </div>
          <div className="mx-auto w-full max-w-2xl border-t border-border/60">
            {FAQS.map((f, i) => (
              <details
                key={f.q}
                className="group border-b border-border/60"
                open={i === 0}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                    style={{ color: "var(--apple-blue)" }}
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-[62ch] pb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="glass relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-10 sm:py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[-30%] h-[120%] w-[70%] -translate-x-1/2"
            style={{
              background:
                "radial-gradient(60% 100% at 50% 0, color-mix(in oklab, var(--apple-blue) 22%, transparent), transparent 70%)",
              filter: "blur(10px)",
            }}
          />
          <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
            Before you sign
          </div>
          <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            See what&rsquo;s really on the lot.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-pretty text-[14.5px] leading-relaxed text-muted-foreground">
            Flooding preview is free. Ninety seconds now can save a very
            expensive surprise later.
          </p>
          <a
            href="#top"
            className="mt-7 inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
              boxShadow:
                "0 8px 20px -8px color-mix(in oklab, var(--apple-blue) 70%, transparent)",
            }}
          >
            Run a report
          </a>
        </section>

        {/* ── DISCLAIMER ── */}
        <section id="disclaimer" className="mx-auto max-w-3xl">
          <div className="rounded-3xl border border-border/60 bg-card/60 p-6 text-center text-[13px] leading-relaxed text-muted-foreground backdrop-blur-sm">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80">
              Disclaimer
            </div>
            <p className="text-pretty">{DISCLAIMER}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-background/40 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-[11.5px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left sm:text-[12px]">
          <span>© LotLens — Brisbane Due Diligence</span>
          <span>Public data only · No valuation · No title search</span>
        </div>
      </footer>
    </>
  );
}
