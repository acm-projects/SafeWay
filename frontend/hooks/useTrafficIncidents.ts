import { useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/api';

export type TrafficIncident = {
  id: string;
  category: number;
  type: string;
  latitude: number;
  longitude: number;
  description: string;
  delay_seconds: number;
  road: string[];
};

type IncidentsResponse = {
  incidents: TrafficIncident[];
  total: number;
  cached: boolean;
};

export function useTrafficIncidents(params: {
  lat: number | null;
  lng: number | null;
  radiusKm?: number;
  enabled?: boolean;
}) {
  const { lat, lng, radiusKm = 5, enabled = true } = params;
  const [incidents, setIncidents] = useState<TrafficIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent re-fetching once we have a successful result
  const hasFetchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  async function fetchIncidents() {
    if (!lat || !lng || !enabled) return;

    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const url = `${apiBaseUrl}/traffic/incidents?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IncidentsResponse = await res.json();
      const raw = data.incidents ?? [];
      setIncidents(
        raw.map(inc => ({
          ...inc,
          category:
            typeof inc.category === 'number' && Number.isFinite(inc.category)
              ? inc.category
              : (() => {
                  const n = parseInt(String(inc.category ?? ''), 10);
                  return Number.isFinite(n) ? n : 0;
                })(),
        })),
      );
      setError(null);
      hasFetchedRef.current = true;
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message ?? 'Failed to fetch incidents');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled || !lat || !lng) {
      setIncidents([]);
      hasFetchedRef.current = false;
      return;
    }

    // Only fetch if we haven't successfully loaded incidents yet
    if (!hasFetchedRef.current) {
      fetchIncidents();
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [lat, lng, radiusKm, enabled]);

  return { incidents, loading, error, refetch: () => fetchIncidents() };
}