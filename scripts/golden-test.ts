// Golden classification tests — pins the pipeline's per-module output for
// known addresses against a checked-in snapshot.
//
//   npx tsx scripts/golden-test.ts            compare against the snapshot
//   npx tsx scripts/golden-test.ts --update   re-record the snapshot
//
// Catches two failure classes the health check can't:
//   - a source silently changing its schema/vocabulary (fetch succeeds but
//     classification flips to a wrong value)
//   - a refactor changing classification behaviour unintentionally
//
// Overlay data DOES legitimately change (new flood studies, plan updates).
// When a diff is genuinely upstream, verify against the council's own
// mapping, then re-run with --update and commit the new snapshot.
//
// Snapshot: scripts/golden-snapshot.json

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Module, RiskLevel } from "../lib/db";
import { fetchPropertyParcel, insetParcelPolygon } from "../lib/property";
import { regionFromParcel } from "../lib/region";

import { fetchAcidSulfateData } from "../lib/modules/acid-sulfate";
import { fetchBushfireData } from "../lib/modules/bushfire";
import { fetchEasementsData } from "../lib/modules/easements";
import { fetchEnvironmentData } from "../lib/modules/environment";
import { fetchFloodingData } from "../lib/modules/flooding";
import { fetchFloodPlanningData } from "../lib/modules/flood-planning";
import { fetchHeritageData } from "../lib/modules/heritage";
import { fetchMiningData } from "../lib/modules/mining";
import { fetchNoiseData } from "../lib/modules/noise";
import { fetchOverlandFlowData } from "../lib/modules/overland-flow";
import { fetchSchoolsData } from "../lib/modules/schools";
import { fetchSteepLandData } from "../lib/modules/steep-land";
import { fetchStormTideData } from "../lib/modules/storm-tide";
import { fetchVegetationData } from "../lib/modules/vegetation";
import { fetchZoningData } from "../lib/modules/zoning";

const SNAPSHOT_PATH = join(process.cwd(), "scripts", "golden-snapshot.json");

// Diverse fixtures: Brisbane (full BCC stack), Gold Coast + Sunshine Coast
// (council adapters), each stable residential locations.
const FIXTURES = [
  { key: "graceville-bne", label: "Graceville (Brisbane)", lat: -27.519, lng: 152.9727 },
  { key: "surfers-gc", label: "Surfers Paradise (Gold Coast)", lat: -28.0023, lng: 153.4145 },
  { key: "maroochydore-sc", label: "Maroochydore (Sunshine Coast)", lat: -26.6564, lng: 153.091 },
] as const;

type ModuleGolden = {
  riskLevel: RiskLevel;
  hasConsideration: boolean;
  /** Only for availability-gated modules. */
  available?: boolean;
};
type FixtureGolden = {
  label: string;
  lotPlan: string | null;
  lga: string | null;
  modules: Record<Module, ModuleGolden>;
};
type Snapshot = Record<string, FixtureGolden>;

async function classify(lat: number, lng: number): Promise<Omit<FixtureGolden, "label">> {
  const parcel = await fetchPropertyParcel(lat, lng);
  const region = regionFromParcel(parcel.lga, lat, lng);
  const lot = parcel.polygon ? insetParcelPolygon(parcel.polygon) : null;

  const [
    flood, floodPlan, overland, stormTide, fire, veg, env, herit,
    ease, noise, steep, acid, mine, schools, zone,
  ] = await Promise.all([
    fetchFloodingData(lat, lng, region, lot),
    fetchFloodPlanningData(lat, lng, region, lot),
    fetchOverlandFlowData(lat, lng, region, lot),
    fetchStormTideData(lat, lng, lot),
    fetchBushfireData(lat, lng, lot),
    fetchVegetationData(lat, lng, region, lot),
    fetchEnvironmentData(lat, lng, lot),
    fetchHeritageData(lat, lng, region, lot),
    fetchEasementsData(lat, lng, region, lot),
    fetchNoiseData(lat, lng, region, lot),
    fetchSteepLandData(lat, lng, region, lot),
    fetchAcidSulfateData(lat, lng, lot),
    fetchMiningData(lat, lng, lot),
    fetchSchoolsData(lat, lng),
    fetchZoningData(lat, lng, region),
  ]);

  const g = (r: {
    riskLevel: RiskLevel;
    hasConsideration: boolean;
    available?: boolean;
  }): ModuleGolden => ({
    riskLevel: r.riskLevel,
    hasConsideration: r.hasConsideration,
    ...(r.available !== undefined ? { available: r.available } : {}),
  });

  return {
    lotPlan: parcel.lotPlan,
    lga: parcel.lga,
    modules: {
      flooding: g(flood),
      flood_planning: g(floodPlan),
      overland_flow: g(overland),
      storm_tide: g(stormTide),
      bushfire: g(fire),
      vegetation: g(veg),
      environment: g(env),
      heritage: g(herit),
      easements: g(ease),
      noise: g(noise),
      steep_land: g(steep),
      acid_sulfate: g(acid),
      mining: g(mine),
      schools: g(schools),
      zoning: g(zone),
    },
  };
}

async function main() {
  const update = process.argv.includes("--update");

  const current: Snapshot = {};
  for (const f of FIXTURES) {
    console.log(`fetching ${f.label} …`);
    current[f.key] = { label: f.label, ...(await classify(f.lat, f.lng)) };
  }

  if (update) {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`\nsnapshot written to ${SNAPSHOT_PATH}`);
    return;
  }

  let golden: Snapshot;
  try {
    golden = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  } catch {
    console.error(
      `No snapshot at ${SNAPSHOT_PATH}. Run with --update to record one.`,
    );
    process.exit(1);
  }

  const diffs: string[] = [];
  for (const f of FIXTURES) {
    const want = golden[f.key];
    const got = current[f.key];
    if (!want) {
      diffs.push(`${f.key}: missing from snapshot (run --update)`);
      continue;
    }
    if (want.lotPlan !== got.lotPlan) {
      diffs.push(`${f.key}: lotPlan ${want.lotPlan} -> ${got.lotPlan}`);
    }
    for (const m of Object.keys(want.modules) as Module[]) {
      const w = want.modules[m];
      const c = got.modules[m];
      if (!c) {
        diffs.push(`${f.key}/${m}: missing from current run`);
        continue;
      }
      if (w.riskLevel !== c.riskLevel) {
        diffs.push(`${f.key}/${m}: riskLevel ${w.riskLevel} -> ${c.riskLevel}`);
      }
      if (w.hasConsideration !== c.hasConsideration) {
        diffs.push(`${f.key}/${m}: hasConsideration ${w.hasConsideration} -> ${c.hasConsideration}`);
      }
      if (w.available !== c.available) {
        diffs.push(`${f.key}/${m}: available ${w.available} -> ${c.available}`);
      }
    }
  }

  if (diffs.length > 0) {
    console.error(`\n${diffs.length} golden diff(s):`);
    for (const d of diffs) console.error(`  ${d}`);
    console.error(
      "\nIf these reflect a genuine upstream data change, re-run with --update and commit the snapshot.",
    );
    process.exit(1);
  }
  console.log(`\nall ${FIXTURES.length} fixtures match the golden snapshot ✓`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
