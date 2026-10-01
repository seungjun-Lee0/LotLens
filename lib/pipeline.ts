// End-to-end DD pipeline.
//
// Two phases, both addressed by address_id:
//
//   1. fetchOverlaysForAddress(): hits every module source in parallel,
//      writes one council_data row per module. Each fetch settles
//      independently: a source that's down becomes a fetchFailed row
//      (risk_level NULL) instead of sinking the whole report.
//   2. generateReportForAddress(): reads the council_data rows back,
//      generates narrative per module (LLM stub in Task 4a), writes one
//      reports row.
//
// Both are idempotent: re-running deletes prior data for that address and
// rewrites. Route handlers and CLI scripts call these directly so we keep
// HTTP-vs-script behaviour identical.

import { revalidateTag, unstable_cache } from "next/cache";

import { fetchAcidSulfateData } from "@/lib/modules/acid-sulfate";
import { fetchBushfireData } from "@/lib/modules/bushfire";
import { fetchEasementsData } from "@/lib/modules/easements";
import { fetchEnvironmentData } from "@/lib/modules/environment";
import { fetchFloodingData } from "@/lib/modules/flooding";
import { fetchFloodPlanningData } from "@/lib/modules/flood-planning";
import { fetchHeritageData } from "@/lib/modules/heritage";
import { fetchLocalPlansData } from "@/lib/modules/local-plans";
import { fetchMiningData } from "@/lib/modules/mining";
import { fetchNoiseData } from "@/lib/modules/noise";
import { fetchOverlandFlowData } from "@/lib/modules/overland-flow";
import { fetchPowerData } from "@/lib/modules/power";
import { fetchSchoolsData } from "@/lib/modules/schools";
import { fetchSteepLandData } from "@/lib/modules/steep-land";
import { fetchStormTideData } from "@/lib/modules/storm-tide";
import { fetchStormwaterData } from "@/lib/modules/stormwater";
import { fetchTransportData } from "@/lib/modules/transport";
import { fetchWaterSewerData } from "@/lib/modules/water-sewer";
import { fetchVegetationData } from "@/lib/modules/vegetation";
import { fetchZoningData } from "@/lib/modules/zoning";
import { fetchBoundaryData } from "@/lib/modules/boundary";
import { fetchInternetData } from "@/lib/modules/internet";
import { slimGeoJson } from "@/lib/geo-slim";
import { regionFromParcel } from "@/lib/region";
import { geocodeAddress } from "@/lib/geocoder";
import { formatAuAddress } from "@/lib/format-address";

import { generateModuleNarrative, type ModuleNarrative } from "@/lib/anthropic";
import {
  getDb,
  ENVIRONMENT_ENABLED,
  MODULE_ORDER,
  POWER_ENABLED,
  WATER_SEWER_ENABLED,
  type CouncilDataRow,
  type Module,
  type RiskLevel,
} from "@/lib/db";
import {
  EMPTY_PARCEL,
  fetchParcelLinesNear,
  fetchPropertyParcel,
  insetParcelPolygon,
  type ParcelInfo,
} from "@/lib/property";
import { fetchPostcode } from "@/lib/postcode";
import { isFlagged } from "@/lib/risk-style";

type Address = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
};

// ── Phase 1: fetch + persist overlays ─────────────────────────────────────

type ModuleOverlay = {
  module: Module;
  /** null = the source couldn't be reached this run (fetchFailed row). */
  riskLevel: RiskLevel | null;
  hasConsideration: boolean;
  sourceName: string;
  sourceUrl: string;
  raw: unknown;
};

/** Minimal shape every module fetcher satisfies. */
type AnyModuleResult = {
  riskLevel: RiskLevel;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string }>;
};

export type FetchOverlaysSummary = {
  addressId: string;
  modules: Record<
    Module,
    { riskLevel: RiskLevel | null; hasConsideration: boolean }
  >;
  /** Modules whose source couldn't be reached this run (fetchFailed rows). */
  failedModules: Module[];
  elapsedMs: number;
};

