-- Intersection-level crash + crime aggregates + danger_score.
-- Populate from Python after build_intersection_safety_scores() (see build_intersection_dataset.py).
-- Run in Supabase SQL editor when you want to serve scores from the DB.

create table if not exists public.intersection_safety (
  node_id text primary key,
  latitude double precision not null,
  longitude double precision not null,
  total_crashes integer not null default 0,
  fsi_crashes integer not null default 0,
  ped_crashes integer not null default 0,
  bike_crashes integer not null default 0,
  total_crimes integer not null default 0,
  danger_score double precision not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_intersection_safety_lat_lng
  on public.intersection_safety (latitude, longitude);

comment on table public.intersection_safety is 'Per-intersection safety scores from crashes + crimes; upsert from model pipeline.';
