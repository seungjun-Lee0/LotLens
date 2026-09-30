// Read-only share links for a report.
//
// A report URL is NOT a bearer token: a signed-in owner's run 404s for
// anyone else (canViewReport). Sharing with a conveyancer or a partner
// therefore needs its own credential: a signed, expiring token bound to
// ONE report id, carried in the URL (`?s=…`). Stateless (HS256 over
// AUTH_SECRET, like the session cookie), so nothing is stored and a link
// stays valid until it expires or the secret rotates.
//
// What a holder can do: view the report page, load its map overlays and
// download its PDF, all exactly as the owner sees them (paid → full,
// preview → preview). What they cannot do: unlock, retry, delete, or
// reach any other report.

import { jwtVerify, SignJWT } from "jose";

export const SHARE_PARAM = "s";
const SHARE_DAYS = 90;
const SUBJECT = "report-share";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing env var AUTH_SECRET");
  return new TextEncoder().encode(secret);
}

export async function createShareToken(reportId: string): Promise<string> {
  return new SignJWT({ rid: reportId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${SHARE_DAYS}d`)
    .sign(secretKey());
}

/** True when `token` is a live share token for exactly this report. */
export async function verifyShareToken(
  token: string | null | undefined,
  reportId: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { subject: SUBJECT });
    return payload.rid === reportId;
  } catch {
    return false;
  }
}

/** Append the share token to a same-report URL, keeping any query it has. */
export function withShareToken(url: string, token: string | null | undefined): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${SHARE_PARAM}=${encodeURIComponent(token)}`;
}

/** The token from a request URL, or null. */
export function shareTokenFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get(SHARE_PARAM);
  } catch {
    return null;
  }
}

export const SHARE_DAYS_LABEL = `${SHARE_DAYS} days`;
