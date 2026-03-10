-- Extend intersection_safety for driver-first composite danger_score and crime-as-context.
-- Run after 004_intersection_safety.sql if the table already exists without these columns.

alter table public.intersection_safety
  add column if not exists context_crime_score double precision not null default 0;

alter table public.intersection_safety
  add column if not exists frequency_component double precision not null default 0;

alter table public.intersection_safety
  add column if not exists severity_component double precision not null default 0;

alter table public.intersection_safety
  add column if not exists driver_risk_component double precision not null default 0;

alter table public.intersection_safety
  add column if not exists vulnerable_component double precision not null default 0;

comment on column public.intersection_safety.danger_score is
  'Driver-first composite: 0.35*frequency + 0.40*severity + 0.20*driver_risk + 0.05*vulnerable; crimes excluded.';

comment on column public.intersection_safety.context_crime_score is
  'Normalized log-crime count for optional UI blend; not included in danger_score.';
