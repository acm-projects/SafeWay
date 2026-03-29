import React, { useEffect, useRef } from 'react';
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

// ─── Incident Bubble (shown as map marker) ────────────────────────────────────
export function IncidentBubble({ incident }: { incident: TrafficIncident }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const s = getStyle(incident.category);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.22, duration: 950, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0,  duration: 950, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={bub.wrapper}>
      {/* Pulsing outer ring */}
      <Animated.View style={[bub.ring, { borderColor: s.color, transform: [{ scale: pulse }] }]} />
      {/* Bubble body */}
      <View style={[bub.body, { backgroundColor: s.bg, borderColor: s.color }]}>
        <Text style={bub.emoji}>{s.emoji}</Text>
      </View>
      {/* Label pill */}
      <View style={[bub.label, { backgroundColor: s.color }]}>
        <Text style={bub.labelText} numberOfLines={1}>{s.label}</Text>
      </View>
      {/* Pointer */}
      <View style={[bub.pointer, { borderTopColor: s.color }]} />
    </View>
  );
}

const bub = StyleSheet.create({
  wrapper:   { alignItems: 'center' },
  ring:      { position: 'absolute', top: -4, width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, opacity: 0.4 },
  body:      { width: 48, height: 48, borderRadius: 24, borderWidth: 2, justifyContent: 'center', alignItems: 'center',
               shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.55, shadowRadius: 7, elevation: 9 },
  emoji:     { fontSize: 22 },
  label:     { marginTop: 3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 90 },
  labelText: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },
  pointer:   { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
               borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: 1 },
});

// ─── Incident Detail Popup (bottom sheet shown on tap) ────────────────────────
export function IncidentDetailPopup({
  incident,
  onClose,
}: {
  incident: TrafficIncident | null;
  onClose: () => void;
}) {
  const slideY  = useRef(new Animated.Value(320)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (incident) {
      Animated.parallel([
        Animated.spring(slideY,  { toValue: 0,   useNativeDriver: true, damping: 18, stiffness: 200 }),
        Animated.timing(opacity, { toValue: 1,   duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 320, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0,   duration: 180, useNativeDriver: true }),
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
          style={[pop.sheet, { opacity, transform: [{ translateY: slideY }] }]}
        >
          {/* Handle */}
          <View style={pop.handle} />

          {/* Header row */}
          <View style={pop.header}>
            <View style={[pop.iconCircle, { backgroundColor: s.bg, borderColor: s.color }]}>
              <Text style={pop.iconEmoji}>{s.emoji}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={pop.titleRow}>
                <Text style={pop.typeText}>{s.label}</Text>
                <View style={[pop.liveBadge, { backgroundColor: s.color + '28', borderColor: s.color + '60' }]}>
                  <Text style={[pop.liveBadgeText, { color: s.color }]}>LIVE</Text>
                </View>
              </View>
              {road && <Text style={pop.roadText} numberOfLines={1}>📍 {road}</Text>}
            </View>

            <Pressable style={pop.closeBtn} onPress={onClose} hitSlop={10}>
              <Text style={pop.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Divider */}
          <View style={[pop.divider, { backgroundColor: s.color + '30' }]} />

          {/* Body */}
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            <Text style={pop.detailText}>{s.detail}</Text>

            {!!incident.description && (
              <View style={[pop.reportedBox, { borderLeftColor: s.color }]}>
                <Text style={pop.reportedLabel}>REPORTED</Text>
                <Text style={pop.reportedText}>{incident.description}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer chips */}
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0D1326',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#FFFFFF10',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 24,
  },
  handle: {
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: '#FFFFFF28',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  iconEmoji:  { fontSize: 28 },
  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  typeText:   { fontSize: 20, fontWeight: '800', color: '#F1F5F9', letterSpacing: -0.3 },
  liveBadge:  { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  liveBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  roadText:   { fontSize: 13, color: '#64748B', fontWeight: '500' },
  closeBtn:   { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF10', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' },
  closeBtnText: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  divider:    { height: 1, marginBottom: 16 },
  detailText: { fontSize: 15, color: '#CBD5E1', lineHeight: 23, marginBottom: 14 },
  reportedBox:   { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 14 },
  reportedLabel: { fontSize: 10, fontWeight: '800', color: '#475569', letterSpacing: 1, marginBottom: 4 },
  reportedText:  { fontSize: 14, color: '#94A3B8', lineHeight: 20 },
  footer:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  chip:       { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipText:   { fontSize: 12, fontWeight: '600' },
});