// npx tsx scripts/test-db.ts
//
// Smoke-test the Postgres setup: DATABASE_URL resolves, the Neon client
// connects, the three tables exist.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getDb } from "../lib/db";

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "yes" : "MISSING");

  const sql = getDb();
  const probes: Array<{ name: string; q: () => Promise<unknown> }> = [
    { name: "addresses",    q: () => sql`SELECT count(*)::int AS n FROM addresses` },
    { name: "council_data", q: () => sql`SELECT count(*)::int AS n FROM council_data` },
    { name: "reports",      q: () => sql`SELECT count(*)::int AS n FROM reports` },
  ];

  console.log("\nchecking tables...");
  for (const p of probes) {
    try {
      const rows = (await p.q()) as Array<{ n: number }>;
      console.log(`  ${p.name.padEnd(13)} ${rows[0].n} rows`);
    } catch (err) {
      console.error(`  ${p.name.padEnd(13)} ERROR ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
