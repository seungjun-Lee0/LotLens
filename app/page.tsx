import {
  CloudRain,
  Droplets,
  Flame,
  GraduationCap,
  Landmark,
  LayoutGrid,
  Leaf,
  Mountain,
  PawPrint,
  ScrollText,
  TrendingUp,
  Volume2,
  Waves,
  Wind,
} from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { AddressForm } from "@/components/site/address-form";
import { CtaStage } from "@/components/site/cta-stage";
import { FaqScroller } from "@/components/site/faq-scroller";
import { Reveal } from "@/components/site/reveal";
import { SubscribeButton } from "@/components/site/billing-buttons";
import { HeroShowcase, type HeroDemoData } from "@/components/site/hero-showcase";

// Real report data for the hero's demo lot (Stafford, 10SP348436) — actual
// cadastre parcel + per-module council overlays, snapshotted by
// `npx tsx scripts/generate-hero-demo.ts`. The aerial crops are derived from
// the bboxes stored in the fixture so imagery and geometry always align.
import heroDemoJson from "@/lib/hero-demo-data.json";

const heroDemo = heroDemoJson as unknown as HeroDemoData;

// ── Landing module registry ──────────────────────────────────────────────────────────────────────────────────────────────
// `hex` mirrors the overlay colour the report map paints for that module.
type LandingModule = {
  icon: typeof Waves;
  name: string;
  blurb: string;
  hex: string;
};

const MODULES: LandingModule[] = [
  {
    icon: Waves,
    name: "Flooding",
    blurb: "River, creek & storm-tide risk, plus 2011 & 2022 historic events.",
    hex: "#3b82f6",
  },
  {
    icon: Waves,
    name: "Flood Planning",
    blurb: "Which statutory flood planning area the lot sits in, and what it restricts.",
    hex: "#2563eb",
  },
  {
    icon: CloudRain,
    name: "Overland Flow",
    blurb: "Stormwater run-off paths crossing the property.",
    hex: "#f97316",
  },
  {
    icon: Wind,
    name: "Coastal Hazards",
    blurb: "Storm-tide inundation & erosion prone areas, QLD-wide.",
    hex: "#06b6d4",
  },
  {
    icon: Flame,
    name: "Bushfire",
    blurb: "Queensland bushfire hazard rating for the site.",
    hex: "#dc2626",
  },
  {
    icon: Leaf,
    name: "Vegetation",
    blurb: "Regulated vegetation (VMA), waterway & biodiversity overlays.",
    hex: "#16a34a",
  },
  {
    icon: PawPrint,
    name: "Environment & Koala",
    blurb: "Core koala habitat & state wildlife habitat mapping.",
    hex: "#10b981",
  },
  {
    icon: Landmark,
    name: "Heritage & Character",
    blurb: "State/local heritage & pre-1947 character controls.",
    hex: "#7e22ce",
  },
  {
    icon: ScrollText,
    name: "Easements",
    blurb: "High-voltage & registered cadastral easements on the lot.",
    hex: "#db2777",
  },
  {
    icon: Volume2,
    name: "Noise",
    blurb: "Transport-corridor & aircraft (ANEF) noise bands.",
    hex: "#f59e0b",
  },
  {
    icon: TrendingUp,
    name: "Steep Land",
    blurb: "Landslide hazard & steep-land overlays from your council.",
    hex: "#f59e0b",
  },
  {
    icon: Droplets,
    name: "Acid Sulfate Soils",
    blurb: "Coastal-lowland soils that turn acidic when excavated.",
    hex: "#eab308",
  },
  {
    icon: Mountain,
    name: "Mining & Resources",
    blurb: "Resource tenures & quarry buffer areas over the lot.",
    hex: "#a855f7",
  },
  {
    icon: GraduationCap,
    name: "School Catchments",
    blurb: "State primary & secondary catchment zones.",
    hex: "#14b8a6",
  },
  {
    icon: LayoutGrid,
    name: "Zoning",
    blurb: "City Plan zone, precinct & what you're allowed to build.",
    hex: "#6366f1",
  },
];

