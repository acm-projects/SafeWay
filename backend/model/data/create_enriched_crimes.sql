-- Run this in Supabase SQL Editor to create the enriched_crimes table
CREATE TABLE IF NOT EXISTS public.enriched_crimes (
    crime_id TEXT PRIMARY KEY,
    crime_date TIMESTAMPTZ,
    primary_type TEXT,
    description TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    arrest BOOLEAN,
    domestic BOOLEAN,
    beat TEXT,
    district TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast geo queries
CREATE INDEX IF NOT EXISTS idx_enriched_crimes_lat_lon 
ON public.enriched_crimes (latitude, longitude);

-- Index for date queries
CREATE INDEX IF NOT EXISTS idx_enriched_crimes_date 
ON public.enriched_crimes (crime_date);

-- Index for crime type queries
CREATE INDEX IF NOT EXISTS idx_enriched_crimes_type 
ON public.enriched_crimes (primary_type);


