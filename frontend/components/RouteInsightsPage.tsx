/**
 * RouteInsightsPage.tsx
 *
 * Changes from previous version:
 *  - Removed the mini map (redundant with directions screen map)
 *  - Line graphs (AADT + Peak Flow) moved to top, above speed gauge
 *  - Speed gauge moved lower in the layout
 *  - Animated line graph: periodic "trace" animation replays the line
 *  - Safety hero: description replaced with client-side generated route summary
 *    (e.g. "Low crash rate · light traffic · SafeWay optimised")
 *  - Color theme tuned to match app navy/seafoam palette
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/providers/theme-context';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ModeRouteData {
  coords: { latitude: number; longitude: number }[];
  distance: number;
  durationSecs: number;
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

// ─── Design tokens (matching app theme) ──────────────────────────────────────
// Previous navy theme: NAVY='#030427', NAVY_CARD='#0D0E3A', NAVY_ITEM='#161750', GLASS_BORDER='#1A1B4D'
const NAVY        = '#030427';
const NAVY_CARD   = '#0D0E3A';
const NAVY_ITEM   = '#161750';
const GLASS_BORDER = '#1A1B4D';
const SEAFOAM     = '#1ABC93';
const TEXT_PRI    = '#FFFFFF';
const TEXT_MUT    = '#7A8FA6';
const TEXT_SUB    = '#8A9BBF';
const SCALE_COLORS = ['#000000', '#4B1D7E', '#8D2E6C', '#D4573A', '#F6C23E'] as const;

// ─── INFO content ─────────────────────────────────────────────────────────────
const INFO_CONTENT: Record<string, { title: string; body: string }> = {
  aadt: {
    title: 'AADT — Annual Average Daily Traffic',
    body:
      'AADT estimates the average number of vehicles passing through a road segment per day, averaged over a full year.\n\n' +
      'SafeWay uses AADT proxy values based on OpenStreetMap road classification:\n' +
      '• Residential: ~1,000/day\n• Secondary: ~15,000/day\n• Primary: ~25,000/day\n• Trunk: ~40,000/day\n• Motorway: ~60,000/day\n\n' +
      "This helps normalize crash rates — a highway with more crashes isn't necessarily more dangerous per vehicle-mile than a quiet street.",
  },
  shap: {
    title: 'What makes this route safer or riskier?',
    body:
      'SafeWay scores your route segment by segment. For each risky stretch, the model asks which real-world patterns best explain the score. Those explanations are summarized in the factors below.\n\n' +
      'The % on each row is not a second safety grade. It means roughly what share of assessed segments on this route flagged that factor when we explained the model (standard SHAP-style attribution).\n\n' +
      'Examples: crash history, lighting, pedestrian-related risk, speed patterns, road layout. Use this as transparency into what the model reacts to—not a guarantee of conditions on the ground.',
  },
};

const STAT_INFO: Record<string, string> = {
  AVG_SPEED:
    'Average speed across this route, computed from route distance and Google-estimated travel time.',
  PEAK_FLOW:
    'Estimated vehicles per hour, derived from the AADT daily average using time-of-day distribution factors. Dashed = projected for the rest of today.',
  TRAVEL_TIME:
    'Estimated total travel time from origin to destination under current traffic conditions.',
  SCORED_SEGMENTS:
    'Route Segments evaluates structural road safety for each segment — factoring in pavement condition, lane geometry, intersection density, and historical incident patterns.',
};

function extractSegmentRiskValues(segmentRisks: unknown): number[] {
  if (!Array.isArray(segmentRisks) || segmentRisks.length === 0) return [];
  const first = segmentRisks[0] as any;
  if (typeof first === 'number') {
    return (segmentRisks as number[]).filter(n => typeof n === 'number' && Number.isFinite(n));
  }
  if (first && typeof first === 'object' && typeof first.risk === 'number') {
    return (segmentRisks as { risk: number }[]).map(s => s.risk).filter(n => Number.isFinite(n));
  }
  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  return new Date(Date.now() + secs * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function estimateAadtFromDistanceMeters(distanceMeters: number): { avg: number; max: number } {
  const miles = Math.max(0.1, distanceMeters / 1609.34);
  const avg = Math.round(Math.min(52_000, Math.max(3_200, 1_800 + miles * 5_200)));
  const max = Math.round(avg * 1.34);
  return { avg, max };
}

// ─── Client-side route summary generator (no external API needed) ─────────────
/**
 * Generates a concise, friendly route summary from available data.
 * Replaces the old "description of safety score" with actionable highlights.
 *
 * NOTE: This is 100% client-side logic — no Gemini or external API call needed.
 * The data is deterministic enough that template-based generation works well here.
 * If you want AI-generated prose in future, you could call the Anthropic API
 * (already available in artifacts) with the route data as context.
 */
