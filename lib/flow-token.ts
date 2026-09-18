// Report-flow token: proof that the caller of /api/fetch-overlays and
// /api/generate-narrative got the addressId from OUR /api/geocode a moment
// ago, rather than replaying an id scraped from a report URL.
//
// The two routes are the most expensive in the app (~100 upstream calls,
// multi-MB writes) and must stay usable by anonymous visitors (the single-
// report paywall), so a session cannot be the gate. A short-lived HS256
// token bound to the addressId is: it costs nothing to issue, the client
// already has to round-trip through geocode, and it turns "any UUID" into
// "a UUID this deployment handed out in the last half hour".

import { jwtVerify, SignJWT } from "jose";

const FLOW_TTL = "30m";
const PURPOSE = "report-flow";

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing env var AUTH_SECRET (see lib/auth.ts).");
  return new TextEncoder().encode(secret);
}

export async function signFlowToken(addressId: string): Promise<string> {
  return new SignJWT({ purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(addressId)
    .setIssuedAt()
    .setExpirationTime(FLOW_TTL)
    .sign(key());
}

/** True when `token` was issued for exactly this addressId and is unexpired. */
export async function verifyFlowToken(
  token: string | null | undefined,
  addressId: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload.sub === addressId && payload.purpose === PURPOSE;
  } catch {
    return false;
  }
}