const FAQS = [
  {
    q: "Is this legal or planning advice?",
    a: "No. LotLens aggregates public council & state data into plain English for your own research. It's not legal, financial or planning advice — always confirm details with a qualified professional, conveyancer or the relevant Council before you act.",
  },
  {
    q: "How accurate is the data?",
    a: "Every layer is queried live, straight from local council and Queensland Government sources at the moment you run the report — not a stale cached copy. Each finding cites its exact source layer.",
  },
  {
    q: "Which areas are covered?",
    a: "Any Queensland address. Statewide layers (cadastre, bushfire, coastal hazards, heritage register, vegetation, koala habitat, acid sulfate soils, mining, school catchments) run everywhere. Detailed council overlays (flood risk bands, zoning, transport noise, landslide) are live for Brisbane, Gold Coast, Moreton Bay, Sunshine Coast and Redland — and the report tells you honestly when a council layer isn't integrated yet for other LGAs.",
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

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* ── HERO — blurred aerial full-bleed, sharp loupe on the right ── */}
      {/* overflow-CLIP, not hidden: hidden boxes are still programmatically
          scrollable, and anything calling scrollIntoView/focus inside (rail
          pins, keyboard tabbing) could shift the whole hero sideways over
          the oversized aerial canvas. clip cannot scroll, ever. */}
      <section
        id="top"
        className="relative -mt-16 overflow-clip pt-16 sm:-mt-[72px] sm:pt-[72px]"
      >
        <HeroShowcase data={heroDemo}>
          {/* copy + live address form */}
          <div className="flex flex-col items-start gap-5 sm:gap-6">
            {/* <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium text-foreground/70 sm:text-[12px]">
              <span
                className="size-1.5 rounded-full"
                style={{ background: "var(--apple-green)" }}
              />
              Public council + Queensland state data
            </span> */}

            <h1 className="text-balance text-[2.15rem] font-semibold leading-[1.06] tracking-tight sm:text-6xl sm:leading-[1.03]">
              Queensland property,
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
              · full report $19 during beta · no signup to preview
            </p>
          </div>

        </HeroShowcase>
      </section>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 pb-14 pt-10 sm:gap-24 sm:px-6 sm:pb-24 sm:pt-20">
        {/* ── MODULES — map-tile cards: the layer IS the card ── */}
        <section id="modules" className="cv-auto flex flex-col gap-8">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              What&rsquo;s checked
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Fifteen layers, one report.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-[14px] leading-relaxed text-muted-foreground">
              Every tile is that overlay exactly as it renders on your
              report&rsquo;s map — same colours, same amber lot outline.
            </p>
          </div>

          {/* 2-up on phones — a single column of 16 cards scrolls forever */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
            {MODULES.map((m, i) => (
              <Reveal key={m.name} className="card-reveal" delay={(i % 4) * 90}>
                <div
                  className="mod-card group relative h-full rounded-2xl border border-border/60 bg-card/70 p-4 sm:p-5"
                  style={{ ["--c" as string]: m.hex }}
                >
                  <div className="flex items-center justify-between">
                    <m.icon className="size-[18px]" style={{ color: m.hex }} />
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[13.5px] font-semibold tracking-tight sm:mt-4 sm:text-[14.5px]">
                    {m.name}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground sm:text-[12.5px]">
                    {m.blurb}
                  </p>
                </div>
              </Reveal>
            ))}
            {/* filler card — rounds out the grid */}
            <Reveal className="card-reveal" delay={(MODULES.length % 4) * 90}>
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 p-4 text-center text-[12.5px] leading-snug text-muted-foreground">
                + more layers added each sprint
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="cv-auto flex flex-col gap-6 sm:gap-8">
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

          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
            {/* Single report — beta price */}
            <Reveal className="rise-reveal">
            <div className="flex h-full flex-col gap-4 rounded-3xl border border-border/60 bg-card/60 p-5 sm:p-7">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/70">
                  Single report
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{
                    background:
                      "color-mix(in oklab, var(--apple-green) 14%, transparent)",
                    color: "var(--apple-green)",
                  }}
                >
                  Beta
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight sm:text-5xl">$19</span>
                <span className="text-[14px] text-muted-foreground line-through">
                  $29
                </span>
                <span className="text-[13px] text-muted-foreground">AUD</span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                One-off · per address · $29 after beta
              </p>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-muted-foreground">
                <li>· All 15 modules for one address</li>
                <li>· A4 PDF export, branded cover</li>
                <li>· No subscription, no auto-renewal</li>
                <li>· Flooding preview always free first</li>
              </ul>
              <a
                href="#top"
                className="mt-auto inline-flex h-11 w-full items-center justify-center rounded-full border border-border/70 bg-background/50 text-[14px] font-medium transition hover:bg-foreground/5"
              >
                Run a report
              </a>
            </div>
            </Reveal>

            {/* Basic */}
            <Reveal className="rise-reveal" delay={120}>
            <div className="flex h-full flex-col gap-4 rounded-3xl border border-border/60 bg-card/60 p-5 sm:p-7">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/70">
                  Basic
                </div>
                <div className="text-[12px] text-muted-foreground">
                  Cancel anytime
                </div>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight sm:text-5xl">$49</span>
                <span className="text-[13px] text-muted-foreground">
                  AUD / month
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                For serious house-hunting weeks
              </p>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-muted-foreground">
                <li>· 10 full reports per month</li>
                <li>· Single user</li>
                <li>· Renews monthly — no automatic top-ups</li>
                <li>· Manage or cancel in one click</li>
              </ul>
              <div className="mt-auto">
                <SubscribeButton plan="basic" label="Start Basic" variant="ghost" />
              </div>
            </div>
            </Reveal>

            {/* Pro — featured */}
            <Reveal className="rise-reveal" delay={240}>
            <div
              className="relative flex h-full flex-col gap-4 rounded-3xl p-5 text-foreground sm:p-7"
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
                  Pro
                </div>
                <div className="text-[12px] text-muted-foreground">
                  For professionals
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight sm:text-5xl">$79</span>
                <span className="text-[14px] text-muted-foreground line-through">
                  $99
                </span>
                <span className="text-[13px] text-muted-foreground">
                  AUD / month
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Beta price · $99/month after beta
              </p>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-foreground/80">
                <li>· 50 full reports per month</li>
                <li>· Branded PDF reports</li>
                <li>· Buyer&rsquo;s agents &amp; conveyancers</li>
                <li>· Renews monthly — no automatic top-ups</li>
              </ul>
              <div className="mt-auto">
                <SubscribeButton plan="pro" label="Start Pro" />
              </div>
            </div>
            </Reveal>
          </div>

          <p className="text-center text-[12px] text-muted-foreground">
            Monthly plans renew monthly and never top up without confirmation ·
            Secure checkout via Stripe · Apple Pay &amp; cards accepted ·{" "}
            <a
              href="mailto:hello@lotlens.au"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Email us
            </a>{" "}
            for volume pricing beyond Pro.
          </p>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="cv-auto flex flex-col gap-6">
          <div className="mx-auto max-w-xl text-center">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
              FAQ
            </div>
            <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Good questions.
            </h2>
          </div>
          <FaqScroller items={FAQS} />
        </section>

        {/* ── FINAL CTA — pinned focus stage: scrolling into the middle
            triggers a smooth grow + page dim that spotlights the card ── */}
        <CtaStage>
        <section className="cta-card glass overflow-hidden rounded-3xl px-5 py-10 text-center sm:px-10 sm:py-16">
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
          {/* the search itself — no detour back to the top */}
          <div className="mx-auto mt-7 w-full max-w-xl text-left">
            <AddressForm />
          </div>
        </section>
        </CtaStage>

        {/* ── DISCLAIMER ── */}
        <section id="disclaimer" className="cv-auto mx-auto w-full max-w-3xl">
          <div className="rounded-3xl border border-border/60 bg-card/60 p-6 text-center text-[13px] leading-relaxed text-muted-foreground">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80">
              Disclaimer
            </div>
            <p className="text-pretty">{DISCLAIMER}</p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