function generateRouteSummary(data: ModeRouteData | null): string {
  if (!data) return 'No route data available.';

  const parts: string[] = [];

  const score = data.safetyScore ?? null;
  const safetyPct = score != null ? Math.max(0, Math.min(100, 100 - Math.round(score))) : null;
  const hotSpots = data.nHighRisk ?? 0;
  const riskPerKm = data.riskPerKm ?? null;
  const aadtAvg = data.aadtAvg ?? null;
  const timePenalty = data.timePenaltyPct ?? 0;
  const riskReduction = data.riskReductionPct ?? 0;
  const isOptimised = data.routeSource === 'safeway';

  // Safety / crash rate
  if (safetyPct != null) {
    if (safetyPct >= 80) parts.push('Low crash risk');
    else if (safetyPct >= 60) parts.push('Moderate crash risk');
    else parts.push('Higher crash risk');
  }

  // Hot spots
  if (hotSpots === 0) parts.push('no danger zones');
  else if (hotSpots <= 2) parts.push(`${hotSpots} minor hot spot${hotSpots > 1 ? 's' : ''}`);
  else parts.push(`${hotSpots} high-risk zones — caution advised`);

  // Traffic / AADT
  if (aadtAvg != null) {
    if (aadtAvg < 5000)       parts.push('very light traffic');
    else if (aadtAvg < 15000) parts.push('light traffic');
    else if (aadtAvg < 30000) parts.push('moderate traffic');
    else                      parts.push('heavy traffic corridor');
  }

  // Route optimisation
  if (isOptimised && riskReduction > 0) {
    parts.push(`${Math.round(riskReduction)}% safer than fastest route`);
  } else if (isOptimised) {
    parts.push('SafeWay optimised');
  }

  // Time penalty context
  if (timePenalty > 0 && timePenalty < 15) {
    parts.push(`only +${Math.round(timePenalty)}% longer`);
  }

  if (parts.length === 0) return 'Route data available — see metrics below.';

  // Capitalise first, join with middle dots
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' · ');
}

