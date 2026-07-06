import {
  CloudRain,
  Flame,
  GraduationCap,
  Landmark,
  LayoutGrid,
  Leaf,
  ScrollText,
  Volume2,
  Waves,
  Wind,
} from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { ModuleCard, type ModuleStatus } from "@/components/site/module-card";
import { AddressForm } from "@/components/site/address-form";

type LandingModule = {
  icon: typeof Waves;
  name: string;
  source: string;
  blurb: string;
  tint: string;
  status: ModuleStatus;
};

const MODULES: LandingModule[] = [
  {
    icon: Waves,
    name: "Flooding",
    source: "BCC Flood Awareness · QLD historic",
    blurb:
      "Creek, river, overland and storm tide risk levels, plus 2011 and 2022 historic event extents.",
    tint: "var(--apple-blue)",
    status: "high",
  },
  {
    icon: Waves,
    name: "Flood Planning",
    source: "BCC statutory overlays",
    blurb:
      "Brisbane River and creek/waterway flood planning areas — the statutory bands that drive City Plan controls.",
    tint: "var(--apple-indigo)",
    status: "medium",
  },
  {
    icon: CloudRain,
    name: "Overland Flow",
    source: "BCC Overland Flow Path overlay",
    blurb:
      "Stormwater runoff paths across the lot. Affects floor levels, fencing, and minor works approvals.",
    tint: "var(--apple-teal)",
    status: "medium",
  },
  {
    icon: Wind,
    name: "Storm Tide",
    source: "BCC Coastal Hazard overlay",
    blurb:
      "Storm tide inundation extents for bayside and tidal-creek properties. Insurance-relevant.",
    tint: "var(--apple-teal)",
    status: "low",
  },
  {
    icon: Flame,
    name: "Bushfire",
    source: "QLD State Hazard Mapping",
    blurb:
      "Bushfire prone area classification with proximity buffers and potential impact category.",
    tint: "var(--apple-orange)",
    status: "low",
  },
  {
    icon: Leaf,
    name: "Vegetation",
    source: "BCC Biodiversity overlay",
    blurb:
      "Significant vegetation, koala habitat, and tree clearing constraints across the parcel.",
    tint: "var(--apple-green)",
    status: "low",
  },
  {
    icon: Volume2,
    name: "Noise",
    source: "BCC Transport noise + ANEF",
    blurb:
      "Road, rail and aviation noise corridors. ANEF bands flag AS2021 acoustic treatment requirements.",
    tint: "var(--apple-yellow)",
    status: "medium",
  },
  {
    icon: GraduationCap,
    name: "School Catchments",
    source: "QLD Department of Education",
    blurb:
      "State primary and secondary school catchments by year level — the schools your child is entitled to attend.",
    tint: "var(--apple-teal)",
    status: "none",
  },
  {
    icon: Landmark,
    name: "Heritage & Character",
    source: "BCC Heritage Register",
    blurb:
      "Heritage listings and Character Protection overlays. Affects what you can renovate or demolish.",
    tint: "var(--apple-purple)",
    status: "none",
  },
  {
    icon: ScrollText,
    name: "High-Voltage Easements",
    source: "BCC powerline corridor overlay",
    blurb:
      "Detects high-voltage transmission easements only. Drainage, sewer, access and title-registered easements need a conveyancer's QLD Title Search.",
    tint: "var(--apple-pink)",
    status: "medium",
  },
  {
    icon: LayoutGrid,
    name: "Zoning",
    source: "BCC City Plan",
    blurb:
      "Zone code, precinct and overlay codes that determine how the land can be used and developed.",
    tint: "var(--apple-indigo)",
    status: "none",
  },
];

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 pb-16 pt-8 sm:gap-24 sm:px-6 sm:pb-24 sm:pt-20">
        {/* Hero + address form */}
        <section className="flex flex-col items-center gap-6 text-center sm:gap-10">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium text-foreground/70 sm:text-[12px]">
            <span
              className="size-1.5 rounded-full"
              style={{ background: "var(--apple-green)" }}
            />
            Brisbane LGA · 11 modules · public data only
          </span>

          <h1 className="text-balance text-[2.4rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            Brisbane Property
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, var(--apple-blue), var(--apple-purple) 55%, var(--apple-pink))",
              }}
            >
              Due Diligence.
            </span>
          </h1>

          <p className="max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
            Enter a Brisbane address to see what you&rsquo;re buying. We pull
            council and state overlay data across eleven modules and translate
            it into plain English — cited line by line.
          </p>

          {/* Live: geocode → fetch-overlays → generate-narrative → redirect */}
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
        </section>

        {/* Module preview grid */}
        <section id="modules" className="flex flex-col gap-6 sm:gap-8">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-6">
            <div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                Eleven modules
              </div>
              <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
                Every claim cited to public data.
              </h2>
            </div>
            <p className="hidden max-w-sm text-pretty text-[14px] leading-relaxed text-muted-foreground md:block">
              The narrative engine cites the ArcGIS rows it read. No invented
              risk levels. No estimated values.
            </p>
          </div>

          <div
            className="marquee -mx-4 sm:-mx-6"
            style={{ ["--marquee-duration" as string]: "60s" }}
          >
            <div className="marquee-track px-4 sm:px-6">
              {[...MODULES, ...MODULES].map((m, i) => (
                <div
                  key={`${m.name}-${i}`}
                  className="w-[280px] shrink-0 sm:w-[300px]"
                  aria-hidden={i >= MODULES.length}
                >
                  <ModuleCard
                    icon={m.icon}
                    name={m.name}
                    source={m.source}
                    blurb={m.blurb}
                    tint={m.tint}
                    status={m.status}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="flex flex-col gap-6 sm:gap-8">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-6">
            <div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                Pricing
              </div>
              <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
                Pay once. Per address.
              </h2>
            </div>
            <p className="hidden max-w-sm text-pretty text-[14px] leading-relaxed text-muted-foreground md:block">
              No subscription, no surprise add-ons. The Flooding module is
              always free so you can sanity-check the data before paying.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <span className="text-5xl font-semibold tracking-tight">
                  $0
                </span>
                <span className="text-[13px] text-muted-foreground">
                  AUD
                </span>
              </div>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-muted-foreground">
                <li>· Flooding module unlocked (BCC + QLD historic)</li>
                <li>· Property polygon + base map render</li>
                <li>· Lot, area, suburb metadata</li>
                <li className="text-foreground/40">
                  · Other 10 modules blurred
                </li>
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
                <span className="text-[13px] text-muted-foreground">
                  AUD
                </span>
              </div>
              <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-foreground/80">
                <li>· All 11 modules unlocked</li>
                <li>· Per-module map with overlay polygons</li>
                <li>· Cited ArcGIS source rows on every claim</li>
                <li>· A4 PDF export, branded cover page</li>
                <li>· Lifetime access to the report URL</li>
              </ul>
              <div className="text-[12px] text-muted-foreground">
                Secure checkout via Stripe · Apple Pay & cards accepted
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

        {/* Pipeline strip */}
        <section className="glass rounded-3xl p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8">
            {[
              {
                step: "01",
                title: "Geocode + spatial query",
                body:
                  "Address resolves to lat / lng / lot-plan. Eleven ArcGIS REST endpoints queried in parallel against the parcel polygon.",
                tint: "var(--apple-blue)",
              },
              {
                step: "02",
                title: "Persist + structure",
                body:
                  "Raw responses land in a Postgres store, each row tagged with module, source URL, and a classified risk level.",
                tint: "var(--apple-teal)",
              },
              {
                step: "03",
                title: "Plain-English narrative",
                body:
                  "A deterministic narrative engine writes per-module summaries strictly from the cited rows. No hallucinated facts, no estimated values.",
                tint: "var(--apple-purple)",
              },
            ].map((s) => (
              <div key={s.step} className="flex flex-col gap-3">
                <span
                  className="text-[11px] font-semibold tracking-[0.18em]"
                  style={{ color: s.tint }}
                >
                  {s.step}
                </span>
                <div className="text-[15px] font-semibold tracking-tight">
                  {s.title}
                </div>
                <p className="text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Disclaimer */}
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
