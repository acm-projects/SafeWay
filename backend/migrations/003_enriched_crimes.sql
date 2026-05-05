-- Enriched crime data from Chicago Open Data (Crimes 2001 to Present).
-- Pipeline upserts from backend/model/data/supabase_crimes.py.
-- Run in Supabase SQL editor or via migration tooling.
create table if not exists public.enriched_crimes (
  crime_id text primary key,
  crime_date timestamptz,
  primary_type text,
  description text,
  latitude double precision not null,
  longitude double precision not null,
  arrest boolean not null default false,
  domestic boolean not null default false,
  beat text,
  district text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_enriched_crimes_crime_date 
on public.enriched_crimes (crime_date);

create index if not exists idx_enriched_crimes_lat_lng 
on public.enriched_crimes (latitude, longitude);

create index if not exists idx_enriched_crimes_primary_type 
on public.enriched_crimes (primary_type);

comment on table public.enriched_crimes is 'Chicago violent and property crime data; populated by backend model pipeline.';

