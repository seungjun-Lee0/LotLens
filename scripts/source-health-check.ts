// Source health check — verifies every upstream data source the report
// pipeline depends on is answering queries.
//
//   npx tsx scripts/source-health-check.ts
//
// Run weekly (or before a release). Exit code 1 when anything fails, so
// it drops straight into cron / GitHub Actions:
//   - runs all 15 module fetchers at a Brisbane test point (covers every
//     BCC + statewide layer exactly the way the pipeline calls them)
//   - point-queries every per-council adapter at a test point inside that
//     council (covers the Gold Coast / Moreton Bay / Sunshine Coast /
//     Redland layers the Brisbane run doesn't touch)
//   - checks the DCDB parcel layer, the QLD geocoder /suggest endpoint,
//     and the aerial imagery exporter.

import { queryArcGIS } from "../lib/arcgis";
import {
  FLOOD_ADAPTERS,
  NOISE_ADAPTERS,
  OVERLAND_ADAPTERS,
  STEEP_ADAPTERS,
  ZONING_ADAPTERS,
  type CouncilId,
} from "../lib/councils";
import { fetchPropertyParcel } from "../lib/property";
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

// Brisbane test point — the Graceville hero/demo lot (115RP73818).
const BNE = { lat: -27.519, lng: 152.9727 };

// One residential-ish point inside each adapted council.
const COUNCIL_POINTS: Record<CouncilId, { lat: number; lng: number }> = {
  brisbane: BNE,
  gold_coast: { lat: -28.0023, lng: 153.4145 },     // Surfers Paradise
  moreton_bay: { lat: -27.2019, lng: 152.9587 },     // Narangba
  sunshine_coast: { lat: -26.6564, lng: 153.091 },   // Maroochydore
  redland: { lat: -27.5266, lng: 153.2626 },         // Cleveland
};

const IMAGERY =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage" +
  "?bbox=17026000,-3185000,17027000,-3184000&bboxSR=3857&imageSR=3857&size=64,64&format=jpeg&f=image";

const SUGGEST =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Location/QldCompositeLocator/GeocodeServer/suggest?text=12%20oxley%20rd%20graceville&f=json&maxSuggestions=3";

type CheckResult = { name: string; ok: boolean; ms: number; error?: string };

async function check(name: string, run: () => Promise<unknown>): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    await run();
    return { name, ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: (err as Error).message,
    };
  }
}

async function main() {
  const results: CheckResult[] = [];
  const push = async (name: string, run: () => Promise<unknown>) =>
    results.push(await check(name, run));

  // Parcel first — the module fetchers below reuse its region.
  await push("dcdb-parcel", async () => {
    const p = await fetchPropertyParcel(BNE.lat, BNE.lng);
    if (!p.polygon) throw new Error("no parcel polygon at Brisbane test point");
    return p;
  });
  const parcel = await fetchPropertyParcel(BNE.lat, BNE.lng);
  const region = regionFromParcel(parcel.lga, BNE.lat, BNE.lng);
  const lot = parcel.polygon;

  // All 15 module fetchers, exactly as the pipeline calls them.
  const moduleChecks: Array<[string, () => Promise<unknown>]> = [
    ["module:flooding",       () => fetchFloodingData(BNE.lat, BNE.lng, region, lot)],
    ["module:flood_planning", () => fetchFloodPlanningData(BNE.lat, BNE.lng, region, lot)],
    ["module:overland_flow",  () => fetchOverlandFlowData(BNE.lat, BNE.lng, region, lot)],
    ["module:storm_tide",     () => fetchStormTideData(BNE.lat, BNE.lng, lot)],
    ["module:bushfire",       () => fetchBushfireData(BNE.lat, BNE.lng, lot)],
    ["module:vegetation",     () => fetchVegetationData(BNE.lat, BNE.lng, region, lot)],
    ["module:environment",    () => fetchEnvironmentData(BNE.lat, BNE.lng, lot)],
    ["module:heritage",       () => fetchHeritageData(BNE.lat, BNE.lng, region, lot)],
    ["module:easements",      () => fetchEasementsData(BNE.lat, BNE.lng, region, lot)],
    ["module:noise",          () => fetchNoiseData(BNE.lat, BNE.lng, region, lot)],
    ["module:steep_land",     () => fetchSteepLandData(BNE.lat, BNE.lng, region, lot)],
    ["module:acid_sulfate",   () => fetchAcidSulfateData(BNE.lat, BNE.lng, lot)],
    ["module:mining",         () => fetchMiningData(BNE.lat, BNE.lng, lot)],
    ["module:schools",        () => fetchSchoolsData(BNE.lat, BNE.lng)],
    ["module:zoning",         () => fetchZoningData(BNE.lat, BNE.lng, region)],
  ];
  results.push(
    ...(await Promise.all(moduleChecks.map(([name, run]) => check(name, run)))),
  );

  // Council adapter layers the Brisbane run doesn't exercise.
  const adapterChecks: Array<[string, string, CouncilId]> = [];
  const add = (kind: string, table: Partial<Record<CouncilId, { url: string } | { url: string }[]>>) => {
    for (const [council, entry] of Object.entries(table) as Array<
      [CouncilId, { url: string } | { url: string }[]]
    >) {
      if (council === "brisbane") continue; // covered by the module run
      for (const a of Array.isArray(entry) ? entry : [entry]) {
        adapterChecks.push([`${kind}:${council}`, a.url, council]);
      }
    }
  };
  add("zoning", ZONING_ADAPTERS);
  add("flood", FLOOD_ADAPTERS);
  add("overland", OVERLAND_ADAPTERS);
  add("noise", NOISE_ADAPTERS);
  add("steep", STEEP_ADAPTERS);

  results.push(
    ...(await Promise.all(
      adapterChecks.map(([name, url, council]) =>
        check(name, () =>
          queryArcGIS(url, {
            geometry: {
              x: COUNCIL_POINTS[council].lng,
              y: COUNCIL_POINTS[council].lat,
              spatialReference: 4326,
            },
            geometryType: "esriGeometryPoint",
            inSR: 4326,
            outFields: "*",
            returnGeometry: false,
            bufferDegrees: 0.00045,
          }),
        ),
      ),
    )),
  );

  // Infrastructure endpoints.
  await push("qld-geocoder-suggest", async () => {
    const res = await fetch(SUGGEST, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { suggestions?: unknown[] };
    if (!Array.isArray(body.suggestions) || body.suggestions.length === 0) {
      throw new Error("no suggestions returned");
    }
  });
  await push("qld-aerial-imagery", async () => {
    const res = await fetch(IMAGERY, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").includes("image")) {
      throw new Error(`unexpected content-type ${res.headers.get("content-type")}`);
    }
  });

  // Report.
  const failed = results.filter((r) => !r.ok);
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(
      `${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(width)} ${String(r.ms).padStart(6)}ms${r.error ? `  ${r.error}` : ""}`,
    );
  }
  console.log(`\n${results.length - failed.length}/${results.length} healthy`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} source(s) failing: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
