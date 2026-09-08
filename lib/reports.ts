// "My reports" data layer: the ONE query behind /reports, the account page's
// recent-reports hub and the /api/reports load-more endpoint, so a card
// reads the same numbers everywhere.
//
// Rows are grouped per ADDRESS: re-running a search inserts a new `reports`
// row against the same address (generateReportForQuery reuses the address
// row by label), and a list that shows "12 Oxley Rd" four times over reads
// as a bug. Each item is the LATEST run, with every run's id/date attached
// so the card can offer the earlier versions.
//
// The risk summary mirrors the report page exactly: a module counts as
// flagged when isFlagged(riskLevel, hasConsideration) holds (lib/risk-style)
// — i.e. hasConsideration AND the effective level (null → medium) is not
// 'informational' — restricted to MODULE_ORDER so a disabled module's stale
// row can't add a warning the report itself never shows.

import { getDb, MODULE_ORDER, type Module, type RiskLevel } from "@/lib/db";

export type ReportListFilter = "all" | "full" | "preview" | "attention";

export const REPORT_LIST_FILTERS: ReportListFilter[] = [
  "all",
  "full",
  "preview",
  "attention",
];

export function parseReportListFilter(v: unknown): ReportListFilter {
  return REPORT_LIST_FILTERS.includes(v as ReportListFilter)
    ? (v as ReportListFilter)
    : "all";
}

export type ReportRun = { id: string; generatedAt: string };

export type ReportListItem = {
  /** Latest run for this address. */
  id: string;
  addressId: string;
  addressText: string;
  postcode: string | null;
  lga: string | null;
  lat: number;
  lng: number;
  generatedAt: string;
  paid: boolean;
  /** Number of flagged (warning) modules — the report's considerationCount. */
  flagged: number;
  /** Severity of the worst flagged module; null when nothing is flagged. */
  worst: RiskLevel | null;
  /** Flagged modules, most severe first. */
  flaggedModules: Module[];
  /** Every run for this address, latest first (index 0 === `id`). */
  runs: ReportRun[];
};

export type ReportListPage = {
  items: ReportListItem[];
  /** Opaque cursor for the next page; null when this was the last page. */
  nextCursor: string | null;
};

const WORST_TO_LEVEL: Record<number, RiskLevel> = {
  4: "high",
  3: "medium",
  2: "low",
  1: "very_low",
};

const toIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): {
  at: string | null;
  id: string | null;
} {
  if (!cursor) return { at: null, id: null };
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
    if (!at || !/^[0-9a-f-]{36}$/i.test(id ?? "")) return { at: null, id: null };
    return { at, id };
  } catch {
    return { at: null, id: null };
  }
}

