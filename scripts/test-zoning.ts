// npx tsx scripts/test-zoning.ts
import { fetchZoningData } from "../lib/modules/zoning";

const CASES = [
  { label: "Brisbane CBD", lat: -27.4694, lng: 153.0235 },
  { label: "Rocklea Markets", lat: -27.5464, lng: 152.9912 },
  { label: "Chermside", lat: -27.385, lng: 153.034 },
  { label: "Paddington", lat: -27.4604, lng: 152.9971 },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.label} @ (${c.lat}, ${c.lng}) ===`);
    try {
      const r = await fetchZoningData(c.lat, c.lng);
      console.log("  zoneCode:    ", r.zoneCode);
      console.log("  zonePrecinct:", r.zonePrecinct);
      console.log("  lvl1Zone:    ", r.lvl1Zone);
      console.log("  lvl2Zone:    ", r.lvl2Zone);
      console.log("  riskLevel:   ", r.riskLevel);
    } catch (err) {
      console.error("  ERROR:", err);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
