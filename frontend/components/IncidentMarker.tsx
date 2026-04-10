import React, { useEffect, useRef, useState } from 'react';
import { Marker } from 'react-native-maps';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Polygon, Circle, Rect, Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { TrafficIncident } from '@/hooks/useTrafficIncidents';

// ─── Per-category config ──────────────────────────────────────────────────────
type IncidentShape = 'diamond' | 'circle' | 'triangle' | 'square' | 'hexagon' | 'shield';

type IncidentStyle = {
  color: string;
  darkBg: string;
  symbol: string;
  label: string;
  detail: string;
  pulse: boolean;
  shape: IncidentShape;
};

const S: Record<number, IncidentStyle> = {
  0:  { color: '#64748B', darkBg: '#0F1623', symbol: '?',  label: 'Unknown',             pulse: false, shape: 'square',   detail: 'An unclassified incident has been reported in this area.' },
  1:  { color: '#FF4D6A', darkBg: '#2A0A10', symbol: '✕',  label: 'Accident',             pulse: true,  shape: 'diamond',  detail: 'A traffic collision has been reported. Expect delays and emergency vehicles.' },
  2:  { color: '#A8C4D4', darkBg: '#101B22', symbol: '◌',  label: 'Fog',                  pulse: false, shape: 'circle',   detail: 'Dense fog is reducing visibility. Slow down and use headlights.' },
  3:  { color: '#FFB830', darkBg: '#221800', symbol: '!',  label: 'Hazard',               pulse: true,  shape: 'triangle', detail: 'Dangerous road conditions have been reported. Proceed with caution.' },
  4:  { color: '#4DA6FF', darkBg: '#08162A', symbol: '≈',  label: 'Rain',                 pulse: false, shape: 'circle',   detail: 'Heavy rain is affecting road conditions. Reduce speed and increase following distance.' },
  5:  { color: '#B8E4F9', darkBg: '#081520', symbol: '*',  label: 'Ice',                  pulse: true,  shape: 'hexagon',  detail: 'Icy road surface detected. Brake early and avoid sudden maneuvers.' },
  6:  { color: '#FF7A30', darkBg: '#221008', symbol: '▲',  label: 'Traffic Jam',          pulse: true,  shape: 'triangle', detail: 'Heavy congestion ahead. Significant delays expected — consider an alternate route.' },
  7:  { color: '#FFCC44', darkBg: '#221900', symbol: '║',  label: 'Lane Closed',          pulse: false, shape: 'square',   detail: 'One or more lanes are closed. Merge early and watch for workers.' },
  8:  { color: '#FF3333', darkBg: '#2A0808', symbol: '⊘',  label: 'Road Closed',          pulse: true,  shape: 'shield',   detail: 'This road is fully closed. You must use an alternate route.' },
  9:  { color: '#9B72F7', darkBg: '#130A2A', symbol: '⚙',  label: 'Road Works',           pulse: false, shape: 'square',   detail: 'Active road works in progress. Reduced speed limits and lane changes may apply.' },
  10: { color: '#5DC8E8', darkBg: '#071A22', symbol: '≋',  label: 'Wind',                 pulse: false, shape: 'circle',   detail: 'High winds are affecting the road. Be alert for debris and maintain firm grip.' },
  11: { color: '#22AAEE', darkBg: '#061422', symbol: '~',  label: 'Flooding',             pulse: true,  shape: 'hexagon',  detail: 'Flooding has been reported. Do not attempt to drive through standing water.' },
  14: { color: '#C084FC', darkBg: '#160A2A', symbol: '□',  label: 'Broken Down Vehicle',  pulse: false, shape: 'diamond',  detail: 'A broken down vehicle is blocking part of the road. Watch for occupants on the shoulder.' },
};

function getStyle(cat: number): IncidentStyle {
  return S[cat] ?? S[0];
}

