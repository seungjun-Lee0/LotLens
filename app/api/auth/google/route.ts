// GET /api/auth/google — kicks off the Google OAuth code flow.
// Active only when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { googleOAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google sign-in is not configured." },
      { status: 404 },
    );
  }
  const origin = new URL(req.url).origin;
  const state = crypto.randomUUID();
  const store = await cookies();
  store.set("lotlens_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302,
  );
}
