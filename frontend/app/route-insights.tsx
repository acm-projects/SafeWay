import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  useWindowDimensions,
} from 'react-native';
// DateTimePicker removed — replaced with inline preset chips
// import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import {
  RouteInsightsMetricsBody,
  type ModeRouteData,
} from '@/components/RouteInsightsPage';
import { consumeRouteInsightsPayload, type RouteInsightsPayload } from '@/lib/routeInsightsPayload';
import { loadMapSession, scheduleSaveMapSession, type MapStyleId } from '@/lib/mapSession';
import { useTheme } from '@/providers/theme-context';
import {
  HotspotDetailPanel,
  HotspotPulseMarkers,
  HotspotRouteSegments,
  PeakFlowIntensityPolylines,
  PeakFlowVolumeHalos,
  strokeColorForSegmentRisk,
  strokeColorForSegmentRiskBlue,
  type HotspotMapItem,
} from '@/components/RouteInsightsMapOverlays';

type RoutePoint = { latitude: number; longitude: number };

function isCoordSegmentArray(
  segs: any[] | undefined,
): segs is Array<{ start: RoutePoint; end: RoutePoint; risk: number }> {
  return (
    Array.isArray(segs) &&
    segs.length > 0 &&
    segs[0]?.start &&
    segs[0]?.end &&
    typeof segs[0]?.risk === 'number'
  );
}

type VizId = 'overview' | 'aadt' | 'peak' | 'hotspots' | 'scored';

/** Stable calendar date for time-only pickers (no meaningful day — only clock matters). */
function dateFromMinutesOfDay(totalMin: number): Date {
  const d = new Date(2000, 0, 1, 0, 0, 0, 0);
  const clamped = Math.max(0, Math.min(1439, Math.round(totalMin)));
  d.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
  return d;
}

function minutesOfDayFromDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatTimeOfDayLabel(totalMin: number): string {
  return dateFromMinutesOfDay(totalMin).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

const VIZ_OPTIONS: { id: VizId; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'Safety score, speed, and key factors' },
  { id: 'aadt', label: 'AADT', hint: 'Hourly traffic trend for this route' },
  {
    id: 'peak',
    label: 'Peak flow',
    hint: 'How traffic intensity changes by time',
  },
  {
    id: 'scored',
    label: 'Route Segments',
    hint: 'Segment count and structural route quality',
  },
  { id: 'hotspots', label: 'Hot spots', hint: 'Most critical stretches to watch' },
];

const LEGEND_COLORS = ['#000000', '#4B1D7E', '#8D2E6C', '#D4573A', '#F6C23E'] as const;
const AADT_LEGEND_COLORS = ['#42A5F5', '#FBC02D', '#E53935'] as const;

const FLOAT_SIDE = 14;
const FLOAT_BOTTOM = 18;
const FLOAT_RADIUS = 26;

/** Space above expanded sheet so it never covers the map back FAB. */
const BACK_FAB_TOP = 10;
const BACK_FAB_SIZE = 42;
const SHEET_CLEAR_BELOW_BACK = 12;

