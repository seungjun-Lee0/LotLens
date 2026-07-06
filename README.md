# LotLens — Brisbane Property Due Diligence

An end-to-end Brisbane LGA property due diligence report generator.
Type an address → the backend geocodes, queries five public ArcGIS
overlay layers, persists results to Postgres (Vercel Postgres / Neon),
and renders a web report plus a print-ready PDF.

This is a **prototype**, not an MVP. The point is to prove the
public-data + structured-narrative pipeline produces a usable DD report
that feels meaningfully better than the existing "raw layer dump" tools
on the market (e.g. Develo). It is not a finished product.

## What it does

Five modules per property (SPEC.md §2):

1. **Flooding** — BCC Flood Awareness Mapping (creek/river/storm tide
   overall risk) + Feb 2022 and Jan 2011 historic flood extents.
2. **Bushfire** — BCC City Plan Bushfire overlay (council-scope; the
   statewide QFD BPA is publish-only as a cached tile service and
   isn't queryable).
3. **Heritage & Character** — BCC State + Local heritage areas + the
   Traditional Building Character (pre-1947) overlay.
4. **Easements** — BCC public high-voltage powerline easement overlay
   only. The majority of easements live on title; a paid QLD Title
   Search is required to see them and is **out of scope**.
5. **Zoning** — BCC City Plan 2014 zone code + precinct.

Each module page in the web view and PDF carries: a clarifying
question, a property-centric map with overlay polygons in module
colours, a "Considerations identified" status pill, a generic "Things
to know" educational explainer, the AI narrative for this specific
property (currently a stubbed deterministic renderer — see "LLM"
below), module-specific facts, a verbatim "Note:" caveat, "Questions
to ask" bullets, the source colour legend, and source links.

## What it does NOT do

Out of scope for the prototype (SPEC.md §3). If a request seems to
need any of these, surface it before building:

- User accounts, login, auth
- Stripe / Afterpay / any payment flow
- Marketing landing page, SEO, suburb pages
- Email, lead magnets, notifications
- The remaining 12 Develo modules (noise, stormwater, slope, sewer,
  water, power lines, boundary, public transport, historic imagery,
  vegetation, overland flow standalone, flood coastal)
- Non-Brisbane LGAs (Moreton Bay, Logan, Gold Coast, etc.)
- QLD Title Search (paid per-lookup; legal + cost reasons)
- Mobile-specific optimisation
- Analytics (PostHog, GA4), error monitoring (Sentry)
- Multi-provider LLM routing
- Admin dashboards, manual-review UI
- A "valuation" — the Queensland Valuers Registration Act prohibits
  unlicensed property valuations. Never estimate property value.

## Tech stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind v4 +
  shadcn/ui
- **Maps**: MapLibre GL JS on the web (OSM raster basemap), the
  `staticmaps` npm package for server-rendered PDF map images
- **Backend**: Next.js Route Handlers, Postgres via
  `@neondatabase/serverless` (Vercel Postgres / Neon — HTTP-fetch
  driver, no connection pool to manage in serverless functions)
- **LLM narrative**: Currently a deterministic stub in
  [`lib/anthropic.ts`](./lib/anthropic.ts) that mirrors the Anthropic
  SDK signature. Swap for a real Claude Sonnet 4.5 call without
  changing route handlers, the report page, or the PDF — the data
  shape is final.
- **PDF**: `@react-pdf/renderer` with pre-rendered static map images
- **Geocoding**: Google Maps Geocoding + Places Autocomplete when
  `GOOGLE_GEOCODING_API_KEY` is set (unit / apartment precision), OSM
  Nominatim fallback otherwise (street-level only)

## Run it locally

### 1. Postgres (Vercel Postgres / Neon)

On the Vercel dashboard for your project → **Storage** → **Create
Database** → **Postgres** (Vercel uses Neon under the hood). Pick the
free tier and `iad1` (closest to the Vercel functions). Vercel will
auto-inject `DATABASE_URL` (and a few other variants) into every
deployment's environment.

Then open the Postgres "Query" tab in the Vercel dashboard and paste
the contents of [`db/schema.sql`](./db/schema.sql) to create the three
tables.

Standalone Neon (without the Vercel integration) works the same way —
sign up at neon.tech, create a project, copy the connection string.

### 2. Env vars

Copy `.env.local.example` to `.env.local` and fill in:

```
DATABASE_URL=postgresql://...   # Vercel Postgres / Neon connection string
# Optional — enables unit / apartment-level AU geocoding (see below).
GOOGLE_GEOCODING_API_KEY=
# Optional. When unset, the LLM stub is used (Task 4b — see
# lib/anthropic.ts).
ANTHROPIC_API_KEY=
NEXT_PUBLIC_DEBUG=false
```

### Optional: Google Geocoding for unit / apartment precision

Nominatim has no unit-number data for AU — it only resolves to the
street. For live demos where buyers paste "Unit 103, …" we need
Google. Free tier $200/mo (~10K geocoding + autocomplete requests),
nowhere near a demo's traffic.

1. Google Cloud Console → create a project (or reuse one).
2. **APIs & Services → Library** → enable both:
   - Geocoding API
   - Places API
3. **APIs & Services → Credentials** → Create API Key.
4. Restrict the key:
   - **Application restrictions**: HTTP referrer → add your Vercel
     domain (e.g. `https://prop-ai-three.vercel.app/*`). For local
     dev the server-side route uses the key directly, so the
     restriction can stay HTTP-referrer; just make sure to also
     add `http://localhost:3000/*` during dev.
   - **API restrictions**: limit to Geocoding API + Places API.
5. Set `GOOGLE_GEOCODING_API_KEY` in `.env.local` and on Vercel.

When the key is missing the routes silently fall back to Nominatim,
so the prototype keeps working — you just lose unit precision.

`DATABASE_URL` is server-only and must never reach a browser bundle.
The client in [`lib/db.ts`](./lib/db.ts) enforces this —
`getDb()` throws if called from `window`.

### 3. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and try one of the preset chips, or type
any Brisbane LGA address.

### Useful scripts

- `npx tsx scripts/test-db.ts` — verifies env vars and that the three
  tables exist.
- `npx tsx scripts/test-flooding.ts` (and `-bushfire`, `-zoning`,
  `-heritage`, `-easements`) — probe the ArcGIS endpoints directly,
  no DB needed.
- `npx tsx scripts/run-end-to-end.ts [addressId]` — inserts the
  Rocklea Markets test address if needed, runs fetch-overlays +
  generate-narrative, prints the full report JSON.

## Deploy to Vercel

```bash
npx vercel
```

…or push the repo to a Vercel-linked GitHub project. Either way:

1. Add the same env vars from `.env.local` in **Project Settings →
   Environment Variables** (Production + Preview + Development).
2. Function `maxDuration` is set per route — `60 s` for
   `/api/fetch-overlays`, `/api/generate-narrative`, and
   `/api/report/[id]/pdf` (which pre-renders five OSM map images),
   `30 s` for `/api/geocode`. On Hobby tier 60 s is the cap; if a
   route ever times out, the route file is where to lift the limit.
3. Vercel's Node runtime ships pre-built `sharp` binaries, so
   `staticmaps`-based PDF map rendering Just Works.

## Known limitations

- **Develo coordinate caveat**: the `(-27.540, 152.988)` Rocklea coord
  in TASKS.md sits just outside the FAM flood polygon. For Property B
  you want a coord deeper in the flood zone, e.g. Rocklea Markets
  (`-27.5464, 152.9912`).
- **Easements module** sees only Council-mapped high-voltage easement
  corridors (17 polygons across the whole BCC LGA). All other
  easements live on title — the report is clear about this in every
  module page footer note.
- **No real LLM call**. Per-module narrative is a deterministic stub.
  The data shape matches the final Anthropic-call shape, so swapping
  is a single-file change in `lib/anthropic.ts`.
- **Maps are pin-only when no overlay exists nearby**. Bushfire,
  heritage, and easement layers genuinely have no features within
  280 m of many Brisbane addresses (e.g. industrial Rocklea); those
  modules render base-map + pin without polygons.
- **Mobile is unstyled**. Desktop-first prototype.
- **No auth, no RLS**. Lock down at MVP.

## Legal guardrails

Carried through to the UI and PDF disclaimer (SPEC.md §9):

> This report aggregates public data for informational purposes only.
> It is not legal, financial, or planning advice. Confirm all details
> with a qualified professional, conveyancer, or the relevant Council
> before making decisions.

No valuation. No title search. No `realestate.com.au` / `domain.com.au`
data. No display of current owner contact details.

## Project structure

```
app/                  Next.js App Router pages + API route handlers
  api/geocode         Nominatim wrapper, Brisbane LGA viewbox
  api/fetch-overlays  Runs 5 module fetchers in parallel, writes
                      council_data rows
  api/generate-narrative  Generates per-module narrative (stub),
                          writes a reports row
  api/report/[id]/pdf     Pre-renders 5 module map PNGs, streams PDF
  report/[id]         Web report view
components/
  report/             Module section, RiskBadge, map, PDF document
  site/               Header, theme toggle, address form
  ui/                 shadcn-generated primitives
lib/
  arcgis.ts           queryArcGIS helper (envelope + buffer support)
  modules/            One file per module: ArcGIS endpoints,
                      classification, point + context queries
  anthropic.ts        Narrative generator (stub today)
  pipeline.ts         End-to-end orchestration consumed by routes +
                      scripts
  db.ts               Neon Postgres client (server-only)
  overlays.ts         Map-overlay feature extractor
  module-meta.ts      Per-module display copy (question, things-to-
                      know, note, legend, hex)
  static-map.ts       Server-side OSM-tile PNG renderer for PDF
db/                   schema.sql + seed.sql + README
scripts/              Manual test scripts
```

## Origin

The architecture is set by [`AGENTS.md`](./AGENTS.md) → linked to a
project-level SPEC.md (kept outside the repo). Don't expand scope
without checking against the OUT-of-scope list before building.
