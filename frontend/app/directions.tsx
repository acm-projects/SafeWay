import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
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
  Animated as RNAnimated,
} from 'react-native';
import MapView, { Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
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
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';

import { getRoute, getMultipleRoutes, searchPlaces, getRouteDirections } from '@/lib/api';
import type { AlternativeRoute, DirectionStep, PlaceSearchResult, RoutePoint, RouteTimingInput } from '@/lib/api';
import { RouteInsightsPage } from '../components/RouteInsightsPage';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import { useTheme } from '@/providers/theme-context';
import { useTrafficIncidents } from '@/hooks/useTrafficIncidents';
import type { TrafficIncident } from '@/hooks/useTrafficIncidents';
import { IncidentBubble, IncidentDetailPopup, IncidentMarker } from '@/components/IncidentMarker';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Design tokens (aligned with index.tsx + destination.tsx) ─────────────────
const NAVY        = '#030427';
const NAVY_GLASS  = '#06072E';
const NAVY_CARD   = '#0D0E3A';
const NAVY_ITEM   = '#161750';
const GLASS_BORDER = '#1A1B4D';
const SEAFOAM     = '#1ABC93';
const TEXT_PRI    = '#FFFFFF';
const TEXT_MUT    = '#6B7FA8';
const TEXT_SUB    = '#8A9BBF';
const DIVIDER     = '#1A1B4D';
// Legacy aliases used by internal helpers
const BG          = NAVY;
const SHEET_BG    = NAVY_GLASS;
const CARD_BG     = NAVY_CARD;
const ITEM_BG     = NAVY_ITEM;
const GREEN       = SEAFOAM;

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
  safetyScore?: number | null;
  safetyLabel?: string;
  routeSource?: 'google' | 'safeway';
  riskPerKm?: number;
  nHighRisk?: number;
  routeKm?: number;
  topRiskFactors?: { factor: string; weight: number }[] | { label: string; count: number; pct: number }[];
  timeBand?: string;
  segmentRisks?: number[];
  highRiskCoords?: Array<{ latitude: number; longitude: number }>;
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
    highRiskCoords?: Array<{ latitude: number; longitude: number }>;
    aadtAvg?: number;
    aadtMax?: number;
    timePenaltyPct?: number;
    riskReductionPct?: number;
  })[];
}

type RouteAltRow = ModeRoutes['alternatives'][number];

function isCoordSegmentArray(segs: any[] | undefined): segs is Array<{ start: RoutePoint; end: RoutePoint; risk: number }> {
  if (!segs || segs.length === 0) return false;
  const first = segs[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'start' in first &&
    'end' in first &&
    typeof first.start?.latitude === 'number'
  );
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
const FLOAT_BOTTOM = 19;
const FLOAT_RADIUS = 24;

// ─── Greeting context (mirrors index.tsx) ────────────────────────────────────
function getTimeContext(): { label: string; icon: string } {
  const h = new Date().getHours();
  if (h >= 5  && h < 9)  return { label: 'Good morning',   icon: 'sunny-outline'        };
  if (h >= 9  && h < 12) return { label: 'Good morning',   icon: 'partly-sunny-outline' };
  if (h >= 12 && h < 17) return { label: 'Good afternoon', icon: 'sunny-outline'        };
  if (h >= 17 && h < 21) return { label: 'Good evening',   icon: 'moon-outline'         };
  return                         { label: 'Good night',     icon: 'moon-outline'         };
}

// ─── Bottom sheet glass background ───────────────────────────────────────────
function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: bg ?? SHEET_BG,
          borderWidth: 1,
          borderColor: GLASS_BORDER,
          shadowColor: SEAFOAM,
          shadowOpacity: 0.06,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -4 },
        },
        style,
      ]}
    />
  );
}

