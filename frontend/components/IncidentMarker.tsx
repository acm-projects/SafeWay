import React, { useEffect, useRef } from 'react';
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
import { Image } from 'react-native';
import Svg, { Circle, Rect, Path } from 'react-native-svg';
import type { TrafficIncident } from '@/hooks/useTrafficIncidents';

const TRAFFIC_JAM_MARKER = require('@/assets/images/traffic-jam-marker.png');
const TRAFFIC_CRASH_MARKER = require('@/assets/images/traffic-crash-marker.png');
const ROAD_WORK_MARKER = require('@/assets/images/road-work-marker.png');
const HAZARD_MARKER = require('@/assets/images/hazard-marker.png');
const FLOODING_MARKER = require('@/assets/images/flooding-marker.png');

// ─── Per-category config ──────────────────────────────────────────────────────
type IncidentShape = 'diamond' | 'circle' | 'triangle' | 'square' | 'hexagon' | 'shield';

type IncidentStyle = {
  color: string;
  darkBg: string;
  symbol: string;
  emoji: string;
  label: string;
  detail: string;
  shape: IncidentShape;
};

const S: Record<number, IncidentStyle> = {
  0:  { color: '#64748B', darkBg: '#0F1623', symbol: '?',  emoji: '❔', label: 'Unknown',             shape: 'square',   detail: 'An unclassified incident has been reported in this area.' },
  1:  { color: '#FF4D6A', darkBg: '#2A0A10', symbol: '✕',  emoji: '💥', label: 'Accident',             shape: 'diamond',  detail: 'A traffic collision has been reported. Expect delays and emergency vehicles.' },
  2:  { color: '#A8C4D4', darkBg: '#101B22', symbol: '◌',  emoji: '🌫️', label: 'Fog',                  shape: 'circle',   detail: 'Dense fog is reducing visibility. Slow down and use headlights.' },
  3:  { color: '#FFB830', darkBg: '#221800', symbol: '!',  emoji: '⚠️', label: 'Hazard',               shape: 'triangle', detail: 'Dangerous road conditions have been reported. Proceed with caution.' },
  4:  { color: '#4DA6FF', darkBg: '#08162A', symbol: '≈',  emoji: '🌧️', label: 'Rain',                 shape: 'circle',   detail: 'Heavy rain is affecting road conditions. Reduce speed and increase following distance.' },
  5:  { color: '#B8E4F9', darkBg: '#081520', symbol: '*',  emoji: '❄️', label: 'Ice',                  shape: 'hexagon',  detail: 'Icy road surface detected. Brake early and avoid sudden maneuvers.' },
  6:  { color: '#FF7A30', darkBg: '#221008', symbol: '▲',  emoji: '🚗', label: 'Traffic Jam',          shape: 'triangle', detail: 'Heavy congestion ahead. Significant delays expected — consider an alternate route.' },
  7:  { color: '#FFCC44', darkBg: '#221900', symbol: '║',  emoji: '🚧', label: 'Lane Closed',          shape: 'square',   detail: 'One or more lanes are closed. Merge early and watch for workers.' },
  8:  { color: '#FF3333', darkBg: '#2A0808', symbol: '⊘',  emoji: '⛔', label: 'Road Closed',          shape: 'shield',   detail: 'This road is fully closed. You must use an alternate route.' },
  9:  { color: '#9B72F7', darkBg: '#130A2A', symbol: '⚙',  emoji: '🛠️', label: 'Road Works',           shape: 'square',   detail: 'Active road works in progress. Reduced speed limits and lane changes may apply.' },
  10: { color: '#5DC8E8', darkBg: '#071A22', symbol: '~',  emoji: '💨', label: 'Wind',                 shape: 'circle',   detail: 'High winds are affecting the road. Be alert for debris and maintain firm grip.' },
  11: { color: '#22AAEE', darkBg: '#061422', symbol: '~',  emoji: '💧', label: 'Flooding',             shape: 'hexagon',  detail: 'Flooding has been reported. Do not attempt to drive through standing water.' },
  14: { color: '#C084FC', darkBg: '#160A2A', symbol: '□',  emoji: '🚙', label: 'Broken Down Vehicle',  shape: 'diamond',  detail: 'A broken down vehicle is blocking part of the road. Watch for occupants on the shoulder.' },
  12: { color: '#94A3B8', darkBg: '#0F1623', symbol: '⋯',  emoji: '📍', label: 'Traffic',              shape: 'circle',   detail: 'Traffic-related road event reported in this area. Proceed with caution.' },
  13: { color: '#F472B6', darkBg: '#1A0A14', symbol: '⋯',  emoji: '🌀', label: 'Road condition',       shape: 'circle',   detail: 'A road condition has been reported. Adjust speed and stay alert.' },
};

