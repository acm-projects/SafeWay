import { useEffect, useState } from 'react';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8000';

export interface RoadSegment {
  coordinates: { latitude: number; longitude: number }[];
  intensity: number;
}

interface Options {
  filter?: string;
  enabled?: boolean;
}

export function useRoadHeatmap({ filter = 'all', enabled = true }: Options = {}): RoadSegment[] {
  const [segments, setSegments] = useState<RoadSegment[]>([]);

  useEffect(() => {
    if (!enabled) { setSegments([]); return; }

    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/crashes/road-segments?filter=${filter}&limit=500`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled) setSegments(data.segments ?? []);
      } catch (e) {
        console.warn('[useRoadHeatmap] fetch failed:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [filter, enabled]);

  return segments;
}