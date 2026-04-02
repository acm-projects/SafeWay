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
import type { TrafficIncident } from '@/hooks/useTrafficIncidents';

// ─── Per-category visual config ───────────────────────────────────────────────
type IncidentStyle = {
  emoji: string;
  color: string;
  bg: string;
  label: string;
  detail: string;
};

const INCIDENT_STYLES: Record<number, IncidentStyle> = {
  0:  { emoji: '❓', color: '#94A3B8', bg: '#1E293B', label: 'Unknown',              detail: 'An unclassified incident has been reported in this area.' },
  1:  { emoji: '💥', color: '#F87171', bg: '#2D1515', label: 'Accident',             detail: 'A traffic collision has been reported. Expect delays and emergency vehicles.' },
  2:  { emoji: '🌫️', color: '#CBD5E1', bg: '#1C2033', label: 'Fog',                 detail: 'Dense fog is reducing visibility. Slow down and use headlights.' },
  3:  { emoji: '⚠️', color: '#FBBF24', bg: '#2D2010', label: 'Hazard',              detail: 'Dangerous road conditions have been reported. Proceed with caution.' },
  4:  { emoji: '🌧️', color: '#60A5FA', bg: '#111D2D', label: 'Rain',                detail: 'Heavy rain is affecting road conditions. Reduce speed and increase following distance.' },
  5:  { emoji: '🧊', color: '#BAE6FD', bg: '#0D1E2D', label: 'Ice',                 detail: 'Icy road surface detected. Brake early and avoid sudden maneuvers.' },
  6:  { emoji: '🚦', color: '#FB923C', bg: '#2D1A08', label: 'Traffic Jam',         detail: 'Heavy congestion ahead. Significant delays expected — consider an alternate route.' },
  7:  { emoji: '🚧', color: '#F59E0B', bg: '#2D2000', label: 'Lane Closed',         detail: 'One or more lanes are closed. Merge early and watch for workers.' },
  8:  { emoji: '🚫', color: '#EF4444', bg: '#2D0D0D', label: 'Road Closed',         detail: 'This road is fully closed. You must use an alternate route.' },
  9:  { emoji: '🛠️', color: '#A78BFA', bg: '#1E1430', label: 'Road Works',          detail: 'Active road works in progress. Reduced speed limits and lane changes may apply.' },
  10: { emoji: '💨', color: '#7DD3FC', bg: '#0D1E2D', label: 'Wind',                detail: 'High winds are affecting the road. Be alert for debris and maintain firm grip.' },
  11: { emoji: '🌊', color: '#38BDF8', bg: '#0A1E2D', label: 'Flooding',            detail: 'Flooding has been reported. Do not attempt to drive through standing water.' },
  14: { emoji: '🚗', color: '#C084FC', bg: '#1E102D', label: 'Broken Down Vehicle', detail: 'A broken down vehicle is blocking part of the road. Watch for occupants on the shoulder.' },
};

function getStyle(category: number): IncidentStyle {
  return INCIDENT_STYLES[category] ?? INCIDENT_STYLES[0];
}

// ─── Size calculation based on zoom ──────────────────────────────────────────
// latDelta:  0.005 = very zoomed in  →  full size (32px)
//            0.02  = street level    →  medium (22px)
//            0.06  = neighbourhood   →  small (14px)
//            0.08+ = hidden entirely
const MAX_DELTA = 0.08;  // hide above this
const MIN_DELTA = 0.005; // full size below this
const SIZE_MAX  = 32;
const SIZE_MIN  = 12;

function bubbleSize(latDelta: number): number {
  if (latDelta >= MAX_DELTA) return 0;
  if (latDelta <= MIN_DELTA) return SIZE_MAX;
  // linear interpolation between full and min size
  const t = (latDelta - MIN_DELTA) / (MAX_DELTA - MIN_DELTA); // 0→1
  return Math.round(SIZE_MAX - t * (SIZE_MAX - SIZE_MIN));
}

// ─── Incident Bubble ──────────────────────────────────────────────────────────
export function IncidentBubble({
  incident,
  latDelta = 0.02,
}: {
  incident: TrafficIncident;
  latDelta?: number;
}) {
  const s    = getStyle(incident.category);
  const size = bubbleSize(latDelta);
  if (size === 0) return null;

  const ringSize   = size + 6;
  const fontSize   = Math.max(8, size * 0.55);
  const borderW    = size > 22 ? 2 : 1.5;

  return (
    <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer ring */}
      <View style={{
        position: 'absolute',
        width: ringSize, height: ringSize,
        borderRadius: ringSize / 2,
        borderWidth: 1,
        borderColor: s.color + '99',
        backgroundColor: s.color + '18',
      }} />
      {/* Main circle */}
      <View style={{
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: borderW,
        borderColor: s.color,
        backgroundColor: s.bg,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.45,
        shadowRadius: 3,
        elevation: 5,
      }}>
        <Text style={{ fontSize, lineHeight: fontSize + 2 }}>{s.emoji}</Text>
        {/* Gloss */}
        {size >= 20 && (
          <View style={{
            position: 'absolute',
            top: Math.round(size * 0.12),
            right: Math.round(size * 0.14),
            width: Math.round(size * 0.2),
            height: Math.round(size * 0.2),
            borderRadius: Math.round(size * 0.1),
            backgroundColor: 'rgba(255,255,255,0.35)',
          }} />
        )}
      </View>
    </View>
  );
}

