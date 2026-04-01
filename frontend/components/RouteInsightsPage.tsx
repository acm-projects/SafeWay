/**
 * RouteInsightsPage.tsx
 *
 * Standalone Route Insights modal extracted from directions.tsx for maintainability.
 * All data is sourced from the backend-provided `activeData` prop (ModeRouteData).
 *
 * Data sourcing notes:
 *  - safetyScore / safetyLabel / routeSource / riskPerKm / nHighRisk / routeKm /
 *    topRiskFactors / timeBand / segmentRisks / riskReductionPct
 *      → From backend /maps/route → risk_cache.score_coordinates()
 *  - aadtAvg / aadtMax
 *      → From backend /maps/route → OSM-based AADT on scored routes.
 *        If missing (e.g. Google-only route), we estimate from route length (veh·day proxy).
 *  - durationSecs / distance
 *      → From Google Routes API (via backend or direct).
 *  - AADT hourly curve: backend gives only a daily average (aadtAvg).
 *    The 24-hour shape is computed client-side using time-of-day multipliers
 *    that mirror the backend's _hour_to_band() logic — this is intentional
 *    because the backend does not expose per-hour AADT breakdowns.
 *  - Peak Flow: derived as aadtAvg / 24 scaled by the same hourly multipliers.
 *    Always a formula from AADT — never a separate backend field.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/providers/theme-context';

// ─── Types (mirrored from directions.tsx) ────────────────────────────────────
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
  aadtAvg?: number;
  aadtMax?: number;
  timePenaltyPct?: number;
  riskReductionPct?: number;
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
  return new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** When backend AADT is absent: rough daily volume from trip length (longer → more major-road exposure). */
function estimateAadtFromDistanceMeters(distanceMeters: number): { avg: number; max: number } {
  const miles = Math.max(0.1, distanceMeters / 1609.34);
  const avg = Math.round(Math.min(52_000, Math.max(3_200, 1_800 + miles * 5_200)));
  const max = Math.round(avg * 1.34);
  return { avg, max };
}

// ─── Dark map style (same as directions.tsx) ──────────────────────────────────
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

// ─── INFO_CONTENT ─────────────────────────────────────────────────────────────
const INFO_CONTENT: Record<string, { title: string; body: string }> = {
  aadt: {
    title: 'AADT — Annual Average Daily Traffic',
    body:
      'AADT estimates the average number of vehicles passing through a road segment per day, averaged over a full year.\n\n' +
      'SafeWay uses AADT proxy values based on OpenStreetMap road classification:\n' +
      '• Residential: ~1,000/day\n• Secondary: ~15,000/day\n• Primary: ~25,000/day\n• Trunk: ~40,000/day\n• Motorway: ~60,000/day\n\n' +
      'This helps normalize crash rates — a highway with more crashes isn\'t necessarily more dangerous per vehicle-mile than a quiet street.\n\n' +
      'If this route has no backend AADT (for example, a Google-only path when Avoid filters are on), we estimate a daily proxy from trip length — labeled EST — so the hourly curve still reflects typical peaks.',
  },
  shap: {
    title: 'SHAP — Risk Factor Explanation',
    body:
      'SHAP (SHapley Additive exPlanations) is an AI interpretability technique that shows how much each feature contributed to a prediction.\n\n' +
      'For each intersection on your route, the model identifies the top 3 factors that most increased its risk score. These are then aggregated across all intersections on the route.\n\n' +
      'Common factors include:\n' +
      '• High crash history — many past crashes at that intersection\n' +
      '• Dark conditions — poor lighting correlated with higher risk\n' +
      '• Pedestrian crashes — history of pedestrian-involved incidents\n' +
      '• Speed camera violations — frequent speeding in the area\n\n' +
      'The percentage shows how many route intersections flagged that factor.',
  },
};

