// End-to-end DD pipeline.
//
// Two phases, both addressed by address_id:
//
//   1. fetchOverlaysForAddress() — hits the 15 module sources in parallel,
//      writes one council_data row per module. Each fetch settles
//      independently: a source that's down becomes a fetchFailed row
//      (risk_level NULL) instead of sinking the whole report.
//   2. generateReportForAddress() — reads the council_data rows back,
//      generates narrative per module (LLM stub in Task 4a), writes one
//      reports row.
//
// Both are idempotent: re-running deletes prior data for that address and
// rewrites. Route handlers and CLI scripts call these directly so we keep
// HTTP-vs-script behaviour identical.

import { fetchAcidSulfateData } from "@/lib/modules/acid-sulfate";
import { fetchBushfireData } from "@/lib/modules/bushfire";
import { fetchEasementsData } from "@/lib/modules/easements";
import { fetchEnvironmentData } from "@/lib/modules/environment";
import { fetchFloodingData } from "@/lib/modules/flooding";
import { fetchFloodPlanningData } from "@/lib/modules/flood-planning";
import { fetchHeritageData } from "@/lib/modules/heritage";
import { fetchMiningData } from "@/lib/modules/mining";
import { fetchNoiseData } from "@/lib/modules/noise";
import { fetchOverlandFlowData } from "@/lib/modules/overland-flow";
import { fetchSchoolsData } from "@/lib/modules/schools";
import { fetchSteepLandData } from "@/lib/modules/steep-land";
import { fetchStormTideData } from "@/lib/modules/storm-tide";
import { fetchVegetationData } from "@/lib/modules/vegetation";
import { fetchZoningData } from "@/lib/modules/zoning";
import { slimGeoJson } from "@/lib/geo-slim";
import { regionFromParcel } from "@/lib/region";

import { generateModuleNarrative, type ModuleNarrative } from "@/lib/anthropic";
import {
  getDb,
  type CouncilDataRow,
  type Module,
  type RiskLevel,
} from "@/lib/db";
import {
  fetchParcelLinesNear,
  fetchPropertyParcel,
  insetParcelPolygon,
  type ParcelInfo,
} from "@/lib/property";

