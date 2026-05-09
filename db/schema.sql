-- PropAI prototype schema. Run in Supabase SQL Editor.
-- Enable PostGIS first if not already on. See db/README.md.

create extension if not exists postgis;

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  address_text text not null,
  lat double precision not null,
  lng double precision not null,
  lot_plan text,
  geom geometry(Point, 4326) generated always as
    (st_setsrid(st_makepoint(lng, lat), 4326)) stored,
  created_at timestamptz default now()
);

create table if not exists council_data (
  id uuid primary key default gen_random_uuid(),
  address_id uuid references addresses(id) on delete cascade,
  module text not null, -- 'flooding' | 'bushfire' | 'heritage' | 'easements' | 'zoning'
  source_url text not null,
  source_name text not null,
  raw_response jsonb not null,
  risk_level text, -- 'high' | 'medium' | 'low' | 'very_low' | 'none'
  has_consideration boolean not null default false,
  retrieved_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  address_id uuid references addresses(id),
  narrative jsonb not null,
  generated_at timestamptz default now()
);

create index if not exists council_data_address_id_idx on council_data(address_id);
create index if not exists council_data_module_idx on council_data(module);
create index if not exists addresses_geom_idx on addresses using gist(geom);
