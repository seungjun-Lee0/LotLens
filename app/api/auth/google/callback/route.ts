// GET /api/auth/google/callback — exchanges the code, verifies the Google
// id_token (signature via Google's JWKS), upserts the user, signs them in.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { createSession, googleOAuthConfigured } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export async function GET(req: Request) {
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google", req.url), 302);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const expectedState = store.get("lotlens_oauth_state")?.value;
  store.delete("lotlens_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=google", req.url), 302);
  }

  try {
    // Exchange the code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error("no id_token in response");

    const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: process.env.GOOGLE_CLIENT_ID!,
    });
    const googleId = payload.sub as string;
    const email = String(payload.email ?? "").toLowerCase();
    const name = (payload.name as string | undefined) ?? null;
    if (!googleId || !email) throw new Error("id_token missing sub/email");

    const sql = getDb();
    // Match by google_id first, then link by email (existing password
    // account signing in with Google for the first time), else create.
    const rows = (await sql`
      SELECT id FROM users WHERE google_id = ${googleId} OR email = ${email}
      ORDER BY (google_id = ${googleId}) DESC LIMIT 1
    `) as Array<{ id: string }>;
    let userId: string;
    if (rows.length > 0) {
      userId = rows[0].id;
      await sql`
        UPDATE users
        SET google_id = COALESCE(google_id, ${googleId}),
            name = COALESCE(name, ${name})
        WHERE id = ${userId}
      `;
    } else {
      const inserted = (await sql`
        INSERT INTO users (email, google_id, name)
        VALUES (${email}, ${googleId}, ${name})
        RETURNING id
      `) as Array<{ id: string }>;
      userId = inserted[0].id;
    }
    await createSession(userId);
    return NextResponse.redirect(new URL("/", req.url), 302);
  } catch (err) {
    console.error("[auth/google/callback] failed:", err);
    return NextResponse.redirect(new URL("/login?error=google", req.url), 302);
  }
}
