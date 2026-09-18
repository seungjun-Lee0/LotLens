// Per-IP rate limiting for API routes.
//
// Token bucket in Postgres (`rate_limits`), so the limit is GLOBAL across
// serverless instances: the previous per-instance Map meant "5 per 10 min"
// was really "5 per warm instance", and scale-out plus a rotating
// x-forwarded-for made it arbitrarily large on the routes that cost ~100
// upstream calls each. One upsert per request; the bucket maths runs in
// the statement so concurrent requests can't double-spend a token.
//
// If the database is unreachable the in-memory bucket takes over rather
// than failing open or closed: a DB blip should neither let a scraper
// through nor lock every user out.
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();
// Backstop against memory growth from IP churn. Map iterates in insertion
// order, so evicting the first key drops the longest-untouched bucket.
const MAX_BUCKETS = 20_000;

function clientIp(req: Request): string {
  // Vercel/most proxies put the real client first in x-forwarded-for.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSec)) } },
  );
}

/** Local fallback: exactly the old behaviour, one warm instance at a time. */
function takeLocal(key: string, limit: number, refillPerMs: number, now: number): number | null {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: limit, last: now };
    buckets.set(key, bucket);
    if (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  } else {
    bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.last) * refillPerMs);
    bucket.last = now;
    buckets.delete(key);
    buckets.set(key, bucket);
  }
  if (bucket.tokens < 1) {
    return Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
  }
  bucket.tokens -= 1;
  return null;
}

/**
 * Global bucket: refill from the stored timestamp, then either spend one
 * token or record the denial, all in one statement. `denied` is written by
 * the same UPDATE so the caller can tell "0.4 tokens left after spending"
 * from "0.4 tokens, refused" without a second round trip.
 */
async function takeGlobal(
  key: string,
  limit: number,
  refillPerMs: number,
  now: number,
): Promise<number | null> {
  const sql = getDb();
  const rows = (await sql`
    INSERT INTO rate_limits (key, tokens, last_ms, denied)
    VALUES (${key}, ${limit - 1}, ${now}, false)
    ON CONFLICT (key) DO UPDATE SET
      tokens = CASE
        WHEN LEAST(${limit}::double precision,
                   rate_limits.tokens + (${now}::bigint - rate_limits.last_ms) * ${refillPerMs}::double precision) >= 1
        THEN LEAST(${limit}::double precision,
                   rate_limits.tokens + (${now}::bigint - rate_limits.last_ms) * ${refillPerMs}::double precision) - 1
        ELSE LEAST(${limit}::double precision,
                   rate_limits.tokens + (${now}::bigint - rate_limits.last_ms) * ${refillPerMs}::double precision)
      END,
      denied = LEAST(${limit}::double precision,
                     rate_limits.tokens + (${now}::bigint - rate_limits.last_ms) * ${refillPerMs}::double precision) < 1,
      last_ms = ${now}
    RETURNING tokens, denied
  `) as Array<{ tokens: number; denied: boolean }>;
  const row = rows[0];
  if (!row) return null;
  // Reap idle buckets now and then: a day of inactivity means the row is
  // just IP churn. Fire-and-forget; one in a hundred calls is plenty.
  if (Math.random() < 0.01) {
    void sql`DELETE FROM rate_limits WHERE last_ms < ${now - 24 * 3600 * 1000}`.catch(() => {});
  }
  if (row.denied) {
    return Math.ceil((1 - Number(row.tokens)) / refillPerMs / 1000);
  }
  return null;
}

/**
 * Returns a ready-to-send 429 response when the caller is over the limit
 * for this route, or null when the request may proceed.
 *
 *   const limited = await enforceRateLimit("login", req, { limit: 10, windowSec: 600 });
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  route: string,
  req: Request,
  opts: { limit: number; windowSec: number },
): Promise<NextResponse | null> {
  const key = `${route}:${clientIp(req)}`;
  const now = Date.now();
  const refillPerMs = opts.limit / (opts.windowSec * 1000);
  let retryAfter: number | null;
  try {
    retryAfter = await takeGlobal(key, opts.limit, refillPerMs, now);
  } catch (err) {
    console.warn("[rate-limit] db bucket unavailable, using local bucket:", (err as Error).message);
    retryAfter = takeLocal(key, opts.limit, refillPerMs, now);
  }
  return retryAfter === null ? null : tooMany(retryAfter);
}
