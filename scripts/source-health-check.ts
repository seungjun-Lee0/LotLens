// Source health check CLI.
//
//   npx tsx scripts/source-health-check.ts   (npm run health)
//
// Same probes the daily cron route runs (app/api/cron/source-health);
// exit code 1 when anything fails so it drops into CI as well.

import { formatHealthReport, runSourceHealthCheck } from "../lib/source-health";

async function main() {
  const results = await runSourceHealthCheck();
  console.log(formatHealthReport(results));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
