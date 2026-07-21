// Session auth — email+password (bcrypt) and Google OAuth, hand-rolled on
// a signed JWT in an httpOnly cookie. No NextAuth: the surface we need is
// small (signup/login/logout/session) and this keeps us off beta-adapter
// churn. Server-only.

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

import { getDb } from "@/lib/db";

export const SESSION_COOKIE = "lotlens_session";
const SESSION_DAYS = 30;

export type Plan = "free" | "basic" | "pro";

/** Reports a subscriber can unlock per calendar month. */
export const PLAN_QUOTAS: Record<Exclude<Plan, "free">, number> = {
  basic: 10,
  pro: 50,
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  /** Report credits left this billing cycle (granted by the webhook). */
  credits: number;
  /** False for Google-only accounts (they can add a password in /account). */
  hasPassword: boolean;
  /** PDF report branding (subscriber feature). */
  brandName: string | null;
  brandColor: string | null;
  brandLogoUrl: string | null;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  current_period_end: string | null;
  credits: number;
  has_password: boolean;
  brand_name: string | null;
  brand_color: string | null;
  brand_logo_url: string | null;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Missing env var AUTH_SECRET. Generate one with `openssl rand -hex 32` (or any 32+ char random string) and add it to .env.local.",
    );
  }
  return new TextEncoder().encode(secret);
}

// ── Passwords ─────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Session cookie ────────────────────────────────────────────────────────

/** Sign a session JWT and set the cookie. Route Handlers / Server Functions only. */
export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

function toSessionUser(row: UserRow): SessionUser {
  const plan: Plan =
    row.plan === "basic" || row.plan === "pro" ? row.plan : "free";
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    plan,
    subscriptionStatus: row.subscription_status,
    stripeCustomerId: row.stripe_customer_id,
    currentPeriodEnd: row.current_period_end,
    credits: row.credits ?? 0,
    hasPassword: row.has_password,
    brandName: row.brand_name ?? null,
    brandColor: row.brand_color ?? null,
    brandLogoUrl: row.brand_logo_url ?? null,
  };
}

/** Resolve the current user from the session cookie. Null on any failure. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey());
    const userId = payload.sub;
    if (!userId) return null;
    const sql = getDb();
    const rows = (await sql`
      SELECT id, email, name, plan, subscription_status,
             stripe_customer_id, current_period_end, credits,
             (password_hash IS NOT NULL) AS has_password,
             brand_name, brand_color, brand_logo_url
      FROM users WHERE id = ${userId} LIMIT 1
    `) as UserRow[];
    if (rows.length === 0) return null;
    return toSessionUser(rows[0]);
  } catch {
    return null;
  }
}

/** True when the user's paid plan is currently good for quota unlocks. */
export function isActiveSubscriber(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.plan !== "free" &&
    (user.subscriptionStatus === "active" ||
      user.subscriptionStatus === "trialing")
  );
}

/** Reports unlocked against quota in the current calendar month. */
export async function usageThisMonth(userId: string): Promise<number> {
  const sql = getDb();
  const rows = (await sql`
    SELECT count(*)::int AS n FROM report_usage
    WHERE user_id = ${userId} AND created_at >= date_trunc('month', now())
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── Admin ─────────────────────────────────────────────────────────────────

/** True when the user's email is in the comma-separated ADMIN_EMAILS env. */
export function isAdmin(user: SessionUser | null): boolean {
  if (!user) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(user.email.toLowerCase());
}

// ── Google OAuth (enabled only when both env vars are present) ────────────

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}
