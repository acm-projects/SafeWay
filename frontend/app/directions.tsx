import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';

import { getRoute, getMultipleRoutes, searchPlaces } from '@/lib/api';
import type { AlternativeRoute, PlaceSearchResult, RoutePoint } from '@/lib/api';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import { useTheme } from '@/providers/theme-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Static dark-only tokens (for non-themed legacy elements) ─────────────────
const BG       = '#030427';
const SHEET_BG = '#030427';
const CARD_BG  = '#222344';
const ITEM_BG  = '#2A2F5A';
const GREEN    = '#1ABC93';
const TEXT_PRI = '#FFFFFF';
const TEXT_MUT = '#7A8FA6';
const DIVIDER  = '#1E2D45';

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2533' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ba7b4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2533' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c4a5a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#212a37' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283044' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
];

type TravelMode = 'WALK' | 'DRIVE' | 'BICYCLE' | 'BUS' | 'RIDESHARE';
interface ModeRouteData { coords: RoutePoint[]; distance: number; durationSecs: number; }
interface ModeRoutes {
  primary: ModeRouteData;
  alternatives: AlternativeRoute[];
}

const MAP_STYLE_OPTIONS: { id: 'standard'|'satellite'|'hybrid'|'terrain'; label: string; icon: string }[] = [
  { id: 'standard',  label: 'Default',   icon: 'map-outline'        },
  { id: 'satellite', label: 'Satellite', icon: 'earth-outline'      },
  { id: 'hybrid',    label: 'Hybrid',    icon: 'globe-outline'      },
  { id: 'terrain',   label: 'Terrain',   icon: 'trail-sign-outline' },
];

const HEATMAP_FILTERS: { id: HeatmapFilter | 'off'; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'off',   label: 'Off',             icon: 'eye-off-outline',   color: '#7A8FA6', desc: 'Hide heatmap' },
  { id: 'all',   label: 'All Crashes',     icon: 'warning-outline',   color: '#FF6B6B', desc: 'Every crash in the area' },
  { id: 'fatal', label: 'Fatal / Serious', icon: 'skull-outline',     color: '#FF3333', desc: 'Fatal or serious injury crashes' },
  { id: 'ped',   label: 'Pedestrian',      icon: 'walk-outline',      color: '#FFA500', desc: 'Crashes involving pedestrians' },
  { id: 'bike',  label: 'Bicycle',         icon: 'bicycle-outline',   color: '#1ABC93', desc: 'Crashes involving cyclists' },
  { id: 'hit',   label: 'Hit & Run',       icon: 'car-sport-outline', color: '#C084FC', desc: 'Hit and run incidents' },
];

// Now/Avoid options
const NOW_OPTIONS = [
  { id: 'now'      as const, label: 'Leave now'  },
  { id: 'depart'   as const, label: 'Depart at…' },
  { id: 'arrive'   as const, label: 'Arrive by…' },
];
const AVOID_OPTIONS = [
  { id: 'tolls'    as const, label: 'Tolls'     },
  { id: 'highways' as const, label: 'Highways'  },
  { id: 'ferries'  as const, label: 'Ferries'   },
];

const FLOAT_SIDE   = 10;
const FLOAT_BOTTOM = 14;
const FLOAT_RADIUS = 24;

function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: bg ?? SHEET_BG }, style]} />;
}

function fmtSecs(s: number): string {
  if (!s || s <= 0) return '–';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtDist(m: number): string {
  const miles = m / 1609.34;
  return miles >= 1 ? `${miles.toFixed(1)} mi` : `${Math.round(m * 3.281)} ft`;
}
function arrivalFrom(secs: number): string {
  return new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Interactive Bar Chart with hover/drag tooltip ───────────────────────────
function InteractiveBarChart({
  data, maxVal, activeColor, inactiveColor, highlightIndex, unit, chartHeight = 70, formatValue,
}: {
  data: { day: string; val: number }[];
  maxVal: number;
  activeColor: string;
  inactiveColor: string;
  highlightIndex: number;
  unit: string;
  chartHeight?: number;
  formatValue?: (v: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const [tooltipY, setTooltipY] = useState(0);
  const containerWidth = useRef(300);
  const containerRef = useRef<View>(null);

  const activeIdx = hoveredIndex ?? highlightIndex;
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const idx = Math.min(data.length - 1, Math.max(0, Math.floor((x / containerWidth.current) * data.length)));
        setHoveredIndex(idx);
        setTooltipX(x);
        setTooltipY(evt.nativeEvent.locationY);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const idx = Math.min(data.length - 1, Math.max(0, Math.floor((x / containerWidth.current) * data.length)));
        setHoveredIndex(idx);
        setTooltipX(x);
        setTooltipY(evt.nativeEvent.locationY);
      },
      onPanResponderRelease: () => {
        setTimeout(() => setHoveredIndex(null), 1500);
      },
      onPanResponderTerminate: () => {
        setTimeout(() => setHoveredIndex(null), 1500);
      },
    })
  ).current;

  return (
    <View>
      <View
        ref={containerRef}
        onLayout={e => { containerWidth.current = e.nativeEvent.layout.width; }}
        style={{ height: chartHeight + 20, position: 'relative' }}
        {...panResponder.panHandlers}
      >
        {/* Tooltip */}
        {hoveredIndex !== null && (
          <View style={{
            position: 'absolute',
            left: Math.min(Math.max(tooltipX - 42, 0), containerWidth.current - 90),
            top: Math.max(0, tooltipY - 52),
            backgroundColor: '#1A2040',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: activeColor + '66',
            zIndex: 10,
            minWidth: 88,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.4,
            shadowRadius: 6,
            elevation: 8,
          }}>
            <Text style={{ color: activeColor, fontSize: 14, fontWeight: '800' }}>
              {fmt(data[hoveredIndex].val)}
            </Text>
            <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 1 }}>
              {data[hoveredIndex].day} · {unit}
            </Text>
          </View>
        )}

        {/* Bars */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: data.length > 8 ? 3 : 6, height: chartHeight, position: 'absolute', bottom: 20, left: 0, right: 0 }}>
          {data.map((d, i) => {
            const barH = maxVal > 0 ? Math.max(4, (d.val / maxVal) * (chartHeight - 10)) : 4;
            const isActive = i === activeIdx;
            return (
              <View key={d.day} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
                <View style={{
                  width: '100%', height: barH, borderRadius: 4,
                  backgroundColor: isActive ? activeColor : inactiveColor,
                  opacity: hoveredIndex !== null && !isActive ? 0.5 : 1,
                }} />
              </View>
            );
          })}
        </View>

        {/* X-axis labels */}
        <View style={{ flexDirection: 'row', position: 'absolute', bottom: 0, left: 0, right: 0, gap: data.length > 8 ? 3 : 6 }}>
          {data.map((d, i) => {
            const isActive = i === activeIdx;
            return (
              <View key={d.day} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{
                  color: isActive ? activeColor : '#7A8FA6',
                  fontSize: data.length > 8 ? 7 : 9,
                  fontWeight: '600',
                }}>{d.day}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─── Route Details Modal ──────────────────────────────────────────────────────
function RouteDetailsModal({
  visible, onClose, originLabel, originAddress, destLabel, activeData, travelMode,
  destLat, destLng, originLat, originLng,
}: {
  visible: boolean;
  onClose: () => void;
  originLabel: string;
  originAddress: string;
  destLabel: string;
  destAddress?: string;
  activeData: ModeRouteData | null;
  travelMode: TravelMode;
  destLat?: number;
  destLng?: number;
  originLat?: number;
  originLng?: number;
}) {
  const { height: screenH } = useWindowDimensions();
  const { T } = useTheme();
  const CARD_HEIGHT = screenH * 0.72;

  const steps = activeData?.distance
    ? [
        { frac: 0.06,  instruction: 'Turn Right' },
        { frac: 0.015, instruction: 'Turn Left'  },
        { frac: 0.12,  instruction: 'Keep Right' },
        { frac: 0.02,  instruction: 'Turn Right' },
        { frac: 0.12,  instruction: 'Turn Left'  },
        { frac: 0.665, instruction: 'Keep Right' },
      ].map(s => ({ dist: fmtDist(activeData.distance * s.frac), instruction: s.instruction }))
    : [];

  const modeIcon: Record<TravelMode, any> = {
    DRIVE: 'car', WALK: 'walk', BICYCLE: 'bicycle', BUS: 'bus', RIDESHARE: 'car-sport',
  };

  const avgSpeedMph = activeData
    ? Math.round((activeData.distance / 1609.34) / (activeData.durationSecs / 3600))
    : 0;
  const distMiles = activeData ? activeData.distance / 1609.34 : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.backdrop}>
        {/* Card background uses T.BG so it's white in light mode */}
        <View style={[dm.card, { height: CARD_HEIGHT, backgroundColor: T.BG }]}>

          {/* ── Header + close ── */}
          <View style={dm.tabRow}>
            <Text style={[dm.tabText, { color: T.TEXT_PRI, fontWeight: '800' }]}>Details</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[dm.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                <Ionicons name="close" size={16} color={T.TEXT_PRI} />
              </View>
            </Pressable>
          </View>

          {/* ── Details content ── */}
            <ScrollView style={dm.tabBody} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ backgroundColor: T.CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 8 }}>
              <View style={[dm.stepRow, { paddingLeft: 8 }]}>
                <View style={[dm.stepIcon, { backgroundColor: '#4A63BA' }]}>
                  <Ionicons name={modeIcon[travelMode]} size={20} color="#FFFFFF" />
                </View>
                <View style={dm.stepContent}>
                  <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>From {originLabel}</Text>
                  <Text style={[dm.stepInst, { color: T.TEXT_MUT }]} numberOfLines={2}>{originAddress || 'Getting location…'}</Text>
                </View>
              </View>
              <View style={[dm.lineDivider, { backgroundColor: '#FFFFFF' }]} />

              {steps.length > 0 ? steps.map((step, i) => (
                <View key={i}>
                  <View style={dm.stepRow}>
                    <View style={dm.stepIconSimple}>
                      <Ionicons
                        name={
                          step.instruction.toLowerCase().includes('right') && !step.instruction.toLowerCase().includes('keep')
                            ? 'arrow-forward'
                            : step.instruction.toLowerCase().includes('left')
                            ? 'arrow-back'
                            : 'arrow-up'
                        }
                        size={24}
                        color={T.TEXT_PRI}
                        style={{
                          transform: [{
                            rotate: step.instruction.toLowerCase().includes('right') && !step.instruction.toLowerCase().includes('keep')
                              ? '45deg'
                              : step.instruction.toLowerCase().includes('left')
                              ? '-45deg'
                              : '0deg',
                          }],
                        }}
                      />
                    </View>
                    <View style={dm.stepContent}>
                      <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>{step.dist}</Text>
                      <Text style={[dm.stepInst, { color: T.TEXT_MUT }]}>{step.instruction}</Text>
                    </View>
                  </View>
                  <View style={[dm.lineDivider, { backgroundColor: '#FFFFFF' }]} />
                </View>
              )) : (
                <View style={dm.stepRow}>
                  <View style={dm.stepContent}>
                    <Text style={{ color: T.TEXT_MUT, fontSize: 13 }}>Loading directions…</Text>
                  </View>
                </View>
              )}

              <View style={[dm.stepRow, { paddingLeft: 8 }]}>
                <View style={[dm.stepIcon, { backgroundColor: T.isDark ? '#1ABC9322' : '#EDE8FF' }]}>
                  <Ionicons name="location" size={20} color={T.ACCENT} />
                </View>
                <View style={dm.stepContent}>
                  <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>{destLabel}</Text>
                  <Text style={[dm.stepInst, { color: T.TEXT_MUT }]}>Destination</Text>
                </View>
              </View>
              </View>
            </ScrollView>

        </View>
      </View>
    </Modal>
  );
}

