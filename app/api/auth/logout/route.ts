// POST /api/auth/logout — clears the session cookie. Accepts plain form
// posts (header sign-out button) and redirects home.

import { NextResponse } from "next/server";

import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await destroySession();
  const accepts = req.headers.get("accept") ?? "";
  if (accepts.includes("text/html")) {
    // Form submission — send the browser back to the landing page.
    return NextResponse.redirect(new URL("/", req.url), 303);
  }
  return NextResponse.json({ ok: true });
}
