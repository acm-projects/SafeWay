import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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

import { getRoute, getMultipleRoutes, getBackendRoutes, searchPlaces } from '@/lib/api';
import type { AlternativeRoute, PlaceSearchResult, RoutePoint, SafetyRoute } from '@/lib/api';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import { useTheme } from '@/providers/theme-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Static dark-only tokens (for non-themed legacy elements) ─────────────────
const BG       = '#0B1120';
const SHEET_BG = '#0B1120';
const CARD_BG  = '#141D2E';
const ITEM_BG  = '#1A2540';
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
  const [tab, setTab] = useState<'details' | 'insights'>('details');
  const [infoKey, setInfoKey] = useState<string | null>(null);
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

          {/* ── Tab row + close ── */}
          <View style={dm.tabRow}>
            <Pressable onPress={() => setTab('details')} style={[dm.tab, tab === 'details' && [dm.tabActive, { borderBottomColor: T.ACCENT }]]}>
              <Text style={[dm.tabText, { color: T.TEXT_MUT }, tab === 'details' && { color: T.TEXT_PRI, fontWeight: '800' }]}>Details</Text>
            </Pressable>
            <Pressable onPress={() => setTab('insights')} style={[dm.tab, tab === 'insights' && [dm.tabActive, { borderBottomColor: T.ACCENT }]]}>
              <Text style={[dm.tabText, { color: T.TEXT_MUT }, tab === 'insights' && { color: T.TEXT_PRI, fontWeight: '800' }]}>Route Insights</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[dm.closeBtnCircle, { backgroundColor: T.ITEM }]}>
                <Ionicons name="close" size={16} color={T.TEXT_PRI} />
              </View>
            </Pressable>
          </View>

          {/* ── Details tab ── */}
          {tab === 'details' && (
            <ScrollView style={dm.tabBody} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={dm.stepRow}>
                <View style={[dm.stepIcon, { backgroundColor: T.ITEM }]}>
                  <Ionicons name={modeIcon[travelMode]} size={20} color="#4A90E2" />
                </View>
                <View style={dm.stepContent}>
                  <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>From {originLabel}</Text>
                  <Text style={[dm.stepInst, { color: T.TEXT_MUT }]} numberOfLines={2}>{originAddress || 'Getting location…'}</Text>
                </View>
              </View>
              <View style={[dm.lineDivider, { backgroundColor: T.DIVIDER }]} />

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
                  <View style={[dm.lineDivider, { backgroundColor: T.DIVIDER }]} />
                </View>
              )) : (
                <View style={dm.stepRow}>
                  <View style={dm.stepContent}>
                    <Text style={{ color: T.TEXT_MUT, fontSize: 13 }}>Loading directions…</Text>
                  </View>
                </View>
              )}

              <View style={dm.stepRow}>
                <View style={[dm.stepIcon, { backgroundColor: T.isDark ? '#1ABC9322' : '#EDE8FF' }]}>
                  <Ionicons name="location" size={20} color={T.ACCENT} />
                </View>
                <View style={dm.stepContent}>
                  <Text style={[dm.stepDist, { color: T.TEXT_PRI }]}>{destLabel}</Text>
                  <Text style={[dm.stepInst, { color: T.TEXT_MUT }]}>Destination</Text>
                </View>
              </View>
            </ScrollView>
          )}

          {/* ── Route Insights tab ── fully themed */}
          {tab === 'insights' && (
            <ScrollView
              style={dm.tabBody}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={dm.insightsContent}
            >
              {/* ── Safety Score Hero ── */}
              {activeData?.safetyScore != null && (
                <View style={[dm.heroCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <View style={dm.heroRow}>
                    <View style={dm.heroCircle}>
                      <View style={[dm.heroCircleInner, {
                        borderColor: activeData.safetyScore < 33 ? '#1ABC93' : activeData.safetyScore < 66 ? '#FFA500' : '#FF4444',
                      }]}>
                        <Text style={dm.heroScoreText}>{Math.max(0, 100 - Math.round(activeData.safetyScore))}%</Text>
                        <Text style={dm.heroScoreLabel}>Safe</Text>
                      </View>
                    </View>
                    <View style={dm.heroInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[dm.heroTitle, { color: T.TEXT_PRI }]}>
                          {activeData.safetyLabel === 'low' ? 'Low Risk' : activeData.safetyLabel === 'medium' ? 'Moderate Risk' : activeData.safetyLabel === 'high' ? 'High Risk' : 'Safety Score'}
                        </Text>
                        {activeData.routeSource === 'safeway' && (
                          <View style={dm.safewayBadge}>
                            <Text style={dm.safewayBadgeText}>SafeWay A*</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[dm.heroSub, { color: T.TEXT_MUT }]}>
                        {activeData.routeKm ? `${activeData.routeKm.toFixed(1)} km` : fmtDist(activeData.distance)}
                        {activeData.nHighRisk ? `  •  ${activeData.nHighRisk} hot spots` : ''}
                      </Text>
                      {activeData.timeBand && (
                        <Text style={[dm.heroSub, { color: T.TEXT_MUT }]}>
                          Time band: {activeData.timeBand}
                        </Text>
                      )}
                      {activeData.riskReductionPct != null && activeData.riskReductionPct > 0 && (
                        <Text style={{ color: '#1ABC93', fontSize: 12, fontWeight: '700', marginTop: 4 }}>
                          ↓ {activeData.riskReductionPct.toFixed(0)}% safer than fastest
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {/* ── Mini-map ── */}
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
                      (activeData.segmentRisks as any[])?.length
                        ? (activeData.segmentRisks as any[]).map((seg: any, si: number) => (
                            <Polyline
                              key={`modal-seg-${si}`}
                              coordinates={[seg.start, seg.end]}
                              strokeColor={seg.risk > 66 ? '#FF4444' : seg.risk > 33 ? '#FFA500' : '#1ABC93'}
                              strokeWidth={4}
                            />
                          ))
                        : <Polyline coordinates={activeData.coords} strokeColor={activeData.routeSource === 'safeway' ? '#1ABC93' : '#4A90E2'} strokeWidth={4} />
                    ) : null}
                    {(activeData?.highRiskCoords as any[] ?? []).map((coord: any, i: number) => (
                      <Marker key={`modal-hs-${i}`} coordinate={coord} anchor={{ x: 0.5, y: 1.0 }} tracksViewChanges={false}>
                        <Text style={{ fontSize: 14 }}>⚠️</Text>
                      </Marker>
                    ))}
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

              {/* ── Stats Grid ── */}
              <View style={dm.statsRow}>
                <View style={[dm.statCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>📏  Distance</Text>
                  <Text style={[dm.statValue, { color: T.TEXT_PRI }]}>{fmtDist(activeData?.distance ?? 0)}</Text>
                </View>
                <View style={[dm.statCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>🔵  Avg Speed</Text>
                  <Text style={[dm.statValue, { color: T.TEXT_PRI }]}>
                    {avgSpeedMph > 0 ? `${avgSpeedMph}` : '–'}
                    <Text style={{ fontSize: 14, fontWeight: '600' }}> mph</Text>
                  </Text>
                </View>
              </View>
              <View style={dm.statsRow}>
                <View style={[dm.statCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>⏱  Travel Time</Text>
                  <Text style={[dm.statValue, { color: T.TEXT_PRI }]}>{activeData ? fmtSecs(activeData.durationSecs) : '–'}</Text>
                  <Text style={[dm.statDelta, { color: T.ACCENT }]}>
                    {activeData ? `Arrive ~${arrivalFrom(activeData.durationSecs)}` : ''}
                  </Text>
                </View>
                <View style={[dm.statCard, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>⚠️  Hot Spots</Text>
                  <Text style={[dm.statValue, { color: T.TEXT_PRI }]}>{activeData?.nHighRisk ?? 0}</Text>
                  <Text style={[dm.statDelta, { color: (activeData?.nHighRisk ?? 0) > 3 ? '#FF6B6B' : T.ACCENT }]}>
                    {(activeData?.nHighRisk ?? 0) === 0 ? '✅ Clear route' : (activeData?.nHighRisk ?? 0) > 3 ? '⚠ Use caution' : 'Manageable'}
                  </Text>
                </View>
              </View>

              {/* ── AADT Card ── */}
              {(activeData?.aadtAvg != null || activeData?.aadtMax != null) && (
                <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>🚗  AADT (Traffic Volume)</Text>
                    <Pressable onPress={() => setInfoKey('aadt')} hitSlop={10}>
                      <Ionicons name="information-circle-outline" size={18} color={T.TEXT_MUT} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                    <View>
                      <Text style={[dm.statValue, { color: T.TEXT_PRI, fontSize: 22 }]}>
                        {activeData.aadtAvg ? activeData.aadtAvg.toLocaleString() : '–'}
                      </Text>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 11 }}>avg vehicles/day</Text>
                    </View>
                    <View>
                      <Text style={[dm.statValue, { color: T.TEXT_PRI, fontSize: 22 }]}>
                        {activeData.aadtMax ? activeData.aadtMax.toLocaleString() : '–'}
                      </Text>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 11 }}>peak segment</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ── SHAP Risk Factors ── */}
              {activeData?.topRiskFactors && activeData.topRiskFactors.length > 0 && (
                <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[dm.statLabel, { color: T.TEXT_MUT }]}>🔍  Risk Factors (SHAP)</Text>
                    <Pressable onPress={() => setInfoKey('shap')} hitSlop={10}>
                      <Ionicons name="information-circle-outline" size={18} color={T.TEXT_MUT} />
                    </Pressable>
                  </View>
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {activeData.topRiskFactors.slice(0, 5).map((f: any, i: number) => {
                      const label = f.label ?? f.factor ?? `Factor ${i + 1}`;
                      const pct = f.pct ?? (f.weight ? Math.round(f.weight * 100) : 0);
                      const barColor = pct > 50 ? '#FF4444' : pct > 25 ? '#FFA500' : '#1ABC93';
                      return (
                        <View key={i}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ color: T.TEXT_PRI, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{label}</Text>
                            <Text style={{ color: T.TEXT_MUT, fontSize: 12 }}>{pct.toFixed(0)}%</Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: T.ITEM }}>
                            <View style={{ height: 6, borderRadius: 3, backgroundColor: barColor, width: `${Math.min(pct, 100)}%` }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* ── Route Source Badge ── */}
              {activeData?.routeSource && (
                <View style={[dm.statCardWide, { backgroundColor: T.CARD, borderColor: T.DIVIDER, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <Ionicons
                    name={activeData.routeSource === 'safeway' ? 'shield-checkmark' : 'navigate'}
                    size={20}
                    color={activeData.routeSource === 'safeway' ? '#1ABC93' : '#4A90E2'}
                  />
                  <View>
                    <Text style={[dm.statLabel, { color: T.TEXT_PRI, fontWeight: '700' }]}>
                      {activeData.routeSource === 'safeway' ? 'SafeWay A* Route' : 'Google Maps Route'}
                    </Text>
                    <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginTop: 2 }}>
                      {activeData.routeSource === 'safeway'
                        ? 'Optimized for safety using our ML model + A* pathfinding'
                        : 'Standard route from Google Routes API, scored by SafeWay'}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}

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

  useEffect(() => {
    if (originCoords && destCoords) void fetchAllRoutes();
  }, [originCoords, destCoords]);

  async function fetchAllRoutes() {
    if (!originCoords || !destCoords) return;
    setRouteBusy(true);
    setSelectedRouteIndex(0);
    const from = stopsSwapped ? destCoords : originCoords;
    const to   = stopsSwapped ? originCoords! : destCoords;

    const nd: Partial<Record<TravelMode, ModeRoutes>> = {};
    const departureHour = nowChoice === 'now' ? new Date().getHours() : pickerHour;

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
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'DRIVE' }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'WALK' }),
        getMultipleRoutes({ origin: from, destination: to, travel_mode: 'BICYCLE' }),
      ]);

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

      // DRIVE: backend first (SafeWay A* + scoring), else Google
      if (backendDriveRes.status === 'fulfilled' && backendDriveRes.value.routes.length > 0) {
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

      if (!nd.DRIVE && driveGoogleRes.status === 'fulfilled' && driveGoogleRes.value.length > 0) {
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
              strokeColor={isSelected ? (alt.routeSource === 'safeway' ? '#1ABC93' : '#4A90E2') : 'rgba(74,144,226,0.28)'}
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

            <View style={[styles.topFieldDivider, { backgroundColor: T.DIVIDER }]} />

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
          <Pressable style={[hm.card, { backgroundColor: T.CARD }]} onPress={() => {}}>
            <Text style={[hm.title, { color: T.TEXT_PRI }]}>Map Style</Text>
            <View style={hm.mapStyleRow}>
              {MAP_STYLE_OPTIONS.map(opt => {
                const active = mapStyleType === opt.id;
                const activeBg = T.isDark ? '#0D2B22' : '#EDE8FF';
                return (
                  <Pressable key={opt.id}
                    style={[hm.mapStyleBtn, { backgroundColor: T.ITEM }, active && { borderColor: T.ACCENT, backgroundColor: activeBg }]}
                    onPress={() => setMapStyleType(opt.id)}>
                    <Ionicons name={opt.icon as any} size={22} color={active ? T.ACCENT : T.TEXT_MUT} />
                    <Text style={[hm.mapStyleLabel, { color: active ? T.ACCENT : T.TEXT_MUT }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[hm.sectionDiv, { backgroundColor: T.DIVIDER }]} />
            <View style={hm.header}>
              <Text style={[hm.title, { color: T.TEXT_PRI }]}>Safety Heatmap</Text>
              {heatmapFilter !== 'off' && (
                <View style={[hm.countBadge, { backgroundColor: T.ITEM }]}>
                  {crashLoading
                    ? <ActivityIndicator size="small" color={T.ACCENT} />
                    : <Text style={[hm.countText, { color: T.ACCENT }]}>{crashPoints.length.toLocaleString()} points</Text>
                  }
                </View>
              )}
            </View>
            <Text style={[hm.subtitle, { color: T.TEXT_MUT }]}>Crash data from traffic records. Brighter = higher density.</Text>
            <View style={[hm.filterList, { backgroundColor: T.ITEM }]}>
              {HEATMAP_FILTERS.map((f, i) => {
                const active = heatmapFilter === f.id;
                return (
                  <View key={f.id}>
                    <Pressable
                      style={[hm.filterRow, active && hm.filterRowActive]}
                      onPress={() => { setHeatmapFilter(f.id); setShowHeatmapModal(false); }}
                    >
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : T.BG }]}>
                        <Ionicons name={f.icon as any} size={20} color={active ? f.color : T.TEXT_MUT} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, { color: T.TEXT_MUT }, active && { color: T.TEXT_PRI }]}>{f.label}</Text>
                        <Text style={[hm.filterDesc, { color: T.TEXT_MUT }]}>{f.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={T.ACCENT} />}
                    </Pressable>
                    {i < HEATMAP_FILTERS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: T.DIVIDER }]} />}
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
          <Pressable style={[hm.card, { backgroundColor: T.CARD }]} onPress={() => {}}>
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

            {/* Time picker — shown for depart/arrive */}
            {nowChoice !== 'now' && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: T.TEXT_MUT, fontSize: 12, fontWeight: '600', marginBottom: 10, letterSpacing: 0.8 }}>
                  {nowChoice === 'depart' ? 'DEPARTING AT' : 'ARRIVING BY'}
                </Text>
                {/* Hour scroll */}
                <View style={{ backgroundColor: T.ITEM, borderRadius: 16, padding: 4 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const active = pickerHour === h;
                      const label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
                      return (
                        <Pressable key={h}
                          style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                            backgroundColor: active ? T.ACCENT : 'transparent' }}
                          onPress={() => setPickerHour(h)}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#fff' : T.TEXT_MUT }}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
                {/* Minute buttons */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {([0, 30] as const).map(m => {
                    const active = pickerMin === m;
                    return (
                      <Pressable key={m}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                          backgroundColor: active ? T.ACCENT : T.ITEM }}
                        onPress={() => setPickerMin(m)}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: active ? '#fff' : T.TEXT_MUT }}>:{m === 0 ? '00' : '30'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {/* Preview */}
                <View style={{ alignItems: 'center', marginTop: 12 }}>
                  <Text style={{ color: T.TEXT_PRI, fontSize: 28, fontWeight: '800' }}>{pickerTimeLabel}</Text>
                </View>
              </View>
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
          <Pressable style={[hm.card, { backgroundColor: T.CARD }]} onPress={() => {}}>
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
                        { backgroundColor: T.CARD },
                        active && { backgroundColor: T.ACCENT, borderColor: T.ACCENT },
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
                  style={[styles.filterChip, { backgroundColor: T.CARD, borderColor: T.DIVIDER }]}
                  onPress={() => setShowNowModal(true)}
                >
                  <Text style={[styles.filterText, { color: T.TEXT_PRI }]}>{nowLabel}</Text>
                  <Ionicons name="chevron-down" size={14} color={T.TEXT_MUT} />
                </Pressable>
                <Pressable
                  style={[
                    styles.filterChip,
                    { backgroundColor: T.CARD, borderColor: avoidActive ? T.ACCENT : T.DIVIDER },
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
                const isSafeWay = alt.routeSource === 'safeway';
                const score = alt.safetyScore;
                const safetyPct = score != null ? Math.max(0, 100 - Math.round(score)) : null;
                const safetyColor = score == null ? '#7A8FA6'
                  : score < 33 ? '#1ABC93' : score < 66 ? '#FFA500' : '#FF4444';
                const routeName = alt.label ?? fmtSecs(alt.durationSecs);

                return (
                  <Pressable
                    key={`${travelMode}-card-${i}`}
                    style={[
                      styles.routeOptionCard,
                      { backgroundColor: T.CARD, borderColor: isSelected ? T.ACCENT : 'transparent' },
                    ]}
                    onPress={() => setSelectedRouteIndex(i)}
                  >
                    {/* Safety badge */}
                    <View style={[styles.matchBadge, styles.matchBadgeActive]}>
                      {isSafeWay ? (
                        <LinearGradient
                          colors={['#0A9E6E', '#1ABC93', '#44D9B8']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 0, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      ) : (
                        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: safetyColor, opacity: 0.15, borderRadius: 12 }]} />
                      )}
                      <View style={styles.matchBadgeContent}>
                        <Text style={[styles.matchWord, { color: isSafeWay ? '#fff' : safetyColor }]}>
                          {isSafeWay ? 'SAFEWAY' : 'SAFETY'}
                        </Text>
                        <Text style={[styles.matchPct, { color: isSafeWay ? '#fff' : safetyColor }]}>
                          {safetyPct != null ? `${safetyPct}%` : '–'}
                        </Text>
                      </View>
                    </View>

                    {/* Route info */}
                    <Pressable style={styles.routeOptionInfo} onPress={() => { setSelectedRouteIndex(i); setShowDetailsModal(true); }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI }]}>{routeName}</Text>
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

                    {/* Start button */}
                    <Pressable
                      style={[styles.startBtnWrap, !isSelected && { backgroundColor: T.ITEM }]}
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
                          colors={['#0A9E6E', '#1ABC93', '#44D9B8']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                      )}
                      <Text style={[styles.startBtnText, !isSelected && { color: T.TEXT_MUT }]}>Start</Text>
                    </Pressable>
                  </Pressable>
                );
              })}

              {/* Fallback card (BUS/RIDESHARE) */}
              {!routeBusy && alternatives.length === 0 && activeData && (
                <View style={[styles.routeOptionCard, { backgroundColor: T.CARD, borderColor: T.ACCENT }]}>
                  <View style={[styles.matchBadge, styles.matchBadgeActive]}>
                    <LinearGradient colors={['#0A9E6E', '#1ABC93', '#44D9B8']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFillObject} />
                    <View style={styles.matchBadgeContent}>
                      <Text style={[styles.matchWord, { color: '#fff' }]}>SAFETY</Text>
                      <Text style={[styles.matchPct, { color: '#fff' }]}>
                        {activeData.safetyScore != null ? `${Math.max(0, 100 - Math.round(activeData.safetyScore))}%` : '–'}
                      </Text>
                    </View>
                  </View>
                  <Pressable style={styles.routeOptionInfo} onPress={() => setShowDetailsModal(true)}>
                    <Text style={[styles.routeOptionTitle, { color: T.TEXT_PRI }]}>Route 1</Text>
                    <Text style={[styles.routeOptionMeta, { color: T.TEXT_MUT }]}>{fmtSecs(activeSecs)}  •  {fmtDist(activeData.distance)}</Text>
                    <Text style={[styles.routeOptionTraffic, { color: T.ACCENT }]}>Arrive ~{arrivalFrom(activeSecs)}</Text>
                  </Pressable>
                  <Pressable style={styles.startBtnWrap} onPress={() => {
                    const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                    const from = stopsSwapped ? destCoords : originCoords;
                    const to   = stopsSwapped ? originCoords : destCoords;
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
                  }}>
                    <LinearGradient colors={['#0A9E6E', '#1ABC93', '#44D9B8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                    <Text style={styles.startBtnText}>Start</Text>
                  </Pressable>
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
  modeChip: { flex: 1, height: 48, marginHorizontal: 3, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
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
  routeOptionCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1.5, gap: 12 },
  matchBadge: { borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', width: 76, overflow: 'hidden', position: 'relative' },
  matchBadgeActive: { backgroundColor: 'transparent' },
  matchBadgeContent: { alignItems: 'center' },
  matchWord: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  matchPct: { fontSize: 24, fontWeight: '800' },
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
  tabActive: { borderBottomColor: GREEN },
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