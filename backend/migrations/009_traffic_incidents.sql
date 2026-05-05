-- Live traffic incidents from TomTom API.
-- Populated by backend /traffic/incidents endpoint.
-- Old incidents are cleaned up automatically after 24 hours.
create table if not exists public.traffic_incidents (
  id uuid primary key default gen_random_uuid(),
  tomtom_id text,
  category integer not null,
  incident_type text not null,
  latitude double precision not null,
  longitude double precision not null,
  description text,
  delay_seconds integer default 0,
  road_numbers text[],
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

-- Index for fast geo queries
create index if not exists idx_traffic_incidents_lat_lng
on public.traffic_incidents (latitude, longitude);

-- Index for expiry cleanup
create index if not exists idx_traffic_incidents_expires_at
on public.traffic_incidents (expires_at);

-- Index for type queries
create index if not exists idx_traffic_incidents_type
on public.traffic_incidents (incident_type);

comment on table public.traffic_incidents is 'Live traffic incidents from TomTom API; auto-expires after 2 hours.';



