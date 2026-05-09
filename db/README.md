# Database (Supabase + PostGIS)

Provision a Supabase project in `ap-southeast-2` (Sydney).

1. Open the Supabase SQL Editor.
2. Run `schema.sql`. PostGIS is created on first run.
3. Run `seed.sql` (placeholder rows — update lat/lng once Kiyong provides
   the two reference addresses).
4. Copy the project URL, anon key, and service-role key into
   `.env.local` (see `.env.local.example`).

No RLS for prototype. Lock down at MVP.