// ─── IncidentMarker wrapper ───────────────────────────────────────────────────
// Passes latDelta down so bubble scales with zoom.
// tracksViewChanges starts true briefly so RN Maps measures the view,
// then freezes to false to prevent map jank.
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
  const freezeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDeltaRef = useRef(latDelta);

  useEffect(() => {
    // If latDelta changed at all, enable tracking immediately
    if (prevDeltaRef.current !== latDelta) {
      prevDeltaRef.current = latDelta;

      // Enable tracking so the marker resizes right now, during the gesture
      setTracks(true);

      // Cancel any pending freeze
      if (freezeTimer.current) clearTimeout(freezeTimer.current);

      // Freeze only after zooming has been stable for 300ms
      freezeTimer.current = setTimeout(() => {
        setTracks(false);
      }, 300);
    }

    return () => {
      if (freezeTimer.current) clearTimeout(freezeTimer.current);
    };
  }, [latDelta]);

  // Initial freeze after mount
  useEffect(() => {
    const id = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(id);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
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
  const slideY     = useRef(new Animated.Value(340)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const sheetScale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    if (incident) {
      Animated.parallel([
        Animated.spring(slideY,     { toValue: 0,    useNativeDriver: true, damping: 18, stiffness: 220 }),
        Animated.spring(sheetScale, { toValue: 1.0,  useNativeDriver: true, damping: 18, stiffness: 220 }),
        Animated.timing(opacity,    { toValue: 1,    duration: 180,         useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,     { toValue: 340, duration: 220, useNativeDriver: true }),
        Animated.timing(sheetScale, { toValue: 0.96, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: 180, useNativeDriver: true }),
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

  const road = incident.road?.length ? incident.road.join(', ') : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={pop.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            pop.sheet,
            { opacity, transform: [{ translateY: slideY }, { scale: sheetScale }] },
          ]}
        >
          <View style={[pop.accentBar, { backgroundColor: s.color }]} />
          <View style={pop.handle} />

          <View style={pop.header}>
            <View style={[pop.iconCircle, { backgroundColor: s.bg, borderColor: s.color }]}>
              <Text style={pop.iconEmoji}>{s.emoji}</Text>
              <View style={pop.iconShine} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={pop.titleRow}>
                <Text style={pop.typeText}>{s.label}</Text>
                <View style={[pop.liveBadge, { backgroundColor: s.color + '28', borderColor: s.color + '60' }]}>
                  <View style={[pop.liveDot, { backgroundColor: s.color }]} />
                  <Text style={[pop.liveBadgeText, { color: s.color }]}>LIVE</Text>
                </View>
              </View>
              {road && <Text style={pop.roadText} numberOfLines={1}>📍 {road}</Text>}
            </View>
            <Pressable style={pop.closeBtn} onPress={onClose} hitSlop={10}>
              <Text style={pop.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={[pop.divider, { backgroundColor: s.color + '30' }]} />

          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <Text style={pop.detailText}>{s.detail}</Text>
            {!!incident.description && (
              <View style={[pop.reportedBox, { borderLeftColor: s.color, backgroundColor: s.color + '10' }]}>
                <Text style={pop.reportedLabel}>REPORTED</Text>
                <Text style={pop.reportedText}>{incident.description}</Text>
              </View>
            )}
          </ScrollView>

          <View style={pop.footer}>
            {delayLabel && (
              <View style={[pop.chip, { backgroundColor: '#FF475722', borderColor: '#FF475755' }]}>
                <Text style={[pop.chipText, { color: '#FF6B7A' }]}>⏱ {delayLabel}</Text>
              </View>
            )}
            <View style={[pop.chip, { backgroundColor: s.color + '18', borderColor: s.color + '44' }]}>
              <Text style={[pop.chipText, { color: s.color }]}>🔴 Live incident</Text>
            </View>
            <View style={[pop.chip, { backgroundColor: '#FFFFFF08', borderColor: '#FFFFFF15' }]}>
              <Text style={[pop.chipText, { color: '#64748B' }]}>Auto-refreshes</Text>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const pop = StyleSheet.create({
  backdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.52)', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: '#0D1326', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 0, paddingBottom: 44, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#FFFFFF12', shadowColor: '#000', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.6, shadowRadius: 28, elevation: 28, overflow: 'hidden' },
  accentBar:     { height: 4, borderTopLeftRadius: 30, borderTopRightRadius: 30, opacity: 0.9 },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF22', alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  header:        { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  iconCircle:    { width: 62, height: 62, borderRadius: 31, borderWidth: 2.5, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  iconEmoji:     { fontSize: 28 },
  iconShine:     { position: 'absolute', top: 8, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.28)' },
  titleRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  typeText:      { fontSize: 20, fontWeight: '800', color: '#F1F5F9', letterSpacing: -0.3 },
  liveBadge:     { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot:       { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  roadText:      { fontSize: 13, color: '#64748B', fontWeight: '500' },
  closeBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF10', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' },
  closeBtnText:  { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  divider:       { height: 1, marginBottom: 16 },
  detailText:    { fontSize: 15, color: '#CBD5E1', lineHeight: 23, marginBottom: 14 },
  reportedBox:   { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 8, borderRadius: 6, marginBottom: 14 },
  reportedLabel: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 1, marginBottom: 4 },
  reportedText:  { fontSize: 14, color: '#94A3B8', lineHeight: 20 },
  footer:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  chip:          { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:      { fontSize: 12, fontWeight: '600' },
});