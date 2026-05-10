// npx tsx scripts/test-easements.ts
import { fetchEasementsData } from "../lib/modules/easements";

// Coords from actual polygon vertices of the 17-feature HV easement layer
// (sampled via returnGeometry=true) — see comment in lib/modules/easements.ts.
const CASES = [
  { label: "Karawatha corridor (real vertex)", lat: -27.64141, lng: 153.01151 },
  { label: "Rocklea Markets",                  lat: -27.5464, lng: 152.9912 },
  { label: "Chermside",                        lat: -27.385,  lng: 153.034 },
  { label: "Brisbane CBD",                     lat: -27.4694, lng: 153.0235 },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.label} @ (${c.lat}, ${c.lng}) ===`);
    try {
      const r = await fetchEasementsData(c.lat, c.lng);
      console.log("  riskLevel:              ", r.riskLevel);
      console.log("  hasHighVoltageEasement: ", r.hasHighVoltageEasement);
      console.log("  description:            ", r.description ?? "(none)");
    } catch (err) {
      console.error("  ERROR:", err);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
