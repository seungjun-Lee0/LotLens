// Postgres client: Vercel Postgres / Neon serverless.
//
// We migrated off Supabase (it pauses free-tier projects after a week of
// dormancy, which is fatal for a demo-and-pause cycle). Neon's compute
// auto-suspends on idle but resumes in sub-second on the next request,
// so the live URL keeps working between demos with no manual restore.
//
// The driver is HTTP-fetch based: no connection pool to leak, no
// `pg_dump`-style overhead. Perfect for Vercel functions.
//
// Connection string: DATABASE_URL (Vercel auto-injects this when the
// Postgres integration is added to the project).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ── Shared domain types (re-exports from the old supabase.ts module so
// callers don't have to chase imports). ──────────────────────────────────

export type Module =
  | "flooding"
  | "flood_planning"
  | "overland_flow"
  | "storm_tide"
  | "bushfire"
  | "vegetation"
  | "environment"
  | "heritage"
  | "easements"
  | "noise"
  | "steep_land"
  | "acid_sulfate"
  | "mining"
  | "stormwater"
  | "water_sewer"
  | "schools"
  | "transport"
  | "local_plans"
  | "zoning";

/**
 * Water & Sewer (Urban Utilities) is built and tested but switched off.
 *
 * The blocker is legal, not technical: UU's endpoints are public and
 * unauthenticated, but they assert "© Urban Utilities 2019" while leaving
 * licenseInfo as the literal string "This is a place holder for terms and
 * conditions of using QUU Open Data". Every other source in this report is
 * CC BY 4.0, which grants commercial redistribution; UU has granted
 * nothing. Flip this to true only once UU confirms reuse terms in writing.
 *
 * The annotation is load-bearing: without it TypeScript narrows the type
 * to `false` and reports the guarded branches as dead code.
 */
export const WATER_SEWER_ENABLED: boolean = false;

/**
 * Canonical report order: hazards, then constraints on building, then
 * infrastructure over/under the lot, then planning, then lifestyle facts.
 *
 * This is the single source of truth: the fetch pipeline, the payload
 * loader and the report body all read it, so a new module is added here
 * once. The At-a-glance verdict layer and the PDF page order deliberately
 * re-sort by severity: the canonical order is what makes two reports
 * comparable side by side.
 */
export const MODULE_ORDER: Module[] = [
  "flooding",
  "flood_planning",
  "overland_flow",
  "storm_tide",
  "bushfire",
  "vegetation",
  "environment",
  "heritage",
  "easements",
  "stormwater",
  // Sits with the other buried-infrastructure checks when enabled. Absent
  // from the order = absent from the report, the fetch fan-out and the
  // council_data row-count freshness check, all from the one flag.
  ...(WATER_SEWER_ENABLED ? (["water_sewer"] as Module[]) : []),
  "noise",
  "steep_land",
  "acid_sulfate",
  "mining",
  "zoning",
  "local_plans",
  "schools",
  "transport",
];

/**
 * Severity on the shared scale, plus one non-severity state.
 *
 * `informational` is NOT a low rung of the risk ladder: it means "this
 * module found something, and that something is not a warning". School
 * catchments, the zone code, the nearest bus stop and a Koala Priority
 * Area with no habitat on the lot all land here. Informational modules
 * keep their full report section and map (see `hasConsideration`, which
 * stays true so the section is allocated) but are excluded from the
 * consideration count, the "Needs attention" list and Next steps.
 */
export type RiskLevel =
  | "high"
  | "medium"
  | "low"
  | "very_low"
  | "informational"
  | "none";

// ── Row types (mirror db/schema.sql) ─────────────────────────────────────

export type AddressRow = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
  lot_plan: string | null;
  paid_at: string | null;
  stripe_session_id: string | null;
  created_at: string;
};

export type CouncilDataRow = {
  id: string;
  address_id: string;
  module: Module;
  source_url: string;
  source_name: string;
  raw_response: unknown; // jsonb
  risk_level: RiskLevel | null;
  has_consideration: boolean;
  retrieved_at: string;
};

export type ReportRow = {
  id: string;
  address_id: string;
  narrative: unknown; // jsonb
  generated_at: string;
};

// ── Client factory ───────────────────────────────────────────────────────

let cached: NeonQueryFunction<false, false> | null = null;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing env var ${name}. See .env.local.example. ` +
        `Provision Vercel Postgres via the dashboard Storage tab: it auto-injects DATABASE_URL.`,
    );
  }
  return value;
}

/**
 * Get a Neon SQL tagged-template function. Server-only.
 *
 * Usage:
 *   const sql = getDb();
 *   const rows = await sql`SELECT id FROM addresses WHERE id = ${id}`;
 */
export function getDb(): NeonQueryFunction<false, false> {
  if (typeof window !== "undefined") {
    throw new Error(
      "getDb() called from the browser. DB access must stay server-only.",
    );
  }
  if (cached) return cached;
  const url = required(
    "DATABASE_URL",
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  );
  cached = neon(url);
  return cached;
}
