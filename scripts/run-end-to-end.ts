// npx tsx scripts/run-end-to-end.ts [addressId]
//
// If no addressId is given, inserts a "Rocklea Markets" test address and
// uses that. Then runs:
//   fetchOverlaysForAddress -> council_data
//   generateReportForAddress -> reports
// and prints the final report JSON. Skip the dev server entirely — the
// pipeline functions run directly against the Postgres DB.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getDb } from "../lib/db";
import {
  fetchOverlaysForAddress,
  generateReportForAddress,
} from "../lib/pipeline";

const TEST_ADDRESS = {
  address_text: "Rocklea Markets (test) — 250 Sherwood Rd, Rocklea QLD 4106",
  lat: -27.5464,
  lng: 152.9912,
};

async function ensureTestAddress(): Promise<string> {
  const sql = getDb();
  const existing = (await sql`
    SELECT id FROM addresses WHERE address_text = ${TEST_ADDRESS.address_text} LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length > 0) return existing[0].id;
  const inserted = (await sql`
    INSERT INTO addresses (address_text, lat, lng)
    VALUES (${TEST_ADDRESS.address_text}, ${TEST_ADDRESS.lat}, ${TEST_ADDRESS.lng})
    RETURNING id
  `) as Array<{ id: string }>;
  return inserted[0].id;
}

async function main() {
  const argId = process.argv[2];
  const addressId = argId ?? (await ensureTestAddress());
  console.log("addressId:", addressId);

  console.log("\n[1/2] fetchOverlaysForAddress ...");
  const fetchRes = await fetchOverlaysForAddress(addressId);
  console.log(`  done in ${fetchRes.elapsedMs}ms`);
  for (const [mod, val] of Object.entries(fetchRes.modules)) {
    console.log(`  ${mod.padEnd(10)} risk=${val.riskLevel.padEnd(8)} consideration=${val.hasConsideration}`);
  }

  console.log("\n[2/2] generateReportForAddress ...");
  const reportRes = await generateReportForAddress(addressId);
  console.log(`  reportId: ${reportRes.reportId}`);
  console.log(`  done in ${reportRes.elapsedMs}ms`);

  console.log("\n=== Narrative ===");
  for (const [mod, n] of Object.entries(reportRes.narrative)) {
    if (!n) continue;
    console.log(`\n--- ${mod} ---`);
    console.log("  summary:", n.summary);
    console.log("  detail: ", n.detail);
    console.log("  questions:");
    for (const q of n.questions_to_ask) console.log("    -", q);
    console.log("  sources:", n.sources);
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
