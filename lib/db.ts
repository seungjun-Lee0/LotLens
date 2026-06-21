// Postgres client — Vercel Postgres / Neon serverless.
//
// We migrated off Supabase (it pauses free-tier projects after a week of
// dormancy, which is fatal for a demo-and-pause cycle). Neon's compute
// auto-suspends on idle but resumes in sub-second on the next request,
// so the live URL keeps working between demos with no manual restore.
//
// The driver is HTTP-fetch based — no connection pool to leak, no
// `pg_dump`-style overhead. Perfect for Vercel functions.
//
// Connection string: DATABASE_URL (Vercel auto-injects this when the
// Postgres integration is added to the project).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ── Shared domain types (re-exports from the old supabase.ts module so
// callers don't have to chase imports). ──────────────────────────────────

export type Module =
  | "flooding"
  | "overland_flow"
  | "storm_tide"
  | "bushfire"
  | "vegetation"
  | "heritage"
  | "easements"
  | "zoning";

export type RiskLevel = "high" | "medium" | "low" | "very_low" | "none";

// ── Row types (mirror db/schema.sql) ─────────────────────────────────────

export type AddressRow = {
  id: string;
  address_text: string;
  lat: number;
  lng: number;
  lot_plan: string | null;
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
        `Provision Vercel Postgres via the dashboard Storage tab — it auto-injects DATABASE_URL.`,
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
