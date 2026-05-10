// Manual smoke test for the flooding module.
// Run: npx tsx scripts/test-flooding.ts
//
// We test three coords:
//   - Rocklea Markets   — flood-affected core, expect High + Feb2022 + Jan2011 hits
//   - TASKS.md Rocklea  — on higher ground edge, expect Very Low + no historic
//   - Chermside         — clean baseline, expect no feature (riskLevel='none')
//
// The TASKS.md spec called for (-27.540, 152.988) which actually falls
// outside the 2022 flood polygon — that point is just NE of the Rocklea
// flood zone. Real Property B coord should be deeper in (e.g. Markets).

import { fetchFloodingData } from "../lib/modules/flooding";

const CASES: { label: string; lat: number; lng: number }[] = [
  { label: "Rocklea Markets (flood-affected core)", lat: -27.5464, lng: 152.9912 },
  { label: "Rocklea per TASKS.md (higher ground edge)", lat: -27.540, lng: 152.988 },
  { label: "Chermside (clean baseline candidate)", lat: -27.385, lng: 153.034 },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.label} @ (${c.lat}, ${c.lng}) ===`);
    try {
      const t0 = performance.now();
      const r = await fetchFloodingData(c.lat, c.lng);
      const ms = Math.round(performance.now() - t0);
      console.log(`  riskLevel:        ${r.riskLevel}`);
      console.log(`  floodType:        ${r.floodType ?? "(none)"}`);
      console.log(`  hasConsideration: ${r.hasConsideration}`);
      console.log(`  historicEvents:   ${r.historicEvents.length}`);
      for (const e of r.historicEvents) {
        console.log(`    - ${e.event} (${e.sourceType ?? "?"} / ${e.sourceName ?? "?"})`);
      }
      console.log(`  elapsed:          ${ms}ms`);
    } catch (err) {
      console.error("  ERROR:", err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
