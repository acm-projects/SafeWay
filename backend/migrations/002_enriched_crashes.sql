-- Enriched crash data (Crashes + Vehicles + People merged). Pipeline upserts from analysis.py.
-- Run in Supabase SQL editor or via migration tooling.

create table if not exists public.enriched_crashes (
  crash_record_id text primary key,
  crash_date timestamptz,
  crash_hour smallint,
  latitude double precision not null,
  longitude double precision not null,
  posted_speed_limit double precision,
  traffic_control_device text,
  weather_condition text,
  lighting_condition text,
  first_crash_type text,
  prim_contributory_cause text,
  hit_and_run_i text,
  injuries_fatal integer,
  injuries_incapacitating integer,
  injuries_non_incapacitating integer,
  injuries_reported_not_evident integer,
  injuries_no_indication integer,
  has_ped boolean not null default false,
  has_bike boolean not null default false,
  is_fsi boolean not null default false,
  people_injuries jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_enriched_crashes_crash_date on public.enriched_crashes (crash_date);
create index if not exists idx_enriched_crashes_lat_lng on public.enriched_crashes (latitude, longitude);

comment on table public.enriched_crashes is 'Merged Chicago crash data (Crashes + Vehicles + People); populated by backend model pipeline.';