async function loadAddress(addressId: string): Promise<Address> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, address_text, lat, lng
    FROM addresses
    WHERE id = ${addressId}
    LIMIT 1
  `) as Address[];
  if (rows.length === 0) {
    throw new Error(`address ${addressId} not found`);
  }
  return rows[0];
}

// A complete, failure-free fetch younger than this is served from
// council_data instead of re-hitting ~25 government endpoints. Overlay
// data changes on a cadence of months; 10 minutes only exists to absorb
// double-submits and back-button replays of the same address.
const FRESH_REUSE_MS = 10 * 60_000;

export async function fetchOverlaysForAddress(
  addressId: string,
  opts: { force?: boolean } = {},
): Promise<FetchOverlaysSummary> {
  const t0 = performance.now();
  const sql = getDb();
  const addr = await loadAddress(addressId);

  if (!opts.force) {
    const existing = (await sql`
      SELECT module, risk_level, has_consideration, retrieved_at,
             raw_response->>'fetchFailed' AS fetch_failed
      FROM council_data
      WHERE address_id = ${addressId}
    `) as Array<{
      module: Module;
      risk_level: RiskLevel | null;
      has_consideration: boolean;
      retrieved_at: string;
      fetch_failed: string | null;
    }>;
    // Every module in the current order must be present and fresh. Keyed
    // by module rather than by row count so a stale row for a since-
    // disabled module can neither satisfy nor spoil the check.
    const byModule = new Map(existing.map((r) => [r.module, r]));
    const allFresh = MODULE_ORDER.every((m) => {
      const r = byModule.get(m);
      return (
        !!r &&
        r.fetch_failed !== "true" &&
        Date.now() - new Date(r.retrieved_at).getTime() < FRESH_REUSE_MS
      );
    });
    if (allFresh) {
      console.log(
        `[overlays] reusing fresh council_data for ${addressId} (all ${MODULE_ORDER.length} rows < ${FRESH_REUSE_MS / 60_000} min old)`,
      );
      return {
        addressId,
        modules: Object.fromEntries(
          MODULE_ORDER.map((m) => {
            const r = byModule.get(m)!;
            return [m, { riskLevel: r.risk_level, hasConsideration: r.has_consideration }];
          }),
        ) as FetchOverlaysSummary["modules"],
        failedModules: [],
        elapsedMs: Math.round(performance.now() - t0),
      };
    }
  }

  // Concurrent runs for the same address on this instance (double-submit,
  // back-button replay) share one fan-out instead of racing each other's
  // writes. The row-level upsert below covers the cross-instance case.
  const inflight = inflightFetches.get(addressId);
  if (inflight) return inflight;
  const run = runOverlayFetch(addressId, addr, t0).finally(() => {
    inflightFetches.delete(addressId);
  });
  inflightFetches.set(addressId, run);
  return run;
}

const inflightFetches = new Map<string, Promise<FetchOverlaysSummary>>();

async function runOverlayFetch(
  addressId: string,
  addr: Address,
  t0: number,
): Promise<FetchOverlaysSummary> {
  const sql = getDb();

  // Per-module wall time: one summary line per run so slow government
  // layers are identifiable in prod logs without extra tooling.
  const timings: Record<string, number> = {};
  const timed = async <T,>(name: string, p: Promise<T>): Promise<T> => {
    const t = performance.now();
    try {
      return await p;
    } finally {
      timings[name] = Math.round(performance.now() - t);
    }
  };

  // Every module settles independently: a source that's down (or a fetcher
  // that throws) becomes a fetchFailed row instead of failing the whole
  // report. `settle` attaches its handlers at creation time, so a fetch
  // that rejects while we're still awaiting the parcel lookup can't raise
  // an unhandled-rejection.
  type Settled =
    | { ok: true; value: AnyModuleResult }
    | { ok: false; error: unknown };
  const settle = (
    module: Module,
    p: Promise<AnyModuleResult>,
  ): Promise<Settled> =>
    timed(module, p).then(
      (value) => ({ ok: true as const, value }),
      (error) => {
        console.error(`[overlays] ${module} fetch failed:`, error);
        return { ok: false as const, error };
      },
    );

  // The parcel lookup now gates ALL fetchers: its `shire_name` picks the
  // council adapters AND its polygon becomes the classification geometry -
  // every risk module classifies against the actual cadastre lot (slightly
  // inset so cadastre-snapped layers don't flag the neighbour across a
  // shared boundary), not just the geocoded point. Costs the ~150-300 ms
  // parcel round-trip up front; correctness over latency.
  // fetchPropertyParcel never rejects (returns an EMPTY parcel on failure),
  // so this always proceeds: with no polygon the fetchers fall back to
  // their point/buffer queries.
  const parcelForRegion = await timed(
    "parcel",
    fetchPropertyParcel(addr.lat, addr.lng),
  );
  const region = regionFromParcel(parcelForRegion.lga, addr.lat, addr.lng);
  const lot = parcelForRegion.polygon
    ? insetParcelPolygon(parcelForRegion.polygon)
    : null;

  // Resolve the report's geo blob (neighbour lot lines + postcode) NOW,
  // alongside the module fan-out, and persist it below. The report page
  // then reads it from the DB instead of re-hitting the flaky QLD cadastre
  // and ABS services on every render.
  const geoExtras = Promise.all([
    fetchParcelLinesNear(addr.lat, addr.lng),
    fetchPostcode(addr.lat, addr.lng),
  ]);

  const tasks = new Map<Module, Promise<Settled>>();
  tasks.set("storm_tide", settle("storm_tide", fetchStormTideData(addr.lat, addr.lng, lot)));
  tasks.set("bushfire", settle("bushfire", fetchBushfireData(addr.lat, addr.lng, lot, region)));
  // Disabled: the koala/MSES fan-out fails wholesale on a single flaky
  // MSES 500. Guarded here as well as in MODULE_ORDER so the flag can never
  // leave a task running whose result nothing reads (see ENVIRONMENT_ENABLED).
  if (ENVIRONMENT_ENABLED) {
    tasks.set("environment", settle("environment", fetchEnvironmentData(addr.lat, addr.lng, lot)));
  }
  tasks.set("acid_sulfate", settle("acid_sulfate", fetchAcidSulfateData(addr.lat, addr.lng, lot)));
  tasks.set("mining", settle("mining", fetchMiningData(addr.lat, addr.lng, lot)));
  // Schools stays point-based on purpose: catchment is decided by where
  // the dwelling is, and a lot straddling two catchments would double-list.
  tasks.set("schools", settle("schools", fetchSchoolsData(addr.lat, addr.lng, lot)));
  tasks.set("flooding", settle("flooding", fetchFloodingData(addr.lat, addr.lng, region, lot)));
  tasks.set("flood_planning", settle("flood_planning", fetchFloodPlanningData(addr.lat, addr.lng, region, lot)));
  tasks.set("overland_flow", settle("overland_flow", fetchOverlandFlowData(addr.lat, addr.lng, region, lot)));
  tasks.set("vegetation", settle("vegetation", fetchVegetationData(addr.lat, addr.lng, region, lot)));
  tasks.set("heritage", settle("heritage", fetchHeritageData(addr.lat, addr.lng, region, lot)));
  tasks.set("easements", settle("easements", fetchEasementsData(addr.lat, addr.lng, region, lot)));
  tasks.set("noise", settle("noise", fetchNoiseData(addr.lat, addr.lng, region, lot)));
  tasks.set("steep_land", settle("steep_land", fetchSteepLandData(addr.lat, addr.lng, region, lot)));
  tasks.set("stormwater", settle("stormwater", fetchStormwaterData(addr.lat, addr.lng, region, lot)));
  // Dark until Urban Utilities confirms reuse terms: see WATER_SEWER_ENABLED.
  // Guarded here as well as in MODULE_ORDER so the flag can never leave a
  // task running whose result nothing reads.
  if (WATER_SEWER_ENABLED) {
    tasks.set("water_sewer", settle("water_sewer", fetchWaterSewerData(addr.lat, addr.lng, region, lot)));
  }
  // Dark until Energex confirms commercial reuse terms: see POWER_ENABLED.
  if (POWER_ENABLED) {
    tasks.set("power", settle("power", fetchPowerData(addr.lat, addr.lng, region, lot)));
  }
  tasks.set("local_plans", settle("local_plans", fetchLocalPlansData(addr.lat, addr.lng, region, lot)));
  // Transport is point-based: "what's near the front door", not "what
  // touches the parcel". A lot polygon would only widen the search.
  tasks.set("transport", settle("transport", fetchTransportData(addr.lat, addr.lng)));
  // Zoning stays point-based too: a lot is in one zone for practical
  // purposes, and BCC's point-query zone polygon doubles as the parcel
  // fallback for the report's yellow lot outline.
  tasks.set("zoning", settle("zoning", fetchZoningData(addr.lat, addr.lng, region, lot)));
  // Boundary is arithmetic on the parcel already fetched above: the RAW
  // polygon, not the inset copy the risk modules classify against, so the
  // side lengths are the cadastre's own.
  tasks.set("boundary", settle("boundary", fetchBoundaryData(parcelForRegion)));
  tasks.set("internet", settle("internet", fetchInternetData(addr.lat, addr.lng, lot)));

  const ORDER = MODULE_ORDER;
  const settled = await Promise.all(ORDER.map((m) => tasks.get(m)!));

  console.log(
    "[overlays] module timings:",
    Object.entries(timings)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}ms`)
      .join(" "),
  );

  const failedModules = ORDER.filter((_, i) => !settled[i].ok);
  if (failedModules.length === ORDER.length) {
    // Nothing came back at all: that's our outage (or the machine's
    // network), not N independent source outages. Persisting a full set of
    // blank rows would cache a useless report, so fail the run outright.
    throw new Error(
      "all module sources failed: aborting instead of writing an empty report",
    );
  }
  if (failedModules.length > 0) {
    console.error(
      `[overlays] ${failedModules.length} module(s) failed this run: ${failedModules.join(", ")}`,
    );
  }

  const overlays: ModuleOverlay[] = ORDER.map((module, i) => {
    const s = settled[i];
    if (!s.ok) {
      return {
        module,
        riskLevel: null,
        hasConsideration: false,
        sourceName: "Source temporarily unavailable",
        sourceUrl: "",
        raw: {
          fetchFailed: true,
          error: s.error instanceof Error ? s.error.message : String(s.error),
        },
      };
    }
    const r = s.value;
    return {
      module,
      riskLevel: r.riskLevel,
      hasConsideration: r.hasConsideration,
      sourceName: r.sources[0]?.name ?? "",
      sourceUrl: r.sources[0]?.url ?? "",
      raw: r,
    };
  });

  // Idempotent upsert on (address_id, module): each module row is replaced
  // in place, so a run never leaves the address without rows, and two runs
  // that overlap across instances end with one complete set (the later
  // write wins per module) instead of one wiping the other's inserts.
  // Neon's HTTP driver gives every statement its own transaction, which is
  // why delete-then-insert was never atomic here.
  //
  // One independent single-row statement per module, run concurrently:
  // sequential would cost ~450 ms of round trips; parallel costs one.
  // slimGeoJson caps polygon vertex counts before upload: the Brisbane
  // River flood-planning multipolygon alone is ~7 MB raw, which was
  // costing >10 s of DB write time per report.
  await Promise.all(
    overlays.map(
      (o) => sql`
        INSERT INTO council_data
          (address_id, module, risk_level, has_consideration,
           source_name, source_url, raw_response)
        VALUES
          (${addressId}, ${o.module}, ${o.riskLevel}, ${o.hasConsideration},
           ${o.sourceName}, ${o.sourceUrl}, ${JSON.stringify(slimGeoJson(o.raw, { lat: addr.lat, lng: addr.lng }))}::jsonb)
        ON CONFLICT (address_id, module) DO UPDATE SET
          risk_level        = EXCLUDED.risk_level,
          has_consideration = EXCLUDED.has_consideration,
          source_name       = EXCLUDED.source_name,
          source_url        = EXCLUDED.source_url,
          raw_response      = EXCLUDED.raw_response,
          retrieved_at      = now()
      `,
    ),
  );
  // Rows for modules no longer in the order (a flag switched off) would
  // otherwise linger forever.
  await sql`
    DELETE FROM council_data
    WHERE address_id = ${addressId} AND module <> ALL(${ORDER as string[]}::text[])
  `;

  // Persist the parcel / lot-lines / postcode so the report page never has
  // to touch the live cadastre or ABS services. slimGeoJson caps the
  // neighbour-lot vertex counts the way it does for module polygons.
  const [parcelLines, postcode] = await geoExtras;
  const geo = {
    parcel: parcelForRegion,
    parcelLines: parcelLines
      ? slimGeoJson(parcelLines, { lat: addr.lat, lng: addr.lng })
      : null,
    postcode,
  };
  await sql`UPDATE addresses SET geo = ${JSON.stringify(geo)}::jsonb WHERE id = ${addressId}`;

  const modules = Object.fromEntries(
    overlays.map((o) => [
      o.module,
      { riskLevel: o.riskLevel, hasConsideration: o.hasConsideration },
    ]),
  ) as FetchOverlaysSummary["modules"];

  return {
    addressId,
    modules,
    failedModules,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

// ── Phase 2: generate narrative + persist report ──────────────────────────

export type ReportNarrative = Partial<Record<Module, ModuleNarrative>>;

export type GenerateReportResult = {
  reportId: string;
  addressId: string;
  narrative: ReportNarrative;
  /** Set when a subscriber's monthly quota was applied to this report. */
  quotaUnlock?: QuotaUnlock | null;
  elapsedMs: number;
};

// ── Report payload loader (consumed by /report/[id]/page.tsx + PDF) ─────

export type ReportModuleRow = {
  module: Module;
  riskLevel: RiskLevel | null;
  hasConsideration: boolean;
  sourceName: string;
  sourceUrl: string;
  raw: unknown;
};

export type ReportPayload = {
  report: {
    id: string;
    generated_at: string;
    narrative: ReportNarrative;
    /** User who generated the run; null for anonymous runs, whose URL
     * is their only credential. Signed-in owners' reports are theirs. */
    ownerId: string | null;
  };
  address: Address;
  modules: ReportModuleRow[];
  considerationCount: number;
  /** GeoJSON Polygon/MultiPolygon of the actual cadastre lot the property
   * sits on: fetched from BCC's property_boundaries_parcel layer. Used
   * as the yellow "selected property" outline on every map. Falls back to
   * the zoning module polygon when the parcel lookup fails. */
  propertyPolygon: unknown | null;
  /** GeoJSON FeatureCollection of every cadastre lot within ~155 m of the
   * property. Drawn as faint boundary lines on each map so zone fills read
   * per-lot (Develo-style) instead of as one flat colour wash. null when the
   * lookup returns nothing. */
  parcelLines: unknown | null;
  /** Per-lot cadastre metadata (lot/plan, area, freehold tenure, suburb).
   * Surfaced in the At a glance sidebar so the report mirrors Develo's
   * sidebar facts. null when the parcel lookup returned nothing. */
  parcel: ParcelInfo | null;
  /** 4-digit postcode for the address (ABS POA lookup). The QLD locator
   * omits it, so this is resolved fresh at load and used for display only.
   * null when the lookup fails. */
  postcode: string | null;
  /** True if this report run is unlocked (one-off purchase or a credit).
   * When false the report page shows Flooding as a free preview and
   * paywalls the rest. Lives on the report, not the address. */
  paid: boolean;
};

/**
 * May `viewer` open this report? Anonymous runs have no owner, so their
 * unguessable URL is the credential; a signed-in user's run is theirs alone
 * (admins see everything). Shared by the page, the PDF and retry routes.
 */
export function canViewReport(
  report: { ownerId: string | null },
  viewer: { id: string } | null,
  admin: boolean,
  /** The request carried a valid share token for THIS report (lib/share). */
  shared = false,
): boolean {
  if (admin || shared) return true;
  if (!report.ownerId) return true;
  return viewer?.id === report.ownerId;
}

type CouncilRowSlim = Pick<
  CouncilDataRow,
  "module" | "risk_level" | "has_consideration" | "source_name" | "source_url" | "raw_response"
>;

/** Cache tag for a report's council_data rows: revalidated by a retry. */
export const reportRowsTag = (reportId: string) => `report-rows:${reportId}`;

/**
 * A report's council_data rows, from the Data Cache after the first read.
 * Every page view, PDF render and bulk export used to re-transfer the
 * whole multi-hundred-KB set from Neon; a generated run is immutable, so
 * the second reader onward gets it from the edge. An entry the cache
 * refuses (oversized) simply falls through to the live query.
 */
export function loadCouncilRowsCached(reportId: string): Promise<CouncilRowSlim[]> {
  // Built per call so the tag can carry the report id (unstable_cache's
  // tags are fixed at definition time); the key parts include it too.
  return unstable_cache(
    async (): Promise<CouncilRowSlim[]> => {
      const sql = getDb();
      return (await sql`
        SELECT module, risk_level, has_consideration,
               source_name, source_url, raw_response
        FROM council_data
        WHERE address_id = (SELECT address_id FROM reports WHERE id = ${reportId})
      `) as CouncilRowSlim[];
    },
    ["council-rows", reportId],
    { revalidate: 60 * 60 * 24 * 30, tags: [reportRowsTag(reportId)] },
  )();
}

export async function loadReportPayload(
  reportId: string,
  opts?: {
    /** PDF route only: prefetch the QLD aerial frames as soon as the
     * coordinates (and later the transport stops) are known, so the
     * ~2 s-per-frame upstream imagery calls overlap the multi-MB
     * council_data transfer instead of queueing behind it. */
    warmImagery?: boolean;
  },
): Promise<ReportPayload | null> {
  const sql = getDb();

  // Both queries fire in one round trip: report+address joined, and
  // council_data keyed through a subquery instead of waiting for the
  // report row to come back first. (Was three sequential round trips.)
  // The council_data transfer is this loader's long pole, so it stays a
  // promise while the address-dependent work below gets going. It is
  // also cached: a report's rows never change after generation except
  // through retryFailedChecks, which revalidates the tag.
  const dataRowsPromise = loadCouncilRowsCached(reportId);
  const reportRows = await sql`
    SELECT r.id, r.address_id, r.narrative, r.generated_at, r.paid_at, r.user_id,
           a.address_text, a.lat, a.lng, a.geo
    FROM reports r
    JOIN addresses a ON a.id = r.address_id
    WHERE r.id = ${reportId}
    LIMIT 1
  `;
  if ((reportRows as unknown[]).length === 0) {
    dataRowsPromise.catch(() => {}); // abandoned — don't leak a rejection
    return null;
  }
  const joined = (reportRows as Array<{
    id: string;
    address_id: string;
    narrative: unknown;
    generated_at: string;
    paid_at: string | null;
    user_id: string | null;
    address_text: string;
    lat: number;
    lng: number;
    geo: {
      parcel: ParcelInfo | null;
      parcelLines: unknown | null;
      postcode: string | null;
    } | null;
  }>)[0];
  const report = joined;
  const address = {
    id: joined.address_id,
    address_text: joined.address_text,
    lat: joined.lat,
    lng: joined.lng,
  } as Address;

  // Parcel / lot lines / postcode were resolved once at generation time and
  // cached on the address row: read them straight from the DB so a report
  // render never touches the flaky live cadastre / ABS services. Reports
  // generated before that caching (no `geo`) fall back to a live lookup.
  const geoBatch: Promise<
    [ParcelInfo, unknown | null, string | null]
  > = joined.geo
    ? Promise.resolve([
        joined.geo.parcel ?? EMPTY_PARCEL,
        joined.geo.parcelLines ?? null,
        joined.geo.postcode ?? null,
      ])
    : Promise.all([
        fetchPropertyParcel(address.lat, address.lng),
        fetchParcelLinesNear(address.lat, address.lng),
        fetchPostcode(address.lat, address.lng),
      ]);

  if (opts?.warmImagery) {
    // Fire-and-forget. Warms the shared module frame + cover as soon as
    // the parcel polygon exists (the frame depends on it — warming
    // without it computes a different bbox and misses the memo), then the
    // transport module's widened frame from a row-sized query rather than
    // waiting on the full council_data transfer.
    // Dynamic imports: static-map drags sharp in, and the web report page
    // (the other caller of this loader) never needs it.
    void (async () => {
      const [{ warmFrames }, { extractOverlays }, [parcelRes]] =
        await Promise.all([
          import("@/lib/static-map"),
          import("@/lib/overlays"),
          geoBatch,
        ]);
      warmFrames(address.lat, address.lng, parcelRes.polygon);
      const tRows = (await sql`
        SELECT raw_response FROM council_data
        WHERE address_id = ${address.id} AND module = 'transport'
        LIMIT 1
      `) as Array<{ raw_response: unknown }>;
      if (!tRows[0]) return;
      const pts: number[][] = [];
      for (const f of extractOverlays("transport", tRows[0].raw_response)) {
        if (f.geometry?.type === "Point") pts.push(f.geometry.coordinates);
      }
      if (pts.length > 0) {
        warmFrames(address.lat, address.lng, parcelRes.polygon, pts);
      }
    })().catch(() => {});
  }

  const rows = await dataRowsPromise;

  const ordered = MODULE_ORDER;
  const byModule = new Map(rows.map((r) => [r.module as Module, r]));
  const modules: ReportModuleRow[] = ordered
    .filter((m) => byModule.has(m))
    .map((m) => {
      const r = byModule.get(m)!;
      return {
        module: m,
        riskLevel: r.risk_level,
        hasConsideration: r.has_consideration,
        sourceName: r.source_name,
        sourceUrl: r.source_url,
        raw: r.raw_response,
      };
    });

  // Cadastre lot polygon + metadata from BCC's property_boundaries_parcel
  // layer — the batch was kicked off right after the address arrived, so
  // by now it has usually already resolved.
  const [parcel, parcelLines, postcode] = await geoBatch;

  // Zoning polygon as the final fallback when the parcel lookup misses
  // (e.g. geocoded coord on a road centreline).
  const zoning = modules.find((m) => m.module === "zoning");
  const zRaw =
    zoning?.raw && typeof zoning.raw === "object"
      ? (zoning.raw as Record<string, unknown>)
      : null;
  const zInner =
    zRaw?.raw && typeof zRaw.raw === "object"
      ? (zRaw.raw as { features?: Array<{ geometry?: unknown }> })
      : null;
  const propertyPolygon =
    parcel.polygon ?? zInner?.features?.[0]?.geometry ?? null;

  return {
    report: {
      id: report.id,
      generated_at: report.generated_at,
      narrative: (report.narrative ?? {}) as ReportNarrative,
      ownerId: report.user_id,
    },
    address,
    modules,
    // Warnings only. Informational modules (school catchment, zone code,
    // nearest stops) set hasConsideration so they keep a full section, but
    // counting them here would put "N checks need your attention" on every
    // report and make the all-clear case unreachable.
    considerationCount: modules.filter((m) =>
      isFlagged(m.riskLevel, m.hasConsideration),
    ).length,
    propertyPolygon,
    parcelLines,
    parcel: parcel.polygon ? parcel : null,
    postcode,
    paid: Boolean(report.paid_at),
  };
}

/**
 * Retry path for reports that came back with fetchFailed rows: re-run the
 * overlay fetches and regenerate the narrative INTO THE EXISTING report row.
 * Unlike generateReportForAddress this never inserts a new report and never
 * touches credits/paywall state: it's a repair, not a purchase.
 *
 * Returns the modules that are still failing after the retry.
 */
export async function retryFailedChecks(reportId: string): Promise<{
  addressId: string;
  stillFailing: Module[];
}> {
  const sql = getDb();
  const reportRows = (await sql`
    SELECT id, address_id FROM reports WHERE id = ${reportId} LIMIT 1
  `) as Array<{ id: string; address_id: string }>;
  if (reportRows.length === 0) {
    throw new Error(`report ${reportId} not found`);
  }
  const addressId = reportRows[0].address_id;
  const addr = await loadAddress(addressId);

  // force: the whole point of a retry is to bypass the freshness reuse.
  const summary = await fetchOverlaysForAddress(addressId, { force: true });

  const rows = (await sql`
    SELECT id, address_id, module, source_url, source_name, raw_response,
           risk_level, has_consideration, retrieved_at
    FROM council_data
    WHERE address_id = ${addressId}
  `) as CouncilDataRow[];

  const narrative: ReportNarrative = {};
  await Promise.all(
    rows.map(async (row) => {
      narrative[row.module as Module] = await generateModuleNarrative({
        module: row.module as Module,
        address: formatAuAddress(addr.address_text),
        councilData: row,
      });
    }),
  );

  await sql`
    UPDATE reports SET narrative = ${JSON.stringify(narrative)}::jsonb
    WHERE id = ${reportId}
  `;
  // The cached row set for this report is now stale.
  revalidateTag(reportRowsTag(reportId), "max");

  return { addressId, stillFailing: summary.failedModules };
}

export type QuotaUnlock = {
  /** Credits remaining AFTER this report (subscribers only). */
  creditsLeft: number;
  quota: number;
  unlocked: boolean;
};

/**
 * When the report was generated by a signed-in user with a credit to
 * spend (monthly allowance or a purchased pack), spend one and unlock the
 * run. Returns null for anonymous users and for anyone with nothing to
 * spend: they keep the single-report paywall. The balance rules live in
 * lib/billing (spendCredit).
 */
async function trySpendCredit(
  userId: string,
  reportId: string,
): Promise<QuotaUnlock | null> {
  // Dynamic: lib/auth pulls next/headers, which the CLI scripts that
  // import this module cannot load.
  const [{ getSessionUser, spendableCredits }, { spendCredit }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/billing"),
  ]);
  const user = await getSessionUser();
  if (!user || user.id !== userId) return null;
  if (spendableCredits(user) === 0) return null;
  const spent = await spendCredit(user, reportId);
  return { creditsLeft: spent.creditsLeft, quota: spent.quota, unlocked: spent.unlocked };
}

