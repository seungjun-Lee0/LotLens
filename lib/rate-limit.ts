// Per-IP rate limiting for API routes.
//
// Token bucket kept in per-instance memory. On serverless this means the
// limit applies per warm instance, not globally — still enough to stop
// the realistic abuse cases (credential stuffing a login form, hammering
// the report pipeline, scripting the geocoder), because a single abuser's
// requests land on a small number of instances. If limits ever need to be
// exact/global, swap the Map for Upstash Redis behind the same function
// signature — callers don't change.

import { NextResponse } from "next/server";

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

/**
 * Returns a ready-to-send 429 response when the caller is over the limit
 * for this route, or null when the request may proceed.
 *
 *   const limited = enforceRateLimit("login", req, { limit: 10, windowSec: 600 });
 *   if (limited) return limited;
 */
export function enforceRateLimit(
  route: string,
  req: Request,
  opts: { limit: number; windowSec: number },
): NextResponse | null {
  const key = `${route}:${clientIp(req)}`;
  const now = Date.now();
  const refillPerMs = opts.limit / (opts.windowSec * 1000);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: opts.limit, last: now };
    buckets.set(key, bucket);
    if (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
  } else {
    bucket.tokens = Math.min(
      opts.limit,
      bucket.tokens + (now - bucket.last) * refillPerMs,
    );
    bucket.last = now;
    // Refresh insertion order so eviction targets genuinely idle buckets.
    buckets.delete(key);
    buckets.set(key, bucket);
  }

  if (bucket.tokens < 1) {
    const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  bucket.tokens -= 1;
  return null;
}
