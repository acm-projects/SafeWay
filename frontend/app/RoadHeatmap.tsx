import React, { useMemo } from 'react';
import { Polyline } from 'react-native-maps';
import { useRoadHeatmap } from '@/lib/useRoadHeatmap';

interface Props {
  filter?: string;
  opacity?: number;
}

const COLOR_STOPS: [number, [number, number, number]][] = [
  [0.0,  [0, 20,  60]],    // dark navy      → very low
  [0.25, [0, 50,  140]],   // dark blue      → low
  [0.5,  [0, 100, 220]],   // medium blue    → medium
  [0.75, [0, 170, 255]],   // bright blue    → high
  [1.0,  [0, 230, 255]],   // neon cyan-blue → max
];

function lerpColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [t0, c0] = COLOR_STOPS[i - 1];
    const [t1, c1] = COLOR_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

function toHex(n: number) { return n.toString(16).padStart(2, '0'); }

function segmentColor(intensity: number, alpha: number): string {
  const boosted = Math.pow(intensity, 0.4);
  const [r, g, b] = lerpColor(boosted);
  const effectiveAlpha = intensity < 0.01 ? 0.08 : alpha;
  const a = Math.round(Math.max(0, Math.min(1, effectiveAlpha)) * 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}

export default function RoadHeatmap({ filter = 'all', opacity = 0.85 }: Props) {
  const segments = useRoadHeatmap({ filter, enabled: true });

  const rendered = useMemo(() =>
    segments
      .filter(seg => seg.intensity > 0.1)
      .slice(0, 2000)
      .map((seg, i) => ({
        key: `road-${i}`,
        coordinates: seg.coordinates,
        color: segmentColor(seg.intensity, opacity),
        width: 1.5 + seg.intensity * 3,
      })),
    [segments, opacity]
  );

console.log('[RoadHeatmap] rendering', rendered.length, 'segments, sample:', rendered[0]);
if (!rendered.length) return null;
  return (
    <>
      {rendered.map(seg => (
        <Polyline
          key={seg.key}
          coordinates={seg.coordinates}
          strokeColor={seg.color}
          strokeWidth={seg.width}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </>
  );
}
