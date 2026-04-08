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
import Svg, { Polygon, Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { TrafficIncident } from '@/hooks/useTrafficIncidents';

// ─── Per-category config ──────────────────────────────────────────────────────
type IncidentStyle = {
  color: string;
  darkBg: string;
  symbol: string;
  label: string;
  detail: string;
  pulse: boolean;
};

const S: Record<number, IncidentStyle> = {
  0:  { color: '#64748B', darkBg: '#0F1623', symbol: '?',  label: 'Unknown',             pulse: false, detail: 'An unclassified incident has been reported in this area.' },
  1:  { color: '#FF4D6A', darkBg: '#2A0A10', symbol: '✕',  label: 'Accident',             pulse: true,  detail: 'A traffic collision has been reported. Expect delays and emergency vehicles.' },
  2:  { color: '#A8C4D4', darkBg: '#101B22', symbol: '◌',  label: 'Fog',                  pulse: false, detail: 'Dense fog is reducing visibility. Slow down and use headlights.' },
  3:  { color: '#FFB830', darkBg: '#221800', symbol: '!',  label: 'Hazard',               pulse: true,  detail: 'Dangerous road conditions have been reported. Proceed with caution.' },
  4:  { color: '#4DA6FF', darkBg: '#08162A', symbol: '≈',  label: 'Rain',                 pulse: false, detail: 'Heavy rain is affecting road conditions. Reduce speed and increase following distance.' },
  5:  { color: '#B8E4F9', darkBg: '#081520', symbol: '*',  label: 'Ice',                  pulse: true,  detail: 'Icy road surface detected. Brake early and avoid sudden maneuvers.' },
  6:  { color: '#FF7A30', darkBg: '#221008', symbol: '▲',  label: 'Traffic Jam',          pulse: true,  detail: 'Heavy congestion ahead. Significant delays expected — consider an alternate route.' },
  7:  { color: '#FFCC44', darkBg: '#221900', symbol: '║',  label: 'Lane Closed',          pulse: false, detail: 'One or more lanes are closed. Merge early and watch for workers.' },
  8:  { color: '#FF3333', darkBg: '#2A0808', symbol: '⊘',  label: 'Road Closed',          pulse: true,  detail: 'This road is fully closed. You must use an alternate route.' },
  9:  { color: '#9B72F7', darkBg: '#130A2A', symbol: '⚙',  label: 'Road Works',           pulse: false, detail: 'Active road works in progress. Reduced speed limits and lane changes may apply.' },
  10: { color: '#5DC8E8', darkBg: '#071A22', symbol: '≋',  label: 'Wind',                 pulse: false, detail: 'High winds are affecting the road. Be alert for debris and maintain firm grip.' },
  11: { color: '#22AAEE', darkBg: '#061422', symbol: '~',  label: 'Flooding',             pulse: true,  detail: 'Flooding has been reported. Do not attempt to drive through standing water.' },
  14: { color: '#C084FC', darkBg: '#160A2A', symbol: '□',  label: 'Broken Down Vehicle',  pulse: false, detail: 'A broken down vehicle is blocking part of the road. Watch for occupants on the shoulder.' },
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

// ─── Incident bubble — diamond SVG shape ─────────────────────────────────────
export function IncidentBubble({
  incident,
  latDelta = 0.02,
}: {
  incident: TrafficIncident;
  latDelta?: number;
}) {
  const s    = getStyle(incident.category);
  const size = markerSize(latDelta);
  if (size === 0) return null;

  const showPulse = s.pulse && size >= 20;
  const canvas    = size + 12;
  const half      = canvas / 2;
  const pad       = 5;
  const symbolPx  = Math.max(8, Math.round(size * 0.38));

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

  const gradId = `rg${incident.category ?? 0}`;

  return (
    <View style={{ width: canvas, height: canvas + 4, alignItems: 'center', justifyContent: 'center' }}>
      {showPulse && <PulseRing color={s.color} size={size} />}

      <Svg width={canvas} height={canvas + 4} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="36%" r="62%">
            <Stop offset="0%"   stopColor={s.color}  stopOpacity="0.25" />
            <Stop offset="100%" stopColor={s.darkBg} stopOpacity="1.0"  />
          </RadialGradient>
        </Defs>
        <Polygon points={pts} fill="rgba(0,0,0,0.32)" x={1.5} y={2.5} />
        <Polygon points={pts} fill={`url(#${gradId})`} stroke={s.color} strokeWidth={size >= 24 ? 1.8 : 1.2} />
        <Polygon points={iPts} fill="none" stroke={s.color} strokeWidth={0.7} strokeOpacity={0.30} />
        {size >= 22 && (
          <Circle cx={half + size * 0.14} cy={half - size * 0.15} r={size * 0.09} fill="rgba(255,255,255,0.22)" />
        )}
      </Svg>

      <Text
        style={{
          position:   'absolute',
          color:       s.color,
          fontSize:    symbolPx,
          fontWeight:  '800',
          lineHeight:  symbolPx + 1,
          textAlign:   'center',
          marginTop:  -Math.round(size * 0.10),
          includeFontPadding: false,
        }}
        allowFontScaling={false}
      >
        {s.symbol}
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

  return (
    <Marker
      coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
      anchor={{ x: 0.5, y: 0.90 }}
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

  const s = getStyle(incident.category);

  const delayLabel = incident.delay_seconds
    ? incident.delay_seconds >= 60
      ? `${Math.round(incident.delay_seconds / 60)} min delay`
      : `${incident.delay_seconds}s delay`
    : null;

  const road = incident.road?.length ? incident.road.join(' · ') : null;

  const D = 52;
  const dh = D / 2;
  const dp = 5;
  const iconPts = [
    `${dh},${dp}`,
    `${D - dp},${dh - 1}`,
    `${dh},${D - dp + 4}`,
    `${dp},${dh - 1}`,
  ].join(' ');
  const iIconPts = [
    `${dh},${dp + 3}`,
    `${D - dp - 3},${dh - 1}`,
    `${dh},${D - dp + 1}`,
    `${dp + 3},${dh - 1}`,
  ].join(' ');

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={pop.backdrop} onPress={onClose}>
        <Animated.View style={[pop.sheet, { opacity, transform: [{ translateY: slideY }, { scale: sc }] }]}>

          <View style={[pop.topBar, { backgroundColor: s.color }]} />
          <View style={pop.handle} />

          <View style={pop.header}>
            <View style={pop.iconWrap}>
              <View style={[pop.iconGlow, { backgroundColor: s.color + '14', borderColor: s.color + '2E' }]} />
              <Svg width={D} height={D + 4} style={{ position: 'absolute' }}>
                <Defs>
                  <RadialGradient id="rgpop" cx="50%" cy="36%" r="62%">
                    <Stop offset="0%"   stopColor={s.color}  stopOpacity="0.30" />
                    <Stop offset="100%" stopColor={s.darkBg} stopOpacity="1.0"  />
                  </RadialGradient>
                </Defs>
                <Polygon points={iconPts} fill="url(#rgpop)" stroke={s.color} strokeWidth={1.8} />
                <Polygon points={iIconPts} fill="none" stroke={s.color} strokeWidth={0.7} strokeOpacity={0.28} />
                <Circle cx={dh + 5} cy={dh - 7} r={4} fill="rgba(255,255,255,0.20)" />
              </Svg>
              <Text style={[pop.iconSymbol, { color: s.color }]}>{s.symbol}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={pop.titleRow}>
                <Text style={pop.typeText}>{s.label}</Text>
                <View style={[pop.liveBadge, { backgroundColor: s.color + '1E', borderColor: s.color + '4E' }]}>
                  <View style={[pop.liveDot, { backgroundColor: s.color }]} />
                  <Text style={[pop.liveBadgeText, { color: s.color }]}>LIVE</Text>
                </View>
              </View>
              {road && <Text style={pop.roadText} numberOfLines={1}>{road}</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <Svg width={7} height={7}>
                  <Polygon points="3.5,0 7,3.5 3.5,7 0,3.5" fill={s.color} />
                </Svg>
                <Text style={[pop.severityText, { color: s.color }]}>
                  {s.pulse ? 'HIGH SEVERITY' : 'ADVISORY'}
                </Text>
              </View>
            </View>

            <Pressable style={pop.closeBtn} onPress={onClose} hitSlop={12}>
              <Text style={pop.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={[pop.divider, { backgroundColor: s.color + '22' }]} />

          <ScrollView style={{ maxHeight: 185 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            <Text style={pop.detailText}>{s.detail}</Text>
            {!!incident.description && (
              <View style={[pop.reportedBox, { borderLeftColor: s.color, backgroundColor: s.color + '0D' }]}>
                <Text style={[pop.reportedLabel, { color: s.color + 'A0' }]}>REPORTED</Text>
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
            <View style={[pop.chip, { backgroundColor: s.color + '14', borderColor: s.color + '38' }]}>
              <Text style={[pop.chipText, { color: s.color }]}>◈  Active</Text>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(2,3,22,0.60)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#07091E',
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    paddingHorizontal: 20, paddingTop: 0, paddingBottom: 46,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -14 },
    shadowOpacity: 0.72, shadowRadius: 36, elevation: 36, overflow: 'hidden',
  },
  topBar: { height: 4, borderTopLeftRadius: 30, borderTopRightRadius: 30, opacity: 0.95 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'center', marginTop: 14, marginBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  iconWrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  iconGlow: { position: 'absolute', width: 58, height: 58, borderRadius: 29, borderWidth: 1 },
  iconSymbol: { position: 'absolute', fontSize: 19, fontWeight: '800', includeFontPadding: false, marginTop: -6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  typeText: { fontSize: 20, fontWeight: '800', color: '#EEF2FF', letterSpacing: -0.3 },
  liveBadge: { borderRadius: 5, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5 },
  liveBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  roadText: { fontSize: 12, color: '#4B5E72', fontWeight: '500', marginBottom: 1 },
  severityText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' },
  closeBtnText: { color: '#4B5E72', fontSize: 11, fontWeight: '700' },
  divider: { height: 1, marginBottom: 14 },
  detailText: { fontSize: 15, color: '#7A8FA6', lineHeight: 24, marginBottom: 14 },
  reportedBox: { borderLeftWidth: 2.5, paddingLeft: 12, paddingVertical: 8, borderRadius: 3, marginBottom: 14 },
  reportedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 3 },
  reportedText: { fontSize: 13, color: '#7A8FA6', lineHeight: 20 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 },
  chip: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5 },
  chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
});
