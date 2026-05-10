// npx tsx scripts/test-heritage.ts
import { fetchHeritageData } from "../lib/modules/heritage";

// First three coords come from actual layer polygon vertices (sampled via
// returnGeometry=true), so we know they intersect the layer.
const CASES = [
  { label: "Paddington (character belt)",            lat: -27.4604, lng: 152.9971 },
  { label: "Local heritage area sample",             lat: -27.53324, lng: 153.02440 },
  { label: "State heritage area sample",             lat: -27.47573, lng: 153.03643 },
  { label: "Chermside (clean baseline)",             lat: -27.385,   lng: 153.034 },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.label} @ (${c.lat}, ${c.lng}) ===`);
    try {
      const r = await fetchHeritageData(c.lat, c.lng);
      console.log("  riskLevel:       ", r.riskLevel);
      console.log("  hasConsideration:", r.hasConsideration);
      console.log("  entries:");
      for (const e of r.entries) {
        console.log(`    - [${e.type}] ${e.category ?? "?"} / ${e.description ?? "?"}`);
      }
    } catch (err) {
      console.error("  ERROR:", err);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
