import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type HeatmapFilter = 'all' | 'fatal' | 'ped' | 'bike' | 'hit';

export interface BBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CrashPoint {
  latitude: number;
  longitude: number;
  weight?: number;
}

interface Options {
  filter?: HeatmapFilter;
  bounds?: BBox | null;
  enabled?: boolean;
  limit?: number;
}

interface Result {
  points: CrashPoint[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const LIMIT = 10_000;

export function useCrashHeatmap({
  filter = 'all',
  bounds = null,
  enabled = true,
  limit = LIMIT,
}: Options = {}): Result {
  const [points, setPoints]   = useState<CrashPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  async function fetchPoints() {
    if (!enabled) { setPoints([]); return; }
    abortRef.current = false;
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('enriched_crashes')
        .select('latitude, longitude, is_fsi, has_ped, has_bike, hit_and_run_i')
        .limit(limit)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (filter === 'fatal') query = query.eq('is_fsi', true);
      else if (filter === 'ped')   query = query.eq('has_ped', true);
      else if (filter === 'bike')  query = query.eq('has_bike', true);
      else if (filter === 'hit')   query = query.eq('hit_and_run_i', true);

      if (bounds) {
        query = query
          .gte('latitude',  bounds.south)
          .lte('latitude',  bounds.north)
          .gte('longitude', bounds.west)
          .lte('longitude', bounds.east);
      }

      const { data, error: sbError } = await query;
      if (abortRef.current) return;

      if (sbError) {
        setError(sbError.message);
        return;
      }

      const mapped: CrashPoint[] = (data ?? []).map((row: any) => {
        let weight = 1;
        if (row.is_fsi)        weight = 3;
        else if (row.has_ped || row.has_bike || row.hit_and_run_i) weight = 2;
        return {
          latitude:  row.latitude  as number,
          longitude: row.longitude as number,
          weight,
        };
      });

      setPoints(mapped);
    } catch (e) {
      if (!abortRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load crash data');
      }
    } finally {
      if (!abortRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPoints();
    return () => { abortRef.current = true; };
  }, [filter, enabled,
    bounds ? Math.round(bounds.north * 100) : 0,
    bounds ? Math.round(bounds.south * 100) : 0,
  ]);

  return { points, loading, error, refresh: fetchPoints };
}