type Address = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
  paid_at?: string | null;
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
    const allFresh =
      existing.length === 15 &&
      existing.every(
        (r) =>
          r.fetch_failed !== "true" &&
          Date.now() - new Date(r.retrieved_at).getTime() < FRESH_REUSE_MS,
      );
    if (allFresh) {
      console.log(
        `[overlays] reusing fresh council_data for ${addressId} (all 15 rows < ${FRESH_REUSE_MS / 60_000} min old)`,
      );
      return {
        addressId,
        modules: Object.fromEntries(
          existing.map((r) => [
            r.module,
            { riskLevel: r.risk_level, hasConsideration: r.has_consideration },
          ]),
        ) as FetchOverlaysSummary["modules"],
        failedModules: [],
        elapsedMs: Math.round(performance.now() - t0),
      };
    }
  }

  // Per-module wall time — one summary line per run so slow government
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
  // council adapters AND its polygon becomes the classification geometry —
  // every risk module classifies against the actual cadastre lot (slightly
  // inset so cadastre-snapped layers don't flag the neighbour across a
  // shared boundary), not just the geocoded point. Costs the ~150-300 ms
  // parcel round-trip up front; correctness over latency.
  // fetchPropertyParcel never rejects (returns an EMPTY parcel on failure),
  // so this always proceeds — with no polygon the fetchers fall back to
  // their point/buffer queries.
  const parcelForRegion = await timed(
    "parcel",
    fetchPropertyParcel(addr.lat, addr.lng),
  );
  const region = regionFromParcel(parcelForRegion.lga, addr.lat, addr.lng);
  const lot = parcelForRegion.polygon
    ? insetParcelPolygon(parcelForRegion.polygon)
    : null;

  const tasks = new Map<Module, Promise<Settled>>();
  tasks.set("storm_tide", settle("storm_tide", fetchStormTideData(addr.lat, addr.lng, lot)));
  tasks.set("bushfire", settle("bushfire", fetchBushfireData(addr.lat, addr.lng, lot)));
  tasks.set("environment", settle("environment", fetchEnvironmentData(addr.lat, addr.lng, lot)));
  tasks.set("acid_sulfate", settle("acid_sulfate", fetchAcidSulfateData(addr.lat, addr.lng, lot)));
  tasks.set("mining", settle("mining", fetchMiningData(addr.lat, addr.lng, lot)));
  // Schools stays point-based on purpose: catchment is decided by where
  // the dwelling is, and a lot straddling two catchments would double-list.
  tasks.set("schools", settle("schools", fetchSchoolsData(addr.lat, addr.lng)));
  tasks.set("flooding", settle("flooding", fetchFloodingData(addr.lat, addr.lng, region, lot)));
  tasks.set("flood_planning", settle("flood_planning", fetchFloodPlanningData(addr.lat, addr.lng, region, lot)));
  tasks.set("overland_flow", settle("overland_flow", fetchOverlandFlowData(addr.lat, addr.lng, region, lot)));
  tasks.set("vegetation", settle("vegetation", fetchVegetationData(addr.lat, addr.lng, region, lot)));
  tasks.set("heritage", settle("heritage", fetchHeritageData(addr.lat, addr.lng, region, lot)));
  tasks.set("easements", settle("easements", fetchEasementsData(addr.lat, addr.lng, region, lot)));
  tasks.set("noise", settle("noise", fetchNoiseData(addr.lat, addr.lng, region, lot)));
  tasks.set("steep_land", settle("steep_land", fetchSteepLandData(addr.lat, addr.lng, region, lot)));
  // Zoning stays point-based too: a lot is in one zone for practical
  // purposes, and BCC's point-query zone polygon doubles as the parcel
  // fallback for the report's yellow lot outline.
  tasks.set("zoning", settle("zoning", fetchZoningData(addr.lat, addr.lng, region)));

  const ORDER: Module[] = [
    "flooding",
    "flood_planning",
    "overland_flow",
    "storm_tide",
    "bushfire",
    "vegetation",
    "environment",
    "heritage",
    "easements",
    "noise",
    "steep_land",
    "acid_sulfate",
    "mining",
    "schools",
    "zoning",
  ];
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
    // Nothing came back at all — that's our outage (or the machine's
    // network), not 15 independent source outages. Persisting 15 blank
    // rows would cache a useless report, so fail the run outright.
    throw new Error(
      "all module sources failed — aborting instead of writing an empty report",
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

  // Idempotent replace. Each invocation drops the address's previous rows
  // and rewrites the fifteen fresh ones.
  await sql`DELETE FROM council_data WHERE address_id = ${addressId}`;

  // 15 independent single-row inserts — run them concurrently. Neon's
  // HTTP driver issues one stateless request per statement (~30 ms), so
  // sequential would cost ~450 ms; parallel costs one round-trip.
  // slimGeoJson caps polygon vertex counts before upload — the Brisbane
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
      `,
    ),
  );

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
  report: { id: string; generated_at: string; narrative: ReportNarrative };
  address: Address;
  modules: ReportModuleRow[];
  considerationCount: number;
  /** GeoJSON Polygon/MultiPolygon of the actual cadastre lot the property
   * sits on — fetched from BCC's property_boundaries_parcel layer. Used
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
  /** True if the user has paid for the report. When false the report page
   * shows Flooding as a free preview and paywalls the other 7 modules. */
  paid: boolean;
};

export async function loadReportPayload(
  reportId: string,
): Promise<ReportPayload | null> {
  const sql = getDb();

  const reportRows = (await sql`
    SELECT id, address_id, narrative, generated_at
    FROM reports
    WHERE id = ${reportId}
    LIMIT 1
  `) as Array<{
    id: string;
    address_id: string;
    narrative: unknown;
    generated_at: string;
  }>;
  if (reportRows.length === 0) return null;
  const report = reportRows[0];

  const [addrRows, dataRows] = await Promise.all([
    sql`
      SELECT id, address_text, lat, lng, paid_at
      FROM addresses
      WHERE id = ${report.address_id}
      LIMIT 1
    `,
    sql`
      SELECT module, risk_level, has_consideration,
             source_name, source_url, raw_response
      FROM council_data
      WHERE address_id = ${report.address_id}
    `,
  ]);
  if ((addrRows as unknown[]).length === 0) return null;
  const address = (addrRows as Address[])[0];
  const rows = dataRows as Pick<
    CouncilDataRow,
    "module" | "risk_level" | "has_consideration" | "source_name" | "source_url" | "raw_response"
  >[];

  const ordered: Module[] = [
    "flooding",
    "flood_planning",
    "overland_flow",
    "storm_tide",
    "bushfire",
    "vegetation",
    "environment",
    "heritage",
    "easements",
    "noise",
    "steep_land",
    "acid_sulfate",
    "mining",
    "schools",
    "zoning",
  ];
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

  // Fetch the actual cadastre lot polygon + metadata from BCC's
  // property_boundaries_parcel layer. ~150 ms extra per page load,
  // dwarfed by the rest of the pipeline. Cleanly replaces our previous
  // hack of using the zoning module's polygon (which actually spans
  // the whole zone-precinct area — hundreds of metres across).
  const [parcel, parcelLines] = await Promise.all([
    fetchPropertyParcel(address.lat, address.lng),
    fetchParcelLinesNear(address.lat, address.lng),
  ]);

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
    },
    address,
    modules,
    considerationCount: modules.filter((m) => m.hasConsideration).length,
    propertyPolygon,
    parcelLines,
    parcel: parcel.polygon ? parcel : null,
    paid: Boolean(address.paid_at),
  };
}

/**
 * Retry path for reports that came back with fetchFailed rows: re-run the
 * overlay fetches and regenerate the narrative INTO THE EXISTING report row.
 * Unlike generateReportForAddress this never inserts a new report and never
 * touches credits/paywall state — it's a repair, not a purchase.
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
        address: addr.address_text,
        councilData: row,
      });
    }),
  );

  await sql`
    UPDATE reports SET narrative = ${JSON.stringify(narrative)}::jsonb
    WHERE id = ${reportId}
  `;

  return { addressId, stillFailing: summary.failedModules };
}

export type QuotaUnlock = {
  /** Credits remaining AFTER this report (subscribers only). */
  creditsLeft: number;
  quota: number;
  unlocked: boolean;
};

/**
 * When the report was generated by an active subscriber with credits left,
 * spend one credit and unlock the address. The decrement is a single
 * conditional UPDATE so concurrent runs can't spend the same credit twice.
 * Returns null for anonymous / free users (they keep the single-report
 * paywall); { unlocked: false } when the balance is empty.
 */
async function trySpendCredit(
  userId: string,
  reportId: string,
  addressId: string,
): Promise<QuotaUnlock | null> {
  const { isActiveSubscriber, getSessionUser, PLAN_QUOTAS } = await import(
    "@/lib/auth"
  );
  const user = await getSessionUser();
  if (!user || user.id !== userId || !isActiveSubscriber(user)) return null;
  const quota = PLAN_QUOTAS[user.plan as keyof typeof PLAN_QUOTAS];
  const sql = getDb();
  const spent = (await sql`
    UPDATE users SET credits = credits - 1
    WHERE id = ${user.id} AND credits > 0
    RETURNING credits
  `) as Array<{ credits: number }>;
  if (spent.length === 0) {
    return { creditsLeft: 0, quota, unlocked: false };
  }
  await sql`
    INSERT INTO report_usage (user_id, report_id) VALUES (${user.id}, ${reportId})
  `;
  await sql`
    UPDATE addresses SET paid_at = COALESCE(paid_at, now()) WHERE id = ${addressId}
  `;
  return { creditsLeft: spent[0].credits, quota, unlocked: true };
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
        address: addr.address_text,
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
      quotaUnlock = await trySpendCredit(userId, reportId, addressId);
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
