# Database (Supabase + PostGIS)

Provision a Supabase project in `ap-southeast-2` (Sydney).

1. Open the Supabase SQL Editor.
2. Run [`schema.sql`](./schema.sql). PostGIS is created on first run.
3. Run [`seed.sql`](./seed.sql) (placeholder rows — update lat/lng once
   Kiyong provides the two reference addresses).
4. Copy the project URL, anon key, and service-role key into `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

   Anon and URL are `NEXT_PUBLIC_*` so the browser bundle can read them.
   Service role is **server-only** — never reference it from client code.
   See [`.env.local.example`](../.env.local.example).

No RLS for prototype. Lock down at MVP.

## Regenerating types

When the schema changes, either:

- Edit `Database` in [`/lib/supabase.ts`](../lib/supabase.ts) by hand, or
- After provisioning, run `supabase gen types typescript --project-id <id>`
  and replace the hand-rolled `Database` block.
