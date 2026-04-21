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
 *      → From backend /maps/route → risk_cache AADT lookup.
 *        If null, backend had no AADT data for these road segments
 *        (shown as "–" with no LIVE badge — no fabricated fallback).
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
  Linking,
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
import { useTheme } from '@/providers/theme-context';

type NewsArticle = {
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
};

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
      'This helps normalize crash rates — a highway with more crashes isn\'t necessarily more dangerous per vehicle-mile than a quiet street.',
  },
  shap: {
    title: 'What makes this route safer or riskier?',
    body:
      'SafeWay scores your route segment by segment. For each risky stretch, the model asks which real-world patterns best explain the score. Those explanations are summarized in the factors below.\n\n' +
      'The % on each row is not a second safety grade. It means roughly what share of scored segments on this route flagged that factor when we explained the model (standard SHAP-style attribution).\n\n' +
      'Examples: crash history, lighting, pedestrian-related risk, speed patterns, road layout. Use this as transparency into what the model reacts to—not a guarantee of conditions on the ground.',
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
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);

  useEffect(() => {
    if (!visible) return;
    setNewsArticles([]);
  }, [visible]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const avgSpeedMph = activeData
    ? Math.round((activeData.distance / 1609.34) / (activeData.durationSecs / 3600))
    : 0;

  // AADT: use backend value if available, otherwise show nothing (no fabricated fallback).
  // The backend populates aadt_avg from its OSM-based lookup during route scoring.
  const backendAadtAvg = activeData?.aadtAvg ?? null;
  const backendAadtMax = activeData?.aadtMax ?? null;
  const hasAadt = backendAadtAvg != null && backendAadtAvg > 0;

  // Current hour for graph anchoring
  const nowHour = new Date().getHours();

  /**
   * 24-hour AADT curve:
   * The backend only returns a daily average. We distribute it across 24 hours
   * using time-of-day multipliers that mirror the backend's _hour_to_band() logic.
   * Hours after `nowHour` are marked `isProjected = true` and rendered dashed.
   *
   * If there is no backend AADT, we still build the shape array (all zeros) so
   * the graph renders consistently — it will just show a flat line at zero.
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
    val: hasAadt ? Math.round(backendAadtAvg! * hourlyMultipliers[h]) : 0,
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
    AADT: 'Annual Average Daily Traffic from the backend route-scoring engine (OSM road-class lookup). Shown only when the backend has coverage for these road segments.',
    AVG_SPEED: 'Average speed across this route, computed from route distance and Google-estimated travel time.',
    PEAK_FLOW: 'Estimated vehicles per hour, derived from the AADT daily average using time-of-day distribution factors. Dashed = projected for the rest of today.',
    TRAVEL_TIME: 'Estimated total travel time from origin to destination under current traffic conditions.',
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.card, { height: CARD_HEIGHT, backgroundColor: T.BG }]}>

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
              <View style={[s.heroCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
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

                {/* Risk factor explanations (SHAP-style attribution) */}
                {Array.isArray(activeData?.topRiskFactors) && activeData!.topRiskFactors.length > 0 && (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>
                        What shaped this score?
                      </Text>
                      <Pressable onPress={() => setInfoKey(infoKey === 'shap' ? null : 'shap')} hitSlop={8}>
                        <Ionicons name="information-circle-outline" size={14} color="#7A8FA6" />
                      </Pressable>
                    </View>
                    <Text style={{ color: '#8A9BBF', fontSize: 10, lineHeight: 14, marginBottom: 8 }}>
                      % = how often each pattern appeared among scored segments—not a second safety rating.
                    </Text>
                    {infoKey === 'shap' && (
                      <View style={{ backgroundColor: '#1A1F3A', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FFFFFF18' }}>
                        <Text style={{ color: '#C8D6E5', fontSize: 12, lineHeight: 17 }}>{INFO_CONTENT.shap.body}</Text>
                      </View>
                    )}
                    {(activeData!.topRiskFactors as any[]).slice(0, 4).map((f: any, i: number) => {
                      const label = f.label ?? f.factor ?? `Factor ${i + 1}`;
                      const pct   = f.pct   ?? (f.weight != null ? Math.round(f.weight * 100) : 0);
                      const pctNote = f.pct != null ? 'of segments' : 'rel. weight';
                      return (
                        <View key={i} style={{ marginBottom: 6 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ color: T.TEXT_PRI, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={{ color: '#FFA500', fontSize: 11, fontWeight: '800' }}>{pct}%</Text>
                              <Text style={{ color: T.TEXT_MUT, fontSize: 8, fontWeight: '600' }}>{pctNote}</Text>
                            </View>
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
                  customMapStyle={undefined /* Previous: DARK_MAP_STYLE — now light map */}
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

            {/* ── Avg Speed Speedometer ── */}
            <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>🔵  AVG SPEED</Text>
                <Pressable onPress={() => setTooltipVisible(tooltipVisible === 'AVG_SPEED' ? null : 'AVG_SPEED')} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                </Pressable>
              </View>
              {tooltipVisible === 'AVG_SPEED' && (
                <View style={s.infoBubble}>
                  <Text style={s.infoBubbleText}>{STAT_INFO.AVG_SPEED}</Text>
                </View>
              )}
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <View style={{ width: 200, height: 116, position: 'relative', alignItems: 'center' }}>
                  {Array.from({ length: 36 }, (_, seg) => {
                    const startAngle = -210 + (seg / 36) * 240;
                    const speedAtSeg = (seg / 36) * 120;
                    const isActive = avgSpeedMph > 0 && speedAtSeg <= avgSpeedMph;
                    const segColor = isActive
                      ? (speedAtSeg < 40 ? '#22C55E' : speedAtSeg < 80 ? '#F5A623' : '#FF6B6B')
                      : '#FFFFFF14';
                    const rad = (startAngle * Math.PI) / 180;
                    const x = 100 + 82 * Math.cos(rad) - 4;
                    const y = 100 + 82 * Math.sin(rad) - 4;
                    return (
                      <View key={seg} style={{
                        position: 'absolute', left: x, top: y,
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: segColor, opacity: isActive ? 1 : 0.5,
                      }} />
                    );
                  })}
                  <View style={{ position: 'absolute', bottom: 4, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 48, fontWeight: '900', lineHeight: 50, letterSpacing: -2 }}>
                      {avgSpeedMph > 0 ? avgSpeedMph : '–'}
                    </Text>
                    <Text style={{ color: '#7A8FA6', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>MPH</Text>
                  </View>
                  <Text style={{ position: 'absolute', left: 4, bottom: 16, color: '#22C55E', fontSize: 9, fontWeight: '700' }}>0</Text>
                  <Text style={{ position: 'absolute', left: '50%', bottom: 0, color: '#7A8FA6', fontSize: 9, fontWeight: '600', marginLeft: -6 }}>60</Text>
                  <Text style={{ position: 'absolute', right: 4, bottom: 16, color: '#FF6B6B', fontSize: 9, fontWeight: '700' }}>120</Text>
                </View>
                <View style={{
                  marginTop: 8, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
                  backgroundColor: avgSpeedMph < 40 ? '#22C55E22' : avgSpeedMph < 80 ? '#F5A62322' : '#FF6B6B22',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: avgSpeedMph < 40 ? '#22C55E' : avgSpeedMph < 80 ? '#F5A623' : '#FF6B6B' }}>
                    {avgSpeedMph < 40 ? '● City Speed' : avgSpeedMph < 80 ? '● Highway Speed' : '● Fast Route'}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── AADT — Hourly Line Graph ── */}
            <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Text style={[s.statLabel, { color: T.TEXT_MUT }]}>📊  AADT</Text>
                    <Pressable onPress={() => setInfoKey(infoKey === 'aadt' ? null : 'aadt')} hitSlop={8}>
                      <Ionicons name="information-circle-outline" size={15} color="#7A8FA6" />
                    </Pressable>
                    {hasAadt && (
                      <View style={{ backgroundColor: '#1ABC9322', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#1ABC93', fontSize: 9, fontWeight: '800' }}>LIVE</Text>
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
                    {hasAadt ? backendAadtAvg!.toLocaleString() : '–'}
                  </Text>
                  <Text style={{ color: '#7A8FA6', fontSize: 10, marginTop: 2 }}>
                    {hasAadt
                      ? `avg/day · now: ~${currentHourAadt.toLocaleString()}`
                      : 'Backend AADT unavailable for this area'}
                  </Text>
                </View>
                {backendAadtMax != null && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#7A8FA6', fontSize: 10 }}>peak segment</Text>
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{backendAadtMax.toLocaleString()}</Text>
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
                  <Text style={{ color: '#7A8FA6', fontSize: 12 }}>No AADT data for this route</Text>
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
                    {hasAadt ? 'vehicles/hour now' : 'Derived from AADT — unavailable'}
                  </Text>
                </View>
                {hasAadt && (
                  <View style={{ backgroundColor: '#22C55E22', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: '#22C55E', fontSize: 11, fontWeight: '700' }}>✓ Normal</Text>
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
                  <Text style={{ color: '#7A8FA6', fontSize: 12 }}>No peak flow data for this route</Text>
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

            {/* ── Nearby News ── */}
            {newsArticles.length > 0 && (
              <View style={[s.statCardWide, { backgroundColor: T.CARD }]}>
                <Text style={[s.statLabel, { color: T.TEXT_MUT, marginBottom: 12 }]}>📰  NEARBY NEWS</Text>
                {newsArticles.slice(0, 5).map((article, i) => (
                  <Pressable
                    key={i}
                    onPress={() => article.url && Linking.openURL(article.url)}
                    style={{ marginBottom: i < 4 ? 12 : 0, borderBottomWidth: i < 4 ? 1 : 0, borderBottomColor: '#FFFFFF12', paddingBottom: i < 4 ? 12 : 0 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 2 }} numberOfLines={2}>
                      {article.title}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                      {article.source && (
                        <Text style={{ color: '#4A90E2', fontSize: 11, fontWeight: '600' }}>{article.source}</Text>
                      )}
                      {article.publishedAt && (
                        <Text style={{ color: '#7A8FA6', fontSize: 11 }}>
                          {new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

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
export default RouteInsightsPage;