// ─── Animated Hourly Line Graph ───────────────────────────────────────────────
function HourlyLineGraph({
  data,
  nowHour,
  lineColor,
  projectedColor,
  formatValue,
  unit,
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
  // Animation: progress 0→1 drives the visible portion of the solid line
  const traceAnim = useRef(new RNAnimated.Value(1)).current;
  const CHART_H = 80;
  const LABEL_H = 18;

  // Replay trace animation every 6 seconds
  useEffect(() => {
    const replay = () => {
      traceAnim.setValue(0);
      RNAnimated.timing(traceAnim, {
        toValue: 1,
        duration: 1800,
        useNativeDriver: false,
      }).start();
    };
    replay();
    const id = setInterval(replay, 6000);
    return () => clearInterval(id);
  }, []);

  const vals = data.map(d => d.val);
  const maxVal = Math.max(...vals, 1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        const x = evt.nativeEvent.locationX;
        setHoveredIndex(Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1)))));
      },
      onPanResponderMove: evt => {
        const x = evt.nativeEvent.locationX;
        setHoveredIndex(Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1)))));
      },
      onPanResponderRelease: () => { setTimeout(() => setHoveredIndex(null), 2000); },
      onPanResponderTerminate: () => { setTimeout(() => setHoveredIndex(null), 2000); },
    }),
  ).current;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * containerWidth;
    const y = CHART_H - (d.val / maxVal) * (CHART_H - 10);
    return { x, y, ...d };
  });

  const nowIdx = data.findIndex(d => d.h === nowHour);
  const solidPoints = points.slice(0, nowIdx + 1);
  const projectedPoints = points.slice(nowIdx);
  const activeIdx = hoveredIndex ?? nowIdx;
  const activePoint = points[activeIdx] ?? null;

  // Animated segments: traceAnim controls how many solid segments are "lit"
  const [traceVal, setTraceVal] = useState(1);
  useEffect(() => {
    const id = traceAnim.addListener(({ value }) => setTraceVal(value));
    return () => traceAnim.removeListener(id);
  }, []);

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={{ height: CHART_H + LABEL_H + 8, position: 'relative' }}
      {...panResponder.panHandlers}
    >
      {/* Tooltip */}
      {hoveredIndex !== null && activePoint && (
        <View
          style={{
            position: 'absolute',
            left: Math.min(Math.max(activePoint.x - 36, 0), containerWidth - 80),
            top: Math.max(0, activePoint.y - 42),
            backgroundColor: NAVY_CARD,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderWidth: 1,
            borderColor: lineColor + '66',
            zIndex: 10,
            minWidth: 76,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: lineColor, fontSize: 13, fontWeight: '800' }}>{formatValue(activePoint.val)}</Text>
          <Text style={{ color: TEXT_MUT, fontSize: 9, marginTop: 1 }}>{activePoint.label} · {unit}</Text>
        </View>
      )}

      <View style={{ height: CHART_H, overflow: 'hidden' }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(frac => (
          <View key={frac} style={{ position: 'absolute', left: 0, right: 0, top: frac * CHART_H, height: 1, backgroundColor: '#FFFFFF0A' }} />
        ))}

        {/* Solid line with trace animation */}
        {solidPoints.length > 1 && solidPoints.slice(0, -1).map((p, i) => {
          const next = solidPoints[i + 1];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          // Determine if this segment is "traced" yet
          const segFrac = (i + 1) / (solidPoints.length - 1);
          const opacity = traceVal >= segFrac ? 1 : traceVal >= segFrac - (1 / (solidPoints.length - 1)) ? 0.3 : 0.08;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y - 1.5,
                width: len,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: lineColor,
                opacity,
                transform: [{ rotate: `${angle}deg` }],
                // @ts-ignore
                transformOrigin: '0 50%',
              }}
            />
          );
        })}

        {/* Projected dashed line */}
        {projectedPoints.length > 1 && projectedPoints.slice(0, -1).map((p, i) => {
          const next = projectedPoints[i + 1];
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={`proj-${i}`}
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y - 1.5,
                width: len,
                height: 3,
                borderRadius: 1.5,
                backgroundColor: projectedColor,
                transform: [{ rotate: `${angle}deg` }],
                // @ts-ignore
                transformOrigin: '0 50%',
                opacity: 0.55,
              }}
            />
          );
        })}

        {/* "Now" dot */}
        {solidPoints.length > 0 && (() => {
          const nowPt = solidPoints[solidPoints.length - 1];
          return (
            <View style={{ position: 'absolute', left: nowPt.x - 5, top: nowPt.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: lineColor, borderWidth: 2, borderColor: '#fff' }} />
          );
        })()}

        {/* Hover dot */}
        {hoveredIndex !== null && activePoint && (
          <View style={{ position: 'absolute', left: activePoint.x - 5, top: activePoint.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: activePoint.isProjected ? projectedColor : lineColor, borderWidth: 2, borderColor: '#fff' }} />
        )}
      </View>

      {/* X-axis labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        {data.filter((_, i) => i % 4 === 0).map(d => (
          <Text key={d.h} style={{ color: d.h === nowHour ? lineColor : TEXT_MUT, fontSize: 9, fontWeight: d.h === nowHour ? '700' : '500' }}>
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Animated Speed Gauge ─────────────────────────────────────────────────────
function AvgSpeedGauge({ mph, accent }: { mph: number; accent: string }) {
  const MIN_MPH = 0;
  const MAX_MPH = 120;
  const ARC_START_DEG = -165;
  const ARC_END_DEG = -15;
  const ARC_SWEEP_DEG = ARC_END_DEG - ARC_START_DEG;

  const W = 232;
  const H = 128;
  const cx = W / 2;
  const hubY = H - 18;
  const arcRadius = 80;

  const labelPoint = (v: number, rOffset = 16) => {
    const t = (v - MIN_MPH) / (MAX_MPH - MIN_MPH);
    const ang = (ARC_START_DEG + t * ARC_SWEEP_DEG) * (Math.PI / 180);
    const r = arcRadius + rOffset;
    return { x: cx + r * Math.cos(ang), y: hubY + r * Math.sin(ang) };
  };
  const p0 = labelPoint(0);
  const p60 = labelPoint(60, 18);
  const p120 = labelPoint(120);

  const clampedMph = Math.min(MAX_MPH, Math.max(MIN_MPH, Number.isFinite(mph) ? mph : 0));
  const needleAngleDeg = ARC_START_DEG + (clampedMph / MAX_MPH) * ARC_SWEEP_DEG;
  const needleLen = 66;
  const animatedNeedleDeg = useSharedValue(ARC_START_DEG);

  useEffect(() => {
    animatedNeedleDeg.value = withSpring(needleAngleDeg, { damping: 17, stiffness: 155 });
  }, [needleAngleDeg]);

  const animatedNeedleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -needleLen / 2 },
      { rotate: `${animatedNeedleDeg.value}deg` },
      { translateX: needleLen / 2 },
    ],
  }));

  return (
    <View style={{ width: W, height: H + 6 }}>
      <LinearGradient
        colors={['#06B6D433', '#8B5CF644', '#F43F5E55']}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 12, top: 10, width: W - 24, height: H - 24, borderTopLeftRadius: 999, borderTopRightRadius: 999 }}
      />
      <View style={{ width: W, height: H, position: 'relative' }}>
        {Array.from({ length: 42 }, (_, i) => {
          const t = i / 41;
          const ang = (ARC_START_DEG + t * ARC_SWEEP_DEG) * (Math.PI / 180);
          const r = arcRadius;
          const x = cx + r * Math.cos(ang) - 2.5;
          const y = hubY + r * Math.sin(ang) - 2.5;
          const speedAt = t * 120;
          const on = mph > 0 && speedAt <= mph;
          const col = !on ? '#FFFFFF12' : speedAt < 38 ? '#4ADE80' : speedAt < 76 ? '#FACC15' : '#FB7185';
          return <View key={i} style={{ position: 'absolute', left: x, top: y, width: 5, height: 5, borderRadius: 2.5, backgroundColor: col }} />;
        })}

        {/* Needle */}
        <View style={{ position: 'absolute', left: cx, top: hubY, width: 0, height: 0, alignItems: 'center', zIndex: 2 }}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: -2.5, width: needleLen, height: 5, borderRadius: 2.5, backgroundColor: accent, shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.85, shadowRadius: 10, elevation: 8 }, animatedNeedleStyle]} />
        </View>

        {/* Hub */}
        <View style={{ position: 'absolute', left: cx - 12, top: hubY - 12, width: 24, height: 24, borderRadius: 12, backgroundColor: '#0B1020', borderWidth: 2, borderColor: accent, zIndex: 3, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
        </View>

        <Text style={{ position: 'absolute', left: p0.x - 7, top: p0.y - 7, color: '#4ADE80', fontSize: 10, fontWeight: '800' }}>0</Text>
        <Text style={{ position: 'absolute', left: p60.x - 8, top: p60.y - 8, color: '#64748B', fontSize: 10, fontWeight: '700' }}>60</Text>
        <Text style={{ position: 'absolute', left: p120.x - 11, top: p120.y - 7, color: '#FB7185', fontSize: 10, fontWeight: '800' }}>120</Text>
      </View>
    </View>
  );
}

