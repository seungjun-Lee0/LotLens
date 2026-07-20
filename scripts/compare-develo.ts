// npx tsx scripts/compare-develo.ts
//
// Runs the LotLens module classifiers for the addresses covered by the
// competitor PDFs in /report (Develo), and dumps a compact per-module
// summary for side-by-side comparison. No DB, no narrative — just the
// live overlay classifications.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// tsx doesn't load .env.local — pull the Google key in so the geocoder
// runs the same provider order as the deployed app.
try {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("GOOGLE_GEOCODING_API_KEY="));
  const v = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "") : "";
  if (v) process.env.GOOGLE_GEOCODING_API_KEY = v;
} catch {
  /* no env file — QLD locator path */
}

import { geocodeAddress } from "../lib/geocoder";
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

const ADDRESSES = [
  "1019 Ann Street, Newstead QLD 4006",
  "15 Addison Avenue, Bulimba QLD 4171",
  "16 Rover Street, Mount Gravatt QLD 4122",
  "198 Fletcher Parade, Bardon QLD 4065",
  "30 Rivergum Place, Fig Tree Pocket QLD 4069",
  "33 Heath Street, East Brisbane QLD 4169",
  "50 Macquarie Street, Teneriffe QLD 4005",
  "69 Alice Street, Brisbane City QLD 4000",
  "8 Queens Wharf Road, Brisbane City QLD 4000",
];

type Row = {
  riskLevel: string;
  hasConsideration: boolean;
  available?: boolean;
  note?: string;
};

async function classify(lat: number, lng: number) {
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
    riskLevel: string;
    hasConsideration: boolean;
    available?: boolean;
    raw?: unknown;
  }, noteKeys: string[] = []): Row => {
    const raw = (r.raw ?? {}) as Record<string, unknown>;
    const note = noteKeys
      .map((k) => raw[k])
      .filter((v) => v !== null && v !== undefined && v !== "")
      .join(" · ");
    return {
      riskLevel: r.riskLevel,
      hasConsideration: r.hasConsideration,
      ...(r.available !== undefined ? { available: r.available } : {}),
      ...(note ? { note } : {}),
    };
  };

  return {
    lotPlan: parcel.lotPlan,
    lga: parcel.lga,
    areaM2: parcel.areaM2,
    modules: {
      flooding: g(flood, ["overallRisk", "riverRisk", "creekRisk"]),
      flood_planning: g(floodPlan, ["riverCategory", "creekCategory"]),
      overland_flow: g(overland, ["risk"]),
      storm_tide: g(stormTide, ["category"]),
      bushfire: g(fire, ["category", "hazardClass"]),
      vegetation: g(veg, ["categories"]),
      environment: g(env, ["koala", "wildlife"]),
      heritage: g(herit, ["stateListed", "localListed", "character"]),
      easements: g(ease, ["count", "hvCount"]),
      noise: g(noise, ["category", "anef"]),
      steep_land: g(steep, ["category"]),
      acid_sulfate: g(acid, ["mapCode"]),
      mining: g(mine, ["tenementCount"]),
      schools: g(schools, []),
      zoning: g(zone, ["zonePrecinct", "lvl2Zone", "lvl1Zone", "zoneCode"]),
    },
  };
}

async function main() {
  const out: Record<string, unknown> = {};
  for (const addr of ADDRESSES) {
    process.stdout.write(`geocoding ${addr} … `);
    const hit = await geocodeAddress(addr);
    if (!hit) {
      console.log("GEOCODE FAILED");
      out[addr] = { error: "geocode failed" };
      continue;
    }
    console.log(`${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
    try {
      out[addr] = { lat: hit.lat, lng: hit.lng, ...(await classify(hit.lat, hit.lng)) };
      console.log(`  done: ${addr}`);
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message}`);
      out[addr] = { error: (err as Error).message };
    }
  }
  const path = join(process.cwd(), "scripts", "develo-compare-lotlens.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