function fmtSecs(s: number): string {
  if (!s || s <= 0) return '–';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function mapSafetyRoutesToAlternatives(safetyRoutes: SafetyRoute[]): RouteAltRow[] {
  return safetyRoutes.map((r: SafetyRoute, i: number) => {
    const rawDurationSecs = parseInt((r.duration ?? '0s').replace('s', ''), 10);
    const durationSecs = rawDurationSecs > 0
      ? rawDurationSecs
      : r.route_km ? Math.round((r.route_km / 30) * 3600) : 0;
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

// ─── Interactive Bar Chart ────────────────────────────────────────────────────
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
      onPanResponderRelease: () => { setTimeout(() => setHoveredIndex(null), 1500); },
      onPanResponderTerminate: () => { setTimeout(() => setHoveredIndex(null), 1500); },
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
        {hoveredIndex !== null && (
          <View style={{
            position: 'absolute',
            left: Math.min(Math.max(tooltipX - 42, 0), containerWidth.current - 90),
            top: Math.max(0, tooltipY - 52),
            backgroundColor: NAVY_CARD,
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
            <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 1 }}>
              {data[hoveredIndex].day} · {unit}
            </Text>
          </View>
        )}

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

        <View style={{ flexDirection: 'row', position: 'absolute', bottom: 0, left: 0, right: 0, gap: data.length > 8 ? 3 : 6 }}>
          {data.map((d, i) => {
            const isActive = i === activeIdx;
            return (
              <View key={d.day} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{
                  color: isActive ? activeColor : TEXT_MUT,
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

// ─── Hourly Line Graph ────────────────────────────────────────────────────────
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

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * containerWidth;
    const y = CHART_H - ((d.val - minVal) / (maxVal - minVal)) * (CHART_H - 10);
    return { x, y, ...d };
  });

  const solidPoints = points.filter(p => !p.isProjected);
  const projectedPoints = points.filter(p => p.isProjected || p.h === nowHour);

  const activeIdx = hoveredIndex ?? nowHour;
  const activePoint = points[activeIdx];

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={{ height: CHART_H + LABEL_H + 8, position: 'relative' }}
      {...panResponder.panHandlers}
    >
      {hoveredIndex !== null && activePoint && (
        <View style={{
          position: 'absolute',
          left: Math.min(Math.max(activePoint.x - 36, 0), containerWidth - 80),
          top: Math.max(0, activePoint.y - 42),
          backgroundColor: NAVY_CARD, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
          borderWidth: 1, borderColor: lineColor + '66',
          zIndex: 10, minWidth: 76, alignItems: 'center',
          shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.4, shadowRadius: 6, elevation: 8,
        }}>
          <Text style={{ color: lineColor, fontSize: 13, fontWeight: '800' }}>{formatValue(activePoint.val)}</Text>
          <Text style={{ color: TEXT_MUT, fontSize: 9, marginTop: 1 }}>{activePoint.label} · {unit}</Text>
        </View>
      )}

      <View style={{ height: CHART_H, overflow: 'hidden' }}>
        {[0.25, 0.5, 0.75].map(frac => (
          <View key={frac} style={{
            position: 'absolute', left: 0, right: 0,
            top: frac * CHART_H, height: 1,
            backgroundColor: '#FFFFFF0A',
          }} />
        ))}

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

        {projectedPoints.length > 1 && projectedPoints.slice(0, -1).map((p, i) => {
          const next = projectedPoints[i + 1];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
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

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 0 }}>
        {data.filter((_, i) => i % 4 === 0).map(d => (
          <Text key={d.h} style={{
            color: d.h === nowHour ? lineColor : TEXT_MUT,
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
  const [steps, setSteps] = useState<DirectionStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const { height: screenH } = useWindowDimensions();
  const { T } = useTheme();
  const CARD_HEIGHT = screenH * 0.72;

  useEffect(() => {
    if (!visible || !originLat || !originLng || !destLat || !destLng) {
      setSteps([]);
      return;
    }
    let cancelled = false;
    setStepsLoading(true);
    const apiMode: 'DRIVE' | 'WALK' | 'BICYCLE' =
      travelMode === 'BUS' || travelMode === 'RIDESHARE' ? 'DRIVE' : travelMode as any;
    getRouteDirections({
      origin: { lat: originLat, lng: originLng },
      destination: { lat: destLat, lng: destLng },
      travel_mode: apiMode,
    })
      .then(result => { if (!cancelled) setSteps(result); })
      .catch(() => { if (!cancelled) setSteps([]); })
      .finally(() => { if (!cancelled) setStepsLoading(false); });
    return () => { cancelled = true; };
  }, [visible, originLat, originLng, destLat, destLng, travelMode]);

  const modeIcon: Record<TravelMode, any> = {
    DRIVE: 'car', WALK: 'walk', BICYCLE: 'bicycle', BUS: 'bus', RIDESHARE: 'car-sport',
  };

  function maneuverIcon(maneuver: string): { name: any; rotate: string } {
    const m = (maneuver ?? '').toUpperCase();
    if (m.includes('TURN_RIGHT') || m === 'TURN-RIGHT') return { name: 'arrow-forward', rotate: '45deg' };
    if (m.includes('TURN_LEFT')  || m === 'TURN-LEFT')  return { name: 'arrow-back',    rotate: '-45deg' };
    if (m.includes('UTURN'))       return { name: 'return-down-back', rotate: '0deg' };
    if (m.includes('ROUNDABOUT')) return { name: 'refresh',           rotate: '0deg' };
    if (m.includes('RAMP') || m.includes('FORK') || m.includes('MERGE')) return { name: 'git-merge', rotate: '0deg' };
    if (m.includes('FERRY'))       return { name: 'boat',             rotate: '0deg' };
    if (m.includes('ARRIVE'))      return { name: 'location',         rotate: '0deg' };
    return { name: 'arrow-up', rotate: '0deg' };
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={dm.backdrop}>
        <View style={[dm.card, { height: CARD_HEIGHT, backgroundColor: T.BG }]}>
          <View style={dm.tabRow}>
            <Text style={[dm.tabText, { color: T.TEXT_PRI, fontWeight: '800' }]}>Details</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[dm.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                <Ionicons name="close" size={16} color={T.TEXT_PRI} />
              </View>
            </Pressable>
          </View>

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
              <View style={[dm.lineDivider, { backgroundColor: T.DIVIDER ?? '#FFFFFF22' }]} />

              {stepsLoading ? (
                <View style={[dm.stepRow, { justifyContent: 'center', gap: 10 }]}>
                  <ActivityIndicator size="small" color={T.ACCENT ?? SEAFOAM} />
                  <Text style={{ color: T.TEXT_MUT, fontSize: 13 }}>Loading directions…</Text>
                </View>
              ) : steps.length > 0 ? (
                steps.map((step, i) => {
                  const { name: iconName, rotate } = maneuverIcon(step.maneuver);
                  const dm_ = step.distanceMeters;
                  const distLabel = dm_ >= 1609
                    ? `${(dm_ / 1609.34).toFixed(1)} mi`
                    : `${Math.round(dm_ * 3.281)} ft`;
                  return (
                    <View key={i}>
                      <View style={dm.stepRow}>
                        <View style={dm.stepIconSimple}>
                          <Ionicons
                            name={iconName}
                            size={24}
                            color={T.TEXT_PRI}
                            style={{ transform: [{ rotate }] }}
                          />
                        </View>
                        <View style={dm.stepContent}>
                          <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>{distLabel}</Text>
                          <Text style={[dm.stepInst, { color: T.TEXT_MUT }]}>{step.htmlInstruction || 'Continue'}</Text>
                        </View>
                      </View>
                      <View style={[dm.lineDivider, { backgroundColor: T.DIVIDER ?? '#FFFFFF22' }]} />
                    </View>
                  );
                })
              ) : (
                <View style={dm.stepRow}>
                  <View style={dm.stepContent}>
                    <Text style={{ color: T.TEXT_MUT, fontSize: 13 }}>
                      {originLat && originLng && destLat && destLng
                        ? 'No directions available for this route.'
                        : 'Set origin and destination to see directions.'}
                    </Text>
                  </View>
                </View>
              )}

              <View style={[dm.stepRow, { paddingLeft: 8 }]}>
                <View style={[dm.stepIcon, { backgroundColor: T.isDark ? SEAFOAM + '22' : '#EDE8FF' }]}>
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
    </Modal>
  );
}

// ─── Draggable stop row ───────────────────────────────────────────────────────
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
        applySlot(Math.round((x / sliderWidth.current) * (TOTAL_SLOTS - 1)));
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        applySlot(Math.round((x / sliderWidth.current) * (TOTAL_SLOTS - 1)));
      },
    })
  ).current;

  const fillPct = (slotIndex / (TOTAL_SLOTS - 1)) * 100;
  const hourTicks = [0, 4, 8, 12, 16, 20];

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ color: textMut, fontSize: 12, fontWeight: '600', marginBottom: 12, letterSpacing: 0.8 }}>
        {label}
      </Text>
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <Text style={{ color: textPri, fontSize: 44, fontWeight: '800', letterSpacing: -1 }}>
          {slotToLabel(slotIndex)}
        </Text>
      </View>
      <View
        ref={trackRef}
        onLayout={e => { sliderWidth.current = e.nativeEvent.layout.width; }}
        style={{ height: 48, justifyContent: 'center', paddingHorizontal: 2 }}
        {...panResponder.panHandlers}
      >
        <View style={{ height: 10, backgroundColor: itemBg, borderRadius: 5, overflow: 'visible' }}>
          <View style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${fillPct}%`,
            backgroundColor: accentColor,
            borderRadius: 5,
          }} />
          <View style={{
            position: 'absolute',
            left: `${fillPct}%`,
            top: '50%',
            width: 26, height: 26, borderRadius: 13,
            backgroundColor: accentColor,
            borderWidth: 3, borderColor: '#fff',
            marginLeft: -13, marginTop: -13,
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
          }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 2 }}>
        {hourTicks.map(h => (
          <Text key={h} style={{ color: textMut, fontSize: 10, fontWeight: '600' }}>
            {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
          </Text>
        ))}
        <Text style={{ color: textMut, fontSize: 10, fontWeight: '600' }}>11p</Text>
      </View>
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

// ─── Stacked Route Deck Card (swipeable, mirrors "Recents" on home screen) ───
function RouteCard({
  alt,
  index,
  isSelected,
  onSelect,
  onShowInsights,
  onShowDetails,
  travelMode,
  originCoords,
  destCoords,
  stopsSwapped,
}: {
  alt: RouteAltRow;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onShowInsights: () => void;
  onShowDetails: () => void;
  travelMode: TravelMode;
  originCoords: { lat: number; lng: number } | null;
  destCoords: { lat: number; lng: number } | null;
  stopsSwapped: boolean;
}) {
  const { T } = useTheme();
  const isSafeWay = alt.routeSource === 'safeway';
  const score = alt.safetyScore;
  const safetyPct = score != null ? Math.max(0, Math.min(100, 100 - Math.round(score))) : null;
  const safetyColor = score == null ? TEXT_MUT
    : score < 33 ? SEAFOAM : score < 66 ? '#FFA500' : '#FF4444';

  return (
    <Pressable onPress={onSelect}>
      <View style={[
        deck.card,
        {
          backgroundColor: isSelected ? T.BG : T.CARD,
          borderColor: isSelected ? safetyColor + '66' : GLASS_BORDER,
          borderWidth: isSelected ? 1.5 : 1,
          marginBottom: 10,
        },
      ]}>
        {/* Card header: safety badge + timing */}
        <View style={deck.cardHeader}>
          {/* Safety badge */}
          <View style={[deck.safetyBadge, { borderColor: safetyColor + '40' }]}>
            {isSafeWay ? (
              <LinearGradient
                colors={['#064E3B', '#047857']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[StyleSheet.absoluteFillObject, { borderRadius: 14 }]}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: safetyColor + '22', borderRadius: 14 }]} />
            )}
            <View style={deck.safetyBadgeContent}>
              <Text style={[deck.safetyLabel, { color: isSafeWay ? 'rgba(255,255,255,0.7)' : safetyColor }]}>
                {isSafeWay ? 'SAFEWAY' : 'SAFETY'}
              </Text>
              {safetyPct != null ? (
                <Text style={[deck.safetyPct, { color: '#fff' }]}>{safetyPct}%</Text>
              ) : (
                <Text style={[deck.safetyPct, { color: TEXT_MUT, fontSize: 18 }]}>N/A</Text>
              )}
            </View>
          </View>

          {/* ETA + meta */}
          <View style={deck.etaBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={[deck.etaTime, { color: T.TEXT_PRI }]}>{fmtSecs(alt.durationSecs)}</Text>
              {isSafeWay && (
                <View style={deck.safewayBadge}>
                  <Ionicons name="shield-checkmark" size={10} color={SEAFOAM} />
                  <Text style={deck.safewayBadgeText}>SafeWay</Text>
                </View>
              )}
              {isSelected && (
                <View style={{ backgroundColor: SEAFOAM + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: SEAFOAM, fontSize: 9, fontWeight: '800' }}>SELECTED</Text>
                </View>
              )}
            </View>
            <Text style={[deck.etaMeta, { color: T.TEXT_MUT }]}>
              {fmtDist(alt.distance)}
              {score != null ? `  ·  Risk: ${Math.round(score)}` : ''}
            </Text>
            <Text style={[deck.etaArrival, { color: T.ACCENT }]}>
              Arrive ~{arrivalFrom(alt.durationSecs)}
              {alt.nHighRisk ? `  ·  ${alt.nHighRisk} hot spots` : ''}
            </Text>
          </View>
        </View>

        {/* Action buttons — only on selected card */}
        {isSelected && (
          <View style={deck.actionsRow}>
            <Pressable
              style={deck.startBtn}
              onPress={() => {
                const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                const from = stopsSwapped ? destCoords : originCoords;
                const to   = stopsSwapped ? originCoords : destCoords;
                Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
              }}
            >
              <LinearGradient
                colors={['#064E3B', '#047857', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[StyleSheet.absoluteFillObject, { borderRadius: 12 }]}
              />
              <View style={[StyleSheet.absoluteFillObject, { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }]} />
              <Ionicons name="navigate" size={15} color="#fff" />
              <Text style={deck.startBtnText}>Start</Text>
            </Pressable>

            <Pressable
              style={[deck.insightsBtn, { backgroundColor: T.isDark ? 'rgba(74,144,226,0.15)' : 'rgba(74,144,226,0.12)', borderColor: 'rgba(74,144,226,0.4)' }]}
              onPress={onShowInsights}
            >
              <Ionicons name="stats-chart" size={14} color="#4A90E2" />
              <Text style={deck.insightsBtnText}>Insights</Text>
            </Pressable>

            <Pressable
              style={[deck.detailsBtn, { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: GLASS_BORDER }]}
              onPress={onShowDetails}
            >
              <Ionicons name="list-outline" size={14} color={T.TEXT_MUT} />
              <Text style={[deck.detailsBtnText, { color: T.TEXT_MUT }]}>Steps</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function StackedRouteDeck({
  alternatives, selectedRouteIndex, onSelectRoute, onShowDetails, onShowInsights,
  travelMode, originCoords, destCoords, stopsSwapped, routeBusy, activeData,
  activeSecs,
}: {
  alternatives: RouteAltRow[];
  selectedRouteIndex: number;
  onSelectRoute: (i: number) => void;
  onShowDetails: () => void;
  onShowInsights: () => void;
  travelMode: TravelMode;
  originCoords: { lat: number; lng: number } | null;
  destCoords: { lat: number; lng: number } | null;
  stopsSwapped: boolean;
  routeBusy: boolean;
  activeData: ModeRouteData | null;
  activeSecs: number;
}) {
  const { T } = useTheme();

  if (routeBusy) {
    return (
      <View style={deck.loadingWrap}>
        <ActivityIndicator size="small" color={T.ACCENT} />
        <Text style={[deck.loadingText, { color: T.TEXT_MUT }]}>Calculating routes…</Text>
      </View>
    );
  }

  const displayAlts = alternatives.length > 0 ? alternatives : (activeData ? [primaryToAlternativeRow(activeData)] : []);
  if (displayAlts.length === 0) return null;

  return (
    <View style={{ gap: 0 }}>
      {displayAlts.map((alt, i) => (
        <RouteCard
          key={i}
          alt={alt}
          index={i}
          isSelected={i === selectedRouteIndex}
          onSelect={() => onSelectRoute(i)}
          onShowInsights={onShowInsights}
          onShowDetails={onShowDetails}
          travelMode={travelMode}
          originCoords={originCoords}
          destCoords={destCoords}
          stopsSwapped={stopsSwapped}
        />
      ))}
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

  const snapPoints = useMemo(() => {
    const cardBottom = insets.top + 132;
    const safeMax = windowHeight - cardBottom - 8;
    const miniSnap = 110;
    return [miniSnap, Math.round(windowHeight * 0.52), safeMax];
  }, [windowHeight, insets.top]);
  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const timeCtx = getTimeContext();

  // Weather
  const [weather, setWeather] = useState<{ temperature: number; description: string; weather_code: number } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.coords.latitude}&longitude=${loc.coords.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
        );
        if (!r.ok) return;
        const json = await r.json();
        const current = json?.current ?? {};
        const code: number = current.weather_code ?? 0;
        const descriptions: Record<number, string> = {
          0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
          45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
          61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
          71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
          80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
          95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Hail storm',
        };
        setWeather({ temperature: Math.round(current.temperature_2m ?? 0), description: descriptions[code] ?? 'Clear sky', weather_code: code });
      } catch {}
    })();
  }, []);

  const weatherIcon = (() => {
    const d = (weather?.description ?? '').toLowerCase();
    if (d.includes('thunder')) return 'thunderstorm-outline';
    if (d.includes('snow'))   return 'snow-outline';
    if (d.includes('rain') || d.includes('shower') || d.includes('drizzle')) return 'rainy-outline';
    if (d.includes('fog'))    return 'cloud-outline';
    if (d.includes('cloud'))  return 'partly-sunny-outline';
    return 'sunny-outline';
  })();

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
  const [mapLatDelta, setMapLatDelta] = useState(0.05);
  const [selectedIncident, setSelectedIncident] = useState<TrafficIncident | null>(null);
  const [showTraffic, setShowTraffic] = useState(true);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [mapStyleType, setMapStyleType] = useState<'standard'|'satellite'|'hybrid'|'terrain'>('standard');

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

  const centerCoords = originCoords ?? destCoords;
  const { incidents: rawIncidents, loading: trafficLoading } = useTrafficIncidents({
    lat: centerCoords?.lat ?? null,
    lng: centerCoords?.lng ?? null,
    radiusKm: 8,
    enabled: showTraffic,
  });
  const incidents = React.useMemo(() => {
    const seen = new Set<string>();
    return rawIncidents.filter(inc => {
      const key = inc.id || `${inc.latitude}-${inc.longitude}-${inc.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rawIncidents]);
  const incidentsVisible = mapLatDelta < 0.08;

  useEffect(() => {
    if (params.originLat && params.originLng) return;
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
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords,
            aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      }

      if (!nd.DRIVE && googleDriveOk) {
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

      if (backendWalkRes.status === 'fulfilled' && backendWalkRes.value.routes.length > 0) {
        const alts = mapSafetyRoutesToAlternatives(backendWalkRes.value.routes);
        const primary = alts[0];
        nd.WALK = {
          primary: {
            coords: primary.coords, distance: primary.distance, durationSecs: primary.durationSecs,
            safetyScore: primary.safetyScore, safetyLabel: primary.safetyLabel, routeSource: primary.routeSource,
            riskPerKm: primary.riskPerKm, nHighRisk: primary.nHighRisk, routeKm: primary.routeKm,
            topRiskFactors: primary.topRiskFactors, timeBand: primary.timeBand,
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords,
            aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      } else {
        const walk = toModeRoutes(walkGoogleRes);
        if (walk) nd.WALK = walk;
      }

      if (backendBikeRes.status === 'fulfilled' && backendBikeRes.value.routes.length > 0) {
        const alts = mapSafetyRoutesToAlternatives(backendBikeRes.value.routes);
        const primary = alts[0];
        nd.BICYCLE = {
          primary: {
            coords: primary.coords, distance: primary.distance, durationSecs: primary.durationSecs,
            safetyScore: primary.safetyScore, safetyLabel: primary.safetyLabel, routeSource: primary.routeSource,
            riskPerKm: primary.riskPerKm, nHighRisk: primary.nHighRisk, routeKm: primary.routeKm,
            topRiskFactors: primary.topRiskFactors, timeBand: primary.timeBand,
            segmentRisks: primary.segmentRisks, highRiskCoords: primary.highRiskCoords,
            aadtAvg: primary.aadtAvg, aadtMax: primary.aadtMax,
            timePenaltyPct: primary.timePenaltyPct, riskReductionPct: primary.riskReductionPct,
          },
          alternatives: alts,
        };
      } else {
        const bike = toModeRoutes(bikeGoogleRes);
        if (bike) nd.BICYCLE = bike;
      }

      if (nd.DRIVE) {
        const avoidMult = 1 + (avoidSet.has('tolls') ? 0.05 : 0) + (avoidSet.has('highways') ? 0.15 : 0);
        const driveAlts = nd.DRIVE.alternatives?.length
          ? nd.DRIVE.alternatives
          : [primaryToAlternativeRow(nd.DRIVE.primary)];

        const scaleAlts = (factor: number) =>
          driveAlts.map((alt) => {
            const durationSecs = Math.round(alt.durationSecs * factor);
            return { ...alt, durationSecs, label: fmtSecs(durationSecs), segmentRisks: undefined };
          });

        const busAlts = scaleAlts(1.4 * avoidMult);
        const rideAlts = scaleAlts(1.1 * avoidMult);
        nd.BUS = {
          primary: { ...nd.DRIVE.primary, durationSecs: busAlts[0].durationSecs, segmentRisks: undefined },
          alternatives: busAlts,
        };
        nd.RIDESHARE = {
          primary: { ...nd.DRIVE.primary, durationSecs: rideAlts[0].durationSecs, segmentRisks: undefined },
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

  function handleSelectOrigin(place: PlaceSearchResult) {
    setOriginLabel(place.name);
    setOriginCoords({ lat: place.lat, lng: place.lng });
    setEditingOrigin(false); setOriginQuery(''); setOriginSuggestions([]);
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

  const TOP_BTNS = insets.top + 118;

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

  const modeItems: { mode: TravelMode; icon: any; label: string }[] = [
    { mode: 'DRIVE',     icon: 'car',           label: 'Drive'    },
    { mode: 'WALK',      icon: 'walk',          label: 'Walk'     },
    { mode: 'BUS',       icon: 'bus',           label: 'Transit'  },
    { mode: 'BICYCLE',   icon: 'bicycle',       label: 'Bike'     },
    { mode: 'RIDESHARE', icon: 'person-outline', label: 'Ride'    },
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
        initialRegion={mapRegion} showsUserLocation showsMyLocationButton={false}
        onRegionChange={(r) => setMapLatDelta(r.latitudeDelta)}
        onRegionChangeComplete={(r) => setMapLatDelta(r.latitudeDelta)}>

        {originCoords && (
          <Marker coordinate={{ latitude: originCoords.lat, longitude: originCoords.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originDot}><View style={styles.originDotInner} /></View>
          </Marker>
        )}
        {destCoords && <Marker coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }} pinColor="#FF4444" />}

        {alternatives.map((alt, i) => {
          if (!alt.coords?.length) return null;
          const isSelected = i === selectedRouteIndex;

          if (isSelected && isCoordSegmentArray(alt.segmentRisks as any)) {
            const segs = alt.segmentRisks as unknown as Array<{ start: RoutePoint; end: RoutePoint; risk: number }>;
            return segs.map((seg, si) => (
              <Polyline
                key={`${travelMode}-alt-${i}-seg-${si}`}
                coordinates={[seg.start, seg.end]}
                strokeColor={seg.risk > 66 ? '#FF4444' : seg.risk > 33 ? '#FFA500' : SEAFOAM}
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
          <Marker key={`hs-${i}`} coordinate={coord} anchor={{ x: 0.5, y: 1.0 }} tracksViewChanges={false}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
          </Marker>
        ))}

        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap points={crashPoints} opacity={0.72} radius={20}
            gradient={{ colors: ['#00E5FF', '#FFD600', '#FF1744'], startPoints: [0.1, 0.5, 1.0], colorMapSize: 256 }}
          />
        )}

        {showTraffic && incidentsVisible && incidents.map((inc, idx) => {
          const stableKey = inc.id
            ? `inc-id-${inc.id}`
            : `inc-pos-${inc.latitude.toFixed(6)}-${inc.longitude.toFixed(6)}-${inc.category}-${idx}`;
          return (
            <IncidentMarker
              key={stableKey}
              incident={inc}
              latDelta={mapLatDelta}
              onPress={() => setSelectedIncident(inc)}
            />
          );
        })}
      </MapView>

      {/* ── Vignette gradients ── */}
      <LinearGradient
        colors={['rgba(3,4,39,0.90)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140, zIndex: 5 }}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(3,4,39,0.55)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 240, zIndex: 5 }}
        pointerEvents="none"
      />

      {/* ── Incident detail popup ── */}
      <IncidentDetailPopup
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
      />

      {/* ── Back button ── */}
      <Pressable
        style={[styles.backBtn, { top: insets.top + 10 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={20} color={TEXT_PRI} />
      </Pressable>

      {/* ── Top search card ── */}
      <View style={[styles.topRouteCard, { top: insets.top + 10, backgroundColor: NAVY_GLASS, borderColor: GLASS_BORDER }]}>
        <View style={styles.topRouteInner}>
          <View style={styles.topRouteDotCol}>
            <View style={styles.originDotSmall} />
            <View style={[styles.topRouteLine, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
            <Ionicons name="location" size={15} color="#FF5A5A" />
          </View>

          <View style={styles.topRouteFields}>
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
                  placeholderTextColor={TEXT_MUT}
                  autoFocus
                  style={[styles.topRouteInput, { color: TEXT_PRI }]}
                  selectionColor={SEAFOAM}
                />
              ) : (
                <Text style={[styles.topRouteLabel, { color: TEXT_PRI }]} numberOfLines={1}>{originLabel}</Text>
              )}
            </Pressable>

            <View style={[styles.topFieldDivider, { backgroundColor: 'rgba(255,255,255,0.10)' }]} />

            <Pressable style={styles.topRouteField} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
              {editingDest ? (
                <TextInput
                  value={destQuery}
                  onChangeText={text => {
                    setDestQuery(text);
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    if (text.trim().length < 2) { setDestSuggestions([]); return; }
                    debounceRef.current = setTimeout(async () => {
                      setSuggBusy(true);
                      try { setDestSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
                      catch { setDestSuggestions([]); }
                      finally { setSuggBusy(false); }
                    }, 350);
                  }}
                  placeholder="Destination…"
                  placeholderTextColor={TEXT_MUT}
                  autoFocus
                  style={[styles.topRouteInput, { color: TEXT_PRI }]}
                  selectionColor={SEAFOAM}
                />
              ) : (
                <Text style={[styles.topRouteLabel, { color: TEXT_PRI }]} numberOfLines={1}>{destLabel}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={[styles.topRouteSwapBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
            onPress={() => {
              const pL = originLabel, pC = originCoords;
              setOriginLabel(destLabel); setOriginCoords(destCoords); setOriginAddress(destLabel);
              setDestLabel(pL); setDestCoords(pC);
              setRouteByMode({}); setSelectedRouteIndex(0);
              setTimeout(() => { void fetchAllRoutes(); }, 50);
            }}
          >
            <Ionicons name="swap-vertical" size={18} color={TEXT_MUT} />
          </Pressable>
        </View>

        {editingOrigin && originSuggestions.length > 0 && (
          <View style={[styles.topSuggList, { backgroundColor: NAVY_CARD }]}>
            {originSuggestions.map((s, i) => (
              <View key={s.place_id}>
                <Pressable style={styles.topSuggRow} onPress={() => handleSelectOrigin(s)}>
                  <Ionicons name="location-outline" size={14} color={SEAFOAM} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.topSuggTitle, { color: TEXT_PRI }]} numberOfLines={1}>{s.name}</Text>
                    <Text style={[styles.topSuggSub, { color: TEXT_MUT }]} numberOfLines={1}>{s.address}</Text>
                  </View>
                </Pressable>
                {i < originSuggestions.length - 1 && <View style={[styles.topSuggDiv, { backgroundColor: DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}

        {editingDest && destSuggestions.length > 0 && (
          <View style={[styles.topSuggList, { backgroundColor: NAVY_CARD }]}>
            {destSuggestions.map((s, i) => (
              <View key={s.place_id}>
                <Pressable style={styles.topSuggRow} onPress={() => handleSelectDest(s)}>
                  <Ionicons name="location-outline" size={14} color={SEAFOAM} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.topSuggTitle, { color: TEXT_PRI }]} numberOfLines={1}>{s.name}</Text>
                    <Text style={[styles.topSuggSub, { color: TEXT_MUT }]} numberOfLines={1}>{s.address}</Text>
                  </View>
                </Pressable>
                {i < destSuggestions.length - 1 && <View style={[styles.topSuggDiv, { backgroundColor: DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Zoom cluster ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS, borderRadius: 14, overflow: 'hidden', width: 42, backgroundColor: T.ITEM }}>
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(0.5)}><Ionicons name="add" size={22} color={T.TEXT_PRI} /></Pressable>
        <View style={[styles.zoomDiv, { backgroundColor: T.DIVIDER }]} />
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(2)}><Ionicons name="remove" size={22} color={T.TEXT_PRI} /></Pressable>
      </View>

      {/* ── Locate ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 100, width: 42, height: 42, borderRadius: 21 }}>
        <Pressable style={[styles.floatBtnInner, { backgroundColor: T.ITEM }]} onPress={handleLocate}>
          <Ionicons name="locate" size={20} color={T.ACCENT} />
        </Pressable>
      </View>

      {/* ── Heatmap pill ── */}
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

      {/* ── Traffic pill ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 202 }}>
        <Pressable
          style={[styles.heatmapInner, { backgroundColor: T.ITEM }, showTraffic && { borderColor: '#FF475744', borderWidth: 1 }]}
          onPress={() => setShowTraffic(v => !v)}
        >
          {trafficLoading
            ? <ActivityIndicator size="small" color="#FF4757" style={{ width: 14 }} />
            : <Text style={{ fontSize: 13, lineHeight: 16 }}>🚦</Text>
          }
          {showTraffic && (
            <Text style={[styles.heatmapText, { color: '#FF4757' }]}>
              {incidentsVisible ? `${incidents.length}` : 'Traffic'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── Modals ── */}
      <Modal visible={showHeatmapModal} transparent animationType="slide" onRequestClose={() => setShowHeatmapModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowHeatmapModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]} onPress={() => {}}>
            <Text style={[hm.title, { color: TEXT_PRI }]}>Map Style</Text>
            <View style={hm.mapStyleRow}>
              {MAP_STYLE_OPTIONS.map(opt => {
                const active = mapStyleType === opt.id;
                return (
                  <Pressable key={opt.id}
                    style={[hm.mapStyleBtn, { backgroundColor: NAVY_ITEM }, active && { borderColor: SEAFOAM, backgroundColor: 'rgba(26,188,147,0.12)' }]}
                    onPress={() => setMapStyleType(opt.id)}>
                    <Ionicons name={opt.icon as any} size={22} color={active ? SEAFOAM : TEXT_MUT} />
                    <Text style={[hm.mapStyleLabel, { color: active ? SEAFOAM : TEXT_MUT }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[hm.sectionDiv, { backgroundColor: DIVIDER }]} />
            <View style={hm.header}>
              <Text style={[hm.title, { color: TEXT_PRI }]}>Safety Heatmap</Text>
              {heatmapFilter !== 'off' && (
                <View style={[hm.countBadge, { backgroundColor: NAVY_ITEM }]}>
                  {crashLoading
                    ? <ActivityIndicator size="small" color={SEAFOAM} />
                    : <Text style={[hm.countText, { color: SEAFOAM }]}>{crashPoints.length.toLocaleString()} points</Text>
                  }
                </View>
              )}
            </View>
            <Text style={[hm.subtitle, { color: TEXT_MUT }]}>Crash data from traffic records. Brighter = higher density.</Text>
            <View style={[hm.filterList, { backgroundColor: NAVY_ITEM }]}>
              {HEATMAP_FILTERS.map((f, i) => {
                const active = heatmapFilter === f.id;
                return (
                  <View key={f.id}>
                    <Pressable
                      style={[hm.filterRow, active && hm.filterRowActive]}
                      onPress={() => { setHeatmapFilter(f.id); setShowHeatmapModal(false); }}
                    >
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : NAVY }]}>
                        <Ionicons name={f.icon as any} size={20} color={active ? f.color : TEXT_MUT} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, { color: TEXT_MUT }, active && { color: TEXT_PRI }]}>{f.label}</Text>
                        <Text style={[hm.filterDesc, { color: TEXT_MUT }]}>{f.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={SEAFOAM} />}
                    </Pressable>
                    {i < HEATMAP_FILTERS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: DIVIDER }]} />}
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showNowModal} transparent animationType="slide" onRequestClose={() => setShowNowModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowNowModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]} onPress={() => {}}>
            <Text style={[hm.title, { color: TEXT_PRI }]}>Departure Time</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
              {(['now', 'depart', 'arrive'] as const).map(opt => {
                const active = nowChoice === opt;
                const label = opt === 'now' ? 'Leave now' : opt === 'depart' ? 'Depart at' : 'Arrive by';
                return (
                  <Pressable key={opt}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1.5,
                      backgroundColor: active ? SEAFOAM : NAVY_ITEM,
                      borderColor: active ? SEAFOAM : DIVIDER }}
                    onPress={() => setNowChoice(opt)}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : TEXT_MUT }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {nowChoice !== 'now' && (
              <TimeSliderPicker
                hour={pickerHour} min={pickerMin}
                onChangeHour={setPickerHour} onChangeMin={setPickerMin}
                label={nowChoice === 'depart' ? 'DEPARTING AT' : 'ARRIVING BY'}
                accentColor={SEAFOAM} textPri={TEXT_PRI} textMut={TEXT_MUT} itemBg={NAVY_ITEM}
              />
            )}
            <Pressable style={[styles.doneBtn, { backgroundColor: SEAFOAM }]} onPress={() => setShowNowModal(false)}>
              <Text style={styles.doneBtnText}>{nowChoice === 'now' ? 'Leave Now' : 'Confirm'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAvoidModal} transparent animationType="slide" onRequestClose={() => setShowAvoidModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowAvoidModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]} onPress={() => {}}>
            <Text style={[hm.title, { color: TEXT_PRI }]}>Avoid</Text>
            <Text style={[hm.subtitle, { color: TEXT_MUT }]}>Select route conditions to avoid.</Text>
            <View style={[hm.filterList, { backgroundColor: NAVY_ITEM }]}>
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
                        <Text style={[hm.filterLabel, { color: active ? TEXT_PRI : TEXT_MUT }]}>{opt.label}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={SEAFOAM} />}
                    </Pressable>
                    {i < AVOID_OPTIONS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: DIVIDER }]} />}
                  </View>
                );
              })}
            </View>
            <Pressable style={[styles.doneBtn, { backgroundColor: SEAFOAM, marginTop: 16 }]} onPress={() => setShowAvoidModal(false)}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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

      <RouteInsightsPage
        visible={showInsightsModal}
        onClose={() => setShowInsightsModal(false)}
        activeData={activeData ?? null}
        destLat={destCoords?.lat}
        destLng={destCoords?.lng}
        originLat={originCoords?.lat}
        originLng={originCoords?.lng}
      />

      {/* ── Floating bottom sheet ── */}
      <Animated.View pointerEvents="box-none" style={{ position:'absolute', left:FLOAT_SIDE, right:FLOAT_SIDE, bottom: (insets.bottom * 0.5 + FLOAT_BOTTOM), top:0 }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { overflow:'hidden', borderRadius:FLOAT_RADIUS }]}>
      <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
        onChange={handleSheetChange} animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bg={T.BG} />}
        handleComponent={() => (
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' }} />
          </View>
        )}
        enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + FLOAT_BOTTOM + 28 }]}
          scrollEnabled>

          <>
            {/* ── Greeting + weather row (SafeWay continuity) ── */}
            <View style={styles.greetingRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Ionicons name={timeCtx.icon as any} size={14} color={T.ACCENT} />
                <Text style={[styles.greetingText, { color: T.TEXT_PRI }]}>{timeCtx.label}</Text>
              </View>
              {weather && (
                <View style={[styles.weatherPill, { backgroundColor: T.CARD }]}>
                  <Ionicons name={weatherIcon as any} size={12} color={T.ACCENT} />
                  <Text style={[styles.weatherText, { color: T.TEXT_PRI }]}>
                    {weather.temperature}°F  ·  {weather.description}
                  </Text>
                </View>
              )}
            </View>

            {/* ── Destination label ── */}
            <View style={styles.destRow}>
              <View style={[styles.destIconWrap, { backgroundColor: 'rgba(255,75,75,0.15)' }]}>
                <Ionicons name="location" size={16} color="#FF4B4B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.destName, { color: T.TEXT_PRI }]} numberOfLines={1}>{destLabel}</Text>
                <Text style={[styles.destSub, { color: T.TEXT_MUT }]} numberOfLines={1}>{originLabel}</Text>
              </View>
              <Pressable onPress={() => router.back()}>
                <View style={[styles.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                  <Ionicons name="close" size={15} color={T.TEXT_PRI} />
                </View>
              </Pressable>
            </View>

            {/* ── Pill-style transport mode selector ── */}
            <View style={[styles.modePill, { backgroundColor: T.ITEM }]}>
              {modeItems.map(({ mode, icon, label }) => {
                const active = travelMode === mode;
                return (
                  <Pressable
                    key={mode}
                    style={[styles.modeOption, active && { backgroundColor: T.BG }]}
                    onPress={() => { setTravelMode(mode); setSelectedRouteIndex(0); }}
                  >
                    {active && (
                      <LinearGradient
                        colors={['#064E3B', '#047857']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]}
                      />
                    )}
                    <View style={[StyleSheet.absoluteFillObject, active && { borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }]} />
                    <Ionicons name={icon} size={18} color={active ? '#fff' : T.TEXT_MUT} />
                    {active && <Text style={styles.modeLabel}>{label}</Text>}
                  </Pressable>
                );
              })}
            </View>

            {/* ── Now / Avoid filter chips ── */}
            <View style={styles.filterRow}>
              <Pressable
                style={[styles.filterChip, { backgroundColor: NAVY_CARD, borderColor: GLASS_BORDER }]}
                onPress={() => setShowNowModal(true)}
              >
                <Ionicons name="time-outline" size={13} color={TEXT_MUT} />
                <Text style={[styles.filterText, { color: TEXT_PRI }]}>{nowLabel}</Text>
                <Ionicons name="chevron-down" size={12} color={TEXT_MUT} />
              </Pressable>
              <Pressable
                style={[
                  styles.filterChip,
                  { backgroundColor: NAVY_CARD, borderColor: avoidActive ? SEAFOAM + '55' : GLASS_BORDER },
                ]}
                onPress={() => setShowAvoidModal(true)}
              >
                <Ionicons name="ban-outline" size={13} color={avoidActive ? SEAFOAM : TEXT_MUT} />
                <Text style={[styles.filterText, { color: avoidActive ? SEAFOAM : TEXT_PRI }]}>
                  {avoidActive ? `Avoid (${avoidList.length})` : 'Avoid'}
                </Text>
                <Ionicons name="chevron-down" size={12} color={avoidActive ? SEAFOAM : TEXT_MUT} />
              </Pressable>
            </View>

            {/* ── Stacked Route Deck ── */}
            <StackedRouteDeck
              alternatives={alternatives}
              selectedRouteIndex={selectedRouteIndex}
              onSelectRoute={setSelectedRouteIndex}
              onShowDetails={() => setShowDetailsModal(true)}
              onShowInsights={() => setShowInsightsModal(true)}
              travelMode={travelMode}
              originCoords={originCoords}
              destCoords={destCoords}
              stopsSwapped={stopsSwapped}
              routeBusy={routeBusy}
              activeData={activeData}
              activeSecs={activeSecs}
            />
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
  backBtn: {
    position: 'absolute', left: 14, zIndex: 20,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(5,6,45,0.85)',
    borderWidth: 1, borderColor: GLASS_BORDER,
    justifyContent: 'center', alignItems: 'center',
  },
  topRouteCard: {
    position: 'absolute', left: 62, right: 14, zIndex: 15,
    borderRadius: 18, borderWidth: 1,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 12,
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
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  floatBtnInner: { flex: 1, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  heatmapInner: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
  heatmapInnerActive: { borderColor: '#FF6B6B55' },
  heatmapText: { fontSize: 12, fontWeight: '600' },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },
  sheetContent: { paddingHorizontal: 14, paddingTop: 6 },

  // Greeting row (mirrors index.tsx)
  greetingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  greetingText: { fontSize: 13, fontWeight: '700' },
  weatherPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  weatherText: { fontSize: 11, fontWeight: '600' },

  // Destination row
  destRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 14,
  },
  destIconWrap: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  destName: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  destSub: { fontSize: 12, marginTop: 1 },
  closeBtnCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },

  // Pill-style mode selector (matches Heatmap Filter design)
  modePill: {
    flexDirection: 'row', borderRadius: 26, padding: 4, gap: 2,
    marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  modeOption: {
    flex: 1, height: 40, borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    position: 'relative', overflow: 'hidden',
  },
  modeLabel: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Filter chips
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1,
  },
  filterText: { flex: 1, fontSize: 12, fontWeight: '600' },

  // Misc
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12, minHeight: 64 },
  stopIconWrap: { width: 26, alignItems: 'center' },
  originCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4A90E2', borderWidth: 2.5, borderColor: '#fff' },
  stopLabelWrap: { flex: 1 },
  stopLabel: { fontSize: 15, fontWeight: '600' },
  stopSub: { fontSize: 12, marginTop: 2 },
  dragHandle: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  doneBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

// ─── Deck styles ──────────────────────────────────────────────────────────────
const deck = StyleSheet.create({
  loadingWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 28,
  },
  loadingText: { fontSize: 14 },
  // Main card
  card: {
    borderRadius: 20, borderWidth: 1.5,
    padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  // Safety badge (left panel)
  safetyBadge: {
    width: 74, borderRadius: 14, paddingVertical: 10,
    alignItems: 'center', overflow: 'hidden', position: 'relative',
    borderWidth: 1,
  },
  safetyBadgeContent: { alignItems: 'center' },
  safetyLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 3 },
  safetyPct: { fontSize: 26, fontWeight: '900', color: '#fff' },
  // ETA block
  etaBlock: { flex: 1 },
  etaTime: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  etaMeta: { fontSize: 12, marginTop: 3 },
  etaArrival: { fontSize: 12, fontWeight: '600', marginTop: 3 },

  safewayBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(26,188,147,0.15)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  safewayBadgeText: { color: SEAFOAM, fontSize: 9, fontWeight: '800' },
  // Action buttons
  actionsRow: { flexDirection: 'row', gap: 8 },
  startBtn: {
    flex: 1.2, height: 42, borderRadius: 12, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'transparent',
  },
  startBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', zIndex: 1 },
  insightsBtn: {
    flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  insightsBtnText: { color: '#4A90E2', fontSize: 13, fontWeight: '700' },
  detailsBtn: {
    flex: 1, height: 42, borderRadius: 12, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  detailsBtnText: { fontSize: 13, fontWeight: '600' },
});

// ─── Details Modal styles ──────────────────────────────────────────────────────
const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 24 },
  tabRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 20 },
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
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  infoCard: { borderRadius: 20, padding: 20, width: '100%', maxWidth: 360 },
});

// ─── Heatmap modal styles ─────────────────────────────────────────────────────
const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 44 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 14, letterSpacing: -0.2 },
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