export default function RouteInsightsScreen() {
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const lastSheetSnapRef = useRef(1);
  const hotspotResumeSnapRef = useRef(1);
  const animatedPosition = useSharedValue(windowHeight);

  const [payload, setPayload] = useState<RouteInsightsPayload | null>(null);
  const [viz, setViz] = useState<VizId>('overview');
  const [hotspotModalIndex, setHotspotModalIndex] = useState<number | null>(null);
  const [peakMinutesOfDay, setPeakMinutesOfDay] = useState(() => {
    const now = new Date();
    const m = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    return Math.min(1439, Math.max(0, m));
  });
  const [draftMinutesOfDay, setDraftMinutesOfDay] = useState(() => {
    const now = new Date();
    const m = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    return Math.min(1439, Math.max(0, m));
  });
  // timeModalVisible removed — using inline preset chips now
  // const [timeModalVisible, setTimeModalVisible] = useState(false);
  const [mapStyleType, setMapStyleType] = useState<MapStyleId>('standard');
  const [currentRegion, setCurrentRegion] = useState({
    latitude: 41.8781,
    longitude: -87.6298,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });

  useEffect(() => {
    const p = consumeRouteInsightsPayload();
    if (!p?.activeData?.coords?.length) {
      router.back();
      return;
    }
    setPayload(p);
    const c = p.activeData!.coords;
    const mid = c[Math.floor(c.length / 2)];
    setCurrentRegion({
      latitude: mid.latitude,
      longitude: mid.longitude,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    });
    const midH = Math.round(windowHeight * 0.5);
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(c, {
        edgePadding: {
          top: insets.top + 92,
          right: 52,
          bottom: midH + insets.bottom + 24,
          left: 52,
        },
        animated: true,
      });
    }, 400);
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadMapSession();
      if (s?.mapStyleType) setMapStyleType(s.mapStyleType);
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const rushFactor = useMemo(() => {
    const h = Math.floor(peakMinutesOfDay / 60);
    if (h >= 7 && h <= 9) return 0.92;
    if (h >= 16 && h <= 19) return 0.98;
    if (h >= 11 && h <= 14) return 0.45;
    return 0.12;
  }, [peakMinutesOfDay]);

  const shapFactors = useMemo(() => {
    const raw = payload?.activeData?.topRiskFactors;
    if (!raw?.length) return [];
    return raw.map((f: { label?: string; factor?: string; count?: number; pct?: number }) => ({
      label: String(f.label ?? f.factor ?? 'Risk factor'),
      count: f.count,
      pct: f.pct,
    }));
  }, [payload?.activeData?.topRiskFactors]);

  const sheetTopInset = insets.top + BACK_FAB_TOP + BACK_FAB_SIZE + SHEET_CLEAR_BELOW_BACK;
  const sheetContainerBottomPad = insets.bottom * 0.5 + FLOAT_BOTTOM;

  const snapPoints = useMemo(() => {
    // Short peek: handle + title only so the green “Overview” chip gradient stays hidden when collapsed.
    const minPeek = Math.max(86, Math.round(windowHeight * 0.072));
    const containerH = windowHeight - sheetContainerBottomPad;
    const maxFromTop = windowHeight - sheetTopInset;
    const max = Math.max(minPeek + 100, Math.round(Math.min(maxFromTop, containerH - 6)));
    const mid = Math.min(Math.round(windowHeight * 0.5), max - 32);
    return [minPeek, mid, max];
  }, [windowHeight, sheetTopInset, sheetContainerBottomPad]);

  const sheetBgStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius: FLOAT_RADIUS,
    borderTopRightRadius: FLOAT_RADIUS,
    borderBottomLeftRadius: FLOAT_RADIUS,
    borderBottomRightRadius: FLOAT_RADIUS,
  }));

  const outerWrapStyle = useAnimatedStyle(() => ({
    left: FLOAT_SIDE,
    right: FLOAT_SIDE,
    bottom: insets.bottom * 0.5 + FLOAT_BOTTOM,
  }));

  const clipWrapStyle = useAnimatedStyle(() => ({ borderRadius: FLOAT_RADIUS }));

  const coords = payload?.activeData?.coords ?? [];
  const segsRaw = payload?.activeData?.segmentRisks as unknown;
  const highRiskApi = payload?.activeData?.highRiskCoords ?? [];
  const nHighRisk = payload?.activeData?.nHighRisk ?? 0;

  const segsCoordArray = useMemo(() => {
    return isCoordSegmentArray(segsRaw as any[])
      ? (segsRaw as Array<{ start: RoutePoint; end: RoutePoint; risk: number }>)
      : null;
  }, [segsRaw]);

  /** Hot spots: coordinates + segment risk when known (backend high_risk_coords or derived segments). */
  const hotspotItems = useMemo((): HotspotMapItem[] => {
    const attachNearestRisk = (coord: RoutePoint): HotspotMapItem => {
      let risk: number | undefined;
      if (segsCoordArray?.length) {
        let best = Infinity;
        let bestR = 0;
        for (const seg of segsCoordArray) {
          const midLat = (seg.start.latitude + seg.end.latitude) / 2;
          const midLng = (seg.start.longitude + seg.end.longitude) / 2;
          const d =
            Math.abs(midLat - coord.latitude) +
            Math.abs(midLng - coord.longitude);
          if (d < best) {
            best = d;
            bestR = seg.risk;
          }
        }
        risk = bestR;
      }
      return { coord, risk };
    };

    if (highRiskApi.length > 0) {
      return highRiskApi.map(c => attachNearestRisk(c));
    }
    const cap = Math.max(0, nHighRisk);
    if (cap <= 0) return [];
    if (segsCoordArray?.length) {
      const sorted = [...segsCoordArray].sort((a, b) => b.risk - a.risk);
      const out: HotspotMapItem[] = [];
      const seen = new Set<string>();
      for (const seg of sorted) {
        const lat = (seg.start.latitude + seg.end.latitude) / 2;
        const lng = (seg.start.longitude + seg.end.longitude) / 2;
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ coord: { latitude: lat, longitude: lng }, risk: seg.risk });
        if (out.length >= cap) break;
      }
      if (out.length > 0) return out;
    }
    if (coords.length >= 2) {
      const out: HotspotMapItem[] = [];
      for (let k = 1; k <= cap; k++) {
        const t = k / (cap + 1);
        const pos = t * (coords.length - 1);
        const idx = Math.floor(pos);
        const f = pos - idx;
        const a = coords[idx]!;
        const b = coords[Math.min(idx + 1, coords.length - 1)]!;
        out.push({
          coord: {
            latitude: a.latitude + (b.latitude - a.latitude) * f,
            longitude: a.longitude + (b.longitude - a.longitude) * f,
          },
        });
      }
      return out;
    }
    return [];
  }, [highRiskApi, nHighRisk, segsCoordArray, coords]);

  const hotspotHeatPoints = useMemo(() => {
    const pts: { latitude: number; longitude: number; weight: number }[] = [];
    const d = 0.00022;
    for (const h of hotspotItems) {
      const { latitude, longitude } = h.coord;
      const baseW = h.risk != null ? 4 + (h.risk / 100) * 10 : 6;
      pts.push({ latitude, longitude, weight: baseW });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push({
          latitude: latitude + Math.sin(a) * d,
          longitude: longitude + Math.cos(a) * d,
          weight: Math.max(1, baseW * 0.35),
        });
      }
    }
    return pts;
  }, [hotspotItems]);

  const onRegionComplete = useCallback(
    (r: typeof currentRegion) => {
      setCurrentRegion(r);
      scheduleSaveMapSession({
        latitude: r.latitude,
        longitude: r.longitude,
        latitudeDelta: r.latitudeDelta,
        longitudeDelta: r.longitudeDelta,
        mapStyleType,
      });
    },
    [mapStyleType],
  );

  const dismissHotspot = useCallback(() => {
    setHotspotModalIndex(null);
    requestAnimationFrame(() => {
      bottomSheetRef.current?.snapToIndex(hotspotResumeSnapRef.current);
    });
  }, []);

  useEffect(() => {
    if (hotspotModalIndex === null) return;
    hotspotResumeSnapRef.current = lastSheetSnapRef.current;
    requestAnimationFrame(() => {
      bottomSheetRef.current?.snapToIndex(0);
    });
  }, [hotspotModalIndex]);

  const refitForSheetIndex = useCallback(
    (idx: number) => {
      if (!mapRef.current || coords.length < 2) return;
      const [minP, midP, maxP] = snapPoints;
      const bottomPad =
        idx === 0 ? minP + insets.bottom + 28 : idx === 1 ? midP + insets.bottom + 24 : maxP + insets.bottom + 20;
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: insets.top + 92, right: 52, bottom: bottomPad, left: 52 },
        animated: true,
      });
    },
    [coords, snapPoints, insets.top, insets.bottom],
  );

  if (!payload?.activeData) {
    return (
      <View style={[styles.fill, { backgroundColor: T.BG, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: T.TEXT_MUT }}>Loading…</Text>
      </View>
    );
  }

  const data: ModeRouteData = payload.activeData;

  return (
    <View style={[styles.fill, { backgroundColor: T.BG }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={currentRegion}
        customMapStyle={undefined}
        mapType={mapStyleType === 'standard' ? 'standard' : mapStyleType}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onRegionChangeComplete={onRegionComplete}
      >
        {viz === 'overview' && coords.length > 1 ? (
          <Polyline
            coordinates={coords}
            strokeColor="rgba(74, 144, 226, 0.92)"
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {viz === 'aadt' && coords.length > 1 && isCoordSegmentArray(segsRaw as any)
          ? (segsRaw as Array<{ start: RoutePoint; end: RoutePoint; risk: number }>).map((seg, si) => (
              <Polyline
                key={`aadt-seg-${si}`}
                coordinates={[seg.start, seg.end]}
                strokeColor={strokeColorForSegmentRisk(seg.risk)}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
              />
            ))
          : null}

        {viz === 'aadt' && coords.length > 1 && !isCoordSegmentArray(segsRaw as any) ? (
          <Polyline
            coordinates={coords}
            strokeColor="rgba(66, 165, 245, 0.92)"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {viz === 'peak' && coords.length > 1 ? (
          <>
            <PeakFlowVolumeHalos coords={coords} segments={segsCoordArray} rushFactor={rushFactor} />
            <PeakFlowIntensityPolylines
              coords={coords}
              segments={segsCoordArray}
              rushFactor={rushFactor}
            />
          </>
        ) : null}

        {viz === 'scored' && coords.length > 1 && isCoordSegmentArray(segsRaw as any)
          ? (segsRaw as Array<{ start: RoutePoint; end: RoutePoint; risk: number }>).map((seg, si) => (
              <Polyline
                key={`scored-seg-${si}`}
                coordinates={[seg.start, seg.end]}
                strokeColor={strokeColorForSegmentRiskBlue(seg.risk)}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
              />
            ))
          : null}

        {viz === 'scored' && coords.length > 1 && !isCoordSegmentArray(segsRaw as any) ? (
          <Polyline
            coordinates={coords}
            strokeColor="rgba(74, 144, 226, 0.92)"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {viz === 'hotspots' && coords.length > 1 ? (
          <Polyline
            coordinates={coords}
            strokeColor="rgba(255, 107, 107, 0.32)"
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {viz === 'hotspots' && hotspotItems.length > 0 ? (
          <HotspotRouteSegments
            coords={coords}
            segments={segsCoordArray}
            hotspotItems={hotspotItems}
          />
        ) : null}

        {viz === 'hotspots' && hotspotItems.length > 0 ? (
          <HotspotPulseMarkers items={hotspotItems} onPressSpot={i => setHotspotModalIndex(i)} />
        ) : null}

        {payload.originLat != null && payload.originLng != null ? (
          <Marker coordinate={{ latitude: payload.originLat, longitude: payload.originLng }} anchor={{ x: 0.35, y: 0.5 }}>
            <View style={styles.originMarkerRow}>
              <View style={styles.originDot}>
                <View style={styles.originInner} />
              </View>
              <View style={styles.originHeadingChev} />
            </View>
          </Marker>
        ) : null}

        {payload.destLat != null && payload.destLng != null ? (
          <Marker coordinate={{ latitude: payload.destLat, longitude: payload.destLng }} pinColor="#FF4444" />
        ) : null}

      </MapView>

      {(viz === 'aadt' || viz === 'scored') && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 14,
            width: 178,
            top: insets.top + 106,
            backgroundColor: 'rgba(8,10,32,0.86)',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
            paddingHorizontal: 8,
            paddingVertical: 6,
            zIndex: 30,
          }}
        >
          <Text style={{ color: '#C8D6E5', fontSize: 9, fontWeight: '700', marginBottom: 4 }}>
            {viz === 'aadt' ? 'AADT' : 'Route Segments'}
          </Text>
          <View style={{ borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
            <LinearGradient
              colors={viz === 'aadt' ? [...AADT_LEGEND_COLORS] : [...LEGEND_COLORS]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ height: 7 }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ color: '#9BB1C8', fontSize: 8 }}>{viz === 'aadt' ? 'Low traffic risk' : '0'}</Text>
            <Text style={{ color: '#9BB1C8', fontSize: 8 }}>{viz === 'aadt' ? 'High traffic risk' : '250'}</Text>
          </View>
        </View>
      )}

{/* Time picker modal replaced with inline preset chips + slider below */}

      {hotspotModalIndex !== null ? (
        <>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 44 }]}
            onPress={dismissHotspot}
          />
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 14,
              right: 14,
              bottom: insets.bottom + 10,
              zIndex: 45,
            }}
          >
            {(() => {
              const i = hotspotModalIndex;
              const item = hotspotItems[i];
              const spotRisk = item?.risk;
              const f = shapFactors[i % Math.max(shapFactors.length, 1)];
              const title = f?.label ? `Pattern: ${f.label}` : 'High-risk zone';
              const body = f?.label
                ? `${f.label} shows up often on this route${f.pct != null ? ` (~${f.pct}% of scored intersections).` : '.'} Use extra caution when merging or crossing here.`
                : spotRisk != null
                  ? 'This stretch ranks higher on the safety model than most of this route. Slow down and scan intersections ahead.'
                  : 'This location is highlighted from your route risk profile. Use extra caution in this area.';
              return (
                <HotspotDetailPanel
                  docked
                  onClose={dismissHotspot}
                  index={i}
                  reasonTitle={title}
                  reasonBody={body}
                  accentColor={T.ACCENT}
                  riskScore={spotRisk}
                />
              );
            })()}
          </View>
        </>
      ) : null}

      <Pressable
        style={[styles.backFab, { top: insets.top + 10, backgroundColor: T.BG }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
      </Pressable>

      <Animated.View pointerEvents="box-none" style={[styles.sheetWrap, outerWrapStyle]}>
        <Animated.View pointerEvents="box-none" style={[styles.sheetClip, clipWrapStyle]}>
          <BottomSheet
            ref={bottomSheetRef}
            index={1}
            snapPoints={snapPoints}
            topInset={sheetTopInset}
            animatedPosition={animatedPosition}
            onChange={idx => {
              lastSheetSnapRef.current = idx;
              refitForSheetIndex(idx);
            }}
            backgroundComponent={({ style }) => (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, { backgroundColor: T.BG }, style, sheetBgStyle]}
              />
            )}
            handleIndicatorStyle={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' }}
            enablePanDownToClose={false}
          >
            <BottomSheetScrollView
              nestedScrollEnabled
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28, gap: 12 }}
            >
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: T.TEXT_PRI }]}>Route Insights</Text>
                <Text style={[styles.sub, { color: T.TEXT_MUT }]}>Map · metrics</Text>
              </View>

              <GHScrollView
                horizontal
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.chipRow, { paddingRight: 80 }]}
              >
                {VIZ_OPTIONS.map(opt => {
                  const on = viz === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        void Haptics.selectionAsync();
                        setViz(opt.id);
                      }}
                      style={[styles.vizChip, { borderColor: on ? 'rgba(255,255,255,0.35)' : 'transparent' }]}
                    >
                      {on ? (
                        <LinearGradient
                          colors={['#064E3B', '#047857', '#059669']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[StyleSheet.absoluteFillObject, { borderRadius: 14 }]}
                        />
                      ) : (
                        <View style={[StyleSheet.absoluteFillObject, { borderRadius: 14, backgroundColor: T.CARD }]} />
                      )}
                      <Text style={{ color: on ? '#FFFFFF' : T.TEXT_MUT, fontSize: 12, fontWeight: '800' }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: on ? '#FFFFFF' : T.TEXT_MUT, fontSize: 9, marginTop: 2 }}>{opt.hint}</Text>
                    </Pressable>
                  );
                })}
              </GHScrollView>

              {viz === 'scored' ? (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginBottom: 8, lineHeight: 16, fontWeight: '600' }}>
                    Each segment is assessed for structural road safety.
                  </Text>
                </View>
              ) : null}

              {viz === 'aadt' ? (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginBottom: 8, lineHeight: 16, fontWeight: '600' }}>
                    AADT risk colors on the map path.
                  </Text>
                </View>
              ) : null}

              {viz === 'peak' ? (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginBottom: 8, fontWeight: '600' }}>
                    Time of day (flow intensity)
                  </Text>
                  <View style={[styles.peakTimeRow, { backgroundColor: T.CARD, borderColor: 'rgba(255,255,255,0.08)' }]}>
                    <View style={[styles.peakTimeIconWrap, { backgroundColor: `${T.ACCENT}22` }]}>
                      <Ionicons name="time-outline" size={20} color={T.ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 10, fontWeight: '600' }}>Rush intensity model</Text>
                      <Text style={{ color: T.TEXT_PRI, fontSize: 15, fontWeight: '800', marginTop: 2 }}>
                        {formatTimeOfDayLabel(peakMinutesOfDay)}
                      </Text>
                    </View>
                  </View>
                  <GHScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingVertical: 10, paddingRight: 16 }}
                  >
                    {[
                      { label: 'Now',       min: new Date().getHours() * 60 + new Date().getMinutes() },
                      { label: '6 AM',      min: 360  },
                      { label: '8 AM',      min: 480  },
                      { label: '12 PM',     min: 720  },
                      { label: '5 PM',      min: 1020 },
                      { label: '7 PM',      min: 1140 },
                      { label: '10 PM',     min: 1320 },
                    ].map(preset => {
                      const isActive = Math.abs(peakMinutesOfDay - preset.min) < 15;
                      return (
                        <Pressable
                          key={preset.label}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setPeakMinutesOfDay(preset.min);
                            setDraftMinutesOfDay(preset.min);
                          }}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: 20,
                            backgroundColor: isActive ? T.ACCENT : T.ITEM,
                            borderWidth: 1,
                            borderColor: isActive ? T.ACCENT : 'rgba(255,255,255,0.06)',
                          }}
                        >
                          <Text style={{ color: isActive ? '#FFFFFF' : T.TEXT_PRI, fontSize: 12, fontWeight: '700' }}>
                            {preset.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </GHScrollView>
                  <Text style={{ color: T.TEXT_MUT, fontSize: 10, lineHeight: 14, marginTop: 8 }}>
                    {segsCoordArray
                      ? 'Glow follows each segment’s risk from the backend; the time you pick scales how “busy” the corridor feels.'
                      : 'No per-segment risk in this response — glow uses a visual estimate along the path; time still scales intensity.'}
                  </Text>
                </View>
              ) : null}

              <RouteInsightsMetricsBody
                activeData={data}
                activeTab={viz === 'scored' ? 'segments' : viz}
              />
            </BottomSheetScrollView>
          </BottomSheet>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, zIndex: 32, elevation: 32 },
  sheetClip: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  backFab: {
    position: 'absolute',
    left: 14,
    zIndex: 40,
    elevation: 40,
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  headerRow: { paddingTop: 4, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  chipRow: { gap: 10, paddingVertical: 4 },
  vizChip: {
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 14,
    marginRight: 4,
    borderWidth: 1,
    minWidth: 96,
  },
  originMarkerRow: { flexDirection: 'row', alignItems: 'center' },
  originDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(74,144,226,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  originInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4A90E2',
    borderWidth: 2,
    borderColor: '#fff',
  },
  originHeadingChev: {
    width: 0,
    height: 0,
    marginLeft: -1,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#4A90E2',
  },
  peakTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  peakTimeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    paddingBottom: 32,
  },
  timeModalCard: {
    marginHorizontal: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  timeModalTitle: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '600',
    paddingTop: 12,
    paddingBottom: 4,
  },
  timeModalActions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  timeModalBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  timeModalDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)' },
  timeModalCancel: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  timeModalDone: { color: '#5AC8FA', fontSize: 17, fontWeight: '600' },
});
