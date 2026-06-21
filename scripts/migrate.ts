// npx tsx scripts/migrate.ts
//
// Runs db/schema.sql against DATABASE_URL one statement at a time.
//
// Why one at a time: Neon's HTTP driver (and Vercel Postgres' Query tab)
// reject multi-statement strings — `cannot insert multiple commands into
// a prepared statement`. We split on `;` at statement-end and execute
// sequentially. Each statement is wrapped in `IF NOT EXISTS` so re-runs
// are safe.

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getDb } from "../lib/db";

function splitStatements(sql: string): string[] {
  // Strip line comments, then split on `;` at end of line. Trim empties.
  const noComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error(
      "DATABASE_URL not set. Run `vercel env pull .env.local` first.",
    );
  }
  const path = join(process.cwd(), "db", "schema.sql");
  const raw = readFileSync(path, "utf-8");
  const stmts = splitStatements(raw);
  console.log(`running ${stmts.length} statements from db/schema.sql...`);

  const sql = getDb();
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    const preview = s.slice(0, 60).replace(/\s+/g, " ");
    process.stdout.write(`  [${i + 1}/${stmts.length}] ${preview}… `);
    try {
      // Use the raw string-form query (not the tagged-template) since each
      // statement is a fully-formed DDL with no user input.
      await sql.query(s);
      console.log("ok");
    } catch (err) {
      console.log("FAIL");
      console.error("   ", (err as Error).message);
      process.exit(1);
    }
  }
  console.log("\nschema applied. ready for `npx tsx scripts/test-db.ts`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