// ─── SHAP Risk Factors Card ───────────────────────────────────────────────────
function ShapRiskFactors({ factors, infoKey, setInfoKey }: { factors: any[]; infoKey: string | null; setInfoKey: (k: string | null) => void }) {
  return (
    <View style={[s.statCardWide]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Text style={[s.statLabel, { color: TEXT_MUT }]}>What shaped this safety score?</Text>
        <Pressable onPress={() => setInfoKey(infoKey === 'shap' ? null : 'shap')} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={15} color={TEXT_MUT} />
        </Pressable>
      </View>
      <Text style={{ color: TEXT_SUB, fontSize: 11, lineHeight: 16, marginBottom: 12 }}>
        Bars show how often each pattern showed up among assessed segments—not a separate safety rating.
      </Text>

      {infoKey === 'shap' && (
        <View style={s.infoBubble}>
          <Text style={s.infoBubbleText}>{INFO_CONTENT.shap.body}</Text>
        </View>
      )}

      <View style={{ gap: 10 }}>
        {factors.slice(0, 5).map((f: any, i: number) => {
          const label = f.label ?? f.factor ?? `Factor ${i + 1}`;
          const pct = f.pct ?? (f.weight != null ? Math.round(f.weight * 100) : 0);
          const barColor = pct > 50 ? '#FF4444' : pct > 25 ? '#FFA500' : SEAFOAM;
          const pctNote = f.pct != null ? 'of assessed segments' : 'relative weight';
          return (
            <View key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: TEXT_PRI, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: barColor, fontSize: 12, fontWeight: '800' }}>{pct.toFixed(0)}%</Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 9, fontWeight: '600', marginTop: 1 }}>{pctNote}</Text>
                </View>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: '#FFFFFF14', overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${Math.min(100, pct)}%`, backgroundColor: barColor, borderRadius: 3 }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Route Source Badge Card ──────────────────────────────────────────────────
function RouteSourceCard({ routeSource }: { routeSource: 'google' | 'safeway' }) {
  return (
    <View style={[s.statCardWide, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <Ionicons name={routeSource === 'safeway' ? 'shield-checkmark' : 'navigate'} size={22} color={routeSource === 'safeway' ? SEAFOAM : '#4A90E2'} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: TEXT_PRI, fontSize: 14, fontWeight: '800', marginBottom: 2 }}>
          {routeSource === 'safeway' ? 'SafeWay A* Route' : 'Google Maps Route'}
        </Text>
        <Text style={{ color: TEXT_MUT, fontSize: 12, lineHeight: 17 }}>
          {routeSource === 'safeway'
            ? 'Optimised for safety using our ML risk model + A* pathfinding algorithm'
            : 'Standard route from Google Routes API, scored by the SafeWay ML model'}
        </Text>
      </View>
    </View>
  );
}

// ─── Metrics body (shared by modal + /route-insights screen) ────────────────
export function RouteInsightsMetricsBody({
  activeData,
  activeTab = 'overview',
}: {
  activeData: ModeRouteData | null;
  activeTab?: 'overview' | 'aadt' | 'peak' | 'segments' | 'hotspots';
}) {
  const { T } = useTheme();
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);

  useEffect(() => {
    setInfoKey(null);
    setTooltipVisible(null);
  }, [activeData]);

  // ── Derived safety values ─────────────────────────────────────────────────
  const score = activeData?.safetyScore ?? null;
  const safetyPct = score != null ? Math.max(0, Math.min(100, 100 - Math.round(score))) : null;
  const safetyColor =
    score == null ? TEXT_MUT
    : score < 33  ? SEAFOAM
    : score < 66  ? '#FFA500'
    : '#FF4444';

  // ── Speed ────────────────────────────────────────────────────────────────
  const distM =
    activeData?.distance && activeData.distance > 0
      ? activeData.distance
      : activeData?.routeKm ? Math.round(activeData.routeKm * 1000) : 0;

  const effectiveDurationSecs =
    activeData?.durationSecs && activeData.durationSecs > 0
      ? activeData.durationSecs
      : activeData?.routeKm ? Math.round((activeData.routeKm / 30) * 3600) : 0;

  const avgSpeedMph =
    distM > 0 && effectiveDurationSecs > 0
      ? Math.round(distM / 1609.34 / (effectiveDurationSecs / 3600))
      : 0;

  // ── AADT ─────────────────────────────────────────────────────────────────
  const backendAadtAvg = activeData?.aadtAvg ?? null;
  const backendAadtMax = activeData?.aadtMax ?? null;
  const hasBackendAadt = backendAadtAvg != null && backendAadtAvg > 0;
  const mileageEstimate = !hasBackendAadt && distM > 0 ? estimateAadtFromDistanceMeters(distM) : null;
  const effectiveAadtAvg = hasBackendAadt ? backendAadtAvg! : mileageEstimate?.avg ?? null;
  const effectiveAadtMax = hasBackendAadt ? backendAadtMax ?? null : mileageEstimate?.max ?? null;
  const hasAadt = effectiveAadtAvg != null && effectiveAadtAvg > 0;
  const aadtSource: 'backend' | 'estimated' | 'none' = hasBackendAadt ? 'backend' : mileageEstimate ? 'estimated' : 'none';

  // ── Hourly AADT curve ─────────────────────────────────────────────────────
  const nowHour = new Date().getHours();

  const hourlyMultipliers = [
    0.18, 0.12, 0.08, 0.07, 0.10, 0.28,
    0.55, 0.85, 1.00, 0.88, 0.75, 0.80,
    0.82, 0.78, 0.76, 0.80, 0.95, 1.05,
    1.10, 0.90, 0.72, 0.55, 0.38, 0.25,
  ];

  const aadtHourlyData = Array.from({ length: 24 }, (_, h) => ({
    h,
    label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
    val: hasAadt ? Math.round(effectiveAadtAvg! * hourlyMultipliers[h]) : 0,
    isProjected: h > nowHour,
  }));

  const peakFlowHourly = aadtHourlyData.map(d => ({
    h: d.h,
    label: d.label,
    val: parseFloat((d.val / 1000).toFixed(2)),
    isProjected: d.isProjected,
  }));

  const currentHourAadt = aadtHourlyData[nowHour]?.val ?? 0;
  const peakHourIdx = hasAadt
    ? aadtHourlyData.reduce((maxI, d, i, arr) => (d.val > arr[maxI].val ? i : maxI), 0)
    : -1;
  const peakFlowNow = peakFlowHourly[nowHour]?.val ?? 0;

  // ── Scored segments (API segment risks) ───────────────────────────────────
  const segmentRiskValues = useMemo(
    () => extractSegmentRiskValues(activeData?.segmentRisks as unknown),
    [activeData?.segmentRisks],
  );
  const hasSegScores = segmentRiskValues.length > 0;
  const segMin = hasSegScores ? Math.min(...segmentRiskValues) : null;
  const segMax = hasSegScores ? Math.max(...segmentRiskValues) : null;
  const segMean = hasSegScores
    ? Math.round(segmentRiskValues.reduce((a, b) => a + b, 0) / segmentRiskValues.length)
    : null;

  // ── SHAP factors ──────────────────────────────────────────────────────────
  const shapFactors = Array.isArray(activeData?.topRiskFactors) ? (activeData!.topRiskFactors as any[]) : [];

  // ── Route summary (client-side) ───────────────────────────────────────────
  const routeSummary = useMemo(() => generateRouteSummary(activeData), [activeData]);

  return (
    <>
            {/* ── Safety Score Hero with route summary ── */}
            {activeTab === 'overview' && safetyPct != null ? (
              <LinearGradient
                colors={['#0D3B2E', '#0A1F3A', '#1A1B4D']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 20, padding: 1.5 }}
              >
                <View style={[s.heroCard, { backgroundColor: T.CARD, borderColor: 'transparent' }]}>
                  <View style={s.heroRow}>
                    <View style={s.heroCircle}>
                      <View style={[s.heroCircleInner, { borderColor: safetyColor }]}>
                        <Text style={s.heroScoreText}>{safetyPct}%</Text>
                        <Text style={s.heroScoreLabel}>Safe</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                        <Text style={[s.heroTitle, { color: T.TEXT_PRI }]}>
                          {activeData?.safetyLabel === 'low'    ? 'Low Risk'
                          : activeData?.safetyLabel === 'medium' ? 'Moderate Risk'
                          : activeData?.safetyLabel === 'high'   ? 'High Risk'
                          : 'Safety Score'}
                        </Text>
                        {activeData?.routeSource === 'safeway' && (
                          <View style={s.safewayBadge}>
                            <Ionicons name="shield-checkmark" size={9} color={SEAFOAM} />
                            <Text style={s.safewayBadgeText}>SafeWay A*</Text>
                          </View>
                        )}
                      </View>
                      {/* Route summary — replaces old description */}
                      <View style={[s.summaryBox, { borderColor: safetyColor + '33' }]}>
                        <Text style={[s.summaryText, { color: T.TEXT_PRI }]}>{routeSummary}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </LinearGradient>
            ) : activeTab === 'overview' ? (
              <View style={[s.heroCard, { backgroundColor: T.CARD, borderColor: GLASS_BORDER }]}>
                <View style={s.heroRow}>
                  <View style={s.heroCircle}>
                    <View style={[s.heroCircleInner, { borderColor: TEXT_MUT }]}>
                      <Text style={[s.heroScoreText, { fontSize: 14 }]}>N/A</Text>
                      <Text style={s.heroScoreLabel}>Safe</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.heroTitle, { color: T.TEXT_PRI }]}>Safety Unavailable</Text>
                    <View style={[s.summaryBox, { borderColor: GLASS_BORDER, marginTop: 6 }]}>
                      <Text style={[s.summaryText, { color: T.TEXT_MUT }]}>
                        Safety scoring requires crash data for this area. Try a route within a supported region.
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* ── AADT Hourly Graph (moved to top) ── */}
            {activeTab === 'aadt' && <View style={s.statCardWide}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>📊  AADT</Text>
                    <Pressable onPress={() => setInfoKey(infoKey === 'aadt' ? null : 'aadt')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color={TEXT_MUT} />
                    </Pressable>
                    {aadtSource === 'backend' && (
                      <View style={{ backgroundColor: SEAFOAM + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: SEAFOAM, fontSize: 9, fontWeight: '800' }}>LIVE</Text>
                      </View>
                    )}
                    {aadtSource === 'estimated' && (
                      <View style={{ backgroundColor: '#A855F722', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#C084FC', fontSize: 9, fontWeight: '800' }}>EST</Text>
                      </View>
                    )}
                  </View>

                  {infoKey === 'aadt' && (
                    <View style={s.infoBubble}>
                      <Text style={s.infoBubbleText}>{INFO_CONTENT.aadt.body}</Text>
                    </View>
                  )}

                  <Text style={[s.statValue, { color: TEXT_PRI, fontSize: 22 }]}>
                    {hasAadt ? effectiveAadtAvg!.toLocaleString() : '–'}
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 2 }}>
                    {hasAadt ? `avg/day · now: ~${currentHourAadt.toLocaleString()}` : 'No route distance — AADT unavailable'}
                  </Text>
                </View>

                {effectiveAadtMax != null && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: TEXT_MUT, fontSize: 10 }}>peak segment</Text>
                    <Text style={{ color: TEXT_PRI, fontSize: 16, fontWeight: '700' }}>{effectiveAadtMax.toLocaleString()}</Text>
                  </View>
                )}
              </View>

              {hasAadt ? (
                <>
                  <HourlyLineGraph
                    data={aadtHourlyData}
                    nowHour={nowHour}
                    lineColor="#4A90E2"
                    projectedColor="#4A90E255"
                    formatValue={v => `${(v / 1000).toFixed(1)}k`}
                    unit="vehicles"
                  />
                  <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 6 }}>
                    Hourly traffic volume · solid = past, dashed = projected
                    {peakHourIdx >= 0 ? ` · peak at ${aadtHourlyData[peakHourIdx]?.label}` : ''}
                  </Text>
                </>
              ) : (
                <View style={{ height: 60, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>No route length — cannot estimate AADT</Text>
                </View>
              )}
            </View>}

            {/* ── Peak Flow Hourly Graph (moved to top alongside AADT) ── */}
            {activeTab === 'peak' && <View style={s.statCardWide}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>〰  PEAK FLOW</Text>
                    <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'PEAK_FLOW' ? null : 'PEAK_FLOW')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color={TEXT_MUT} />
                    </Pressable>
                  </View>

                  {tooltipVisible === 'PEAK_FLOW' && (
                    <View style={s.infoBubble}>
                      <Text style={s.infoBubbleText}>{STAT_INFO.PEAK_FLOW}</Text>
                    </View>
                  )}

                  <Text style={[s.statValue, { color: TEXT_PRI, fontSize: 22 }]}>
                    {hasAadt && peakFlowNow > 0 ? `${peakFlowNow.toFixed(1)}k/h` : '–'}
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 2 }}>
                    {hasAadt
                      ? aadtSource === 'estimated' ? 'vehicles/hour now (estimated curve)' : 'vehicles/hour now'
                      : 'Derived from AADT — unavailable'}
                  </Text>
                </View>

                {hasAadt && (
                  <View style={{ backgroundColor: aadtSource === 'backend' ? '#22C55E22' : '#A855F722', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: aadtSource === 'backend' ? '#22C55E' : '#C084FC', fontSize: 11, fontWeight: '700' }}>
                      {aadtSource === 'backend' ? '✓ Live Flow' : '~ Estimated'}
                    </Text>
                  </View>
                )}
              </View>

              {hasAadt ? (
                <>
                  <HourlyLineGraph
                    data={peakFlowHourly}
                    nowHour={nowHour}
                    lineColor={SEAFOAM}
                    projectedColor={SEAFOAM + '44'}
                    formatValue={v => `${v.toFixed(1)}k`}
                    unit="k veh/h"
                  />
                  <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 6 }}>
                    Vehicles/hour · solid = past, dashed = projected for rest of day
                  </Text>
                </>
              ) : (
                <View style={{ height: 60, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>Need AADT (or route distance) for flow curve</Text>
                </View>
              )}
            </View>}

            {/* ── Path Integrity (backend segment risk) ── */}
            {activeTab === 'segments' && <View style={s.statCardWide}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>◧  ROUTE SEGMENTS</Text>
                    <Pressable
                      onPress={() => setTooltipVisible(tooltipVisible === 'SCORED_SEGMENTS' ? null : 'SCORED_SEGMENTS')}
                      hitSlop={8}
                    >
                      <Ionicons name="information-circle-outline" size={15} color={TEXT_MUT} />
                    </Pressable>
                  </View>

                  {tooltipVisible === 'SCORED_SEGMENTS' && (
                    <View style={s.infoBubble}>
                      <Text style={s.infoBubbleText}>{STAT_INFO.SCORED_SEGMENTS}</Text>
                    </View>
                  )}

                  <Text style={[s.statValue, { color: TEXT_PRI, fontSize: 22 }]}>
                    {hasSegScores ? segmentRiskValues.length.toLocaleString() : '–'}
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 2 }}>
                    {hasSegScores ? 'segments with model risk scores' : 'No segment geometry in payload — open from Directions after a fresh route'}
                  </Text>
                  <View style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: GLASS_BORDER }}>
                    <LinearGradient colors={[...SCALE_COLORS]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ height: 10 }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ color: TEXT_MUT, fontSize: 10 }}>0</Text>
                    <Text style={{ color: TEXT_MUT, fontSize: 10 }}>250</Text>
                  </View>
                </View>

                {hasSegScores && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: TEXT_MUT, fontSize: 10 }}>mean · range</Text>
                    <Text style={{ color: TEXT_PRI, fontSize: 15, fontWeight: '800' }}>
                      {segMean} · {Math.round(segMin!)}–{Math.round(segMax!)}
                    </Text>
                  </View>
                )}
              </View>

              {hasSegScores ? (
                <Text style={{ color: TEXT_MUT, fontSize: 11, lineHeight: 16 }}>
                  On the Route Insights map, select "Route Segments" to view the structural segment risk legend colors along your route.
                </Text>
              ) : (
                <View style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>
                    When the API returns segment polylines, counts and averages appear here automatically.
                  </Text>
                </View>
              )}
            </View>}

            {/* ── Avg Speed Gauge (moved lower) ── */}
            {activeTab === 'overview' && <LinearGradient
              colors={['#1E1B4B', '#312E81']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, padding: 1 }}
            >
              <View style={[s.statCardWide, { borderColor: '#FFFFFF18', margin: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <LinearGradient
                      colors={['#22D3EE', '#A78BFA']}
                      style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ionicons name="speedometer-outline" size={22} color="#fff" />
                    </LinearGradient>
                    <View>
                      <Text style={[s.statLabel, { color: T.TEXT_MUT, marginBottom: 0 }]}>AVG SPEED</Text>
                      <Text style={{ color: T.TEXT_PRI, fontSize: 13, fontWeight: '700' }}>Along this route</Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'AVG_SPEED' ? null : 'AVG_SPEED')} hitSlop={8}>
                    <Ionicons name="information-circle-outline" size={18} color="#94A3B8" />
                  </Pressable>
                </View>

                {tooltipVisible === 'AVG_SPEED' && (
                  <View style={s.infoBubble}>
                    <Text style={s.infoBubbleText}>{STAT_INFO.AVG_SPEED}</Text>
                  </View>
                )}

                <View style={{ alignItems: 'center', paddingTop: 4 }}>
                  <AvgSpeedGauge mph={avgSpeedMph} accent="#22D3EE" />
                  <Text style={{ color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1, marginTop: -6 }}>
                    {avgSpeedMph > 0 ? avgSpeedMph : '–'}
                    <Text style={{ fontSize: 16, color: '#94A3B8', fontWeight: '700' }}> mph</Text>
                  </Text>
                  <View style={{ marginTop: 10, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, backgroundColor: avgSpeedMph < 40 ? '#22C55E28' : avgSpeedMph < 80 ? '#EAB30828' : '#FB718528' }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: avgSpeedMph <= 0 ? '#94A3B8' : avgSpeedMph < 40 ? '#4ADE80' : avgSpeedMph < 80 ? '#FACC15' : '#FB7185' }}>
                      {avgSpeedMph <= 0 ? 'No pace data' : avgSpeedMph < 40 ? 'Neighbourhood pace' : avgSpeedMph < 80 ? 'Mixed / arterial' : 'Wide open'}
                    </Text>
                  </View>
                </View>
              </View>
            </LinearGradient>}

            {/* ── SHAP Risk Factors ── */}
            {activeTab === 'overview' && shapFactors.length > 0 && (
              <ShapRiskFactors factors={shapFactors} infoKey={infoKey} setInfoKey={setInfoKey} />
            )}

            {/* ── Route Source Badge ── */}
            {activeTab === 'overview' && activeData?.routeSource && <RouteSourceCard routeSource={activeData.routeSource} />}

            {/* ── Travel Time Card ── */}
            {activeTab === 'overview' && <View style={s.statCardWide}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>⏱  TRAVEL TIME</Text>
                <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'TRAVEL_TIME' ? null : 'TRAVEL_TIME')} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={15} color={TEXT_MUT} />
                </Pressable>
              </View>

              {tooltipVisible === 'TRAVEL_TIME' && (
                <View style={s.infoBubble}>
                  <Text style={s.infoBubbleText}>{STAT_INFO.TRAVEL_TIME}</Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <Text style={[s.statValue, { color: TEXT_PRI }]}>
                  {effectiveDurationSecs > 0 ? fmtSecs(effectiveDurationSecs) : '–'}
                </Text>
              </View>

              <View style={{ marginTop: 12 }}>
                  <View style={{ height: 6, backgroundColor: '#FFFFFF18', borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${Math.round((nowHour / 23) * 100)}%`, backgroundColor: SEAFOAM, borderRadius: 3 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 10 }}>Depart now</Text>
                    <Text style={{ color: SEAFOAM, fontSize: 10, fontWeight: '600' }}>
                    Arrive ~{effectiveDurationSecs > 0 ? arrivalFrom(effectiveDurationSecs) : '–'}
                  </Text>
                </View>
              </View>
            </View>}

            {/* ── Hot Spots + Distance stats row ── */}
            {(activeTab === 'overview' || activeTab === 'hotspots') && <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={s.statCardHalf}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>📏  DISTANCE</Text>
                <Text style={[s.statValue, { color: TEXT_PRI, fontSize: 22 }]}>{fmtDist(distM)}</Text>
              </View>
              <View style={s.statCardHalf}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>⚠️  HOT SPOTS</Text>
                <Text style={[s.statValue, { color: TEXT_PRI, fontSize: 22 }]}>{activeData?.nHighRisk ?? 0}</Text>
                <Text style={{ color: (activeData?.nHighRisk ?? 0) === 0 ? SEAFOAM : (activeData?.nHighRisk ?? 0) > 3 ? '#FF6B6B' : '#FFA500', fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                  {(activeData?.nHighRisk ?? 0) === 0 ? '✅ Clear route' : (activeData?.nHighRisk ?? 0) > 3 ? '⚠ Use caution' : 'Manageable'}
                </Text>
              </View>
            </View>}

    </>
  );
}

