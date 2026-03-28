import React, { useMemo, useState, useEffect } from 'react';
import { Polygon } from 'react-native-maps';
 
interface LatLng {
  latitude: number;
  longitude: number;
  weight?: number;
}
 
interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}
 
interface Props {
  points: LatLng[];
  region: Region;
  cols?: number;
  opacity?: number;
  filter?: string;
}
 
const COLOR_STOPS: [number, [number, number, number]][] = [
  [0.0,  [9,   32,  120]],
  [0.25, [0,   150, 210]],
  [0.5,  [0,   210, 180]],
  [0.7,  [247, 220,   8]],
  [0.85, [244,  96,  54]],
  [1.0,  [255,   0,  60]],
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
 
function colorWithAlpha(t: number, alpha: number): string {
  const [r, g, b] = lerpColor(t);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}
 
interface HexData {
  hexId: string;
  count: number;
  corners: { latitude: number; longitude: number }[];
}
 
export default function HexHeatmap({
  points,
  region,
  cols = 12,
  opacity = 0.75,
  filter = 'all',
}: Props) {
  const [hexData, setHexData] = useState<HexData[]>([]);
 
  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    console.log('Fetching from:', apiUrl, 'filter:', filter);
    fetch(`${apiUrl}/crashes/hex?filter=${filter}`)
      .then(res => res.json())
      .then(data => {
        console.log('Hex count received:', data.hexes?.length);
        setHexData(data.hexes ?? []);
      })
      .catch(err => console.error('Failed to fetch hex data:', err));
  }, [filter]);
 
  const hexes = useMemo(() => {
    if (!hexData.length) return [];
 
    const maxCount = Math.max(...hexData.map(h => h.count));
    const logMax = Math.log1p(maxCount);
 
    return hexData
      .map(h => {
        const norm = Math.log1p(h.count) / logMax;
        const fillColor = colorWithAlpha(norm, opacity);
        const strokeColor = '#00000022';
        return { key: h.hexId, corners: h.corners, fillColor, strokeColor, norm };
      })
      .sort((a, b) => a.norm - b.norm);
  }, [hexData, opacity]);
 
  if (!hexes.length) return null;
 
  return (
    <>
      {hexes.map(hex => (
        <Polygon
          key={hex.key}
          coordinates={hex.corners}
          fillColor={hex.fillColor}
          strokeColor={hex.strokeColor}
          strokeWidth={0.5}
        />
      ))}
    </>
  );
}