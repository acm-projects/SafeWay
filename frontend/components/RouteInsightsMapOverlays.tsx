import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Circle, Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

type RoutePoint = { latitude: number; longitude: number };

/** Backend segment risk (0–100): high / medium / low → red / amber / blue */
export function strokeColorForSegmentRisk(risk: number): string {
  if (risk > 66) return 'rgba(229, 57, 53, 0.95)'; // red
  if (risk > 33) return 'rgba(251, 192, 45, 0.95)'; // amber / yellow
  return 'rgba(66, 165, 245, 0.95)'; // normal blue
}

/** Same risk scale as backend: same base blue as active routes (#4A90E2), darker navy as risk increases. */
export function strokeColorForSegmentRiskBlue(risk: number): string {
  const t = Math.max(0, Math.min(1, risk / 100));
  const ramp = [
    [0.0, [0, 0, 0]],
    [0.25, [75, 29, 126]],
    [0.5, [141, 46, 108]],
    [0.75, [212, 87, 58]],
    [1.0, [246, 194, 62]],
  ] as const;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < ramp.length - 1; i++) {
    const [t0, c0] = ramp[i]!;
    const [t1, c1] = ramp[i + 1]!;
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      r = Math.round(c0[0] + (c1[0] - c0[0]) * u);
      g = Math.round(c0[1] + (c1[1] - c0[1]) * u);
      b = Math.round(c0[2] + (c1[2] - c0[2]) * u);
      break;
    }
  }
  return `rgba(${r},${g},${b},0.95)`;
}

export type HotspotMapItem = { coord: RoutePoint; risk?: number };

const CYAN = 'rgba(0, 229, 255,';

function chunkCoords(coords: RoutePoint[], maxChunks: number): RoutePoint[][] {
  if (coords.length < 2) return [];
  const n = Math.min(maxChunks, Math.max(8, Math.floor(coords.length / 4)));
  const step = Math.max(1, Math.floor((coords.length - 1) / n));
  const out: RoutePoint[][] = [];
  for (let start = 0; start < coords.length - 1; start += step) {
    const end = Math.min(coords.length, start + step + 1);
    out.push(coords.slice(start, end));
  }
  return out.filter(c => c.length > 1);
}

type SegRisk = { start: RoutePoint; end: RoutePoint; risk: number };

function segmentLengthMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const m =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(m)));
}

/** Soft cyan “blobs” along the path (heat-line look) — radius scales with model intensity. */
export function PeakFlowVolumeHalos({
  coords,
  segments,
  rushFactor,
}: {
  coords: RoutePoint[];
  segments: SegRisk[] | null;
  rushFactor: number;
}) {
  const blobs = useMemo(() => {
    const rf = Math.max(0.04, Math.min(1, rushFactor));
    const out: { center: RoutePoint; radius: number; fill: string; z: number }[] = [];
    const stepM = 200;
    const maxBlobs = 42;

    const pushAlong = (a: RoutePoint, b: RoutePoint, riskHint: number) => {
      const len = segmentLengthMeters(a, b);
      if (len < 8) return;
      const tRisk = Math.max(0, Math.min(1, riskHint / 100));
      let d = 0;
      while (d < len && out.length < maxBlobs) {
        const u = d / len;
        const lat = a.latitude + (b.latitude - a.latitude) * u;
        const lng = a.longitude + (b.longitude - a.longitude) * u;
        const wobble = Math.sin(d * 0.11 + tRisk * 6) * 0.15;
        const raw = Math.min(1, tRisk * 0.6 + rf * 0.4 + wobble);
        const intensity = raw * raw;
        const radius = 10 + intensity * 80;
        const fill = `rgba(0, 245, 255, ${0.015 + intensity * 0.14})`;
        out.push({ center: { latitude: lat, longitude: lng }, radius, fill, z: 0 });
        d += stepM * (0.9 + intensity * 0.3);
      }
    };

    if (segments?.length) {
      for (const s of segments) {
        pushAlong(s.start, s.end, s.risk);
      }
    } else if (coords.length > 1) {
      for (let i = 0; i < coords.length - 1; i++) {
        const pseudo = 30 + ((i * 19) % 60);
        pushAlong(coords[i]!, coords[i + 1]!, pseudo);
      }
    }
    return out;
  }, [coords, segments, rushFactor]);

  return (
    <>
      {blobs.map((b, i) => (
        <Circle
          key={`peak-halo-${i}`}
          center={b.center}
          radius={b.radius}
          fillColor={b.fill}
          strokeWidth={0}
          zIndex={0}
        />
      ))}
    </>
  );
}