// ─── Main Modal (optional; directions uses full-screen /route-insights) ─────
export function RouteInsightsPage({
  visible,
  onClose,
  activeData,
  destLat: _destLat,
  destLng: _destLng,
  originLat: _originLat,
  originLng: _originLng,
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.card, { height: CARD_HEIGHT, backgroundColor: T.BG, overflow: 'hidden' }]}>
          <View style={s.tabRow}>
            <Text style={[s.tabText, { color: T.TEXT_PRI, fontWeight: '800' }]}>Route Insights</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[s.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                <Ionicons name="close" size={16} color={T.TEXT_PRI} />
              </View>
            </Pressable>
          </View>
          <ScrollView
            style={s.body}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingBottom: 30 }}
          >
            <RouteInsightsMetricsBody activeData={activeData} activeTab="overview" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: GLASS_BORDER,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 20,
  },
  tabText: { fontSize: 18, fontWeight: '600' },
  closeBtnCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: { flex: 1 },

  heroCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroCircle: { width: 72, height: 72, justifyContent: 'center', alignItems: 'center' },
  heroCircleInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroScoreText: { color: TEXT_PRI, fontSize: 20, fontWeight: '900' },
  heroScoreLabel: { color: TEXT_MUT, fontSize: 10, fontWeight: '600' },
  heroTitle: { fontSize: 16, fontWeight: '800' },
  safewayBadge: {
    backgroundColor: SEAFOAM + '22',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  safewayBadgeText: { color: SEAFOAM, fontSize: 10, fontWeight: '800' },
  summaryBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(26,27,77,0.5)',
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },

  statCardWide: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: GLASS_BORDER,
    backgroundColor: NAVY_CARD,
  },
  statCardHalf: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: GLASS_BORDER,
    backgroundColor: NAVY_CARD,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 0,
  },
  statValue: { fontSize: 28, fontWeight: '800', marginBottom: 4 },

  infoBubble: {
    backgroundColor: NAVY_ITEM,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    maxWidth: 300,
  },
  infoBubbleText: { color: '#C8D6E5', fontSize: 12, lineHeight: 17 },
});

export default RouteInsightsPage;