// ─── Sizing ───────────────────────────────────────────────────────────────────
const MAX_DELTA = 0.08;
const MIN_DELTA = 0.005;
const SIZE_MAX  = 38;
const SIZE_MIN  = 14;

function markerSize(latDelta: number): number {
  if (latDelta >= MAX_DELTA) return 0;
  if (latDelta <= MIN_DELTA) return SIZE_MAX;
  const t = (latDelta - MIN_DELTA) / (MAX_DELTA - MIN_DELTA);
  return Math.round(SIZE_MAX - t * (SIZE_MAX - SIZE_MIN));
}

// ─── Animated pulse ring ──────────────────────────────────────────────────────
function PulseRing({ color, size }: { color: string; size: number }) {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale,   { toValue: 2.0, duration: 1500, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1.0, duration: 0,    useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0,    duration: 1500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.65, duration: 0,    useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
}

// ─── Shape renderers ─────────────────────────────────────────────────────────

function DiamondShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const half = canvas / 2;
  const pad = 6;
  const pts = [
    `${half},${pad}`,
    `${canvas - pad},${half - 1}`,
    `${half},${canvas - pad + 4}`,
    `${pad},${half - 1}`,
  ].join(' ');
  const iPts = [
    `${half},${pad + 3}`,
    `${canvas - pad - 3},${half - 1}`,
    `${half},${canvas - pad + 1}`,
    `${pad + 3},${half - 1}`,
  ].join(' ');
  return (
    <>
      <Polygon points={pts} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      <Polygon points={iPts} fill="none" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.30} />
      {size >= 22 && <Circle cx={half + size * 0.14} cy={half - size * 0.15} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

function CircleShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const cx = canvas / 2;
  const cy = canvas / 2;
  const r = (canvas - 10) / 2;
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      <Circle cx={cx} cy={cy} r={r - 3} fill="none" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.30} />
      {size >= 22 && <Circle cx={cx + size * 0.12} cy={cy - size * 0.15} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

function TriangleShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const half = canvas / 2;
  const pad = 6;
  const pts = [`${half},${pad}`, `${canvas - pad},${canvas - pad}`, `${pad},${canvas - pad}`].join(' ');
  const iPts = [`${half},${pad + 4}`, `${canvas - pad - 4},${canvas - pad - 2}`, `${pad + 4},${canvas - pad - 2}`].join(' ');
  return (
    <>
      <Polygon points={pts} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      <Polygon points={iPts} fill="none" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.30} />
      {size >= 22 && <Circle cx={half + size * 0.1} cy={half + size * 0.05} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

function SquareShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const pad = 6;
  const r = 4;
  const w = canvas - pad * 2;
  return (
    <>
      <Rect x={pad} y={pad} width={w} height={w} rx={r} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      <Rect x={pad + 3} y={pad + 3} width={w - 6} height={w - 6} rx={r - 1} fill="none" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.30} />
      {size >= 22 && <Circle cx={canvas / 2 + size * 0.12} cy={canvas / 2 - size * 0.12} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

function HexagonShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const cx = canvas / 2;
  const cy = canvas / 2;
  const r = (canvas - 10) / 2;
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
  const iHexPts = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + (r - 3) * Math.cos(angle)},${cy + (r - 3) * Math.sin(angle)}`;
  }).join(' ');
  return (
    <>
      <Polygon points={hexPts} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      <Polygon points={iHexPts} fill="none" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.30} />
      {size >= 22 && <Circle cx={cx + size * 0.1} cy={cy - size * 0.12} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

function ShieldShape({ canvas, s: style, size, gradId }: { canvas: number; s: IncidentStyle; size: number; gradId: string }) {
  const pad = 6;
  const w = canvas - pad * 2;
  const h = canvas - pad * 2;
  const cx = canvas / 2;
  const top = pad;
  // Shield: rounded top corners, pointed bottom
  const d = `M ${pad + 4} ${top} H ${pad + w - 4} Q ${pad + w} ${top} ${pad + w} ${top + 4} V ${top + h * 0.55} Q ${pad + w} ${top + h * 0.85} ${cx} ${top + h} Q ${pad} ${top + h * 0.85} ${pad} ${top + h * 0.55} V ${top + 4} Q ${pad} ${top} ${pad + 4} ${top} Z`;
  return (
    <>
      <Path d={d} fill={`url(#${gradId})`} stroke={style.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
      {size >= 22 && <Circle cx={cx + size * 0.10} cy={canvas / 2 - size * 0.10} r={size * 0.09} fill="rgba(255,255,255,0.22)" />}
    </>
  );
}

// ─── Incident bubble — shape varies by incident type ────────────────────────
export function IncidentBubble({
  incident,
  latDelta = 0.02,
}: {
  incident: TrafficIncident;
  latDelta?: number;
}) {
  const st   = getStyle(incident.category);
  const size = markerSize(latDelta);
  if (size === 0) return null;

  const showPulse = st.pulse && size >= 20;
  // EDGE_PAD: enough room for strokeWidth (2) + bevel ring (3) + safe margin.
  // All shape geometry is drawn inside [EDGE_PAD, canvas-EDGE_PAD] so nothing
  // ever touches the SVG boundary and gets clipped.
  const EDGE_PAD = 8;
  const canvas   = size + EDGE_PAD * 2;
  const symbolPx = Math.max(8, Math.round(size * 0.38));
  const gradId   = `rg${incident.category ?? 0}`;

  const shapeProps = { canvas, s: st, size, gradId };

  return (
    // overflow:'visible' prevents the RN Marker container from clipping the SVG
    // at View boundaries when the marker is near a screen edge.
    <View style={{ width: canvas, height: canvas, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      {showPulse && <PulseRing color={st.color} size={size} />}

      {/* No overflow prop on Svg — not a valid SVGProps key (causes TS2322) */}
      <Svg width={canvas} height={canvas} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="36%" r="62%">
            <Stop offset="0%"   stopColor={st.color}  stopOpacity="0.25" />
            <Stop offset="100%" stopColor={st.darkBg} stopOpacity="1.0"  />
          </RadialGradient>
        </Defs>

        {st.shape === 'diamond'  && <DiamondShape  {...shapeProps} />}
        {st.shape === 'circle'   && <CircleShape   {...shapeProps} />}
        {st.shape === 'triangle' && <TriangleShape {...shapeProps} />}
        {st.shape === 'square'   && <SquareShape   {...shapeProps} />}
        {st.shape === 'hexagon'  && <HexagonShape  {...shapeProps} />}
        {st.shape === 'shield'   && <ShieldShape   {...shapeProps} />}
      </Svg>

      {/* Symbol — centred over the shape */}
      <Text
        style={{
          position:   'absolute',
          color:       st.color,
          fontSize:    symbolPx,
          fontWeight:  '800',
          lineHeight:  symbolPx + 1,
          textAlign:   'center',
          includeFontPadding: false,
        }}
        allowFontScaling={false}
      >
        {st.symbol}
      </Text>
    </View>
  );
}

// ─── IncidentMarker — live zoom-tracking ─────────────────────────────────────
export function IncidentMarker({
  incident,
  latDelta = 0.02,
  onPress,
}: {
  incident: TrafficIncident;
  latDelta?: number;
  onPress: () => void;
}) {
  const [tracks, setTracks] = useState(true);
  const freezeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDeltaRef = useRef(latDelta);

  useEffect(() => {
    if (prevDeltaRef.current !== latDelta) {
      prevDeltaRef.current = latDelta;
      setTracks(true);
      if (freezeTimer.current) clearTimeout(freezeTimer.current);
      freezeTimer.current = setTimeout(() => setTracks(false), 300);
    }
    return () => { if (freezeTimer.current) clearTimeout(freezeTimer.current); };
  }, [latDelta]);

  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(id);
  }, []);

  const st = getStyle(incident.category);
  // anchor.y for triangle/shield: 1.0 (tip points down); others: 0.5 (centered)
  const anchorY = (st.shape === 'diamond' || st.shape === 'triangle' || st.shape === 'shield') ? 0.90 : 0.5;

  return (
    <Marker
      coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
      anchor={{ x: 0.5, y: anchorY }}
      tracksViewChanges={tracks}
      onPress={onPress}
    >
      <IncidentBubble incident={incident} latDelta={latDelta} />
    </Marker>
  );
}

// ─── Incident Detail Popup ────────────────────────────────────────────────────
export function IncidentDetailPopup({
  incident,
  onClose,
}: {
  incident: TrafficIncident | null;
  onClose: () => void;
}) {
  const slideY  = useRef(new Animated.Value(380)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const sc      = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    if (incident) {
      Animated.parallel([
        Animated.spring(slideY,  { toValue: 0,    useNativeDriver: true, damping: 22, stiffness: 260 }),
        Animated.spring(sc,      { toValue: 1.0,  useNativeDriver: true, damping: 22, stiffness: 260 }),
        Animated.timing(opacity, { toValue: 1,    duration: 150,         useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 380, duration: 200, useNativeDriver: true }),
        Animated.timing(sc,      { toValue: 0.96, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0,    duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [!!incident]);

  if (!incident) return null;

  const st = getStyle(incident.category);

  const delayLabel = incident.delay_seconds
    ? incident.delay_seconds >= 60
      ? `${Math.round(incident.delay_seconds / 60)} min delay`
      : `${incident.delay_seconds}s delay`
    : null;

  const road = incident.road?.length ? incident.road.join(' · ') : null;

  // Popup icon — 52px canvas, same shape as marker
  const D = 56;
  const dh = D / 2;
  const dp = 6;
  const gradIdPop = `rgpop_${incident.category ?? 0}`;

  const iconShapeProps = { canvas: D, s: st, size: D - 16, gradId: gradIdPop };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={pop.backdrop} onPress={onClose}>
        <Animated.View style={[pop.sheet, { opacity, transform: [{ translateY: slideY }, { scale: sc }] }]}>

          {/* Accent bar */}
          <View style={[pop.topBar, { backgroundColor: st.color }]} />

          {/* Handle */}
          <View style={pop.handle} />

          {/* Header */}
          <View style={pop.header}>

            {/* Shape icon */}
            <View style={pop.iconWrap}>
              <View style={[pop.iconGlow, { backgroundColor: st.color + '14', borderColor: st.color + '2E' }]} />
              <Svg width={D} height={D + 4} style={{ position: 'absolute' }}>
                <Defs>
                  <RadialGradient id={gradIdPop} cx="50%" cy="36%" r="62%">
                    <Stop offset="0%"   stopColor={st.color}  stopOpacity="0.30" />
                    <Stop offset="100%" stopColor={st.darkBg} stopOpacity="1.0"  />
                  </RadialGradient>
                </Defs>
                {st.shape === 'diamond'  && <DiamondShape  {...iconShapeProps} />}
                {st.shape === 'circle'   && <CircleShape   {...iconShapeProps} />}
                {st.shape === 'triangle' && <TriangleShape {...iconShapeProps} />}
                {st.shape === 'square'   && <SquareShape   {...iconShapeProps} />}
                {st.shape === 'hexagon'  && <HexagonShape  {...iconShapeProps} />}
                {st.shape === 'shield'   && <ShieldShape   {...iconShapeProps} />}
              </Svg>
              <Text style={[pop.iconSymbol, { color: st.color }]}>{st.symbol}</Text>
            </View>

            {/* Title */}
            <View style={{ flex: 1 }}>
              <View style={pop.titleRow}>
                <Text style={pop.typeText}>{st.label}</Text>
                <View style={[pop.liveBadge, { backgroundColor: st.color + '1E', borderColor: st.color + '4E' }]}>
                  <View style={[pop.liveDot, { backgroundColor: st.color }]} />
                  <Text style={[pop.liveBadgeText, { color: st.color }]}>LIVE</Text>
                </View>
              </View>
              {road && <Text style={pop.roadText} numberOfLines={1}>{road}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                {/* Shape label badge */}
                <View style={{ width: 8, height: 8, borderRadius: st.shape === 'circle' ? 4 : 2, backgroundColor: st.color, transform: st.shape === 'diamond' ? [{ rotate: '45deg' }] : [] }} />
                <Text style={[pop.severityText, { color: st.color }]}>
                  {st.pulse ? 'HIGH SEVERITY' : 'ADVISORY'}
                </Text>
              </View>
            </View>

            <Pressable style={pop.closeBtn} onPress={onClose} hitSlop={12}>
              <Text style={pop.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={[pop.divider, { backgroundColor: st.color + '22' }]} />

          <ScrollView style={{ maxHeight: 185 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            <Text style={pop.detailText}>{st.detail}</Text>
            {!!incident.description && (
              <View style={[pop.reportedBox, { borderLeftColor: st.color, backgroundColor: st.color + '0D' }]}>
                <Text style={[pop.reportedLabel, { color: st.color + 'A0' }]}>REPORTED</Text>
                <Text style={pop.reportedText}>{incident.description}</Text>
              </View>
            )}
          </ScrollView>

          <View style={pop.footer}>
            {delayLabel && (
              <View style={[pop.chip, { backgroundColor: '#FF475716', borderColor: '#FF475745' }]}>
                <Text style={[pop.chipText, { color: '#FF8A94' }]}>⏱  {delayLabel}</Text>
              </View>
            )}
            <View style={[pop.chip, { backgroundColor: st.color + '14', borderColor: st.color + '38' }]}>
              <Text style={[pop.chipText, { color: st.color }]}>◈  Active</Text>
            </View>
            <View style={[pop.chip, { backgroundColor: '#FFFFFF06', borderColor: '#FFFFFF10' }]}>
              <Text style={[pop.chipText, { color: '#475569' }]}>↺  Auto-refresh</Text>
            </View>
          </View>

        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const pop = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,3,22,0.60)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#07091E',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 46,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -14 },
    shadowOpacity: 0.72,
    shadowRadius: 36,
    elevation: 36,
    overflow: 'hidden',
  },
  topBar: {
    height: 4,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    opacity: 0.95,
  },
  handle: {
    width: 36, height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignSelf: 'center',
    marginTop: 14,
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  iconWrap: {
    width: 58, height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlow: {
    position: 'absolute',
    width: 58, height: 58,
    borderRadius: 29,
    borderWidth: 1,
  },
  iconSymbol: {
    position: 'absolute',
    fontSize: 19,
    fontWeight: '800',
    includeFontPadding: false,
    marginTop: -6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
    flexWrap: 'wrap',
  },
  typeText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#EEF2FF',
    letterSpacing: -0.3,
  },
  liveBadge: {
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 5, height: 5,
    borderRadius: 2.5,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  roadText: {
    fontSize: 12,
    color: '#4B5E72',
    fontWeight: '500',
    marginBottom: 1,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 28, height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  closeBtnText: {
    color: '#4B5E72',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: { height: 1, marginBottom: 14 },
  detailText: {
    fontSize: 15,
    color: '#7A8FA6',
    lineHeight: 24,
    marginBottom: 14,
  },
  reportedBox: {
    borderLeftWidth: 2.5,
    paddingLeft: 12,
    paddingVertical: 8,
    borderRadius: 3,
    marginBottom: 14,
  },
  reportedLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 3,
  },
  reportedText: {
    fontSize: 13,
    color: '#7A8FA6',
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 16,
  },
  chip: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});