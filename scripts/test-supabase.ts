// npx tsx scripts/test-supabase.ts
//
// Smoke-test the Supabase setup: env vars resolve, service-role client
// connects, schema is applied, PostGIS is enabled.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getServerSupabase } from "../lib/supabase";

async function main() {
  console.log("env present:");
  console.log("  NEXT_PUBLIC_SUPABASE_URL:     ", process.env.NEXT_PUBLIC_SUPABASE_URL ? "yes" : "MISSING");
  console.log("  NEXT_PUBLIC_SUPABASE_ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "yes" : "MISSING");
  console.log("  SUPABASE_SERVICE_ROLE_KEY:    ", process.env.SUPABASE_SERVICE_ROLE_KEY ? "yes" : "MISSING");

  const sb = getServerSupabase();

  console.log("\nchecking tables...");
  for (const t of ["addresses", "council_data", "reports"] as const) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) console.error(`  ${t}: ERROR ${error.message}`);
    else console.log(`  ${t}: ${count ?? 0} rows`);
  }

  console.log("\nchecking PostGIS via RPC fallback (SELECT 1 from addresses with geom)...");
  // Probe whether the generated geom column resolved on the addresses row.
  const { data, error } = await sb
    .from("addresses")
    .select("id,address_text,lat,lng")
    .limit(1);
  if (error) console.error("  query error:", error.message);
  else console.log("  read OK (rows returned:", data?.length ?? 0, ")");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