export function normalizeIncidentCategory(cat: unknown): number {
  if (typeof cat === 'number' && Number.isFinite(cat)) return cat;
  const n = parseInt(String(cat ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function getStyle(cat: unknown): IncidentStyle {
  const n = normalizeIncidentCategory(cat);
  return S[n] ?? S[0];
}

// ─── Sizing: compact when zoomed out, capped when zoomed in (never invisible) ─
const MAX_DELTA = 0.45;
const MIN_DELTA = 0.003;
const SIZE_MAX = 34;
const SIZE_MIN = 16;
/** Smallest sticker size when very zoomed out — still tappable */
const SIZE_FAR = 18;

function markerSize(latDelta: number): number {
  if (latDelta >= MAX_DELTA) return SIZE_FAR;
  if (latDelta <= MIN_DELTA) return SIZE_MAX;
  const t = (latDelta - MIN_DELTA) / (MAX_DELTA - MIN_DELTA);
  return Math.round(SIZE_MAX - t * (SIZE_MAX - SIZE_MIN));
}

/** Traffic jam — minimal white ring; RN Image + numeric layout (expo-image inside Map Marker often paints empty on Android). */
function TrafficJamSticker({ diameter }: { diameter: number }) {
  const d = Math.max(22, Math.round(diameter));
  const bw = 1;
  const zoom = 1.0;
  const img = Math.round(d * zoom);
  const shift = (d - img) / 2;
  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        borderWidth: bw,
        borderColor: 'rgba(255,255,255,0.94)',
        overflow: 'hidden',
        backgroundColor: '#0E1228',
      }}
    >
      <Image
        source={TRAFFIC_JAM_MARKER}
        style={{ position: 'absolute', left: shift, top: shift, width: img, height: img }}
        resizeMode="cover"
      />
    </View>
  );
}

function IncidentImageSticker({
  diameter,
  source,
  resizeMode = 'cover',
  padding = 0,
  zoom = 1,
  offsetY = 0,
}: {
  diameter: number;
  source: any;
  resizeMode?: 'cover' | 'contain';
  padding?: number;
  zoom?: number;
  offsetY?: number;
}) {
  const d = Math.max(22, Math.round(diameter));
  const bw = 1;
  const img = Math.round(Math.max(10, (d - padding * 2) * zoom));
  const off = Math.round((d - img) / 2);
  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        borderWidth: bw,
        borderColor: 'rgba(255,255,255,0.94)',
        overflow: 'hidden',
        backgroundColor: '#0E1228',
      }}
    >
      <Image source={source} style={{ position: 'absolute', left: off, top: off + offsetY, width: img, height: img }} resizeMode={resizeMode} />
    </View>
  );
}

const VB = 40;

