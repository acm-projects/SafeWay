import { useEffect, useRef, useState } from 'react';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8000';

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function fetchIncidents(silent = false) {
    if (!lat || !lng || !enabled) return;
    if (!silent) setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const url = `${apiBaseUrl}/traffic/incidents?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IncidentsResponse = await res.json();
      setIncidents(data.incidents ?? []);
      setError(null);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setError(e?.message ?? 'Failed to fetch incidents');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled || !lat || !lng) {
      setIncidents([]);
      return;
    }
    fetchIncidents(false);
    // Refresh every 2 minutes (matches backend cache TTL)
    intervalRef.current = setInterval(() => fetchIncidents(true), 120_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [lat, lng, radiusKm, enabled]);

  return { incidents, loading, error, refetch: () => fetchIncidents(false) };
}
