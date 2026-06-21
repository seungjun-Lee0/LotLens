# Database (Vercel Postgres / Neon)

Plain Postgres. Three small tables, jsonb-heavy, no PostGIS — all
spatial work lives in the ArcGIS modules, we only store results.

1. **Vercel route** (recommended): in the project's **Storage** tab
   click **Create Database → Postgres**. Vercel auto-injects
   `DATABASE_URL` into every deployment.
2. **Neon standalone**: sign up at neon.tech, create a project, copy
   the connection string into `.env.local` as `DATABASE_URL`.

Then open the Postgres "Query" tab (Vercel) or Neon's SQL Editor and
paste [`schema.sql`](./schema.sql) once. That creates `addresses`,
`council_data`, `reports` plus their indexes.

[`seed.sql`](./seed.sql) has placeholder rows you can skip — every
demo run inserts its own address.

## Regenerating types

Row types are hand-rolled in [`/lib/db.ts`](../lib/db.ts) and kept in
sync with `schema.sql` by eye. When the schema changes, edit both. The
prototype is small enough that codegen (kysely-codegen, drizzle-kit)
isn't worth the wiring.