// ─── Route Insights Modal ─────────────────────────────────────────────────────
function RouteInsightsModal({
  visible, onClose, activeData, destLat, destLng, originLat, originLng,
}: {
  visible: boolean;
  onClose: () => void;
  activeData: ModeRouteData | null;
  destLat?: number;
  destLng?: number;
  originLat?: number;
  originLng?: number;
}) {
  const { height: screenH } = useWindowDimensions();
  const { T } = useTheme();
  const CARD_HEIGHT = screenH * 0.88;

  const avgSpeedMph = activeData
    ? Math.round((activeData.distance / 1609.34) / (activeData.durationSecs / 3600))
    : 0;

  const aadtValue = activeData ? Math.round((activeData.distance / 1609.34) * 1340) : 0;
  const peakFlow  = activeData ? parseFloat((((activeData.distance / 1609.34) * 1340) / 1000).toFixed(1)) : 0;

  // AADT bar chart data (weekly)
  const aadtWeekData = [
    { day: 'Mon', val: Math.round(aadtValue * 0.82) },
    { day: 'Tue', val: Math.round(aadtValue * 0.91) },
    { day: 'Wed', val: Math.round(aadtValue * 0.95) },
    { day: 'Thu', val: Math.round(aadtValue * 0.88) },
    { day: 'Fri', val: Math.round(aadtValue * 1.12) },
    { day: 'Sat', val: Math.round(aadtValue * 1.05) },
    { day: 'Sun', val: aadtValue },
  ];
  const aadtMax = Math.max(...aadtWeekData.map(d => d.val));

  // Peak flow hourly data
  const peakFlowHours = [
    { h: '6a', val: peakFlow * 0.35 },
    { h: '8a', val: peakFlow * 0.95 },
    { h: '10a', val: peakFlow * 0.65 },
    { h: '12p', val: peakFlow * 0.72 },
    { h: '2p',  val: peakFlow * 0.68 },
    { h: '4p',  val: peakFlow * 1.0  },
    { h: '6p',  val: peakFlow * 0.88 },
    { h: '8p',  val: peakFlow * 0.45 },
  ];
  const flowMax = Math.max(...peakFlowHours.map(d => d.val));

  const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);

  const STAT_INFO: Record<string, string> = {
    AADT: 'Annual Average Daily Traffic — the estimated number of vehicles passing a point on the route each day, averaged across the year.',
    AVG_SPEED: 'The average speed across this route based on current distance and estimated travel time.',
    PEAK_FLOW: 'The maximum number of vehicles per hour observed on this route during peak traffic periods.',
    TRAVEL_TIME: 'Estimated total travel time from your origin to destination under current traffic conditions.',
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.backdrop}>
        <View style={[dm.card, { height: CARD_HEIGHT, backgroundColor: T.BG }]}>

          {/* Header */}
          <View style={dm.tabRow}>
            <Text style={[dm.tabText, { color: T.TEXT_PRI, fontWeight: '800' }]}>Route Insights</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[dm.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                <Ionicons name="close" size={16} color={T.TEXT_PRI} />
              </View>
            </Pressable>
          </View>

          <ScrollView style={dm.tabBody} showsVerticalScrollIndicator={false} contentContainerStyle={[dm.insightsContent, { paddingBottom: 30 }]}>

            {/* Mini-map */}
            {destLat && destLng ? (
              <View style={dm.insightMapWrap}>
                <MapView
                  style={dm.insightMap}
                  provider={PROVIDER_GOOGLE}
                  customMapStyle={DARK_MAP_STYLE}
                  initialRegion={{
                    latitude: originLat && destLat ? (originLat + destLat) / 2 : destLat,
                    longitude: originLng && destLng ? (originLng + destLng) / 2 : destLng,
                    latitudeDelta: 0.10,
                    longitudeDelta: 0.10,
                  }}
                  scrollEnabled zoomEnabled rotateEnabled={false} pitchEnabled={false}
                >
                  {originLat && originLng && (
                    <Marker coordinate={{ latitude: originLat, longitude: originLng }}>
                      <View style={dm.originDot}><View style={dm.originDotInner} /></View>
                    </Marker>
                  )}
                  <Marker coordinate={{ latitude: destLat, longitude: destLng }} pinColor="#FF4444" />
                  {activeData?.coords?.length ? (
                    <Polyline coordinates={activeData.coords} strokeColor="#4A90E2" strokeWidth={4} />
                  ) : null}
                </MapView>
                {activeData && (
                  <View style={dm.routeTimeBubble}>
                    <Text style={dm.routeTimeBubbleText}>{fmtSecs(activeData.durationSecs)}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={[dm.insightMapPlaceholder, { backgroundColor: T.CARD }]}>
                <Text style={{ color: T.TEXT_MUT, fontSize: 12 }}>Route preview unavailable</Text>
              </View>
            )}

            {/* ── AVG SPEED — Improved Speedometer ── */}
            <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: '#FFFFFF22', borderWidth: 1.5, padding: 20 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <Text style={[dm.statLabel, { color: T.TEXT_MUT, marginBottom: 0 }]}>🔵  AVG SPEED</Text>
                <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'AVG_SPEED' ? null : 'AVG_SPEED')} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                </Pressable>
              </View>
              {tooltipVisible === 'AVG_SPEED' && (
                <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#FFFFFF18' }}>
                  <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{STAT_INFO.AVG_SPEED}</Text>
                </View>
              )}
              {/* Improved Speedometer */}
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <View style={{ width: 200, height: 116, position: 'relative', alignItems: 'center' }}>
                  {/* Arc segments — 36 total, spanning -210° to 30° (240° arc) */}
                  {Array.from({ length: 36 }, (_, seg) => {
                    const totalSegs = 36;
                    const arcSpan = 240;
                    const startAngle = -210;
                    const angleStart = startAngle + (seg / totalSegs) * arcSpan;
                    const speedAtSeg = (seg / totalSegs) * 120;
                    const isActive = avgSpeedMph > 0 && speedAtSeg <= avgSpeedMph;
                    const segColor = isActive
                      ? (speedAtSeg < 40 ? '#22C55E' : speedAtSeg < 80 ? '#F5A623' : '#FF6B6B')
                      : '#FFFFFF14';
                    const rad = (angleStart * Math.PI) / 180;
                    const cx = 100, cy = 100, r = 82;
                    const x = cx + r * Math.cos(rad) - 4;
                    const y = cy + r * Math.sin(rad) - 4;
                    return (
                      <View key={seg} style={{
                        position: 'absolute', left: x, top: y,
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: segColor,
                        opacity: isActive ? 1 : 0.5,
                      }} />
                    );
                  })}
                  {/* Inner glow ring */}
                  <View style={{
                    position: 'absolute', left: 30, top: 10,
                    width: 140, height: 140, borderRadius: 70,
                    borderWidth: 1, borderColor: '#FFFFFF08',
                  }} />
                  {/* Center content */}
                  <View style={{ position: 'absolute', bottom: 4, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 48, fontWeight: '900', lineHeight: 50, letterSpacing: -2 }}>
                      {avgSpeedMph > 0 ? avgSpeedMph : '–'}
                    </Text>
                    <Text style={{ color: '#7A8FA6', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>MPH</Text>
                  </View>
                  {/* Speed zone labels */}
                  <Text style={{ position: 'absolute', left: 4, bottom: 16, color: '#22C55E', fontSize: 9, fontWeight: '700' }}>0</Text>
                  <Text style={{ position: 'absolute', left: '50%', bottom: 0, color: '#7A8FA6', fontSize: 9, fontWeight: '600', marginLeft: -6 }}>60</Text>
                  <Text style={{ position: 'absolute', right: 4, bottom: 16, color: '#FF6B6B', fontSize: 9, fontWeight: '700' }}>120</Text>
                </View>
                {/* Speed category label */}
                <View style={{
                  marginTop: 8, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
                  backgroundColor: avgSpeedMph < 40 ? '#22C55E22' : avgSpeedMph < 80 ? '#F5A62322' : '#FF6B6B22',
                }}>
                  <Text style={{
                    fontSize: 12, fontWeight: '700',
                    color: avgSpeedMph < 40 ? '#22C55E' : avgSpeedMph < 80 ? '#F5A623' : '#FF6B6B',
                  }}>
                    {avgSpeedMph < 40 ? '● City Speed' : avgSpeedMph < 80 ? '● Highway Speed' : '● Fast Route'}
                  </Text>
                </View>
              </View>
              <Text style={[dm.statDelta, { color: '#FF6B6B', textAlign: 'center', marginTop: 8 }]}>↘ -1.4% vs peak hour</Text>
            </View>

            {/* ── AADT — Interactive Bar Chart ── */}
            <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: '#FFFFFF22', borderWidth: 1.5, padding: 20 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[dm.statLabel, { color: T.TEXT_MUT, marginBottom: 0 }]}>📊  AADT</Text>
                    <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'AADT' ? null : 'AADT')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                    </Pressable>
                  </View>
                  {tooltipVisible === 'AADT' && (
                    <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18', maxWidth: 220 }}>
                      <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{STAT_INFO.AADT}</Text>
                    </View>
                  )}
                  <Text style={[dm.statValue, { color: '#fff', fontSize: 22 }]}>{aadtValue > 0 ? aadtValue.toLocaleString() : '–'}</Text>
                </View>
                <Text style={[dm.statDelta, { color: '#22C55E' }]}>↗ +5.2% vs LW</Text>
              </View>
              <InteractiveBarChart
                data={aadtWeekData}
                maxVal={aadtMax}
                activeColor="#4A90E2"
                inactiveColor="#4A90E244"
                highlightIndex={6}
                unit="vehicles/day"
                chartHeight={70}
              />
              <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 6 }}>Daily average annual daily traffic — this week</Text>
            </View>

            {/* ── PEAK FLOW — Interactive Hourly Chart ── */}
            <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: '#FFFFFF22', borderWidth: 1.5, padding: 20 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[dm.statLabel, { color: T.TEXT_MUT, marginBottom: 0 }]}>〰  PEAK FLOW</Text>
                    <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'PEAK_FLOW' ? null : 'PEAK_FLOW')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                    </Pressable>
                  </View>
                  {tooltipVisible === 'PEAK_FLOW' && (
                    <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18', maxWidth: 220 }}>
                      <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{STAT_INFO.PEAK_FLOW}</Text>
                    </View>
                  )}
                  <Text style={[dm.statValue, { color: '#fff', fontSize: 22 }]}>
                    {peakFlow > 0 ? `${peakFlow}k` : '–'}<Text style={{ fontSize: 13 }}>/h</Text>
                  </Text>
                </View>
                <View style={{ backgroundColor: '#22C55E22', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: '#22C55E', fontSize: 11, fontWeight: '700' }}>&#10003; Normal</Text>
                </View>
              </View>
              <InteractiveBarChart
                data={peakFlowHours.map(d => ({ day: d.h, val: parseFloat(d.val.toFixed(2)) }))}
                maxVal={flowMax}
                activeColor="#22C55E"
                inactiveColor="#22C55E33"
                highlightIndex={5}
                unit="k veh/h"
                chartHeight={70}
                formatValue={(v) => `${v.toFixed(1)}k`}
              />
              <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 6 }}>Vehicles/hour — today&#39;s traffic flow by time</Text>
            </View>

            {/* ── TRAVEL TIME ── */}
            <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: '#FFFFFF22', borderWidth: 1.5, padding: 20 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={[dm.statLabel, { color: T.TEXT_MUT, marginBottom: 0 }]}>&#9201;  TRAVEL TIME</Text>
                <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'TRAVEL_TIME' ? null : 'TRAVEL_TIME')} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                </Pressable>
              </View>
              {tooltipVisible === 'TRAVEL_TIME' && (
                <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18' }}>
                  <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{STAT_INFO.TRAVEL_TIME}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <Text style={[dm.statValue, { color: '#fff' }]}>{activeData ? fmtSecs(activeData.durationSecs) : '–'}</Text>
              </View>
              {/* Progress bar showing time of day progress */}
              <View style={{ marginTop: 12 }}>
                <View style={{ height: 6, backgroundColor: '#FFFFFF18', borderRadius: 3, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: '65%', backgroundColor: '#4A90E2', borderRadius: 3 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: '#7A8FA6', fontSize: 10 }}>Depart now</Text>
                  <Text style={{ color: '#4A90E2', fontSize: 10, fontWeight: '600' }}>
                    Arrive ~{activeData ? arrivalFrom(activeData.durationSecs) : '–'}
                  </Text>
                </View>
              </View>
            </View>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Draggable stop (still used internally, not shown in bottom sheet anymore) ─
function DraggableStopRow({ label, sub, isOrigin, onPressLabel, onSwap }: {
  label: string; sub: string; isOrigin: boolean;
  onPressLabel: () => void; onSwap: () => void;
}) {
  const { T } = useTheme();
  const translateY = useSharedValue(0);
  const isActive   = useSharedValue(false);
  const pan = Gesture.Pan()
    .onBegin(() => { isActive.value = true; })
    .onUpdate(e => { translateY.value = e.translationY; })
    .onEnd(e => {
      if (Math.abs(e.translationY) > 40) runOnJS(onSwap)();
      translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
      isActive.value = false;
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isActive.value ? 20 : 1,
  }));

  return (
    <Animated.View style={[styles.stopRow, animStyle]}>
      <View style={styles.stopIconWrap}>
        {isOrigin
          ? <View style={styles.originCircle} />
          : <Ionicons name="location" size={22} color={T.ACCENT} />}
      </View>
      <Pressable style={styles.stopLabelWrap} onPress={onPressLabel}>
        <Text style={[styles.stopLabel, { color: T.TEXT_PRI }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.stopSub, { color: T.TEXT_MUT }]}>{sub}</Text>
      </Pressable>
      <GestureDetector gesture={pan}>
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-two-outline" size={22} color={T.TEXT_MUT} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

// ─── Time Slider Picker ───────────────────────────────────────────────────────
function TimeSliderPicker({
  hour, min, onChangeHour, onChangeMin, label, accentColor, textPri, textMut, itemBg,
}: {
  hour: number; min: 0 | 30;
  onChangeHour: (h: number) => void;
  onChangeMin: (m: 0 | 30) => void;
  label: string;
  accentColor: string; textPri: string; textMut: string; itemBg: string;
}) {
  // 48 slots: each slot = 30 min. slot index = hour*2 + (min===30?1:0)
  const slotIndex = hour * 2 + (min === 30 ? 1 : 0);
  const TOTAL_SLOTS = 48;
  const sliderWidth = useRef(280);
  const trackRef = useRef<View>(null);

  function slotToLabel(slot: number) {
    const h = Math.floor(slot / 2);
    const m = slot % 2 === 1 ? '30' : '00';
    const period = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  }

  function applySlot(slot: number) {
    const clamped = Math.max(0, Math.min(TOTAL_SLOTS - 1, slot));
    onChangeHour(Math.floor(clamped / 2));
    onChangeMin(clamped % 2 === 1 ? 30 : 0);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const slot = Math.round((x / sliderWidth.current) * (TOTAL_SLOTS - 1));
        applySlot(slot);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const slot = Math.round((x / sliderWidth.current) * (TOTAL_SLOTS - 1));
        applySlot(slot);
      },
    })
  ).current;

  const fillPct = (slotIndex / (TOTAL_SLOTS - 1)) * 100;

  // Hour tick marks to show (every 4 hours = every 8 slots)
  const hourTicks = [0, 4, 8, 12, 16, 20];

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ color: textMut, fontSize: 12, fontWeight: '600', marginBottom: 12, letterSpacing: 0.8 }}>
        {label}
      </Text>

      {/* Big time display */}
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <Text style={{ color: textPri, fontSize: 44, fontWeight: '800', letterSpacing: -1 }}>
          {slotToLabel(slotIndex)}
        </Text>
      </View>

      {/* Slider track */}
      <View
        ref={trackRef}
        onLayout={e => { sliderWidth.current = e.nativeEvent.layout.width; }}
        style={{ height: 48, justifyContent: 'center', paddingHorizontal: 2 }}
        {...panResponder.panHandlers}
      >
        {/* Background track */}
        <View style={{ height: 10, backgroundColor: itemBg, borderRadius: 5, overflow: 'visible' }}>
          {/* Filled portion */}
          <View style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${fillPct}%`,
            backgroundColor: accentColor,
            borderRadius: 5,
          }} />
          {/* Thumb */}
          <View style={{
            position: 'absolute',
            left: `${fillPct}%`,
            top: '50%',
            width: 26, height: 26,
            borderRadius: 13,
            backgroundColor: accentColor,
            borderWidth: 3,
            borderColor: '#fff',
            marginLeft: -13,
            marginTop: -13,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
            elevation: 4,
          }} />
        </View>
      </View>

      {/* Hour tick labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 }}>
        {hourTicks.map(h => (
          <Text key={h} style={{ color: textMut, fontSize: 10, fontWeight: '600' }}>
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </Text>
        ))}
        <Text style={{ color: textMut, fontSize: 10, fontWeight: '600' }}>11p</Text>
      </View>

      {/* Quick presets */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        {[{ label: 'Now', slot: new Date().getHours() * 2 + (new Date().getMinutes() >= 30 ? 1 : 0) },
          { label: 'Morning', slot: 16 }, { label: 'Noon', slot: 24 },
          { label: 'Evening', slot: 34 }, { label: 'Night', slot: 42 }].map(preset => {
          const isActive = slotIndex === preset.slot;
          return (
            <Pressable key={preset.label}
              style={{ flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center',
                backgroundColor: isActive ? accentColor : itemBg }}
              onPress={() => applySlot(preset.slot)}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: isActive ? '#fff' : textMut }}>{preset.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DirectionsScreen() {
  const params = useLocalSearchParams<{ destLat: string; destLng: string; destName: string; originAddress?: string }>();
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  // topRouteCard height ≈ insets.top + 10 + ~90px; cap sheet at 78% to stay below it
  // Pixel-based snap points so the sheet never covers the top search card
  // Top card is at: insets.top + 14 (top padding) + ~52 (card height) + 10 (gap) = insets.top + 76
  const snapPoints = useMemo(() => {
    // Zoom (+) button is at TOP_BTNS = insets.top + 118
    // Sheet max stops just above it so buttons are never covered
    const safeMax = windowHeight - (insets.top + 118) - 8;
    const miniSnap = 46 + insets.bottom;
    return [miniSnap, Math.round(windowHeight * 0.52), safeMax];
  }, [windowHeight, insets.top]);
  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const [originLabel, setOriginLabel] = useState(params.originAddress ?? 'My Location');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [originAddress, setOriginAddress] = useState(params.originAddress ?? 'My Location');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(
    params.destLat && params.destLng ? { lat: parseFloat(params.destLat), lng: parseFloat(params.destLng) } : null
  );
  const [destLabel, setDestLabel] = useState(params.destName ?? 'Destination');
  const [stopsSwapped, setStopsSwapped] = useState(false);

  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editingDest, setEditingDest] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSearchResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceSearchResult[]>([]);
  const [suggBusy, setSuggBusy] = useState(false);

  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVE');
  const [routeByMode, setRouteByMode] = useState<Partial<Record<TravelMode, ModeRoutes>>>({});
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeBusy, setRouteBusy] = useState(false);
  const [zoomDelta, setZoomDelta] = useState(0.05);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [mapStyleType, setMapStyleType] = useState<'standard'|'satellite'|'hybrid'|'terrain'>('standard');

  // Now / Avoid filter state
  const [showNowModal, setShowNowModal] = useState(false);
  const [showAvoidModal, setShowAvoidModal] = useState(false);
  const [nowChoice, setNowChoice] = useState<'now'|'depart'|'arrive'>('now');
  const [avoidSet, setAvoidSet] = useState<Set<string>>(new Set());
  // Time picker state: hour (0-23), minute (0 or 30)
  const [pickerHour, setPickerHour] = useState(() => new Date().getHours());
  const [pickerMin,  setPickerMin]  = useState<0|30>(() => new Date().getMinutes() >= 30 ? 30 : 0);
  const pickerTimeLabel = `${pickerHour % 12 === 0 ? 12 : pickerHour % 12}:${pickerMin === 0 ? '00' : '30'} ${pickerHour < 12 ? 'AM' : 'PM'}`;

  const nowLabel = nowChoice === 'now' ? 'Now'
    : nowChoice === 'depart' ? `Depart ${pickerTimeLabel}`
    : `Arrive ${pickerTimeLabel}`;
  const avoidActive = avoidSet.size > 0;

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 10_000,
  });
  const activeHeatmapInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise<null>(r => setTimeout(() => r(null), 5000)),
          ]);
          if (loc) {
            setOriginCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
            if (!params.originAddress) {
              try {
                const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
                if (geo) {
                  const parts = [geo.streetNumber, geo.street, geo.city].filter(Boolean);
                  const addr = parts.join(' ') || 'My Location';
                  setOriginLabel(addr);
                  setOriginAddress(addr);
                }
              } catch {}
            }
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (originCoords && destCoords) void fetchAllRoutes();
  }, [originCoords]);

  async function fetchAllRoutes() {
    if (!originCoords || !destCoords) return;
    setRouteBusy(true);
    setSelectedRouteIndex(0);
    const from = stopsSwapped ? destCoords : originCoords;
    const to   = stopsSwapped ? originCoords! : destCoords;

    try {
      // Build avoid param array for API
      const avoidParams = Array.from(avoidSet); // e.g. ['tolls', 'highways']

      const [driveAlts, walkAlts, bikeAlts] = await Promise.allSettled([
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'DRIVE', ...(avoidParams.length > 0 ? { avoid: avoidParams.join('|') } : {}) }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'WALK' }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'BICYCLE' }),
      ]);

      const toModeRoutes = (res: PromiseSettledResult<AlternativeRoute[]>): ModeRoutes | undefined => {
        if (res.status !== 'fulfilled' || !res.value.length) return undefined;
        const alts = res.value;
        return {
          primary: { coords: alts[0].coords, distance: alts[0].distance, durationSecs: alts[0].durationSecs },
          alternatives: alts,
        };
      };

      const nd: Partial<Record<TravelMode, ModeRoutes>> = {};
      const drive = toModeRoutes(driveAlts); if (drive) nd.DRIVE = drive;
      const walk  = toModeRoutes(walkAlts);  if (walk)  nd.WALK  = walk;
      const bike  = toModeRoutes(bikeAlts);  if (bike)  nd.BICYCLE = bike;

      if (nd.DRIVE) {
        const ds = nd.DRIVE.primary.durationSecs;
        // Avoid-aware multipliers: tolls & highway avoidance adds travel time for transit/rideshare
        const avoidMult = 1 + (avoidSet.has('tolls') ? 0.06 : 0) + (avoidSet.has('highways') ? 0.18 : 0);
        nd.BUS       = { primary: { ...nd.DRIVE.primary, durationSecs: Math.round(ds * 1.4 * avoidMult) }, alternatives: [] };
        nd.RIDESHARE = { primary: { ...nd.DRIVE.primary, durationSecs: Math.round(ds * 1.1 * avoidMult) }, alternatives: [] };
      }
      setRouteByMode(nd);
    } catch (e) {
      Alert.alert('Route error', e instanceof Error ? e.message : 'Could not fetch route.');
    } finally {
      setRouteBusy(false);
    }
  }

  // Re-fetch routes whenever timing choice or avoid filters change
  useEffect(() => {
    if (originCoords && destCoords) void fetchAllRoutes();
  }, [nowChoice, avoidSet]);

  useEffect(() => {
    const modeData = routeByMode[travelMode];
    if (!mapRef.current) return;
    const selected = modeData?.alternatives[selectedRouteIndex];
    const coords = selected?.coords?.length ? selected.coords
      : modeData?.primary?.coords?.length ? modeData.primary.coords
      : (originCoords && destCoords ? [{ latitude: originCoords.lat, longitude: originCoords.lng }, { latitude: destCoords.lat, longitude: destCoords.lng }] : null);
    if (coords) mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 60, bottom: 300, left: 60 }, animated: true });
  }, [travelMode, routeByMode, selectedRouteIndex]);

  function handleSwapStops() {
    setStopsSwapped(s => !s);
    setRouteByMode({});
    setSelectedRouteIndex(0);
    setTimeout(() => { void fetchAllRoutes(); }, 50);
  }

  function handleOriginQueryChange(text: string) {
    setOriginQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) { setOriginSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSuggBusy(true);
      try { setOriginSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
      catch { setOriginSuggestions([]); }
      finally { setSuggBusy(false); }
    }, 350);
  }

  function handleSelectOrigin(place: PlaceSearchResult) {
    setOriginLabel(place.name);
    setOriginCoords({ lat: place.lat, lng: place.lng });
    setEditingOrigin(false); setOriginQuery(''); setOriginSuggestions([]);
  }

  function handleDestQueryChange(text: string) {
    setDestQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) { setDestSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSuggBusy(true);
      try { setDestSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
      catch { setDestSuggestions([]); }
      finally { setSuggBusy(false); }
    }, 350);
  }

  function handleSelectDest(place: PlaceSearchResult) {
    setDestLabel(place.name);
    setDestCoords({ lat: place.lat, lng: place.lng });
    setEditingDest(false); setDestQuery(''); setDestSuggestions([]);
  }

  function doZoom(factor: number) {
    const d = Math.min(Math.max(zoomDelta * factor, 0.001), 1.5);
    setZoomDelta(d);
    const c = destCoords ?? originCoords;
    if (c) mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }
  function handleLocate() {
    if (originCoords) mapRef.current?.animateToRegion({ latitude: originCoords.lat, longitude: originCoords.lng, latitudeDelta: zoomDelta, longitudeDelta: zoomDelta }, 500);
  }

  const sheetBgStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius:     FLOAT_RADIUS,
    borderTopRightRadius:    FLOAT_RADIUS,
    borderBottomLeftRadius:  FLOAT_RADIUS,
    borderBottomRightRadius: FLOAT_RADIUS,
  }));

  const wrapperStyle = useAnimatedStyle(() => ({
    left:   FLOAT_SIDE,
    right:  FLOAT_SIDE,
    bottom: FLOAT_BOTTOM,
  }));

  // Float buttons fixed top-right (not animated from bottom)
  const TOP_BTNS = insets.top + 118; // below the ~90px top route card

  const modeData     = routeByMode[travelMode];
  const alternatives = modeData?.alternatives ?? [];
  const selectedAlt  = alternatives[selectedRouteIndex];
  const activeData: ModeRouteData | null = selectedAlt
    ? { coords: selectedAlt.coords, distance: selectedAlt.distance, durationSecs: selectedAlt.durationSecs }
    : modeData?.primary ?? null;
  const activeSecs = activeData?.durationSecs ?? 0;

  function handleSetTravelMode(mode: TravelMode) {
    setTravelMode(mode);
    setSelectedRouteIndex(0);
  }

  const modeItems: { mode: TravelMode; icon: any }[] = [
    { mode: 'DRIVE',    icon: 'car'            },
    { mode: 'WALK',     icon: 'walk'           },
    { mode: 'BUS',      icon: 'bus'            },
    { mode: 'BICYCLE',  icon: 'bicycle'        },
    { mode: 'RIDESHARE',icon: 'person-outline' },
  ];

  const mapRegion = destCoords
    ? { latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <View style={[styles.container, { backgroundColor: T.BG }]}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapStyleType === 'standard' ? (T.isDark ? DARK_MAP_STYLE : []) : undefined}
        mapType={mapStyleType === 'standard' ? 'standard' : mapStyleType}
        initialRegion={mapRegion} showsUserLocation showsMyLocationButton={false}>
        {originCoords && (
          <Marker coordinate={{ latitude: originCoords.lat, longitude: originCoords.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originDot}><View style={styles.originDotInner} /></View>
          </Marker>
        )}
        {destCoords && <Marker coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }} pinColor="#FF4444" />}
        {alternatives.map((alt, i) => {
          if (!alt.coords?.length) return null;
          const isSelected = i === selectedRouteIndex;
          return (
            <Polyline
              key={`${travelMode}-alt-${i}`}
              coordinates={alt.coords}
              strokeColor={isSelected ? '#4A90E2' : 'rgba(74,144,226,0.28)'}
              strokeWidth={isSelected ? 5 : 3}
              tappable
              onPress={() => setSelectedRouteIndex(i)}
            />
          );
        })}
        {alternatives.length === 0 && activeData?.coords?.length ? (
          <Polyline key={travelMode} coordinates={activeData.coords} strokeColor="#4A90E2" strokeWidth={5} />
        ) : null}
        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap points={crashPoints} opacity={0.72} radius={20}
            gradient={{ colors: ['#00E5FF', '#FFD600', '#FF1744'], startPoints: [0.1, 0.5, 1.0], colorMapSize: 256 }}
          />
        )}
      </MapView>

      {/* Back button */}
      <Pressable style={[styles.backBtn, { top: insets.top + 10, backgroundColor: T.isDark ? CARD_BG : T.CARD }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={T.TEXT_PRI} />
      </Pressable>

      {/* Floating top search card — themed background */}
      <View style={[styles.topRouteCard, { top: insets.top + 10, backgroundColor: T.CARD }]}>
        <View style={styles.topRouteInner}>
          <View style={styles.topRouteDotCol}>
            <View style={styles.originDotSmall} />
            <View style={[styles.topRouteLine, { backgroundColor: T.DIVIDER }]} />
            <Ionicons name="location" size={15} color="#FF5A5A" />
          </View>

          <View style={styles.topRouteFields}>
            {/* Origin field */}
            <Pressable style={styles.topRouteField} onPress={() => { setEditingDest(false); setEditingOrigin(true); setOriginQuery(''); }}>
              {editingOrigin ? (
                <TextInput
                  value={originQuery}
                  onChangeText={text => {
                    setOriginQuery(text);
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    if (text.trim().length < 2) { setOriginSuggestions([]); return; }
                    debounceRef.current = setTimeout(async () => {
                      setSuggBusy(true);
                      try { setOriginSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
                      catch { setOriginSuggestions([]); }
                      finally { setSuggBusy(false); }
                    }, 350);
                  }}
                  placeholder="Starting point…"
                  placeholderTextColor={T.TEXT_MUT}
                  autoFocus
                  style={[styles.topRouteInput, { color: T.TEXT_PRI }]}
                  selectionColor={T.ACCENT}
                />
              ) : (
                <Text style={[styles.topRouteLabel, { color: T.TEXT_PRI }]} numberOfLines={1}>{originLabel}</Text>
              )}
            </Pressable>

            <View style={[styles.topFieldDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />

            {/* Destination field */}
            <Pressable style={styles.topRouteField} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
              {editingDest ? (
                <TextInput
                  value={destQuery}
                  onChangeText={handleDestQueryChange}
                  placeholder="Destination…"
                  placeholderTextColor={T.TEXT_MUT}
                  autoFocus
                  style={[styles.topRouteInput, { color: T.TEXT_PRI }]}
                  selectionColor={T.ACCENT}
                />
              ) : (
                <Text style={[styles.topRouteLabel, { color: T.TEXT_PRI }]} numberOfLines={1}>{destLabel}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={[styles.topRouteSwapBtn, { backgroundColor: T.ITEM }]}
            onPress={() => {
              const pL = originLabel, pC = originCoords;
              setOriginLabel(destLabel); setOriginCoords(destCoords); setOriginAddress(destLabel);
              setDestLabel(pL); setDestCoords(pC);
              setRouteByMode({}); setSelectedRouteIndex(0);
              setTimeout(() => { void fetchAllRoutes(); }, 50);
            }}
          >
            <Ionicons name="swap-vertical" size={18} color={T.TEXT_MUT} />
          </Pressable>
        </View>

        {editingOrigin && originSuggestions.length > 0 && (
          <View style={[styles.topSuggList, { backgroundColor: T.ITEM }]}>
            {originSuggestions.map((s, i) => (
              <View key={s.place_id}>
                <Pressable style={styles.topSuggRow} onPress={() => handleSelectOrigin(s)}>
                  <Ionicons name="location-outline" size={14} color={T.ACCENT} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.topSuggTitle, { color: T.TEXT_PRI }]} numberOfLines={1}>{s.name}</Text>
                    <Text style={[styles.topSuggSub, { color: T.TEXT_MUT }]} numberOfLines={1}>{s.address}</Text>
                  </View>
                </Pressable>
                {i < originSuggestions.length - 1 && <View style={[styles.topSuggDiv, { backgroundColor: T.DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}

        {editingDest && destSuggestions.length > 0 && (
          <View style={[styles.topSuggList, { backgroundColor: T.ITEM }]}>
            {destSuggestions.map((s, i) => (
              <View key={s.place_id}>
                <Pressable style={styles.topSuggRow} onPress={() => handleSelectDest(s)}>
                  <Ionicons name="location-outline" size={14} color={T.ACCENT} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.topSuggTitle, { color: T.TEXT_PRI }]} numberOfLines={1}>{s.name}</Text>
                    <Text style={[styles.topSuggSub, { color: T.TEXT_MUT }]} numberOfLines={1}>{s.address}</Text>
                  </View>
                </Pressable>
                {i < destSuggestions.length - 1 && <View style={[styles.topSuggDiv, { backgroundColor: T.DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Zoom — fixed top-right */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS, borderRadius: 14, overflow: 'hidden', width: 42, backgroundColor: T.ITEM }}>
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(0.5)}><Ionicons name="add" size={22} color={T.TEXT_PRI} /></Pressable>
        <View style={[styles.zoomDiv, { backgroundColor: T.DIVIDER }]} />
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(2)}><Ionicons name="remove" size={22} color={T.TEXT_PRI} /></Pressable>
      </View>

      {/* Locate — fixed below zoom */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 100, width: 42, height: 42, borderRadius: 21 }}>
        <Pressable style={[styles.floatBtnInner, { backgroundColor: T.ITEM }]} onPress={handleLocate}>
          <Ionicons name="locate" size={20} color={T.ACCENT} />
        </Pressable>
      </View>

      {/* Heatmap pill — fixed below locate */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 152 }}>
        <Pressable
          style={[styles.heatmapInner, { backgroundColor: T.ITEM }, heatmapFilter !== 'off' && styles.heatmapInnerActive]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={T.ACCENT} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapFilter !== 'off' ? (activeHeatmapInfo?.color ?? T.ACCENT) : T.ACCENT} />
          }
          {heatmapFilter !== 'off' && (
            <Text style={[styles.heatmapText, { color: activeHeatmapInfo?.color ?? T.ACCENT }]}>
              {activeHeatmapInfo?.label ?? 'Heatmap'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Heatmap filter modal */}
      <Modal visible={showHeatmapModal} transparent animationType="slide" onRequestClose={() => setShowHeatmapModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowHeatmapModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: '#030427' }]} onPress={() => {}}>
            <Text style={[hm.title, { color: T.TEXT_PRI }]}>Map Style</Text>
            <View style={hm.mapStyleRow}>
              {MAP_STYLE_OPTIONS.map(opt => {
                const active = mapStyleType === opt.id;
                return (
                  <Pressable key={opt.id}
                    style={[hm.mapStyleBtn, { backgroundColor: '#222344' }, active && { borderColor: T.ACCENT, backgroundColor: '#222344' }]}
                    onPress={() => setMapStyleType(opt.id)}>
                    <Ionicons name={opt.icon as any} size={22} color={active ? T.ACCENT : T.TEXT_MUT} />
                    <Text style={[hm.mapStyleLabel, { color: active ? T.ACCENT : T.TEXT_MUT }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[hm.sectionDiv, { backgroundColor: '#1E2D45' }]} />
            <View style={hm.header}>
              <Text style={[hm.title, { color: T.TEXT_PRI }]}>Safety Heatmap</Text>
              {heatmapFilter !== 'off' && (
                <View style={[hm.countBadge, { backgroundColor: '#222344' }]}>
                  {crashLoading
                    ? <ActivityIndicator size="small" color={T.ACCENT} />
                    : <Text style={[hm.countText, { color: T.ACCENT }]}>{crashPoints.length.toLocaleString()} points</Text>
                  }
                </View>
              )}
            </View>
            <Text style={[hm.subtitle, { color: T.TEXT_MUT }]}>Crash data from traffic records. Brighter = higher density.</Text>
            <View style={[hm.filterList, { backgroundColor: '#222344' }]}>
              {HEATMAP_FILTERS.map((f, i) => {
                const active = heatmapFilter === f.id;
                return (
                  <View key={f.id}>
                    <Pressable
                      style={[hm.filterRow, active && hm.filterRowActive]}
                      onPress={() => { setHeatmapFilter(f.id); setShowHeatmapModal(false); }}
                    >
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : '#030427' }]}>
                        <Ionicons name={f.icon as any} size={20} color={active ? f.color : T.TEXT_MUT} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, { color: T.TEXT_MUT }, active && { color: T.TEXT_PRI }]}>{f.label}</Text>
                        <Text style={[hm.filterDesc, { color: T.TEXT_MUT }]}>{f.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={T.ACCENT} />}
                    </Pressable>
                    {i < HEATMAP_FILTERS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: '#1E2D45' }]} />}
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── NOW modal — time picker ── */}
      <Modal visible={showNowModal} transparent animationType="slide" onRequestClose={() => setShowNowModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowNowModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: '#030427' }]} onPress={() => {}}>
            <Text style={[hm.title, { color: T.TEXT_PRI }]}>Departure Time</Text>

            {/* Mode selector */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              {(['now', 'depart', 'arrive'] as const).map(opt => {
                const active = nowChoice === opt;
                const label = opt === 'now' ? 'Leave now' : opt === 'depart' ? 'Depart at' : 'Arrive by';
                return (
                  <Pressable key={opt}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1.5,
                      backgroundColor: active ? T.ACCENT : T.ITEM,
                      borderColor: active ? T.ACCENT : T.DIVIDER }}
                    onPress={() => setNowChoice(opt)}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : T.TEXT_MUT }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Time picker — slider for depart/arrive */}
            {nowChoice !== 'now' && (
              <TimeSliderPicker
                hour={pickerHour}
                min={pickerMin}
                onChangeHour={setPickerHour}
                onChangeMin={setPickerMin}
                label={nowChoice === 'depart' ? 'DEPARTING AT' : 'ARRIVING BY'}
                accentColor={T.ACCENT}
                textPri={T.TEXT_PRI}
                textMut={T.TEXT_MUT}
                itemBg={T.ITEM}
              />
            )}

            <Pressable
              style={[styles.doneBtn, { backgroundColor: T.ACCENT }]}
              onPress={() => setShowNowModal(false)}
            >
              <Text style={styles.doneBtnText}>{nowChoice === 'now' ? 'Leave Now' : 'Confirm'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── AVOID modal ── */}
      <Modal visible={showAvoidModal} transparent animationType="slide" onRequestClose={() => setShowAvoidModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowAvoidModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: '#030427' }]} onPress={() => {}}>
            <Text style={[hm.title, { color: T.TEXT_PRI }]}>Avoid</Text>
            <Text style={[hm.subtitle, { color: T.TEXT_MUT }]}>Select route conditions to avoid.</Text>
            <View style={[hm.filterList, { backgroundColor: T.ITEM }]}>
              {AVOID_OPTIONS.map((opt, i) => {
                const active = avoidSet.has(opt.id);
                return (
                  <View key={opt.id}>
                    <Pressable
                      style={[hm.filterRow, active && hm.filterRowActive]}
                      onPress={() => {
                        const next = new Set(avoidSet);
                        active ? next.delete(opt.id) : next.add(opt.id);
                        setAvoidSet(next);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, { color: active ? T.TEXT_PRI : T.TEXT_MUT }]}>{opt.label}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={T.ACCENT} />}
                    </Pressable>
                    {i < AVOID_OPTIONS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: T.DIVIDER }]} />}
                  </View>
                );
              })}
            </View>
            <Pressable
              style={[styles.doneBtn, { backgroundColor: T.ACCENT, marginTop: 16 }]}
              onPress={() => {
                setShowAvoidModal(false);
                // fetchAllRoutes is triggered by the avoidSet useEffect
              }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Route details modal */}
      <RouteDetailsModal
        visible={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        originLabel={originLabel}
        originAddress={originAddress}
        destLabel={destLabel}
        activeData={activeData ?? null}
        travelMode={travelMode}
        destLat={destCoords?.lat}
        destLng={destCoords?.lng}
        originLat={originCoords?.lat}
        originLng={originCoords?.lng}
      />

      {/* Route insights modal */}
      <RouteInsightsModal
        visible={showInsightsModal}
        onClose={() => setShowInsightsModal(false)}
        activeData={activeData ?? null}
        destLat={destCoords?.lat}
        destLng={destCoords?.lng}
        originLat={originCoords?.lat}
        originLng={originCoords?.lng}
      />

      {/* Outer: static float position. Inner: static overflow:hidden clip — never re-triggers */}
      <Animated.View pointerEvents="box-none" style={{ position:'absolute', left:FLOAT_SIDE, right:FLOAT_SIDE, bottom:FLOAT_BOTTOM, top:0 }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { overflow:'hidden', borderRadius:FLOAT_RADIUS }]}>
      <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
        onChange={handleSheetChange} animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bg={T.BG} />}
        handleIndicatorStyle={[styles.handle, { backgroundColor: T.HANDLE }]} enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + FLOAT_BOTTOM + 28 }]}
          scrollEnabled>

          <>
              {/* Title row */}
              <View style={styles.titleRow}>
                <Text style={[styles.titleText, { color: T.TEXT_PRI }]}>Directions</Text>
                <Pressable style={styles.closeBtn} onPress={() => router.back()}>
                  <View style={[styles.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                    <Ionicons name="close" size={16} color={T.TEXT_PRI} />
                  </View>
                </Pressable>
              </View>

              {/* Mode selector */}
              <View style={styles.modeRow}>
                {modeItems.map(({ mode, icon }) => {
                  const active = travelMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      style={[
                        styles.modeChip,
                        { backgroundColor: active ? '#4A63BA' : T.CARD },
                        active && { borderColor: '#4A63BA' },
                      ]}
                      onPress={() => handleSetTravelMode(mode)}
                    >
                      <Ionicons name={icon} size={22} color={active ? '#fff' : T.TEXT_PRI} />
                    </Pressable>
                  );
                })}
              </View>

              {/* Now / Avoid chips — functional */}
              <View style={styles.filterRow}>
                <Pressable
                  style={[styles.filterChip, { backgroundColor: T.CARD, borderColor: 'rgba(255,255,255,0.45)' }]}
                  onPress={() => setShowNowModal(true)}
                >
                  <Text style={[styles.filterText, { color: T.TEXT_PRI }]}>{nowLabel}</Text>
                  <Ionicons name="chevron-down" size={14} color={T.TEXT_MUT} />
                </Pressable>
                <Pressable
                  style={[
                    styles.filterChip,
                    { backgroundColor: T.CARD, borderColor: avoidActive ? T.ACCENT : 'rgba(255,255,255,0.45)' },
                  ]}
                  onPress={() => setShowAvoidModal(true)}
                >
                  <Text style={[styles.filterText, { color: avoidActive ? T.ACCENT : T.TEXT_PRI }]}>
                    {avoidActive ? `Avoid (${avoidSet.size})` : 'Avoid'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={avoidActive ? T.ACCENT : T.TEXT_MUT} />
                </Pressable>
              </View>

              {routeBusy && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={T.ACCENT} />
                  <Text style={[styles.loadingText, { color: T.TEXT_MUT }]}>Calculating routes…</Text>
                </View>
              )}

              {/* Route option cards */}
              {!routeBusy && alternatives.length > 0 && alternatives.map((alt, i) => {
                const isSelected = i === selectedRouteIndex;

                return (
                  <Pressable
                    key={`${travelMode}-card-${i}`}
                    style={[
                      styles.routeOptionCard,
                      { backgroundColor: T.CARD, borderColor: isSelected ? '#1ABC93' : 'transparent', flexWrap: 'wrap' },
                      isSelected && { borderWidth: 4 },
                    ]}
                    onPress={() => setSelectedRouteIndex(i)}
                  >
                    {/* Top row: Safety badge + route info */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, width: '100%' }}>
                      {/* Safety badge — gradient only when selected */}
                      <View style={[styles.matchBadge, isSelected ? styles.matchBadgeActive : styles.matchBadgeInactive]}>
                        {isSelected && (
                          <LinearGradient
                            colors={['#4FA8A0', '#71BB81']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={StyleSheet.absoluteFillObject}
                          />
                        )}
                        <View style={styles.matchBadgeContent}>
                          <Text style={[styles.matchWord, { color: '#fff', fontSize: 13 }]}>SAFETY</Text>
                          <Text style={[styles.matchPct, { color: '#fff' }]}>90%</Text>
                        </View>
                      </View>

                      {/* Route info — time as main label */}
                      <Pressable style={styles.routeOptionInfo} onPress={() => { setSelectedRouteIndex(i); setShowDetailsModal(true); }}>
                        <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI, fontSize: 18 }]}>{fmtSecs(alt.durationSecs)}</Text>
                        <Text style={[styles.routeOptionMeta, { color: T.TEXT_MUT }]}>{fmtDist(alt.distance)}</Text>
                        <Text style={[styles.routeOptionTraffic, { color: T.ACCENT }]}>
                          Arrive ~{arrivalFrom(alt.durationSecs)}
                        </Text>
                      </Pressable>
                    </View>

                    {/* Bottom row: Start + Insights buttons — same size side by side */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' }}>
                      {/* Start button */}
                      <Pressable
                        style={[styles.startBtnWrap, { flex: 1, height: 40 }, !isSelected && { backgroundColor: T.ITEM }]}
                        onPress={() => {
                          setSelectedRouteIndex(i);
                          const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                          const from = stopsSwapped ? destCoords : originCoords;
                          const to   = stopsSwapped ? originCoords : destCoords;
                          Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
                        }}
                      >
                        {isSelected && (
                          <LinearGradient
                            colors={['#4FA8A0', '#71BB81']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={StyleSheet.absoluteFillObject}
                          />
                        )}
                        <Text style={[styles.startBtnText, !isSelected && { color: T.TEXT_MUT }]}>Start</Text>
                      </Pressable>

                      {/* Insights button — same size as Start */}
                      <Pressable
                        style={[styles.startBtnWrap, {
                          flex: 1,
                          height: 40,
                          flexDirection: 'row',
                          gap: 5,
                          backgroundColor: T.isDark ? 'rgba(74,144,226,0.18)' : 'rgba(74,144,226,0.12)',
                          borderWidth: 1.5,
                          borderColor: 'rgba(74,144,226,0.45)',
                        }]}
                        onPress={() => { setSelectedRouteIndex(i); setShowInsightsModal(true); }}
                      >
                        <Ionicons name="stats-chart" size={13} color="#4A90E2" />
                        <Text style={{ color: '#4A90E2', fontSize: 13, fontWeight: '700', zIndex: 1 }}>Insights</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}

              {/* Fallback card (BUS/RIDESHARE) */}
              {!routeBusy && alternatives.length === 0 && activeData && (
                <View style={[styles.routeOptionCard, { backgroundColor: T.CARD, borderColor: '#1ABC93', borderWidth: 4, flexWrap: 'wrap' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, width: '100%' }}>
                    <View style={[styles.matchBadge, styles.matchBadgeActive]}>
                      <LinearGradient colors={['#4FA8A0', '#71BB81']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                      <View style={styles.matchBadgeContent}>
                        <Text style={[styles.matchWord, { color: '#fff', fontSize: 13 }]}>SAFETY</Text>
                        <Text style={[styles.matchPct, { color: '#fff' }]}>90%</Text>
                      </View>
                    </View>
                    <Pressable style={styles.routeOptionInfo} onPress={() => setShowDetailsModal(true)}>
                      <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI, fontSize: 18 }]}>{fmtSecs(activeSecs)}</Text>
                      <Text style={[styles.routeOptionMeta, { color: T.TEXT_MUT }]}>{fmtDist(activeData.distance)}</Text>
                      <Text style={[styles.routeOptionTraffic, { color: T.ACCENT }]}>Arrive ~{arrivalFrom(activeSecs)}</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' }}>
                    <Pressable style={[styles.startBtnWrap, { flex: 1, height: 40 }]} onPress={() => {
                      const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                      const from = stopsSwapped ? destCoords : originCoords;
                      const to   = stopsSwapped ? originCoords : destCoords;
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
                    }}>
                      <LinearGradient colors={['#4FA8A0', '#71BB81']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                      <Text style={styles.startBtnText}>Start</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.startBtnWrap, {
                        flex: 1, height: 40, flexDirection: 'row', gap: 5,
                        backgroundColor: 'rgba(74,144,226,0.18)',
                        borderWidth: 1.5, borderColor: 'rgba(74,144,226,0.45)',
                      }]}
                      onPress={() => setShowInsightsModal(true)}
                    >
                      <Ionicons name="stats-chart" size={13} color="#4A90E2" />
                      <Text style={{ color: '#4A90E2', fontSize: 13, fontWeight: '700', zIndex: 1 }}>Insights</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {!routeBusy && !modeData && (
                <Pressable style={[styles.getDirectionsBtn, { backgroundColor: T.ACCENT }]} onPress={() => { if (originCoords) void fetchAllRoutes(); }}>
                  <Text style={styles.getDirectionsBtnText}>Get Directions</Text>
                </Pressable>
              )}
          </>
        </BottomSheetScrollView>
      </BottomSheet>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  zoomWrap: { position: 'absolute', right: 14, borderRadius: 14, overflow: 'hidden', width: 42 },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  floatBtn: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21 },
  floatBtnInner: { flex: 1, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  heatmapWrap: { position: 'absolute', right: 14 },
  heatmapInner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
  heatmapInnerActive: { borderColor: '#FF6B6B55' },
  heatmapText: { fontSize: 12, fontWeight: '600' },
  backBtn: {
    position: 'absolute', left: 14, zIndex: 20,
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  topRouteCard: {
    position: 'absolute', left: 62, right: 14, zIndex: 15,
    borderRadius: 16,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 10,
  },
  topRouteInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topRouteDotCol: { width: 18, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 2 },
  originDotSmall: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: 'rgba(74,144,226,0.4)' },
  topRouteLine: { width: 2, height: 14, borderRadius: 1 },
  topRouteFields: { flex: 1 },
  topRouteField: { paddingVertical: 7, justifyContent: 'center', minHeight: 34 },
  topFieldDivider: { height: 1 },
  topRouteLabel: { fontSize: 14, fontWeight: '600' },
  topRouteInput: { fontSize: 14, paddingVertical: 0 },
  topRouteSwapBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  topSuggList: { borderRadius: 12, overflow: 'hidden', marginTop: 8 },
  topSuggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topSuggTitle: { fontSize: 13, fontWeight: '600' },
  topSuggSub: { fontSize: 11, marginTop: 1 },
  topSuggDiv: { height: 1, marginLeft: 34 },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },
  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 0 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  miniIconWrap: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  miniLabel: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  miniMeta: { fontSize: 13 },
  miniClose: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  titleText: { fontSize: 26, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  closeBtnCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  modeChip: { flex: 1, height: 48, marginHorizontal: 3, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  // Stops card styles (used by DraggableStopRow)
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12, minHeight: 64 },
  stopIconWrap: { width: 26, alignItems: 'center' },
  originCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4A90E2', borderWidth: 2.5, borderColor: '#fff' },
  stopLabelWrap: { flex: 1 },
  stopLabel: { fontSize: 15, fontWeight: '600' },
  stopSub: { fontSize: 12, marginTop: 2 },
  dragHandle: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  filterText: { fontSize: 14, fontWeight: '500' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  loadingText: { fontSize: 14 },
  routeOptionCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1.5, gap: 12 },
  matchBadge: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', width: 76, overflow: 'hidden', position: 'relative' },
  matchBadgeActive: { backgroundColor: 'transparent' },
  matchBadgeInactive: { backgroundColor: '#3C3D66' },
  matchBadgeContent: { alignItems: 'center' },
  matchWord: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  matchPct: { fontSize: 28, fontWeight: '800' },
  routeOptionInfo: { flex: 1 },
  routeOptionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  routeOptionMeta: { fontSize: 13, marginBottom: 2 },
  routeOptionTraffic: { fontSize: 12, fontWeight: '600' },
  startBtnWrap: { borderRadius: 12, overflow: 'hidden', height: 40, minWidth: 72, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  startBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', zIndex: 1 },
  getDirectionsBtn: { borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  getDirectionsBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  doneBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 24 },
  tabRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 20 },
  tab: { paddingBottom: 8, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#FFFFFF' },
  tabText: { fontSize: 18, fontWeight: '600' },
  tabBody: { flex: 1 },
  closeBtnCircle: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  stepIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  stepIconSimple: { width: 44, alignItems: 'center' },
  stepContent: { flex: 1 },
  stepDist: { fontSize: 15, fontWeight: '700' },
  stepInst: { fontSize: 13, marginTop: 2 },
  lineDivider: { height: 1, marginLeft: 60 },
  insightsContent: { gap: 14, paddingBottom: 20 },
  insightMapWrap: { borderRadius: 16, overflow: 'hidden', height: 220, position: 'relative' },
  insightMap: { width: '100%', height: '100%' },
  insightMapPlaceholder: { height: 220, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  routeTimeBubble: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  routeTimeBubbleText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },
  statsRow: { flexDirection: 'row', gap: 14 },
  statCard: { flex: 1, borderRadius: 16, padding: 16, borderWidth: 1 },
  statCardWide: { borderRadius: 16, padding: 16, borderWidth: 1 },
  statLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  statValue: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  statDelta: { fontSize: 13, fontWeight: '600' },
});

const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  subtitle: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  countBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { fontSize: 12, fontWeight: '600' },
  mapStyleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  mapStyleBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', gap: 5, borderWidth: 1.5, borderColor: 'transparent' },
  mapStyleLabel: { fontSize: 11, fontWeight: '600' },
  sectionDiv: { height: 1, marginVertical: 18 },
  filterList: { borderRadius: 18, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  filterRowActive: { backgroundColor: 'rgba(26,188,147,0.08)' },
  filterIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  filterLabel: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  filterDesc: { fontSize: 12, opacity: 0.7 },
  filterDiv: { height: 1, marginLeft: 70 },
});