// ─── Hourly Line Graph ────────────────────────────────────────────────────────
/**
 * Renders a 24-hour line graph.
 * - Solid line: hours 0 through nowHour (inclusive) — past + present
 * - Dashed line: hours nowHour+1 through 23 — projected future
 * - A dot marks nowHour as the "current time" endpoint of the solid line
 */
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
  const CHART_H = 80;
  const LABEL_H = 18;

  const vals = data.map(d => d.val);
  const maxVal = Math.max(...vals, 1);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: evt => {
      const x = evt.nativeEvent.locationX;
      const idx = Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1))));
      setHoveredIndex(idx);
    },
    onPanResponderMove: evt => {
      const x = evt.nativeEvent.locationX;
      const idx = Math.min(data.length - 1, Math.max(0, Math.round((x / containerWidth) * (data.length - 1))));
      setHoveredIndex(idx);
    },
    onPanResponderRelease: () => { setTimeout(() => setHoveredIndex(null), 2000); },
    onPanResponderTerminate: () => { setTimeout(() => setHoveredIndex(null), 2000); },
  });

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * containerWidth;
    const y = CHART_H - (d.val / maxVal) * (CHART_H - 10);
    return { x, y, ...d };
  });

  // Solid = hours 0..nowHour inclusive; projected = nowHour..23
  // We include nowHour in both so the dashed line starts exactly at the "now" dot.
  const nowIdx = data.findIndex(d => d.h === nowHour);
  const solidPoints   = points.slice(0, nowIdx + 1);        // 0 → nowHour
  const projectedPoints = points.slice(nowIdx);              // nowHour → 23

  const activeIdx   = hoveredIndex ?? nowIdx;
  const activePoint = points[activeIdx] ?? null;

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

        {/* Solid line (past + now) */}
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
              // @ts-ignore — transformOrigin is valid in RN ≥ 0.74
              transformOrigin: '0 50%',
            }} />
          );
        })}

        {/* Projected dashed line (nowHour → end) */}
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
              // @ts-ignore
              transformOrigin: '0 50%',
              opacity: 0.7,
            }} />
          );
        })}

        {/* "Now" dot — marks where the solid line ends */}
        {solidPoints.length > 0 && (() => {
          const nowPt = solidPoints[solidPoints.length - 1];
          return (
            <View style={{
              position: 'absolute',
              left: nowPt.x - 5,
              top: nowPt.y - 5,
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: lineColor,
              borderWidth: 2, borderColor: '#fff',
            }} />
          );
        })()}

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

      {/* X-axis labels — every 4 hours */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
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

/** Semicircular speed gauge with spring needle (0–120 mph scale). */
function AvgSpeedGauge({ mph, accent }: { mph: number; accent: string }) {
  const rot = useSharedValue(-210);
  useEffect(() => {
    const v = mph > 0 && Number.isFinite(mph) ? mph : 0;
    const c = Math.min(120, Math.max(0, v));
    rot.value = withSpring(-210 + (c / 120) * 240, { damping: 17, stiffness: 150 });
  }, [mph]);

  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  const W = 232;
  const H = 128;
  const cx = W / 2;
  const hubY = H - 16;

  return (
    <View style={{ width: W, height: H + 6 }}>
      <LinearGradient
        colors={['#06B6D433', '#8B5CF644', '#F43F5E55']}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          width: W - 24,
          height: H - 24,
          borderTopLeftRadius: 999,
          borderTopRightRadius: 999,
        }}
      />
      <View style={{ width: W, height: H, position: 'relative' }}>
        {Array.from({ length: 42 }, (_, i) => {
          const t = i / 41;
          const ang = (-210 + t * 240) * (Math.PI / 180);
          const r = 80;
          const x = cx + r * Math.cos(ang) - 2.5;
          const y = hubY + r * Math.sin(ang) - 2.5;
          const speedAt = t * 120;
          const on = mph > 0 && speedAt <= mph;
          const col = !on ? '#FFFFFF12' : speedAt < 38 ? '#4ADE80' : speedAt < 76 ? '#FACC15' : '#FB7185';
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: col,
              }}
            />
          );
        })}
        <View
          style={{
            position: 'absolute',
            left: cx,
            top: hubY,
            width: 0,
            height: 0,
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          <Animated.View
            style={[
              {
                position: 'absolute',
                bottom: 0,
                left: -2.5,
                width: 5,
                height: 66,
                borderRadius: 2.5,
                backgroundColor: accent,
                shadowColor: accent,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.85,
                shadowRadius: 10,
                elevation: 8,
                // @ts-ignore
                transformOrigin: '50% 100%',
              },
              needleStyle,
            ]}
          />
        </View>
        <View
          style={{
            position: 'absolute',
            left: cx - 12,
            top: hubY - 12,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: '#0B1020',
            borderWidth: 2,
            borderColor: accent,
            zIndex: 3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
        </View>
        <Text style={{ position: 'absolute', left: 6, bottom: 4, color: '#4ADE80', fontSize: 9, fontWeight: '800' }}>0</Text>
        <Text style={{ position: 'absolute', left: W / 2 - 8, bottom: 0, color: '#64748B', fontSize: 9, fontWeight: '700' }}>60</Text>
        <Text style={{ position: 'absolute', right: 6, bottom: 4, color: '#FB7185', fontSize: 9, fontWeight: '800' }}>120</Text>
      </View>
    </View>
  );
}

// ─── Route Insights Modal ─────────────────────────────────────────────────────
export function RouteInsightsPage({
  visible,
  onClose,
  activeData,
  destLat,
  destLng,
  originLat,
  originLng,
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

  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);

  // ── Derived values ──────────────────────────────────────────────────────────
  const avgSpeedMph = activeData
    ? Math.round((activeData.distance / 1609.34) / (activeData.durationSecs / 3600))
    : 0;

  const backendAadtAvg = activeData?.aadtAvg ?? null;
  const backendAadtMax = activeData?.aadtMax ?? null;
  const hasBackendAadt = backendAadtAvg != null && backendAadtAvg > 0;
  const distM = activeData?.distance ?? 0;
  const mileageEstimate =
    !hasBackendAadt && distM > 0 ? estimateAadtFromDistanceMeters(distM) : null;
  const effectiveAadtAvg = hasBackendAadt ? backendAadtAvg! : mileageEstimate?.avg ?? null;
  const effectiveAadtMax =
    hasBackendAadt && backendAadtMax != null
      ? backendAadtMax
      : mileageEstimate?.max ?? null;
  const hasAadt = effectiveAadtAvg != null && effectiveAadtAvg > 0;
  const aadtSource: 'backend' | 'estimated' | 'none' = hasBackendAadt
    ? 'backend'
    : mileageEstimate
      ? 'estimated'
      : 'none';

  // Current hour for graph anchoring
  const nowHour = new Date().getHours();

  /**
   * 24-hour AADT curve from daily average (backend or mileage estimate).
   * Hours after `nowHour` are projected (dashed).
   */
  const hourlyMultipliers = [
    0.18, 0.12, 0.08, 0.07, 0.10, 0.28, // 00-05 night / early AM
    0.55, 0.85, 1.00, 0.88, 0.75, 0.80, // 06-11 morning peak at 08
    0.82, 0.78, 0.76, 0.80, 0.95, 1.05, // 12-17 PM build
    1.10, 0.90, 0.72, 0.55, 0.38, 0.25, // 18-23 evening peak at 18
  ];

  const aadtHourlyData = Array.from({ length: 24 }, (_, h) => ({
    h,
    label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
    val: hasAadt ? Math.round(effectiveAadtAvg! * hourlyMultipliers[h]) : 0,
    // Solid = 0..nowHour; projected = nowHour+1..23
    isProjected: h > nowHour,
  }));

  /**
   * Peak Flow: vehicles per hour derived from AADT.
   * Formula: aadtHourly / 1 (already per-hour), scaled to thousands for display.
   * This is always a formula — there is no separate backend field for peak flow.
   */
  const peakFlowHourly = aadtHourlyData.map(d => ({
    h: d.h,
    label: d.label,
    val: parseFloat((d.val / 1000).toFixed(2)), // k vehicles/h
    isProjected: d.isProjected,
  }));

  const currentHourAadt    = aadtHourlyData[nowHour]?.val ?? 0;
  const peakHourIdx        = hasAadt
    ? aadtHourlyData.reduce((maxI, d, i, arr) => d.val > arr[maxI].val ? i : maxI, 0)
    : -1;
  const peakFlowNow        = peakFlowHourly[nowHour]?.val ?? 0;

  // Safety score: backend returns risk_per_km (0-100); 0 = safest, 100 = riskiest.
  const score     = activeData?.safetyScore ?? null;
  const safetyPct = score != null ? Math.max(0, Math.min(100, 100 - Math.round(score))) : null;
  const safetyColor = score == null ? '#7A8FA6'
    : score < 33 ? '#1ABC93'
    : score < 66 ? '#FFA500'
    : '#FF4444';

  const STAT_INFO: Record<string, string> = {
    AADT:
      'Annual Average Daily Traffic. With a scored SafeWay route we use OSM road-class averages from the backend. Otherwise we show a trip-length estimate (not live counts) so charts stay useful.',
    AVG_SPEED: 'Average speed across this route, computed from route distance and Google-estimated travel time.',
    PEAK_FLOW: 'Estimated vehicles per hour, derived from the AADT daily average using time-of-day distribution factors. Dashed = projected for the rest of today.',
    TRAVEL_TIME: 'Estimated total travel time from origin to destination under current traffic conditions.',
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.card, { height: CARD_HEIGHT, backgroundColor: T.BG, overflow: 'hidden' }]}>
          <LinearGradient
            colors={['#6366F1', '#22D3EE', '#A855F7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 4, width: '100%', opacity: 0.9 }}
          />

          {/* ── Header ── */}
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

            {/* ── Safety Score Hero ── */}
            {safetyPct != null ? (
              <LinearGradient
                colors={['#4F46E540', '#06B6D438', '#EC489936']}
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.heroTitle, { color: T.TEXT_PRI }]}>
                        {activeData?.safetyLabel === 'low' ? 'Low Risk'
                          : activeData?.safetyLabel === 'medium' ? 'Moderate Risk'
                          : activeData?.safetyLabel === 'high' ? 'High Risk'
                          : 'Safety Score'}
                      </Text>
                      {activeData?.routeSource === 'safeway' && (
                        <View style={s.safewayBadge}>
                          <Text style={s.safewayBadgeText}>SafeWay A*</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[s.heroSub, { color: T.TEXT_MUT }]}>
                      {activeData?.routeKm ? `${activeData.routeKm.toFixed(1)} km` : fmtDist(activeData?.distance ?? 0)}
                      {activeData?.nHighRisk ? `  •  ${activeData.nHighRisk} hot spots` : ''}
                    </Text>
                    {activeData?.timeBand && (
                      <Text style={[s.heroSub, { color: T.TEXT_MUT }]}>Time band: {activeData.timeBand}</Text>
                    )}
                    {(activeData?.riskReductionPct ?? 0) > 0 && (
                      <Text style={{ color: '#1ABC93', fontSize: 12, fontWeight: '700', marginTop: 4 }}>
                        ↓ {activeData!.riskReductionPct!.toFixed(0)}% safer than fastest
                      </Text>
                    )}
                  </View>
                </View>

                {/* SHAP risk factors */}
                {Array.isArray(activeData?.topRiskFactors) && activeData!.topRiskFactors.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>TOP RISK FACTORS</Text>
                      <Pressable onPress={() => setInfoKey(infoKey === 'shap' ? null : 'shap')} hitSlop={8}>
                        <Ionicons name="information-circle-outline" size={14} color="#7A8FA6" />
                      </Pressable>
                    </View>
                    {infoKey === 'shap' && (
                      <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18' }}>
                        <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{INFO_CONTENT.shap.body}</Text>
                      </View>
                    )}
                    {(activeData!.topRiskFactors as any[]).slice(0, 4).map((f: any, i: number) => {
                      const label = f.label ?? f.factor ?? `Factor ${i + 1}`;
                      const pct   = f.pct   ?? (f.weight != null ? Math.round(f.weight * 100) : 0);
                      return (
                        <View key={i} style={{ marginBottom: 6 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ color: T.TEXT_PRI, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
                            <Text style={{ color: '#FFA500', fontSize: 11, fontWeight: '700' }}>{pct}%</Text>
                          </View>
                          <View style={{ height: 4, backgroundColor: '#FFFFFF14', borderRadius: 2, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${Math.min(100, pct)}%`, backgroundColor: '#FFA500', borderRadius: 2 }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
              </LinearGradient>
            ) : (
              <View style={[s.heroCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                <View style={s.heroRow}>
                  <View style={s.heroCircle}>
                    <View style={[s.heroCircleInner, { borderColor: '#7A8FA6' }]}>
                      <Text style={[s.heroScoreText, { fontSize: 14 }]}>N/A</Text>
                      <Text style={s.heroScoreLabel}>Safe</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.heroTitle, { color: T.TEXT_PRI }]}>Safety Unavailable</Text>
                    <Text style={[s.heroSub, { color: T.TEXT_MUT }]}>
                      Safety scoring requires the SafeWay backend to have crash data for this area. Try a route within a supported region.
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* ── Mini map ── */}
            {destLat && destLng ? (
              <View style={s.insightMapWrap}>
                <MapView
                  style={s.insightMap}
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
                      <View style={s.originDot}><View style={s.originDotInner} /></View>
                    </Marker>
                  )}
                  <Marker coordinate={{ latitude: destLat, longitude: destLng }} pinColor="#FF4444" />
                  {activeData?.coords?.length ? (
                    <Polyline coordinates={activeData.coords} strokeColor="#4A90E2" strokeWidth={4} />
                  ) : null}
                </MapView>
                {activeData && (
                  <View style={s.routeTimeBubble}>
                    <Text style={s.routeTimeBubbleText}>{fmtSecs(activeData.durationSecs)}</Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* ── Avg Speed — animated gauge ── */}
            <LinearGradient
              colors={['#1E1B4B', '#312E81']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, padding: 1 }}
            >
            <View style={[s.statCardWide, { backgroundColor: T.CARD, borderColor: '#FFFFFF18', margin: 0 }]}>
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
                <View style={{
                  marginTop: 10, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: avgSpeedMph < 40 ? '#22C55E28' : avgSpeedMph < 80 ? '#EAB30828' : '#FB718528',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: avgSpeedMph < 40 ? '#4ADE80' : avgSpeedMph < 80 ? '#FACC15' : '#FB7185' }}>
                    {avgSpeedMph <= 0 ? 'No pace data' : avgSpeedMph < 40 ? 'Neighborhood pace' : avgSpeedMph < 80 ? 'Mixed / arterial' : 'Wide open'}
                  </Text>
                </View>
              </View>
            </View>
            </LinearGradient>

            {/* ── AADT — Hourly Line Graph ── */}
            <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>📊  AADT</Text>
                    <Pressable onPress={() => setInfoKey(infoKey === 'aadt' ? null : 'aadt')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                    </Pressable>
                    {aadtSource === 'backend' && (
                      <View style={{ backgroundColor: '#1ABC9322', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#1ABC93', fontSize: 9, fontWeight: '800' }}>LIVE</Text>
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
                  {/* Show real AADT value or explicit unavailable */}
                  <Text style={[s.statValue, { color: '#fff', fontSize: 22 }]}>
                    {hasAadt ? effectiveAadtAvg!.toLocaleString() : '–'}
                  </Text>
                  <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 2 }}>
                    {hasAadt
                      ? `avg/day · now: ~${currentHourAadt.toLocaleString()}`
                      : 'No route distance — AADT unavailable'}
                  </Text>
                </View>
                {effectiveAadtMax != null && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#7A8FA6', fontSize: 10 }}>peak segment</Text>
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{effectiveAadtMax.toLocaleString()}</Text>
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
                  <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 6 }}>
                    Hourly traffic volume · line ends at current time · dashed = projected
                    {peakHourIdx >= 0 ? ` · peak at ${aadtHourlyData[peakHourIdx]?.label}` : ''}
                  </Text>
                </>
              ) : (
                <View style={{ height: 60, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#7A8FA6', fontSize: 12 }}>No route length — cannot estimate AADT</Text>
                </View>
              )}
            </View>

            {/* ── Peak Flow — Hourly Line Graph ── */}
            <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>〰  PEAK FLOW</Text>
                    <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'PEAK_FLOW' ? null : 'PEAK_FLOW')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                    </Pressable>
                  </View>
                  {tooltipVisible === 'PEAK_FLOW' && (
                    <View style={s.infoBubble}>
                      <Text style={s.infoBubbleText}>{STAT_INFO.PEAK_FLOW}</Text>
                    </View>
                  )}
                  <Text style={[s.statValue, { color: '#fff', fontSize: 22 }]}>
                    {hasAadt && peakFlowNow > 0
                      ? <>{peakFlowNow.toFixed(1)}<Text style={{ fontSize: 13 }}>k/h</Text></>
                      : '–'}
                  </Text>
                  <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 2 }}>
                    {hasAadt
                      ? aadtSource === 'estimated'
                        ? 'vehicles/hour now (estimated curve)'
                        : 'vehicles/hour now'
                      : 'Derived from AADT — unavailable'}
                  </Text>
                </View>
                {hasAadt && (
                  <View
                    style={{
                      backgroundColor: aadtSource === 'backend' ? '#22C55E22' : '#A855F722',
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: aadtSource === 'backend' ? '#22C55E' : '#C084FC',
                        fontSize: 11,
                        fontWeight: '700',
                      }}
                    >
                      {aadtSource === 'backend' ? '✓ Live AADT' : '~ Estimated'}
                    </Text>
                  </View>
                )}
              </View>

              {hasAadt ? (
                <>
                  <HourlyLineGraph
                    data={peakFlowHourly}
                    nowHour={nowHour}
                    lineColor="#22C55E"
                    projectedColor="#22C55E44"
                    formatValue={v => `${v.toFixed(1)}k`}
                    unit="k veh/h"
                  />
                  <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 6 }}>
                    Vehicles/hour · line ends at current time · dashed = projected for rest of day
                  </Text>
                </>
              ) : (
                <View style={{ height: 60, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#7A8FA6', fontSize: 12 }}>Need AADT (or route distance) for flow curve</Text>
                </View>
              )}
            </View>

            {/* ── Travel Time ── */}
            <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>⏱  TRAVEL TIME</Text>
                <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'TRAVEL_TIME' ? null : 'TRAVEL_TIME')} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                </Pressable>
              </View>
              {tooltipVisible === 'TRAVEL_TIME' && (
                <View style={s.infoBubble}>
                  <Text style={s.infoBubbleText}>{STAT_INFO.TRAVEL_TIME}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <Text style={[s.statValue, { color: '#fff' }]}>{activeData ? fmtSecs(activeData.durationSecs) : '–'}</Text>
              </View>
              <View style={{ marginTop: 12 }}>
                <View style={{ height: 6, backgroundColor: '#FFFFFF18', borderRadius: 3, overflow: 'hidden' }}>
                  {/* Progress bar: fraction of day elapsed so far */}
                  <View style={{
                    height: '100%',
                    width: `${Math.round((nowHour / 23) * 100)}%`,
                    backgroundColor: '#4A90E2', borderRadius: 3,
                  }} />
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 24 },
  tabRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 20 },
  tabText: { fontSize: 18, fontWeight: '600' },
  closeBtnCircle: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1 },

  heroCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroCircle: { width: 72, height: 72, justifyContent: 'center', alignItems: 'center' },
  heroCircleInner: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, justifyContent: 'center', alignItems: 'center' },
  heroScoreText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  heroScoreLabel: { color: '#7A8FA6', fontSize: 10, fontWeight: '600' },
  heroTitle: { fontSize: 16, fontWeight: '800' },
  heroSub: { fontSize: 12, marginTop: 2 },
  safewayBadge: { backgroundColor: '#1ABC9322', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  safewayBadgeText: { color: '#1ABC93', fontSize: 10, fontWeight: '800' },

  insightMapWrap: { borderRadius: 16, overflow: 'hidden', height: 220, position: 'relative' },
  insightMap: { width: '100%', height: '100%' },
  routeTimeBubble: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  routeTimeBubbleText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },

  statCardWide: { borderRadius: 16, padding: 20, borderWidth: 1.5, borderColor: '#FFFFFF22' },
  statLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 0 },
  statValue: { fontSize: 28, fontWeight: '800', marginBottom: 4 },

  infoBubble: { backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18', maxWidth: 260 },
  infoBubbleText: { color: '#C8D6E5', fontSize: 12, lineHeight: 17 },
});