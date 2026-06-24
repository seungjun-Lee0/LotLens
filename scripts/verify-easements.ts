// One-shot verification — runs fetchEasementsData() against known Brisbane
// coords and prints the relevant fields. No DB writes.

import { fetchEasementsData } from "@/lib/modules/easements";

type Case = { label: string; lat: number; lng: number; expect: string };

const CASES: Case[] = [
  // 61 Tingalpa Street, Wynnum West — Develo's reference. Their report shows
  // "NO CONSIDERATIONS IDENTIFIED" for Easements. Expect both layers empty.
  { label: "Tingalpa (Develo reference)", lat: -27.4540, lng: 153.1822, expect: "no hit (matches Develo)" },
  // Brisbane CBD residential block — dense utility runs usually mean cadastral
  // easements somewhere on adjacent lots; the point may or may not be on one.
  { label: "South Brisbane residential", lat: -27.4839, lng: 153.0182, expect: "context features likely > 0" },
  // Rocklea — known flood-prone area, also tested in our flooding module
  { label: "Rocklea flood-prone", lat: -27.5366, lng: 153.0007, expect: "may show easements" },
  // Inside a known DCDB easement polygon (BSP108564 centroid, 319 m²).
  // This is a positive control — detection MUST hit.
  { label: "Direct hit (BSP108564 centroid)", lat: -27.443656, lng: 153.019445, expect: "hasCadastralEasement = TRUE" },
];

async function main() {
  for (const c of CASES) {
    process.stdout.write(`\n— ${c.label}  (${c.lat}, ${c.lng})\n`);
    try {
      const r = await fetchEasementsData(c.lat, c.lng);
      console.log("  riskLevel:               ", r.riskLevel);
      console.log("  hasHighVoltageEasement:  ", r.hasHighVoltageEasement);
      console.log("  hasCadastralEasement:    ", r.hasCadastralEasement);
      console.log("  cadastralEasements.len:  ", r.cadastralEasements.length);
      if (r.cadastralEasements.length > 0) {
        for (const e of r.cadastralEasements.slice(0, 5)) {
          console.log("    ·", e.lotplan, "|", e.parcelType, "|", e.areaSqm, "m²");
        }
      }
      // Map context (envelope ~280m) — how many polygons would render on the map?
      const ctxCount = countFeatures(r.cadastralContext);
      console.log("  cadastralContext count:  ", ctxCount, "(map polygons)");
      const hvCtxCount = countFeatures(r.context);
      console.log("  HV context count:        ", hvCtxCount);
      console.log("  expectation:             ", c.expect);
    } catch (err) {
      console.error("  ERROR:", (err as Error).message);
    }
  }
}

function countFeatures(x: unknown): number {
  if (typeof x !== "object" || x === null) return 0;
  const fc = x as { features?: unknown[] };
  return Array.isArray(fc.features) ? fc.features.length : 0;
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