/** White glyph on colored circle — one style for all non–traffic-jam incidents on the map. */
function IncidentMapGlyph({ cat, dim }: { cat: number; dim: number }) {
  const s = Math.max(13, dim * 0.62);
  const W = '#FFFFFF';
  const sw = 2;
  const cap = 'round' as const;

  switch (cat) {
    case 1:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M11 25 V17 L14 13 H26 L29 17 V25" stroke={W} strokeWidth={sw} fill="none" strokeLinejoin="round" />
          <Path d="M9 27 H31" stroke={W} strokeWidth={sw + 0.5} strokeLinecap={cap} />
          <Path d="M14 13 L16 9 H24 L26 13" stroke={W} strokeWidth={sw} fill="none" strokeLinejoin="round" />
        </Svg>
      );
    case 2:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M6 17 Q10 13 14 17 T22 17 T30 17" stroke={W} strokeWidth={1.8} fill="none" />
          <Path d="M6 23 Q10 19 14 23 T22 23 T30 23" stroke={W} strokeWidth={1.8} fill="none" />
          <Path d="M6 29 Q11 25 16 29 T26 29 T34 29" stroke={W} strokeWidth={1.8} fill="none" />
        </Svg>
      );
    case 3:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={20} cy={20} r={11} stroke={W} strokeWidth={sw} fill="none" />
          <Path d="M20 13 L20 22" stroke={W} strokeWidth={2.4} strokeLinecap={cap} />
          <Circle cx={20} cy={26.5} r={1.8} fill={W} />
        </Svg>
      );
    case 4:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M11 9 L7 21" stroke={W} strokeWidth={sw} strokeLinecap={cap} />
          <Path d="M20 7 L16 19" stroke={W} strokeWidth={sw} strokeLinecap={cap} />
          <Path d="M29 10 L25 22" stroke={W} strokeWidth={sw} strokeLinecap={cap} />
        </Svg>
      );
    case 5:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M20 8 V32 M8 20 H32 M11 11 L29 29 M29 11 L11 29" stroke={W} strokeWidth={1.8} strokeLinecap={cap} />
        </Svg>
      );
    case 7:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Rect x={10} y={14} width={6} height={16} rx={1} fill={W} />
          <Rect x={24} y={14} width={6} height={16} rx={1} fill={W} />
          <Rect x={8} y={12} width={24} height={4} rx={1} fill={W} />
        </Svg>
      );
    case 8:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={20} cy={20} r={14} fill="none" stroke={W} strokeWidth={sw} />
          <Path d="M12 20 H28" stroke={W} strokeWidth={sw + 1} strokeLinecap={cap} />
        </Svg>
      );
    case 9:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M14 28 L20 10 L26 28" fill="none" stroke={W} strokeWidth={sw} strokeLinejoin="round" />
          <Circle cx={20} cy={24} r={2.5} fill={W} />
        </Svg>
      );
    case 10:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M7 15 Q15 11 33 15" stroke={W} strokeWidth={sw} fill="none" />
          <Path d="M7 23 Q17 19 33 23" stroke={W} strokeWidth={sw} fill="none" />
        </Svg>
      );
    case 11:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M6 27 Q11 24 16 27 T26 27 T34 27" stroke="#2DA8FF" strokeWidth={2.2} fill="none" />
          <Path d="M6 31 Q11 28 16 31 T26 31 T34 31" stroke="#2DA8FF" strokeWidth={2.2} fill="none" />
          <Rect x={12} y={16} width={16} height={8} rx={2} fill="#FF6B6B" />
          <Rect x={15} y={13} width={10} height={4} rx={1.5} fill="#B3EFFF" />
          <Circle cx={15} cy={25} r={2} fill="#4B2E53" />
          <Circle cx={25} cy={25} r={2} fill="#4B2E53" />
        </Svg>
      );
    case 12:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={14} cy={20} r={3.2} fill={W} />
          <Circle cx={20} cy={20} r={3.2} fill={W} />
          <Circle cx={26} cy={20} r={3.2} fill={W} />
        </Svg>
      );
    case 13:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M8 22 Q12 12 18 22 T28 22 T34 20" stroke={W} strokeWidth={sw} fill="none" strokeLinecap={cap} />
        </Svg>
      );
    case 14:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M10 25 V15 H28 V25 Z" stroke={W} strokeWidth={sw} fill="none" strokeLinejoin="round" />
          <Path d="M12 25 V28 H26 V25" stroke={W} strokeWidth={sw} fill="none" />
          <Path d="M30 11 L34 19" stroke={W} strokeWidth={sw} strokeLinecap={cap} />
          <Path d="M32 10 L36 18" stroke={W} strokeWidth={sw} strokeLinecap={cap} />
        </Svg>
      );
    default:
      return (
        <Svg width={s} height={s} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={20} cy={20} r={11} stroke={W} strokeWidth={sw} fill="none" />
          <Path
            d="M20 12 Q25 12 25 16 Q25 19 20 21 V24 M20 27 V29"
            stroke={W}
            strokeWidth={2.2}
            fill="none"
            strokeLinecap={cap}
          />
        </Svg>
      );
  }
}