/** Escape LIKE metacharacters so a typed "%" or "_" matches literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Row = {
  id: string;
  address_id: string;
  latest_at: string | Date;
  runs: Array<{ id: string; generatedAt: string }>;
  address_text: string;
  paid_at: string | null;
  lat: number;
  lng: number;
  lga: string | null;
  postcode: string | null;
  flagged: number;
  worst: number;
  modules: string[];
};

export async function listUserReports(
  userId: string,
  opts: {
    q?: string;
    filter?: ReportListFilter;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<ReportListPage> {
  const sql = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const q = (opts.q ?? "").trim();
  const like = q ? `%${likeEscape(q)}%` : "";
  const filter = opts.filter ?? "all";
  const cur = decodeCursor(opts.cursor);

  // Every optional clause is folded into SQL (`$n = '' OR …`) so the whole
  // thing stays one tagged template: the Neon driver has no query builder,
  // and string-splicing SQL is how injection bugs start.
  const rows = (await sql`
    WITH runs AS (
      SELECT r.address_id,
             jsonb_agg(jsonb_build_object('id', r.id, 'generatedAt', r.generated_at)
                       ORDER BY r.generated_at DESC, r.id DESC) AS runs,
             max(r.generated_at) AS latest_at,
             (array_agg(r.id ORDER BY r.generated_at DESC, r.id DESC))[1] AS latest_id,
             -- The unlock is per run: the card shows the latest run's state.
             (array_agg(r.paid_at ORDER BY r.generated_at DESC, r.id DESC))[1] AS paid_at
      FROM reports r
      WHERE r.user_id = ${userId}
      GROUP BY r.address_id
    ),
    sev AS (
      SELECT c.address_id,
             count(DISTINCT c.module) AS flagged,
             max(CASE coalesce(c.risk_level, 'medium')
                   WHEN 'high' THEN 4 WHEN 'medium' THEN 3
                   WHEN 'low' THEN 2 WHEN 'very_low' THEN 1 ELSE 0 END) AS worst,
             array_agg(c.module ORDER BY
               CASE coalesce(c.risk_level, 'medium')
                 WHEN 'high' THEN 4 WHEN 'medium' THEN 3
                 WHEN 'low' THEN 2 WHEN 'very_low' THEN 1 ELSE 0 END DESC,
               c.module) AS modules
      FROM council_data c
      WHERE c.address_id IN (SELECT address_id FROM runs)
        AND c.module = ANY(${MODULE_ORDER}::text[])
        AND c.has_consideration
        AND coalesce(c.risk_level, 'medium') <> 'informational'
      GROUP BY c.address_id
    )
    SELECT ru.latest_id AS id, ru.address_id, ru.latest_at, ru.runs, ru.paid_at,
           a.address_text, a.lat, a.lng,
           a.geo->'parcel'->>'lga' AS lga,
           a.geo->>'postcode' AS postcode,
           coalesce(s.flagged, 0)::int AS flagged,
           coalesce(s.worst, 0)::int AS worst,
           coalesce(s.modules, '{}'::text[]) AS modules
    FROM runs ru
    JOIN addresses a ON a.id = ru.address_id
    LEFT JOIN sev s ON s.address_id = ru.address_id
    WHERE (${like}::text = '' OR a.address_text ILIKE ${like}::text ESCAPE '\\')
      AND (${filter}::text = 'all'
           OR (${filter}::text = 'full' AND ru.paid_at IS NOT NULL)
           OR (${filter}::text = 'preview' AND ru.paid_at IS NULL)
           OR (${filter}::text = 'attention' AND coalesce(s.flagged, 0) > 0))
      AND (${cur.at}::timestamptz IS NULL
           OR (ru.latest_at, ru.latest_id) < (${cur.at}::timestamptz, ${cur.id}::uuid))
    ORDER BY ru.latest_at DESC, ru.latest_id DESC
    LIMIT ${limit + 1}
  `) as Row[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      addressId: r.address_id,
      addressText: r.address_text,
      postcode: r.postcode,
      lga: r.lga,
      lat: Number(r.lat),
      lng: Number(r.lng),
      generatedAt: toIso(r.latest_at),
      paid: r.paid_at != null,
      flagged: Number(r.flagged),
      worst: WORST_TO_LEVEL[Number(r.worst)] ?? null,
      flaggedModules: [...new Set(r.modules)] as Module[],
      runs: (r.runs ?? []).map((x) => ({ id: x.id, generatedAt: toIso(x.generatedAt) })),
    })),
    nextCursor:
      rows.length > limit && last ? encodeCursor(toIso(last.latest_at), last.id) : null,
  };
}

/**
 * Delete ONE run. Only the `reports` row goes (report_usage cascades): the
 * address row and its council_data are shared by every run of that address
 * — and by other users who searched the same label — so removing them
 * would break other runs. Returns false when the report doesn't exist or
 * isn't the caller's (admins may delete any).
 */
export async function deleteUserReport(
  reportId: string,
  userId: string,
  admin = false,
): Promise<boolean> {
  const sql = getDb();
  const rows = (await sql`
    DELETE FROM reports
    WHERE id = ${reportId}::uuid
      AND (${admin}::boolean OR user_id = ${userId}::uuid)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * The subset of `reportIds` the caller may bundle into a ZIP: their own
 * UNLOCKED reports (the PDF route's paywall, applied up front so a preview
 * id can't sneak into the archive). Admins get every existing id. Order of
 * the request is preserved.
 */
export async function downloadableReportIds(
  reportIds: string[],
  userId: string,
  admin = false,
): Promise<string[]> {
  if (reportIds.length === 0) return [];
  const sql = getDb();
  const rows = (await sql`
    SELECT r.id
    FROM reports r
    WHERE r.id = ANY(${reportIds}::uuid[])
      AND (${admin}::boolean OR (r.user_id = ${userId}::uuid AND r.paid_at IS NOT NULL))
  `) as Array<{ id: string }>;
  const ok = new Set(rows.map((r) => r.id));
  return reportIds.filter((id) => ok.has(id));
}
