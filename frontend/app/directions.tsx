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
import MapView, { Callout, Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { getBackendRoutes, SafetyRoute } from '@/lib/api';
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
import type { AlternativeRoute, PlaceSearchResult, RoutePoint, RouteTimingInput } from '@/lib/api';
import { RouteInsightsPage } from '../components/RouteInsightsPage';
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
interface ModeRouteData {
  coords: RoutePoint[]; distance: number; durationSecs: number;
  // Safety data from backend
  safetyScore?: number | null;
  safetyLabel?: string;
  routeSource?: 'google' | 'safeway';
  riskPerKm?: number;
  nHighRisk?: number;
  routeKm?: number;
  topRiskFactors?: { factor: string; weight: number }[] | { label: string; count: number; pct: number }[];
  timeBand?: string;
  segmentRisks?: number[];
  highRiskCoords?: Array<{ latitude: number; longitude: number; risk?: number; factors?: string[] }>;
  aadtAvg?: number;
  aadtMax?: number;
  timePenaltyPct?: number;
  riskReductionPct?: number;
}
interface ModeRoutes {
  primary: ModeRouteData;
  alternatives: (AlternativeRoute & {
    safetyScore?: number | null;
    safetyLabel?: string;
    routeSource?: 'google' | 'safeway';
    riskPerKm?: number;
    nHighRisk?: number;
    routeKm?: number;
    topRiskFactors?: any[];
    timeBand?: string;
    segmentRisks?: number[];
    highRiskCoords?: Array<{ latitude: number; longitude: number; risk?: number; factors?: string[] }>;
    aadtAvg?: number;
    aadtMax?: number;
    timePenaltyPct?: number;
    riskReductionPct?: number;
  })[];
}

type RouteAltRow = ModeRoutes['alternatives'][number];

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

const INFO_CONTENT: Record<string, { title: string; body: string }> = {
  aadt: {
    title: 'AADT — Annual Average Daily Traffic',
    body: 'AADT estimates the average number of vehicles passing through a road segment per day, averaged over a full year.\n\n'
      + 'SafeWay uses AADT proxy values based on OpenStreetMap road classification:\n'
      + '• Residential: ~1,000/day\n• Secondary: ~15,000/day\n• Primary: ~25,000/day\n• Trunk: ~40,000/day\n• Motorway: ~60,000/day\n\n'
      + 'This helps normalize crash rates — a highway with more crashes isn\'t necessarily more dangerous per vehicle-mile than a quiet street.',
  },
  shap: {
    title: 'SHAP — Risk Factor Explanation',
    body: 'SHAP (SHapley Additive exPlanations) is an AI interpretability technique that shows how much each feature contributed to a prediction.\n\n'
      + 'For each intersection on your route, the model identifies the top 3 factors that most increased its risk score. These are then aggregated across all intersections on the route.\n\n'
      + 'Common factors include:\n'
      + '• High crash history — many past crashes at that intersection\n'
      + '• Dark conditions — poor lighting correlated with higher risk\n'
      + '• Pedestrian crashes — history of pedestrian-involved incidents\n'
      + '• Speed camera violations — frequent speeding in the area\n\n'
      + 'The percentage shows how many route intersections flagged that factor.',
  },
};

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

function mapSafetyRoutesToAlternatives(safetyRoutes: SafetyRoute[]): RouteAltRow[] {
  return safetyRoutes.map((r: SafetyRoute, i: number) => {
    const durationSecs = parseInt((r.duration ?? '0s').replace('s', ''), 10);
    return {
      index: i,
      coords: r.coordinates,
      distance: r.distance_meters ?? 0,
      durationSecs,
      label: fmtSecs(durationSecs),
      routeLabels: [r.route_source],
      safetyScore: r.safety_score,
      safetyLabel: r.safety_label,
      routeSource: r.route_source,
      riskPerKm: r.risk_per_km,
      nHighRisk: r.n_high_risk,
      routeKm: r.route_km,
      topRiskFactors: r.top_risk_factors,
      timeBand: r.time_band,
      segmentRisks: r.segment_risks,
      highRiskCoords: r.high_risk_coords ?? [],
      aadtAvg: r.aadt_avg,
      aadtMax: r.aadt_max,
      timePenaltyPct: r.time_penalty_pct,
      riskReductionPct: r.risk_reduction_pct,
    };
  });
}

function primaryToAlternativeRow(primary: ModeRouteData, index = 0): RouteAltRow {
  return {
    index,
    coords: primary.coords,
    distance: primary.distance,
    durationSecs: primary.durationSecs,
    label: fmtSecs(primary.durationSecs),
    routeLabels: ['DEFAULT_ROUTE'],
    safetyScore: primary.safetyScore,
    safetyLabel: primary.safetyLabel,
    routeSource: primary.routeSource,
    riskPerKm: primary.riskPerKm,
    nHighRisk: primary.nHighRisk,
    routeKm: primary.routeKm,
    topRiskFactors: primary.topRiskFactors,
    timeBand: primary.timeBand,
    segmentRisks: primary.segmentRisks,
    highRiskCoords: primary.highRiskCoords,
    aadtAvg: primary.aadtAvg,
    aadtMax: primary.aadtMax,
    timePenaltyPct: primary.timePenaltyPct,
    riskReductionPct: primary.riskReductionPct,
  };
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

// ─── Hourly Line Graph with projected data ────────────────────────────────────
function HourlyLineGraph({
  data, nowHour, lineColor, projectedColor, formatValue, unit,
}: {
  data: { h: number; label: string; val: number; isProjected: boolean }[];
  nowHour: number;
  lineColor: string;
  projectedColor: string;
  formatValue: (v: number) => string;
  unit: string;
}) {
  const [containerWidth, setContainerWidth] = useState(280);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const CHART_H = 80;
  const LABEL_H = 18;

  const vals = data.map(d => d.val);
  const maxVal = Math.max(...vals, 1);
  const minVal = 0;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.locationX;
        const idx = Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1))));
        setHoveredIndex(idx);
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const idx = Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1))));
        setHoveredIndex(idx);
      },
      onPanResponderRelease: () => { setTimeout(() => setHoveredIndex(null), 2000); },
      onPanResponderTerminate: () => { setTimeout(() => setHoveredIndex(null), 2000); },
    })
  ).current;

  // Calculate point positions
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * containerWidth;
    const y = CHART_H - ((d.val - minVal) / (maxVal - minVal)) * (CHART_H - 10);
    return { x, y, ...d };
  });

  // Build SVG-style path segments split at nowHour
  const solidPoints = points.filter(p => !p.isProjected);
  const projectedPoints = points.filter(p => p.isProjected || p.h === nowHour);

  const toPolyline = (pts: typeof points) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const activeIdx = hoveredIndex ?? nowHour;
  const activePoint = points[activeIdx];

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={{ height: CHART_H + LABEL_H + 8, position: 'relative' }}
      {...panResponder.panHandlers}
    >
      {/* Tooltip */}
      {hoveredIndex !== null && activePoint && (
        <View style={{
          position: 'absolute',
          left: Math.min(Math.max(activePoint.x - 36, 0), containerWidth - 80),
          top: Math.max(0, activePoint.y - 42),
          backgroundColor: '#1A2040',
          borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
          borderWidth: 1, borderColor: lineColor + '66',
          zIndex: 10, minWidth: 76, alignItems: 'center',
          shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4, shadowRadius: 6, elevation: 8,
        }}>
          <Text style={{ color: lineColor, fontSize: 13, fontWeight: '800' }}>{formatValue(activePoint.val)}</Text>
          <Text style={{ color: '#7A8FA6', fontSize: 9, marginTop: 1 }}>{activePoint.label} · {unit}</Text>
        </View>
      )}

      {/* Chart area */}
      <View style={{ height: CHART_H, overflow: 'hidden' }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(frac => (
          <View key={frac} style={{
            position: 'absolute', left: 0, right: 0,
            top: frac * CHART_H, height: 1,
            backgroundColor: '#FFFFFF0A',
          }} />
        ))}

        {/* Solid line segments (past + now) */}
        {solidPoints.length > 1 && solidPoints.slice(0, -1).map((p, i) => {
          const next = solidPoints[i + 1];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={i} style={{
              position: 'absolute',
              left: p.x, top: p.y - 1.5,
              width: len, height: 3, borderRadius: 1.5,
              backgroundColor: lineColor,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: '0 50%',
            }} />
          );
        })}

        {/* Projected dashed segments */}
        {projectedPoints.length > 1 && projectedPoints.slice(0, -1).map((p, i) => {
          const next = projectedPoints[i + 1];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          // Simulate dashed by alternating opacity segments
          return (
            <View key={`proj-${i}`} style={{
              position: 'absolute',
              left: p.x, top: p.y - 1.5,
              width: len, height: 3, borderRadius: 1.5,
              backgroundColor: projectedColor,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: '0 50%',
              opacity: 0.7,
            }} />
          );
        })}

        {/* Current hour dot */}
        {points[nowHour] && (
          <View style={{
            position: 'absolute',
            left: points[nowHour].x - 5,
            top: points[nowHour].y - 5,
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: lineColor,
            borderWidth: 2, borderColor: '#fff',
          }} />
        )}

        {/* Hover dot */}
        {hoveredIndex !== null && activePoint && (
          <View style={{
            position: 'absolute',
            left: activePoint.x - 5, top: activePoint.y - 5,
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: activePoint.isProjected ? projectedColor : lineColor,
            borderWidth: 2, borderColor: '#fff',
          }} />
        )}
      </View>

      {/* X-axis labels — show every 4 hours */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 0 }}>
        {data.filter((_, i) => i % 4 === 0).map(d => (
          <Text key={d.h} style={{
            color: d.h === nowHour ? lineColor : '#7A8FA6',
            fontSize: 9, fontWeight: d.h === nowHour ? '700' : '500',
          }}>{d.label}</Text>
        ))}
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
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [showHotspotsModal, setShowHotspotsModal] = useState(false);
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
<ScrollView
  style={dm.tabBody}
  showsVerticalScrollIndicator={false}
  contentContainerStyle={{ paddingBottom: 20 }}
