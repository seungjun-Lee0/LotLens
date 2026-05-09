import {
  Flame,
  Landmark,
  LayoutGrid,
  ScrollText,
  Waves,
} from "lucide-react";

import { SiteHeader } from "@/components/site/site-header";
import { ModuleCard } from "@/components/site/module-card";
import { AddressForm } from "@/components/site/address-form";

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-6 pb-24 pt-12 sm:pt-20">
        {/* Hero + address form */}
        <section className="flex flex-col items-center gap-10 text-center">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-foreground/70">
            <span
              className="size-1.5 rounded-full"
              style={{ background: "var(--apple-green)" }}
            />
            Prototype · Brisbane LGA only
          </span>

          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
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

          <p className="max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground">
            Enter a Brisbane address to see what you&rsquo;re buying. We pull
            council overlay data across five modules and translate it into
            plain English — cited line by line.
          </p>

          {/* Address form — wiring lands in Task 7 */}
          <AddressForm />

          <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Try one of ours —</span>
            <button
              type="button"
              className="glass rounded-full px-3 py-1.5 font-medium transition hover:bg-foreground/5"
            >
              Property A · clean baseline
            </button>
            <button
              type="button"
              className="glass-tint rounded-full px-3 py-1.5 font-medium"
              style={{ ["--tint" as string]: "var(--apple-orange)" }}
            >
              Property B · 2022 flood case
            </button>
          </div>
        </section>

        {/* Module preview grid */}
        <section id="modules" className="flex flex-col gap-8">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Five modules
              </div>
              <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Every claim cited to public data.
              </h2>
            </div>
            <p className="hidden max-w-sm text-pretty text-[14px] leading-relaxed text-muted-foreground md:block">
              The narrative engine cites the ArcGIS rows it read. No invented
              risk levels. No estimated values.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ModuleCard
              icon={Waves}
              name="Flooding"
              source="BCC Flood Awareness · QLD historic"
              blurb="Creek, river, overland and storm tide risk levels, plus 2011 and 2022 historic event extents."
              tint="var(--apple-blue)"
              status="high"
            />
            <ModuleCard
              icon={Flame}
              name="Bushfire"
              source="QLD State Hazard Mapping"
              blurb="Bushfire prone area classification with proximity buffers and potential impact category."
              tint="var(--apple-orange)"
              status="low"
            />
            <ModuleCard
              icon={Landmark}
              name="Heritage & Character"
              source="BCC Heritage Register"
              blurb="Heritage listings and Character Protection overlays. Affects what you can renovate or demolish."
              tint="var(--apple-purple)"
              status="none"
            />
            <ModuleCard
              icon={ScrollText}
              name="Easements"
              source="BCC public overlay"
              blurb="Council-mapped easements only. We do not run a paid QLD Title Search — confirm with a conveyancer."
              tint="var(--apple-teal)"
              status="medium"
            />
            <ModuleCard
              icon={LayoutGrid}
              name="Zoning"
              source="BCC City Plan"
              blurb="Zone code, precinct and overlay codes that determine how the land can be used and developed."
              tint="var(--apple-indigo)"
              status="none"
            />

            {/* Sixth tile: a "more coming" / scope-reminder card to balance the grid */}
            <div
              className="flex flex-col justify-between gap-4 rounded-3xl border border-dashed border-border/70 p-6 text-[13.5px] leading-relaxed text-muted-foreground"
              aria-hidden
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-foreground/70">
                Out of scope — for now
              </div>
              <p className="text-pretty">
                Noise, stormwater, slope, sewer, water, power lines, boundary,
                public transport, historic imagery, vegetation, overland flow,
                coastal flood. Twelve more modules deferred to MVP.
              </p>
              <div className="text-[12px]">
                See <code className="rounded bg-foreground/5 px-1.5 py-0.5">CLAUDE.md §3</code>
              </div>
            </div>
          </div>
        </section>

        {/* Pipeline strip */}
        <section className="glass rounded-3xl p-8">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Geocode + spatial query",
                body:
                  "Address resolves to lat / lng / lot-plan. Five ArcGIS REST endpoints queried in parallel.",
                tint: "var(--apple-blue)",
              },
              {
                step: "02",
                title: "Persist + structure",
                body:
                  "Raw responses land in Supabase (PostGIS). Each row tagged with module, source URL, risk level.",
                tint: "var(--apple-teal)",
              },
              {
                step: "03",
                title: "Plain-English narrative",
                body:
                  "Claude Sonnet 4.5 writes per-module summaries with RAG-bounded citations. No hallucinated facts.",
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

        {/* Disclaimer (verbatim — CLAUDE.md §9 item 3 requires this on every report) */}
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
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-[12px] text-muted-foreground sm:flex-row">
          <span>© PropAI — Brisbane DD prototype</span>
          <span>Public data only · No valuation · No title search</span>
        </div>
      </footer>
    </>
  );
}
