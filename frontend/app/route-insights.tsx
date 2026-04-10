import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { GOOGLE_MAPS_DARK_STYLE } from '@/constants/googleMapDarkStyle';
import {
  RouteInsightsMetricsBody,
  type ModeRouteData,
} from '@/components/RouteInsightsPage';
import { consumeRouteInsightsPayload, type RouteInsightsPayload } from '@/lib/routeInsightsPayload';
import { loadMapSession, scheduleSaveMapSession, type MapStyleId } from '@/lib/mapSession';
import { useTheme } from '@/providers/theme-context';
import {
  AadtFlowPolylines,
  HotspotGlassModal,
  HotspotPulseMarkers,
  PeakFlowMarkers,
  ShapLogicMarkers,
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

type VizId = 'risk' | 'aadt' | 'peak' | 'hotspots';

const VIZ_OPTIONS: { id: VizId; label: string; hint: string }[] = [
  { id: 'risk', label: 'SHAP', hint: 'Logic layers · factors' },
  { id: 'aadt', label: 'AADT', hint: 'Volume glow' },
  { id: 'peak', label: 'Peak flow', hint: 'Rush intensity' },
  { id: 'hotspots', label: 'Hot spots', hint: 'The pulse' },
];

const SEAFOAM = '#1ABC93';
const FLOAT_SIDE = 14;
const FLOAT_BOTTOM = 18;
const FLOAT_RADIUS = 26;

export default function RouteInsightsScreen() {
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const animatedPosition = useSharedValue(windowHeight);

  const [payload, setPayload] = useState<RouteInsightsPayload | null>(null);
  const [viz, setViz] = useState<VizId>('risk');
  const [hotspotModalIndex, setHotspotModalIndex] = useState<number | null>(null);
  const [peakHour, setPeakHour] = useState(12);
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
    if (peakHour >= 7 && peakHour <= 9) return 0.82;
    if (peakHour >= 16 && peakHour <= 19) return 0.88;
    if (peakHour >= 11 && peakHour <= 14) return 0.52;
    return 0.32;
  }, [peakHour]);

  const shapFactors = useMemo(() => {
    const raw = payload?.activeData?.topRiskFactors;
    if (!raw?.length) return [];
    return raw.map((f: { label?: string; factor?: string; count?: number; pct?: number }) => ({
      label: String(f.label ?? f.factor ?? 'Risk factor'),
      count: f.count,
      pct: f.pct,
    }));
  }, [payload?.activeData?.topRiskFactors]);

  const snapPoints = useMemo(() => {
    const minPeek = Math.max(76, Math.round(windowHeight * 0.11));
    const mid = Math.round(windowHeight * 0.5);
    const max = Math.round(windowHeight * 0.92);
    return [minPeek, mid, max];
  }, [windowHeight]);

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

  /** Hot spots on map: API coords when present; else top-N segment midpoints by risk; else spaced along the route. */
  const displayHotspots = useMemo((): RoutePoint[] => {
    if (highRiskApi.length > 0) return highRiskApi;
    const cap = Math.max(0, nHighRisk);
    if (cap <= 0) return [];
    if (segsCoordArray?.length) {
      const sorted = [...segsCoordArray].sort((a, b) => b.risk - a.risk);
      const out: RoutePoint[] = [];
      const seen = new Set<string>();
      for (const seg of sorted) {
        const lat = (seg.start.latitude + seg.end.latitude) / 2;
        const lng = (seg.start.longitude + seg.end.longitude) / 2;
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ latitude: lat, longitude: lng });
        if (out.length >= cap) break;
      }
      if (out.length > 0) return out;
    }
    if (coords.length >= 2) {
      const out: RoutePoint[] = [];
      for (let k = 1; k <= cap; k++) {
        const t = k / (cap + 1);
        const pos = t * (coords.length - 1);
        const idx = Math.floor(pos);
        const f = pos - idx;
        const a = coords[idx]!;
        const b = coords[Math.min(idx + 1, coords.length - 1)]!;
        out.push({
          latitude: a.latitude + (b.latitude - a.latitude) * f,
          longitude: a.longitude + (b.longitude - a.longitude) * f,
        });
      }
      return out;
    }
    return [];
  }, [highRiskApi, nHighRisk, segsCoordArray, coords]);

  const hotspotHeatPoints = useMemo(() => {
    const pts: { latitude: number; longitude: number; weight: number }[] = [];
    const d = 0.00035;
    for (const h of displayHotspots) {
      pts.push({ latitude: h.latitude, longitude: h.longitude, weight: 8 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push({
          latitude: h.latitude + Math.sin(a) * d,
          longitude: h.longitude + Math.cos(a) * d,
          weight: 3,
        });
      }
    }
    return pts;
  }, [displayHotspots]);

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
        customMapStyle={mapStyleType === 'standard' && T.isDark ? GOOGLE_MAPS_DARK_STYLE : undefined}
        mapType={mapStyleType === 'standard' ? 'standard' : mapStyleType}
        showsUserLocation
        showsMyLocationButton={false}
        onRegionChangeComplete={onRegionComplete}
      >
        {viz === 'risk' && isCoordSegmentArray(segsRaw as any)
          ? (segsRaw as Array<{ start: RoutePoint; end: RoutePoint; risk: number }>).map((seg, si) => (
              <Polyline
                key={`seg-${si}`}
                coordinates={[seg.start, seg.end]}
                strokeColor={seg.risk > 66 ? '#FF4444' : seg.risk > 33 ? '#FFA500' : SEAFOAM}
                strokeWidth={6}
                lineCap="round"
                lineJoin="round"
              />
            ))
          : null}

        {viz === 'risk' && !isCoordSegmentArray(segsRaw as any) && coords.length > 1 ? (
          <Polyline coordinates={coords} strokeColor="#4A90E2" strokeWidth={5} lineCap="round" lineJoin="round" />
        ) : null}

        {viz === 'risk' && coords.length > 1 && shapFactors.length > 0 ? (
          <ShapLogicMarkers coords={coords} factors={shapFactors} />
        ) : null}

        {viz === 'aadt' && coords.length > 1 ? (
          <>
            <Polyline
              coordinates={coords}
              strokeColor="rgba(74, 144, 226, 0.2)"
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
            <AadtFlowPolylines coords={coords} />
          </>
        ) : null}

        {viz === 'peak' && coords.length > 1 ? (
          <>
            <Polyline
              coordinates={coords}
              strokeColor={`rgba(26, 188, 147, ${0.12 + rushFactor * 0.22})`}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={coords}
              strokeColor={T.ACCENT}
              strokeWidth={2.5}
              lineCap="round"
              lineJoin="round"
            />
            <PeakFlowMarkers coords={coords} rushFactor={rushFactor} />
          </>
        ) : null}

        {viz === 'hotspots' && coords.length > 1 ? (
          <Polyline
            coordinates={coords}
            strokeColor="rgba(255, 107, 107, 0.32)"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {viz === 'hotspots' && hotspotHeatPoints.length > 0 ? (
          <Heatmap
            points={hotspotHeatPoints}
            opacity={0.82}
            radius={38}
            gradient={{
              colors: ['#FFFF00', '#FF9800', '#F44336', '#B71C1C'],
              startPoints: [0.15, 0.4, 0.65, 1],
              colorMapSize: 256,
            }}
          />
        ) : null}

        {viz === 'hotspots' && displayHotspots.length > 0 ? (
          <HotspotPulseMarkers spots={displayHotspots} onPressSpot={i => setHotspotModalIndex(i)} />
        ) : null}

        {payload.originLat != null && payload.originLng != null ? (
          <Marker coordinate={{ latitude: payload.originLat, longitude: payload.originLng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originDot}>
              <View style={styles.originInner} />
            </View>
          </Marker>
        ) : null}

        {payload.destLat != null && payload.destLng != null ? (
          <Marker coordinate={{ latitude: payload.destLat, longitude: payload.destLng }} pinColor="#FF4444" />
        ) : null}
      </MapView>

      {(() => {
        const i = hotspotModalIndex;
        if (i === null) return null;
        const f = shapFactors[i % Math.max(shapFactors.length, 1)];
        const title = f?.label ? `Pattern: ${f.label}` : 'High-risk zone';
        const body = f?.label
          ? `${f.label} shows up often on this route${f.pct != null ? ` (~${f.pct}% of scored nodes).` : '.'} Use extra caution when merging or crossing here.`
          : 'This location scores higher than nearby segments on the route model.';
        return (
          <HotspotGlassModal
            visible
            onClose={() => setHotspotModalIndex(null)}
            index={i}
            reasonTitle={title}
            reasonBody={body}
            accentColor={T.ACCENT}
          />
        );
      })()}

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
            animatedPosition={animatedPosition}
            onChange={idx => refitForSheetIndex(idx)}
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
                contentContainerStyle={[styles.chipRow, { paddingRight: 20 }]}
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
                      style={[
                        styles.vizChip,
                        { backgroundColor: T.CARD, borderColor: on ? 'rgba(255,255,255,0.35)' : 'transparent' },
                      ]}
                    >
                      <Text style={{ color: on ? '#FFFFFF' : T.TEXT_MUT, fontSize: 12, fontWeight: '800' }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: T.TEXT_MUT, fontSize: 9, marginTop: 2 }}>{opt.hint}</Text>
                    </Pressable>
                  );
                })}
              </GHScrollView>

              {viz === 'peak' ? (
                <View style={{ marginBottom: 4 }}>
                  <Text style={{ color: T.TEXT_MUT, fontSize: 11, marginBottom: 8, fontWeight: '600' }}>
                    Time of day (scrub rush intensity)
                  </Text>
                  <GHScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, paddingBottom: 4, paddingRight: 16 }}
                  >
                    {[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(h => {
                      const label = h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
                      const on = peakHour === h;
                      return (
                        <Pressable
                          key={h}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setPeakHour(h);
                          }}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 12,
                            backgroundColor: on ? `${T.ACCENT}40` : T.ITEM,
                            borderWidth: 1,
                            borderColor: on ? T.ACCENT : 'transparent',
                          }}
                        >
                          <Text style={{ color: on ? '#FFFFFF' : T.TEXT_MUT, fontSize: 12, fontWeight: '700' }}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </GHScrollView>
                </View>
              ) : null}

              <RouteInsightsMetricsBody activeData={data} />
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    marginRight: 4,
    borderWidth: 1,
    minWidth: 108,
  },
  originDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(26,188,147,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  originInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: SEAFOAM },
});
