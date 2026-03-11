import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export type HeatmapFilter = 'all' | 'fatal' | 'ped' | 'bike' | 'hit';

export type HeatmapPoint = {
  latitude: number;
  longitude: number;
  weight: number;
};

interface UseCrashHeatmapOptions {
  filter: HeatmapFilter;
  enabled?: boolean;
  limit?: number;
}

// Supabase/PostgREST caps responses at 1000 rows per request; paginate with this size
const PAGE = 1000;

export function useCrashHeatmap({
  filter,
  enabled = true,
  limit = 200_000,
}: UseCrashHeatmapOptions): { points: HeatmapPoint[]; loading: boolean } {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setPoints([]);
      return;
    }

    const token = ++cancelRef.current;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const all: HeatmapPoint[] = [];
      let from = 0;

      while (all.length < limit) {
        let q = supabase
          .from('enriched_crashes')
          .select('latitude,longitude')
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);

        if (filter === 'fatal') {
          // Fatal/serious: is_fsi or injuries indicate fatal/incapacitating
          q = q.or('is_fsi.eq.true,injuries_fatal.gt.0,injuries_incapacitating.gt.0');
        } else if (filter === 'ped') q = q.eq('has_ped', true);
        else if (filter === 'bike') q = q.eq('has_bike', true);
        else if (filter === 'hit') q = q.eq('hit_and_run_i', 'Y');

        q = q.order('crash_record_id');

        const to = Math.min(from + PAGE - 1, limit - 1);
        const { data, error } = await q.range(from, to);

        if (cancelled || token !== cancelRef.current) return;
        if (error || !data || data.length === 0) break;

        for (const row of data) {
          all.push({
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            weight: 1,
          });
        }

        from += PAGE;
        if (data.length < PAGE) break;
      }

      if (!cancelled && token === cancelRef.current) {
        setPoints(all);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [filter, enabled, limit]);

  return { points, loading };
}