>
  <View style={{ backgroundColor: T.CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 8 }}>
    <View style={[dm.stepRow, { paddingLeft: 8 }]}>
      <View style={[dm.stepIcon, { backgroundColor: T.ITEM }]}>
        <Ionicons name={modeIcon[travelMode]} size={20} color="#4A90E2" />
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
      {/* ── Info Modal ── */}
      {infoKey && INFO_CONTENT[infoKey] && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setInfoKey(null)}>
          <Pressable style={dm.infoBackdrop} onPress={() => setInfoKey(null)}>
            <View style={[dm.infoCard, { backgroundColor: T.BG }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ color: T.TEXT_PRI, fontSize: 16, fontWeight: '800', flex: 1 }}>{INFO_CONTENT[infoKey].title}</Text>
                <Pressable onPress={() => setInfoKey(null)} hitSlop={10}>
                  <Ionicons name="close-circle" size={22} color={T.TEXT_MUT} />
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 320 }}>
                <Text style={{ color: T.TEXT_MUT, fontSize: 13, lineHeight: 20 }}>{INFO_CONTENT[infoKey].body}</Text>
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      )}

      {/* ── Hot Spots List Modal ── */}
      {showHotspotsModal && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setShowHotspotsModal(false)}>
          <Pressable style={dm.infoBackdrop} onPress={() => setShowHotspotsModal(false)}>
            <View style={[dm.infoCard, { backgroundColor: T.BG, maxHeight: '70%' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ color: T.TEXT_PRI, fontSize: 16, fontWeight: '800' }}>
                  ⚠️  High-Risk Intersections ({(activeData?.highRiskCoords as any[] ?? []).length})
                </Text>
                <Pressable onPress={() => setShowHotspotsModal(false)} hitSlop={10}>
                  <Ionicons name="close-circle" size={22} color={T.TEXT_MUT} />
                </Pressable>
              </View>
              <Text style={{ color: T.TEXT_MUT, fontSize: 12, marginBottom: 12 }}>
                Intersections along this route where the ML model predicts elevated crash risk (score {'>'} 66/100). Tap a marker on the map to see its location.
              </Text>
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                {(activeData?.highRiskCoords as any[] ?? []).map((coord: any, i: number) => (
                  <View
                    key={`hs-row-${i}`}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.DIVIDER, gap: 12 }}
                  >
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF4444', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 14 }}>!</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.TEXT_PRI, fontSize: 13, fontWeight: '600' }}>
                        Hot Spot #{i + 1}
                      </Text>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginTop: 2, fontFamily: 'monospace' }}>
                        {coord.latitude.toFixed(5)}, {coord.longitude.toFixed(5)}
                      </Text>
                    </View>
                    <Text style={{ color: '#FF6B6B', fontSize: 11, fontWeight: '700' }}>HIGH RISK</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      )}
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
  const params = useLocalSearchParams<{ destLat: string; destLng: string; destName: string; originAddress?: string; originLat?: string; originLng?: string }>();
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
    // Top route card ends at approx: insets.top + 10 (top) + 110 (card height) + 12 (gap)
    const cardBottom = insets.top + 132;
    const safeMax = windowHeight - cardBottom - 8;
    const miniSnap = 46 + insets.bottom;
    return [miniSnap, Math.round(windowHeight * 0.50), safeMax];
  }, [windowHeight, insets.top]);
  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const [originLabel, setOriginLabel] = useState(params.originAddress ?? 'My Location');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(
    params.originLat && params.originLng ? { lat: parseFloat(params.originLat), lng: parseFloat(params.originLng) } : null
  );
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
  const [avoidList, setAvoidList] = useState<string[]>([]);
  const avoidSet = new Set(avoidList);
  const avoidActive = avoidList.length > 0;
  const [pickerHour, setPickerHour] = useState(() => new Date().getHours());
  const [pickerMin,  setPickerMin]  = useState<0|30>(() => new Date().getMinutes() >= 30 ? 30 : 0);
  const pickerTimeLabel = `${pickerHour % 12 === 0 ? 12 : pickerHour % 12}:${pickerMin === 0 ? '00' : '30'} ${pickerHour < 12 ? 'AM' : 'PM'}`;

  const nowLabel = nowChoice === 'now' ? 'Now'
    : nowChoice === 'depart' ? `Depart ${pickerTimeLabel}`
    : `Arrive ${pickerTimeLabel}`;

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 10_000,
  });
  const activeHeatmapInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);

  // Only fetch GPS location if no origin coords were passed from destination page
  useEffect(() => {
    if (params.originLat && params.originLng) return; // already have coords from destination
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

  async function fetchAllRoutes() {
    if (!originCoords || !destCoords) return;
    setRouteBusy(true);
    setSelectedRouteIndex(0);
    const from = stopsSwapped ? destCoords : originCoords;
    const to   = stopsSwapped ? originCoords! : destCoords;

    const nd: Partial<Record<TravelMode, ModeRoutes>> = {};
    // Backend scores risk by hour of day (integer). Half-hours use the chosen hour.
    const departureHour = nowChoice === 'now' ? new Date().getHours() : pickerHour;

    const currentAvoidSet = new Set(avoidList);
    const hasAvoid = avoidList.length > 0;

    const timing: RouteTimingInput =
      nowChoice === 'now'
        ? { kind: 'now' }
        : nowChoice === 'depart'
          ? { kind: 'depart', hour: pickerHour, minute: pickerMin }
          : { kind: 'arrive', hour: pickerHour, minute: pickerMin };

    try {
      const [
        backendDriveRes,
        backendWalkRes,
        backendBikeRes,
        driveGoogleRes,
        walkGoogleRes,
        bikeGoogleRes,
      ] = await Promise.allSettled([
        getBackendRoutes({ origin: from, destination: to, travel_mode: 'DRIVE', departure_hour: departureHour }),
        getBackendRoutes({ origin: from, destination: to, travel_mode: 'WALK', departure_hour: departureHour }),
        getBackendRoutes({ origin: from, destination: to, travel_mode: 'BICYCLE', departure_hour: departureHour }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'DRIVE', avoid: currentAvoidSet, timing }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'WALK', timing }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'BICYCLE', timing }),
      ]);

      const googleDriveOk = driveGoogleRes.status === 'fulfilled' && driveGoogleRes.value.length > 0;

      if (__DEV__) {
        if (backendDriveRes.status === 'rejected') {
          console.warn('[directions] getBackendRoutes(DRIVE) failed:', backendDriveRes.reason);
        } else if (backendDriveRes.value.routes.length === 0) {
          console.warn('[directions] getBackendRoutes(DRIVE) returned no routes.');
        } else {
          const hasScore = backendDriveRes.value.routes.some(r => r.safety_score != null);
          if (!hasScore) {
            console.warn(
              '[directions] Backend DRIVE routes have no safety_score — check server risk_map (GCS / intersection_scores.parquet).',
            );
          }
        }
      }

      // DRIVE: prefer Google Routes API when Avoid filters are active (tolls/highways/ferries);
      // otherwise use backend (SafeWay A* + safety scoring).
      if (hasAvoid && googleDriveOk) {
        const alts = driveGoogleRes.value;
        nd.DRIVE = {
          primary: { coords: alts[0].coords, distance: alts[0].distance, durationSecs: alts[0].durationSecs },
          alternatives: alts,
        };
      } else if (backendDriveRes.status === 'fulfilled' && backendDriveRes.value.routes.length > 0) {
        const alts = mapSafetyRoutesToAlternatives(backendDriveRes.value.routes);
        const primary = alts[0];
        nd.DRIVE = {
          primary: {
            coords: primary.coords, distance: primary.distance, durationSecs: primary.durationSecs,
            safetyScore: primary.safetyScore, safetyLabel: primary.safetyLabel, routeSource: primary.routeSource,
            riskPerKm: primary.riskPerKm, nHighRisk: primary.nHighRisk, routeKm: primary.routeKm,
            topRiskFactors: primary.topRiskFactors, timeBand: primary.timeBand,
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords, aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      }

      // Fallback: if backend failed or returned nothing, use Google direct for DRIVE
      if (!nd.DRIVE && googleDriveOk) {
        if (__DEV__) {
          console.warn('[directions] Using Google-only DRIVE routes (no safety scores). Fix backend reachability or empty routes.');
        }
        const alts = driveGoogleRes.value;
        nd.DRIVE = {
          primary: { coords: alts[0].coords, distance: alts[0].distance, durationSecs: alts[0].durationSecs },
          alternatives: alts,
        };
      }

      const toModeRoutes = (res: PromiseSettledResult<AlternativeRoute[]>): ModeRoutes | undefined => {
        if (res.status !== 'fulfilled' || !res.value.length) return undefined;
        const alts = res.value;
        return {
          primary: { coords: alts[0].coords, distance: alts[0].distance, durationSecs: alts[0].durationSecs },
          alternatives: alts,
        };
      };

      // WALK: backend scored routes first, else Google
      if (backendWalkRes.status === 'fulfilled' && backendWalkRes.value.routes.length > 0) {
        const alts = mapSafetyRoutesToAlternatives(backendWalkRes.value.routes);
        const primary = alts[0];
        nd.WALK = {
          primary: {
            coords: primary.coords, distance: primary.distance, durationSecs: primary.durationSecs,
            safetyScore: primary.safetyScore, safetyLabel: primary.safetyLabel, routeSource: primary.routeSource,
            riskPerKm: primary.riskPerKm, nHighRisk: primary.nHighRisk, routeKm: primary.routeKm,
            topRiskFactors: primary.topRiskFactors, timeBand: primary.timeBand,
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords, aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      } else {
        if (__DEV__ && backendWalkRes.status === 'rejected') {
          console.warn('[directions] getBackendRoutes(WALK) failed:', backendWalkRes.reason);
        }
        const walk = toModeRoutes(walkGoogleRes);
        if (walk) nd.WALK = walk;
      }

      // BICYCLE: backend scored routes first, else Google
      if (backendBikeRes.status === 'fulfilled' && backendBikeRes.value.routes.length > 0) {
        const alts = mapSafetyRoutesToAlternatives(backendBikeRes.value.routes);
        const primary = alts[0];
        nd.BICYCLE = {
          primary: {
            coords: primary.coords, distance: primary.distance, durationSecs: primary.durationSecs,
            safetyScore: primary.safetyScore, safetyLabel: primary.safetyLabel, routeSource: primary.routeSource,
            riskPerKm: primary.riskPerKm, nHighRisk: primary.nHighRisk, routeKm: primary.routeKm,
            topRiskFactors: primary.topRiskFactors, timeBand: primary.timeBand,
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords, aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      } else {
        if (__DEV__ && backendBikeRes.status === 'rejected') {
          console.warn('[directions] getBackendRoutes(BICYCLE) failed:', backendBikeRes.reason);
        }
        const bike = toModeRoutes(bikeGoogleRes);
        if (bike) nd.BICYCLE = bike;
      }

      if (nd.DRIVE) {
        const avoidMult = 1 + (avoidSet.has('tolls') ? 0.05 : 0) + (avoidSet.has('highways') ? 0.15 : 0);
        const busFactor = 1.4 * avoidMult;
        const rideFactor = 1.1 * avoidMult;
        const driveAlts = nd.DRIVE.alternatives?.length
          ? nd.DRIVE.alternatives
          : [primaryToAlternativeRow(nd.DRIVE.primary)];

        const scaleAlts = (factor: number) =>
          driveAlts.map((alt) => {
            const durationSecs = Math.round(alt.durationSecs * factor);
            return { ...alt, durationSecs, label: fmtSecs(durationSecs) };
          });

        const busAlts = scaleAlts(busFactor);
        const rideAlts = scaleAlts(rideFactor);
        nd.BUS = {
          primary: { ...nd.DRIVE.primary, durationSecs: busAlts[0].durationSecs },
          alternatives: busAlts,
        };
        nd.RIDESHARE = {
          primary: { ...nd.DRIVE.primary, durationSecs: rideAlts[0].durationSecs },
          alternatives: rideAlts,
        };
      }
      setRouteByMode(nd);
    } catch (e) {
      Alert.alert('Route error', e instanceof Error ? e.message : 'Could not fetch route.');
    } finally {
      setRouteBusy(false);
    }
  }

  useEffect(() => {
    if (originCoords && destCoords) void fetchAllRoutes();
  }, [originCoords, destCoords, nowChoice, pickerHour, pickerMin, avoidList, stopsSwapped]);

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
    ? {
        coords: selectedAlt.coords, distance: selectedAlt.distance, durationSecs: selectedAlt.durationSecs,
        safetyScore: selectedAlt.safetyScore, safetyLabel: selectedAlt.safetyLabel, routeSource: selectedAlt.routeSource,
        riskPerKm: selectedAlt.riskPerKm, nHighRisk: selectedAlt.nHighRisk, routeKm: selectedAlt.routeKm,
        topRiskFactors: selectedAlt.topRiskFactors, timeBand: selectedAlt.timeBand,
        segmentRisks: selectedAlt.segmentRisks, highRiskCoords: selectedAlt.highRiskCoords,
        aadtAvg: selectedAlt.aadtAvg, aadtMax: selectedAlt.aadtMax,
        timePenaltyPct: selectedAlt.timePenaltyPct, riskReductionPct: selectedAlt.riskReductionPct,
      }
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
    : { latitude: 41.8781, longitude: -87.6298, latitudeDelta: 0.05, longitudeDelta: 0.05 };

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
          const segs = alt.segmentRisks as any[] | undefined;
          if (isSelected && segs?.length) {
            return segs.map((seg: any, si: number) => (
              <Polyline
                key={`${travelMode}-alt-${i}-seg-${si}`}
                coordinates={[seg.start, seg.end]}
                strokeColor={seg.risk > 66 ? '#FF4444' : seg.risk > 33 ? '#FFA500' : '#1ABC93'}
                strokeWidth={5}
                tappable
                onPress={() => setSelectedRouteIndex(i)}
              />
            ));
          }
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
        {(alternatives[selectedRouteIndex]?.highRiskCoords as any[] ?? []).map((coord: any, i: number) => (
          <Marker key={`hs-${i}`} coordinate={coord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FF4444', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 14 }}>!</Text>
            </View>
            <Callout tooltip>
              <View style={{ backgroundColor: '#1E2A38', borderRadius: 10, padding: 10, minWidth: 160, maxWidth: 220, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, elevation: 6 }}>
                <Text style={{ color: '#FF6B6B', fontWeight: '800', fontSize: 13, marginBottom: 4 }}>⚠ High-Risk Intersection</Text>
                <Text style={{ color: '#fff', fontSize: 12, marginBottom: 2 }}>Risk score: <Text style={{ fontWeight: '700', color: '#FF4444' }}>{coord.risk ?? '–'}/100</Text></Text>
                {coord.factors?.length > 0 && (
                  <>
                    <Text style={{ color: '#7A8FA6', fontSize: 11, marginTop: 4, marginBottom: 2 }}>Contributing factors:</Text>
                    {coord.factors.map((f: string, fi: number) => (
                      <Text key={fi} style={{ color: '#CBD5E0', fontSize: 11 }}>• {f}</Text>
                    ))}
                  </>
                )}
                <Text style={{ color: '#4A6580', fontSize: 10, marginTop: 6 }}>{coord.latitude.toFixed(5)}, {coord.longitude.toFixed(5)}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
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

            {/* Time slider — shown for depart/arrive */}
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
                        const next = avoidSet.has(opt.id)
                          ? avoidList.filter(x => x !== opt.id)
                          : [...avoidList, opt.id];
                        setAvoidList(next);
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
              onPress={() => setShowAvoidModal(false)}
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

      {/* Route insights — extracted to RouteInsightsPage.tsx */}
      <RouteInsightsPage
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
                    {avoidActive ? `Avoid (${avoidList.length})` : 'Avoid'}
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
                const isSafeWay = alt.routeSource === 'safeway';
                const score = alt.safetyScore;
                // Backend score is 0–100 risk; safety % = 100 - score
                const safetyPct = score != null ? Math.max(0, Math.min(100, 100 - Math.round(score))) : null;
                const safetyColor = score == null ? '#7A8FA6'
                  : score < 33 ? '#1ABC93' : score < 66 ? '#FFA500' : '#FF4444';
                const routeName = alt.label ?? fmtSecs(alt.durationSecs);

                return (
                  <Pressable
                   key={i}
                  style={[
                    styles.routeOptionCard,
                    { backgroundColor: T.CARD, borderColor: isSelected ? '#1ABC93' : 'transparent', flexWrap: 'wrap' },
                    isSelected && { borderWidth: 4 },
                  ]}
                  onPress={() => setSelectedRouteIndex(i)}
                >
                  {/* Top row: Safety badge + route info */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, width: '100%' }}>

                  {/* Safety badge — green tint when safe, color-coded by score */}
                    <View style={[styles.matchBadge, isSelected ? styles.matchBadgeActive : styles.matchBadgeInactive]}>
                      {isSelected && isSafeWay ? (
                        <LinearGradient
                          colors={['#4FA8A0', '#71BB81']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      ) : isSelected ? (
                        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: safetyColor, opacity: 0.15, borderRadius: 12 }]} />
                      ) : null}
                      <View style={styles.matchBadgeContent}>
                        <Text style={[styles.matchWord, { color: safetyPct != null ? '#fff' : '#7A8FA6', fontSize: 11 }]}>
                          {isSafeWay ? 'SAFEWAY' : 'SAFETY'}
                        </Text>
                        {safetyPct != null ? (
                          <Text style={[styles.matchPct, { color: isSelected ? '#fff' : safetyColor, fontSize: 26 }]}>
                            {safetyPct}%
                          </Text>
                        ) : (
                          <>
                            <Text style={{ color: '#7A8FA6', fontSize: 15, fontWeight: '800' }}>N/A</Text>
                            <Text style={{ color: '#7A8FA6', fontSize: 7, textAlign: 'center', marginTop: 2, lineHeight: 9 }}>
                              {'no\ncoverage'}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>

                    {/* Route info — your layout, other branch's data */}
                    <Pressable style={styles.routeOptionInfo} onPress={() => { setSelectedRouteIndex(i); setShowDetailsModal(true); }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {/* Main label = travel time */}
                        <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI, fontSize: 22, fontWeight: '800' }]}>{fmtSecs(alt.durationSecs)}</Text>
                        {isSafeWay && (
                          <View style={{ backgroundColor: '#1ABC9322', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Ionicons name="shield-checkmark" size={10} color="#1ABC93" />
                            <Text style={{ color: '#1ABC93', fontSize: 9, fontWeight: '800' }}>Generated by SafeWay</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.routeOptionMeta, { color: T.TEXT_MUT }]}>
                        {fmtDist(alt.distance)}
                        {score != null ? `  •  Risk: ${Math.round(score)}` : ''}
                        {alt.safetyLabel && alt.safetyLabel !== 'unknown' ? ` (${alt.safetyLabel})` : ''}
                      </Text>
                      <Text style={[styles.routeOptionTraffic, { color: T.ACCENT }]}>
                        Arrive ~{arrivalFrom(alt.durationSecs)}
                        {alt.nHighRisk ? `  •  ${alt.nHighRisk} hot spots` : ''}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Bottom row: Start + Insights — your UI addition */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' }}>
                    <Pressable
                      style={[styles.startBtnWrap, { flex: 1, height: 40 }, !isSelected && { backgroundColor: T.ITEM }]}
                      onPress={() => {
                        setSelectedRouteIndex(i);
                        const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                        const from = stopsSwapped ? destCoords : originCoords;
                        const to   = stopsSwapped ? originCoords : destCoords;
                        // Subsample up to 8 waypoints from the selected route so Google Maps follows the same path
                        const routeCoords = alt.coords ?? [];
                        const inner = routeCoords.slice(1, -1);
                        const step = inner.length > 8 ? Math.floor(inner.length / 8) : 1;
                        const wpts = inner.filter((_: RoutePoint, idx: number) => idx % step === 0).slice(0, 8);
                        const waypointsParam = wpts.length > 0 ? `&waypoints=${encodeURIComponent(wpts.map((p: RoutePoint) => `${p.latitude},${p.longitude}`).join('|'))}` : '';
                        Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}${waypointsParam}&travelmode=${modeMap[travelMode]}`);
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

                    <Pressable
                      style={[styles.startBtnWrap, {
                        flex: 1, height: 40, flexDirection: 'row', gap: 5,
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

                  {/* Top row: Safety badge + route info */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12, width: '100%' }}>
                    <View style={[styles.matchBadge, styles.matchBadgeActive]}>
                      <LinearGradient colors={['#4FA8A0', '#71BB81']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                      <View style={styles.matchBadgeContent}>
                        <Text style={[styles.matchWord, { color: '#fff', fontSize: 13 }]}>SAFETY</Text>
                        <Text style={[styles.matchPct, { color: '#fff' }]}>
                          {activeData.safetyScore != null ? `${Math.max(0, 100 - Math.round(activeData.safetyScore))}%` : '–'}
                        </Text>
                      </View>
                    </View>

                    <Pressable style={styles.routeOptionInfo} onPress={() => setShowDetailsModal(true)}>
                      <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI, fontSize: 18 }]}>{fmtSecs(activeSecs)}</Text>
                      <Text style={[styles.routeOptionMeta, { color: T.TEXT_MUT }]}>{fmtDist(activeData.distance)}</Text>
                      <Text style={[styles.routeOptionTraffic, { color: T.ACCENT }]}>Arrive ~{arrivalFrom(activeSecs)}</Text>
                    </Pressable>
                  </View>

                  {/* Bottom row: Start + Insights */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' }}>
                    <Pressable
                      style={[styles.startBtnWrap, { flex: 1, height: 40 }]}
                      onPress={() => {
                        const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                        const from = stopsSwapped ? destCoords : originCoords;
                        const to   = stopsSwapped ? originCoords : destCoords;
                        Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
                      }}
                    >
                      <LinearGradient colors={['#4FA8A0', '#71BB81']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                      <Text style={styles.startBtnText}>Start</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.startBtnWrap, {
                        flex: 1, height: 40, flexDirection: 'row', gap: 5,
                        backgroundColor: T.isDark ? 'rgba(74,144,226,0.18)' : 'rgba(74,144,226,0.12)',
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
  // Hero card
  heroCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroCircle: { width: 72, height: 72, justifyContent: 'center', alignItems: 'center' },
  heroCircleInner: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, justifyContent: 'center', alignItems: 'center' },
  heroScoreText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  heroScoreLabel: { color: '#7A8FA6', fontSize: 10, fontWeight: '600' },
  heroInfo: { flex: 1 },
  heroTitle: { fontSize: 16, fontWeight: '800' },
  heroSub: { fontSize: 12, marginTop: 2 },
  safewayBadge: { backgroundColor: '#1ABC9322', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  safewayBadgeText: { color: '#1ABC93', fontSize: 10, fontWeight: '800' },
  // Info modal
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  infoCard: { borderRadius: 20, padding: 20, width: '100%', maxWidth: 360 },
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