/** Peak flow: electric-cyan volume layers — width and glow follow segment risk × rush intensity.
 *  Lows are very subtle (thin, nearly transparent); highs are intensely bright and wide. */
export function PeakFlowIntensityPolylines({
  coords,
  segments,
  rushFactor,
}: {
  coords: RoutePoint[];
  segments: SegRisk[] | null;
  rushFactor: number;
}) {
  const layers = useMemo(() => {
    const rf = Math.max(0.04, Math.min(1, rushFactor));
    const items: { coordinates: RoutePoint[]; w: number; c: string; z: number }[] = [];

    const pushSeg = (a: RoutePoint, b: RoutePoint, risk: number) => {
      const t = Math.max(0, Math.min(1, risk / 100));
      const raw = t * 0.65 + rf * 0.35;
      const intensity = Math.min(1, raw * raw * 1.4);
      const segCoords = [a, b];
      const ultra = 6 + intensity * 34;
      const glowWide = 3 + intensity * 22;
      const glowMid = 1.5 + intensity * 12;
      const core = 0.6 + intensity * 4.5;
      const aUltra = 0.01 + intensity * 0.09;
      const aGlow = 0.02 + intensity * 0.2;
      const aMid = 0.04 + intensity * 0.3;
      items.push({ coordinates: segCoords, w: ultra + 14, c: `rgba(0, 180, 255, ${aUltra})`, z: 1 });
      items.push({ coordinates: segCoords, w: ultra, c: `rgba(0, 220, 255, ${aGlow})`, z: 2 });
      items.push({ coordinates: segCoords, w: glowWide, c: `rgba(0, 245, 255, ${aMid})`, z: 3 });
      items.push({ coordinates: segCoords, w: glowMid, c: `rgba(120, 255, 255, ${0.1 + intensity * 0.45})`, z: 4 });
      items.push({
        coordinates: segCoords,
        w: core,
        c: intensity > 0.55 ? `rgba(255, 255, 255, ${0.85 + intensity * 0.15})` : `rgba(0, 236, 255, ${0.4 + intensity * 0.55})`,
        z: 5,
      });
    };

    if (segments?.length) {
      for (const s of segments) {
        pushSeg(s.start, s.end, s.risk);
      }
      return items;
    }

    const chunks = chunkCoords(coords, 22);
    chunks.forEach((segCoords, i) => {
      const pseudoRisk = 28 + ((i * 17) % 55);
      const t = pseudoRisk / 100;
      const raw = t * 0.6 + rf * 0.4;
      const intensity = Math.min(1, raw * raw * 1.4);
      const ultra = 5 + intensity * 32;
      const glowWide = 2.5 + intensity * 20;
      const glowMid = 1.2 + intensity * 10;
      const core = 0.5 + intensity * 4;
      const aUltra = 0.01 + intensity * 0.1;
      const aGlow = 0.025 + intensity * 0.18;
      const aMid = 0.04 + intensity * 0.28;
      items.push({ coordinates: segCoords, w: ultra + 14, c: `rgba(0, 190, 255, ${aUltra})`, z: 1 });
      items.push({ coordinates: segCoords, w: ultra, c: `rgba(0, 225, 255, ${aGlow})`, z: 2 });
      items.push({ coordinates: segCoords, w: glowWide, c: `rgba(0, 240, 255, ${aMid})`, z: 3 });
      items.push({ coordinates: segCoords, w: glowMid, c: `rgba(100, 255, 255, ${0.08 + intensity * 0.4})`, z: 4 });
      items.push({ coordinates: segCoords, w: core, c: `rgba(200, 255, 255, ${0.35 + intensity * 0.6})`, z: 5 });
    });
    return items;
  }, [coords, segments, rushFactor]);

  return (
    <>
      {layers.map((L, i) => (
        <Polyline
          key={`peak-flow-${i}`}
          coordinates={L.coordinates}
          strokeColor={L.c}
          strokeWidth={L.w}
          lineCap="round"
          lineJoin="round"
          zIndex={L.z}
        />
      ))}
    </>
  );
}

