-- Add driver-risk / context columns so analysis.py re-pushes match crashes.py fetch list.
-- Run in Supabase SQL editor after 002.

alter table public.enriched_crashes
  add column if not exists device_condition text,
  add column if not exists crash_type text,
  add column if not exists trafficway_type text,
  add column if not exists lane_cnt text,
  add column if not exists alignment text,
  add column if not exists roadway_surface_cond text,
  add column if not exists road_defect text,
  add column if not exists intersection_related_i text,
  add column if not exists work_zone_i text,
  add column if not exists num_units integer,
  add column if not exists crash_day_of_week smallint;