// ─── Map marker bubble (emoji / sticker, no pulse) ───────────────────────────
export function IncidentBubble({
  incident,
  latDelta = 0.02,
}: {
  incident: TrafficIncident;
  latDelta?: number;
}) {
  const cat = normalizeIncidentCategory(incident.category);
  const st = getStyle(cat);
  const size = markerSize(latDelta);
  if (size === 0) return null;

  const pad = 6;
  const outer = size + pad * 2;

  if (cat === 6) {
    return (
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <TrafficJamSticker diameter={Math.round(size * 1.06)} />
      </View>
    );
  }
  if (cat === 1) {
    return (
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <IncidentImageSticker diameter={Math.round(size * 1.06)} source={TRAFFIC_CRASH_MARKER} resizeMode="contain" padding={2} />
      </View>
    );
  }
  if (cat === 3) {
    return (
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <IncidentImageSticker diameter={Math.round(size * 1.06)} source={HAZARD_MARKER} resizeMode="contain" zoom={1.22} offsetY={-1} />
      </View>
    );
  }
  if (cat === 9) {
    return (
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <IncidentImageSticker diameter={Math.round(size * 1.06)} source={ROAD_WORK_MARKER} resizeMode="contain" zoom={1.22} offsetY={-1} />
      </View>
    );
  }
  if (cat === 11) {
    return (
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <IncidentImageSticker diameter={Math.round(size * 1.06)} source={FLOODING_MARKER} resizeMode="contain" zoom={1.18} />
      </View>
    );
  }

  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: st.color,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.94)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#00E5FF',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.35,
          shadowRadius: 5,
          elevation: 6,
        }}
      >
        <IncidentMapGlyph cat={cat} dim={size} />
      </View>
    </View>
  );
}

// ─── IncidentMarker ──────────────────────────────────────────────────────────
export function IncidentMarker({
  incident,
  latDelta = 0.02,
  onPress,
  zIndex = 800,
}: {
  incident: TrafficIncident;
  latDelta?: number;
  onPress: () => void;
  /** Keep incidents above route polylines / heatmap on Google Maps. */
  zIndex?: number;
}) {
  const cat = normalizeIncidentCategory(incident.category);
  const st = getStyle(cat);
  const anchorY = 0.5;

  return (
    <Marker
      coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
      anchor={{ x: 0.5, y: anchorY }}
      tracksViewChanges
      zIndex={zIndex}
      onPress={onPress}
    >
      <Pressable
        onPress={onPress}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={st.label}
      >
        <IncidentBubble incident={incident} latDelta={latDelta} />
      </Pressable>
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

  const cat = normalizeIncidentCategory(incident.category);
  const st = getStyle(cat);

  const delayLabel = incident.delay_seconds
    ? incident.delay_seconds >= 60
      ? `${Math.round(incident.delay_seconds / 60)} min delay`
      : `${incident.delay_seconds}s delay`
    : null;

  const road = incident.road?.length ? incident.road.join(' · ') : null;

  const D = 56;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={pop.backdrop} onPress={onClose}>
        <Animated.View style={[pop.sheet, { opacity, transform: [{ translateY: slideY }, { scale: sc }] }]}>

          <View style={[pop.topBar, { backgroundColor: st.color }]} />

          <View style={pop.handle} />

          <View style={pop.header}>

            <View style={pop.iconWrap}>
              <View style={[pop.iconGlow, { backgroundColor: st.color + '14', borderColor: st.color + '2E' }]} />
              {cat === 6 ? (
                <TrafficJamSticker diameter={D - 4} />
              ) : (
                <View
                  style={{
                    width: D,
                    height: D,
                    borderRadius: D / 2,
                    backgroundColor: st.color,
                    borderWidth: 1.5,
                    borderColor: 'rgba(255,255,255,0.95)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IncidentMapGlyph cat={cat} dim={D} />
                </View>
              )}
            </View>

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
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st.color }} />
                <Text style={[pop.severityText, { color: st.color }]}>
                  ADVISORY
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
    /* Previous: 'rgba(2,3,22,0.60)' */
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    /* Previous: '#07091E' */
    backgroundColor: '#111111',
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