export async function generateReportForAddress(
  addressId: string,
  userId?: string | null,
): Promise<GenerateReportResult> {
  const t0 = performance.now();
  const sql = getDb();
  const addr = await loadAddress(addressId);

  const rows = (await sql`
    SELECT id, address_id, module, source_url, source_name, raw_response,
           risk_level, has_consideration, retrieved_at
    FROM council_data
    WHERE address_id = ${addressId}
  `) as CouncilDataRow[];
  if (rows.length === 0) {
    throw new Error(
      `no council_data rows for address ${addressId}. Run fetchOverlaysForAddress first.`,
    );
  }

  const narrative: ReportNarrative = {};
  await Promise.all(
    rows.map(async (row) => {
      narrative[row.module as Module] = await generateModuleNarrative({
        module: row.module as Module,
        address: formatAuAddress(addr.address_text),
        councilData: row,
      });
    }),
  );

  const inserted = (await sql`
    INSERT INTO reports (address_id, narrative, user_id)
    VALUES (${addressId}, ${JSON.stringify(narrative)}::jsonb, ${userId ?? null})
    RETURNING id
  `) as Array<{ id: string }>;
  const reportId = inserted[0].id;

  // Subscribers spend a credit and get the report unlocked outright.
  let quotaUnlock: QuotaUnlock | null = null;
  if (userId) {
    try {
      quotaUnlock = await trySpendCredit(userId, reportId);
    } catch (err) {
      console.error("[pipeline] quota unlock failed (non-fatal):", err);
    }
  }

  return {
    reportId,
    addressId,
    narrative,
    quotaUnlock,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

/**
 * End-to-end for one free-text address: geocode → upsert the address row →
 * fetch every overlay → generate the report. This is the whole single-search
 * flow behind one call, used by the admin bulk importer. Throws with a clear
 * message on a geocode miss so the caller can report per-address failure.
 */
export async function generateReportForQuery(
  query: string,
  userId?: string | null,
): Promise<{ addressId: string; reportId: string; displayName: string }> {
  const hit = await geocodeAddress(query);
  if (!hit) {
    throw new Error("Address not found in Queensland");
  }
  const sql = getDb();
  // Reuse an address row with the exact same resolved label, else insert.
  const existing = (await sql`
    SELECT id FROM addresses WHERE address_text = ${hit.displayName} LIMIT 1
  `) as Array<{ id: string }>;
  const addressId =
    existing[0]?.id ??
    (
      (await sql`
        INSERT INTO addresses (address_text, lat, lng)
        VALUES (${hit.displayName}, ${hit.lat}, ${hit.lng})
        RETURNING id
      `) as Array<{ id: string }>
    )[0].id;

  await fetchOverlaysForAddress(addressId);
  const { reportId } = await generateReportForAddress(addressId, userId ?? null);
  return { addressId, reportId, displayName: hit.displayName };
}