/** Variable-width cyan “flow” polylines (AADT proxy: width cycles by segment). */
export function AadtFlowPolylines({ coords }: { coords: RoutePoint[] }) {
  const chunks = useMemo(() => chunkCoords(coords, 22), [coords]);
  return (
    <>
      {chunks.map((seg, i) => {
        const w = 3.5 + (i % 7) * 1.15;
        const a = 0.28 + (i % 5) * 0.07;
        return (
          <Polyline
            key={`aadt-bg-${i}`}
            coordinates={seg}
            strokeColor={`${CYAN}${a})`}
            strokeWidth={w + 5}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
      {chunks.map((seg, i) => (
        <Polyline
          key={`aadt-fg-${i}`}
          coordinates={seg}
          strokeColor={i % 3 === 0 ? 'rgba(200, 255, 255, 0.95)' : 'rgba(0, 212, 255, 0.88)'}
          strokeWidth={2.2 + (i % 5) * 0.35}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </>
  );
}

function FlowDot({ delayMs, rushFactor }: { delayMs: number; rushFactor: number }) {
  const op = useRef(new RNAnimated.Value(0.35)).current;
  useEffect(() => {
    const slow = 900 + (1 - rushFactor) * 700;
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.delay(delayMs),
        RNAnimated.timing(op, { toValue: 1, duration: slow, useNativeDriver: true }),
        RNAnimated.timing(op, { toValue: 0.3, duration: slow, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [delayMs, op, rushFactor]);
  return (
    <RNAnimated.View
      style={[
        styles.flowDot,
        {
          opacity: op,
          backgroundColor: rushFactor > 0.72 ? '#FFD54A' : '#FFFFFF',
        },
      ]}
    />
  );
}

/** Soft kinetic dots along the route (peak flow). */
export function PeakFlowMarkers({
  coords,
  rushFactor,
}: {
  coords: RoutePoint[];
  rushFactor: number;
}) {
  const pts = useMemo(() => {
    if (coords.length < 2) return [];
    const n = 7;
    const out: RoutePoint[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const pos = t * (coords.length - 1);
      const idx = Math.floor(pos);
      const f = pos - idx;
      const a = coords[idx]!;
      const b = coords[Math.min(idx + 1, coords.length - 1)]!;
      out.push({
        latitude: a.latitude + (b.latitude - a.latitude) * f,
        longitude: a.longitude + (b.longitude - a.longitude) * f,
      });
    }
    return out;
  }, [coords]);

  return (
    <>
      {pts.map((c, i) => (
        <Marker key={`pf-${i}`} coordinate={c} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <FlowDot delayMs={i * 140} rushFactor={rushFactor} />
        </Marker>
      ))}
    </>
  );
}

type FactorRow = { label: string; count?: number; pct?: number };

export function ShapLogicMarkers({
  coords,
  factors,
}: {
  coords: RoutePoint[];
  factors: FactorRow[] | undefined;
}) {
  const items = useMemo(() => {
    if (!coords.length || !factors?.length) return [];
    const rows = factors.slice(0, 6);
    return rows.map((row, i) => {
      const idx = Math.min(
        coords.length - 1,
        Math.max(0, Math.floor(((i + 1) / (rows.length + 1)) * (coords.length - 1))),
      );
      const low = /light|wide|calm|low|clear|safe/i.test(row.label);
      return { ...row, coord: coords[idx]!, low, shape: i % 2 === 0 ? 'triangle' : 'square' as const };
    });
  }, [coords, factors]);

  return (
    <>
      {items.map((it, i) => (
        <Marker key={`shap-${i}`} coordinate={it.coord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View
            style={[
              styles.shapBadge,
              { borderColor: it.low ? 'rgba(80, 200, 255, 0.9)' : 'rgba(255, 100, 100, 0.95)', backgroundColor: it.low ? 'rgba(26, 188, 147, 0.2)' : 'rgba(255, 80, 80, 0.18)' },
            ]}
          >
            {it.shape === 'triangle' ? (
              <Ionicons name="caret-up" size={14} color={it.low ? '#7FE8FF' : '#FF8A80'} />
            ) : (
              <Ionicons name="stop-outline" size={12} color={it.low ? '#7FE8FF' : '#FF8A80'} />
            )}
          </View>
        </Marker>
      ))}
    </>
  );
}

function PulseRing() {
  const scale = useRef(new RNAnimated.Value(1)).current;
  const opacity = useRef(new RNAnimated.Value(0.5)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.parallel([
        RNAnimated.sequence([
          RNAnimated.timing(scale, { toValue: 1.28, duration: 1200, useNativeDriver: true }),
          RNAnimated.timing(scale, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ]),
        RNAnimated.sequence([
          RNAnimated.timing(opacity, { toValue: 0.12, duration: 1200, useNativeDriver: true }),
          RNAnimated.timing(opacity, { toValue: 0.5, duration: 1200, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, scale]);

  return (
    <View style={styles.pulseRingAnimWrap} pointerEvents="none">
      <RNAnimated.View
        style={[
          styles.pulseRingInner,
          {
            opacity,
            transform: [{ scale }],
          },
        ]}
      />
    </View>
  );
}

function hotspotIntensityStyle(risk: number | undefined): {
  ring: string;
  ringBorder: string;
  grad: [string, string];
  glyph: string;
} {
  const r = risk == null ? 58 : Math.max(0, Math.min(100, risk));
  if (r >= 78) {
    return {
      ring: 'rgba(255, 59, 48, 0.42)',
      ringBorder: 'rgba(255, 138, 128, 0.95)',
      grad: ['#FF6E40', '#C62828'],
      glyph: '🔥',
    };
  }
  if (r >= 58) {
    return {
      ring: 'rgba(255, 171, 64, 0.38)',
      ringBorder: 'rgba(255, 213, 79, 0.92)',
      grad: ['#FFB74D', '#E65100'],
      glyph: '⚠️',
    };
  }
  if (r >= 38) {
    return {
      ring: 'rgba(255, 213, 79, 0.34)',
      ringBorder: 'rgba(255, 241, 118, 0.88)',
      grad: ['#FFD54F', '#F57F17'],
      glyph: '⚡',
    };
  }
  return {
    ring: 'rgba(79, 195, 247, 0.32)',
    ringBorder: 'rgba(129, 212, 250, 0.9)',
    grad: ['#4FC3F7', '#1565C0'],
    glyph: '◎',
  };
}

export function HotspotPulseMarkers({
  items,
  onPressSpot,
}: {
  items: HotspotMapItem[];
  onPressSpot: (index: number) => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        const coord = item.coord;
        const pal = hotspotIntensityStyle(item.risk);
        return (
          <Marker
            key={`hs-pulse-${i}`}
            coordinate={coord}
            anchor={{ x: 0.5, y: 0.56 }}
            tracksViewChanges={false}
            onPress={() => onPressSpot(i)}
          >
            <Pressable onPress={() => onPressSpot(i)} hitSlop={12} style={styles.hotspotPress}>
              <View style={styles.hotspotMarkerStack}>
                <View style={styles.hotspotPulseBehind}>
                  <View style={[styles.pulseRingLg, { backgroundColor: pal.ring, borderColor: pal.ringBorder }]}>
                    <PulseRing />
                  </View>
                </View>
                <LinearGradient
                  colors={pal.grad}
                  start={{ x: 0.15, y: 0 }}
                  end={{ x: 0.85, y: 1 }}
                  style={styles.hotspotGradientCore}
                >
                  <Text style={styles.hotspotGlyph}>{pal.glyph}</Text>
                  <View style={styles.hotspotIndexBadge}>
                    <Text style={styles.hotspotIndexText}>{i + 1}</Text>
                  </View>
                </LinearGradient>
              </View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

export type HotspotDetailPanelProps = {
  onClose: () => void;
  index: number;
  reasonTitle: string;
  reasonBody: string;
  accentColor: string;
  riskScore?: number;
  /** When true, card gets stronger shadow (docked above home indicator). */
  docked?: boolean;
};

/** Hot spot copy + chrome (no Modal) — parent supplies backdrop / position. */
export function HotspotDetailPanel({
  onClose,
  index,
  reasonTitle,
  reasonBody,
  accentColor,
  riskScore,
  docked,
}: HotspotDetailPanelProps) {
  return (
    <Pressable
      style={[styles.glassCard, docked && styles.glassCardDocked]}
      onPress={() => {}}
    >
      <View style={styles.modalHeader}>
        <View style={[styles.modalBadge, { borderColor: accentColor }]}>
          <Ionicons name="warning" size={16} color={accentColor} />
          <Text style={[styles.modalBadgeText, { color: accentColor }]}>Hot spot {index + 1}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>
      {riskScore != null ? (
        <Text style={styles.modalRiskHint}>
          Model risk at this segment: <Text style={{ fontWeight: '800', color: accentColor }}>{Math.round(riskScore)}</Text>
          /100
        </Text>
      ) : null}
      <Text style={styles.modalTitle}>{reasonTitle}</Text>
      <View style={styles.iconRow}>
        <Ionicons name="car-outline" size={18} color={accentColor} />
        <Ionicons name="flash" size={16} color="#FFB74D" style={{ marginLeft: 8 }} />
      </View>
      <Text style={styles.modalBody}>{reasonBody}</Text>
    </Pressable>
  );
}

export function HotspotGlassModal({
  visible,
  onClose,
  index,
  reasonTitle,
  reasonBody,
  accentColor,
  riskScore,
  bottomReserve,
}: HotspotDetailPanelProps & {
  visible: boolean;
  bottomReserve?: number;
}) {
  const reserve = typeof bottomReserve === 'number' ? bottomReserve : 280;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.modalBackdrop, { justifyContent: 'flex-end', paddingBottom: reserve }]} onPress={onClose}>
        <HotspotDetailPanel
          onClose={onClose}
          index={index}
          reasonTitle={reasonTitle}
          reasonBody={reasonBody}
          accentColor={accentColor}
          riskScore={riskScore}
        />
      </Pressable>
    </Modal>
  );
}

type SegRiskForHotspot = { start: RoutePoint; end: RoutePoint; risk: number };

/** Route-conforming hotspot sections: glowing polyline segments drawn along the actual route
 *  where risk is highest. Similar aesthetic to peak flow but in warm red/orange tones and
 *  rendered as separated sections rather than continuous. */
export function HotspotRouteSegments({
  coords,
  segments,
  hotspotItems,
}: {
  coords: RoutePoint[];
  segments: SegRiskForHotspot[] | null;
  hotspotItems: HotspotMapItem[];
}) {
  const layers = useMemo(() => {
    const items: { coordinates: RoutePoint[]; w: number; c: string; z: number }[] = [];
    if (!coords.length || !hotspotItems.length) return items;

    const RADIUS = 0.004;

    const isNearHotspot = (lat: number, lng: number): { near: boolean; intensity: number } => {
      let minDist = Infinity;
      for (const h of hotspotItems) {
        const d = Math.abs(lat - h.coord.latitude) + Math.abs(lng - h.coord.longitude);
        if (d < minDist) minDist = d;
      }
      if (minDist > RADIUS) return { near: false, intensity: 0 };
      const t = 1 - minDist / RADIUS;
      return { near: true, intensity: t * t };
    };

    if (segments?.length) {
      for (const seg of segments) {
        const midLat = (seg.start.latitude + seg.end.latitude) / 2;
        const midLng = (seg.start.longitude + seg.end.longitude) / 2;
        const { near, intensity } = isNearHotspot(midLat, midLng);
        if (!near) continue;
        const riskT = Math.max(0, Math.min(1, seg.risk / 100));
        const combined = Math.min(1, intensity * 0.6 + riskT * 0.4);
        const segCoords = [seg.start, seg.end];
        const outerW = 12 + combined * 24;
        const midW = 7 + combined * 15;
        const coreW = 2.5 + combined * 5.5;
        items.push({ coordinates: segCoords, w: outerW + 10, c: `rgba(255, 87, 34, ${0.03 + combined * 0.1})`, z: 1 });
        items.push({ coordinates: segCoords, w: outerW, c: `rgba(255, 152, 0, ${0.06 + combined * 0.15})`, z: 2 });
        items.push({ coordinates: segCoords, w: midW, c: `rgba(255, 183, 77, ${0.12 + combined * 0.25})`, z: 3 });
        items.push({ coordinates: segCoords, w: coreW, c: combined > 0.5 ? `rgba(255, 235, 200, ${0.8 + combined * 0.2})` : `rgba(255, 167, 38, ${0.5 + combined * 0.4})`, z: 4 });
      }
    } else if (coords.length > 1) {
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i]!;
        const b = coords[Math.min(i + 1, coords.length - 1)]!;
        const midLat = (a.latitude + b.latitude) / 2;
        const midLng = (a.longitude + b.longitude) / 2;
        const { near, intensity } = isNearHotspot(midLat, midLng);
        if (!near) continue;
        const combined = intensity;
        const segCoords = [a, b];
        const outerW = 12 + combined * 22;
        const midW = 7 + combined * 12;
        const coreW = 2.5 + combined * 4.5;
        items.push({ coordinates: segCoords, w: outerW + 10, c: `rgba(255, 87, 34, ${0.03 + combined * 0.1})`, z: 1 });
        items.push({ coordinates: segCoords, w: outerW, c: `rgba(255, 152, 0, ${0.06 + combined * 0.15})`, z: 2 });
        items.push({ coordinates: segCoords, w: midW, c: `rgba(255, 183, 77, ${0.12 + combined * 0.25})`, z: 3 });
        items.push({ coordinates: segCoords, w: coreW, c: combined > 0.5 ? `rgba(255, 235, 200, ${0.8 + combined * 0.2})` : `rgba(255, 167, 38, ${0.5 + combined * 0.4})`, z: 4 });
      }
    }
    return items;
  }, [coords, segments, hotspotItems]);

  return (
    <>
      {layers.map((L, i) => (
        <Polyline
          key={`hs-route-${i}`}
          coordinates={L.coordinates}
          strokeColor={L.c}
          strokeWidth={L.w}
          lineCap="round"
          lineJoin="round"
          zIndex={L.z}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  shapBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingAnimWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.38)',
  },
  hotspotPress: { alignItems: 'center', justifyContent: 'center' },
  hotspotMarkerStack: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotPulseBehind: {
    position: 'absolute',
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRingLg: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotGradientCore: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00E5FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 6,
  },
  hotspotGlyph: { fontSize: 18, marginTop: -1 },
  hotspotIndexBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotIndexText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  glassCard: {
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    /* Previous: 'rgba(18, 22, 48, 0.92)' */
    backgroundColor: 'rgba(17, 17, 17, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  glassCardDocked: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 24,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modalBadgeText: { fontSize: 12, fontWeight: '800' },
  modalRiskHint: { color: 'rgba(255,255,255,0.62)', fontSize: 12, marginBottom: 6 },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  iconRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  modalBody: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20 },
});
