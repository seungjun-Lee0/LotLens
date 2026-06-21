-- PropAI prototype schema (Vercel Postgres / Neon).
--
-- Run this in the Vercel Storage → Postgres → "Query" tab once after
-- provisioning, or paste into Neon's SQL Editor for a standalone Neon
-- project. The schema is plain Postgres — no PostGIS extension required
-- (all spatial work happens server-side via ArcGIS, we only store the
-- results as jsonb).

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

create table if not exists addresses (
  id                  uuid primary key default gen_random_uuid(),
  address_text        text not null,
  lat                 double precision not null,
  lng                 double precision not null,
  lot_plan            text,
  paid_at             timestamptz,
  stripe_session_id   text,
  created_at          timestamptz not null default now()
);

-- For projects upgrading from the v1 schema (no payment columns):
alter table addresses add column if not exists paid_at timestamptz;
alter table addresses add column if not exists stripe_session_id text;

create table if not exists council_data (
  id                uuid primary key default gen_random_uuid(),
  address_id        uuid not null references addresses(id) on delete cascade,
  module            text not null, -- 'flooding' | 'bushfire' | 'heritage' | 'easements' | 'zoning'
  source_url        text not null,
  source_name       text not null,
  raw_response      jsonb not null,
  risk_level        text,          -- 'high' | 'medium' | 'low' | 'very_low' | 'none'
  has_consideration boolean not null default false,
  retrieved_at      timestamptz not null default now()
);

create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  address_id   uuid not null references addresses(id) on delete cascade,
  narrative    jsonb not null,
  generated_at timestamptz not null default now()
);

create index if not exists council_data_address_id_idx on council_data(address_id);
create index if not exists council_data_module_idx     on council_data(module);
create index if not exists reports_address_id_idx      on reports(address_id);
