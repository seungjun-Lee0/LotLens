// Supabase clients for the prototype.
//
// We have no auth (CLAUDE.md §3), so the cookie-based @supabase/ssr pattern is
// not needed — plain @supabase/supabase-js is enough. The split matters only
// for credentials:
//
//   getBrowserSupabase()  -> anon key, safe to ship to the client
//   getServerSupabase()   -> service-role key, route handlers only
//
// `Database` types mirror /db/schema.sql by hand. Swap for codegen once Jun
// provisions the Supabase project: `supabase gen types typescript`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Database types (manual, kept in sync with /db/schema.sql) ─────────────

type Iso = string; // timestamptz
type Uuid = string;

export type Module =
  | "flooding"
  | "bushfire"
  | "heritage"
  | "easements"
  | "zoning";

export type RiskLevel = "high" | "medium" | "low" | "very_low" | "none";

export type Database = {
  public: {
    Tables: {
      addresses: {
        Row: {
          id: Uuid;
          address_text: string;
          lat: number;
          lng: number;
          lot_plan: string | null;
          // `geom` is a generated PostGIS column; we never read/write it via
          // the JS client. Omit from Row to avoid stringly-typed surprises.
          created_at: Iso;
        };
        Insert: {
          id?: Uuid;
          address_text: string;
          lat: number;
          lng: number;
          lot_plan?: string | null;
          created_at?: Iso;
        };
        Update: Partial<Database["public"]["Tables"]["addresses"]["Insert"]>;
      };
      council_data: {
        Row: {
          id: Uuid;
          address_id: Uuid | null;
          module: Module;
          source_url: string;
          source_name: string;
          raw_response: unknown; // jsonb — narrow at the module boundary
          risk_level: RiskLevel | null;
          has_consideration: boolean;
          retrieved_at: Iso;
        };
        Insert: {
          id?: Uuid;
          address_id: Uuid | null;
          module: Module;
          source_url: string;
          source_name: string;
          raw_response: unknown;
          risk_level?: RiskLevel | null;
          has_consideration?: boolean;
          retrieved_at?: Iso;
        };
        Update: Partial<Database["public"]["Tables"]["council_data"]["Insert"]>;
      };
      reports: {
        Row: {
          id: Uuid;
          address_id: Uuid | null;
          narrative: unknown; // jsonb — { [module]: ModuleNarrative }
          generated_at: Iso;
        };
        Insert: {
          id?: Uuid;
          address_id: Uuid | null;
          narrative: unknown;
          generated_at?: Iso;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type TypedSupabase = SupabaseClient<Database>;

// ── Client factories ──────────────────────────────────────────────────────

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing env var ${name}. See .env.local.example and /db/README.md.`,
    );
  }
  return value;
}

let browserClient: TypedSupabase | null = null;

/** Anon-key client. Safe in client components. Singleton per browser tab. */
export function getBrowserSupabase(): TypedSupabase {
  if (browserClient) return browserClient;
  const url = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  browserClient = createClient<Database>(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return browserClient;
}

/**
 * Service-role client. Bypasses RLS. **Server-only** — never import from a
 * client component or any file that runs in the browser bundle. A fresh
 * instance per call avoids leaking request-scoped state across handlers.
 */
export function getServerSupabase(): TypedSupabase {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerSupabase() called from the browser. Use getBrowserSupabase() instead.",
    );
  }
  const url = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRole = required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  return createClient<Database>(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
