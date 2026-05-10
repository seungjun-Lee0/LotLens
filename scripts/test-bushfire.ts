// npx tsx scripts/test-bushfire.ts
import { fetchBushfireData } from "../lib/modules/bushfire";

const CASES = [
  { label: "Moggill (bushfire-prone wooded edge)", lat: -27.575, lng: 152.870 },
  { label: "Rocklea Markets (urban floodplain — expect none)", lat: -27.5464, lng: 152.9912 },
  { label: "Chermside (clean baseline candidate)", lat: -27.385, lng: 153.034 },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.label} @ (${c.lat}, ${c.lng}) ===`);
    try {
      const r = await fetchBushfireData(c.lat, c.lng);
      console.log("  riskLevel:        ", r.riskLevel);
      console.log("  hazardCategory:   ", r.hazardCategory ?? "(none)");
      console.log("  hazardCode:       ", r.hazardCode ?? "(none)");
      console.log("  hasConsideration: ", r.hasConsideration);
    } catch (err) {
      console.error("  ERROR:", err);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
