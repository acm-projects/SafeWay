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

import { getRoute, searchPlaces } from '@/lib/api';
import type { PlaceSearchResult, RoutePoint } from '@/lib/api';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Tokens ───────────────────────────────────────────────────────────────────
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
interface ModeRouteData { coords: RoutePoint[]; distance: number; durationSecs: number; }

// Heatmap filters — mirrors index.tsx
const HEATMAP_FILTERS: { id: HeatmapFilter | 'off'; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'off',   label: 'Off',             icon: 'eye-off-outline',   color: '#7A8FA6', desc: 'Hide heatmap' },
  { id: 'all',   label: 'All Crashes',     icon: 'warning-outline',   color: '#FF6B6B', desc: 'Every crash in the area' },
  { id: 'fatal', label: 'Fatal / Serious', icon: 'skull-outline',     color: '#FF3333', desc: 'Fatal or serious injury crashes' },
  { id: 'ped',   label: 'Pedestrian',      icon: 'walk-outline',      color: '#FFA500', desc: 'Crashes involving pedestrians' },
  { id: 'bike',  label: 'Bicycle',         icon: 'bicycle-outline',   color: '#1ABC93', desc: 'Crashes involving cyclists' },
  { id: 'hit',   label: 'Hit & Run',       icon: 'car-sport-outline', color: '#C084FC', desc: 'Hit and run incidents' },
];

function SheetBg({ style }: { style?: any }) {
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: SHEET_BG }, style]} />;
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
  const { height: screenH } = useWindowDimensions();
  // Card gets an explicit pixel height so flex:1 children can expand
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
        {/* Card has explicit height so inner flex:1 ScrollViews work */}
        <View style={[dm.card, { height: CARD_HEIGHT }]}>

          {/* ── Tab row + close ── */}
          <View style={dm.tabRow}>
            <Pressable onPress={() => setTab('details')} style={[dm.tab, tab === 'details' && dm.tabActive]}>
              <Text style={[dm.tabText, tab === 'details' && dm.tabTextActive]}>Details</Text>
            </Pressable>
            <Pressable onPress={() => setTab('insights')} style={[dm.tab, tab === 'insights' && dm.tabActive]}>
              <Text style={[dm.tabText, tab === 'insights' && dm.tabTextActive]}>Route Insights</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={dm.closeBtnCircle}>
                <Ionicons name="close" size={16} color={TEXT_PRI} />
              </View>
            </Pressable>
          </View>

          {/* ── Details tab ── */}
          {tab === 'details' && (
            <ScrollView style={dm.tabBody} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {/* Origin */}
              <View style={dm.stepRow}>
                <View style={[dm.stepIcon, { backgroundColor: '#1E3A5F' }]}>
                  <Ionicons name={modeIcon[travelMode]} size={20} color="#4A90E2" />
                </View>
                <View style={dm.stepContent}>
                  <Text style={dm.stepDist}>From {originLabel}</Text>
                  <Text style={dm.stepInst} numberOfLines={2}>{originAddress || 'Getting location…'}</Text>
                </View>
              </View>
              <View style={dm.lineDivider} />

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
                        color={TEXT_PRI}
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
                      <Text style={dm.stepDist}>{step.dist}</Text>
                      <Text style={dm.stepInst}>{step.instruction}</Text>
                    </View>
                  </View>
                  <View style={dm.lineDivider} />
                </View>
              )) : (
                <View style={dm.stepRow}>
                  <View style={dm.stepContent}>
                    <Text style={{ color: TEXT_MUT, fontSize: 13 }}>Loading directions…</Text>
                  </View>
                </View>
              )}

              {/* Destination */}
              <View style={dm.stepRow}>
                <View style={[dm.stepIcon, { backgroundColor: '#1ABC9322' }]}>
                  <Ionicons name="location" size={20} color={GREEN} />
                </View>
                <View style={dm.stepContent}>
                  <Text style={dm.stepDist}>{destLabel}</Text>
                  <Text style={dm.stepInst}>Destination</Text>
                </View>
              </View>
            </ScrollView>
          )}

          {/* ── Route Insights tab ── */}
          {tab === 'insights' && (
            <ScrollView
              style={dm.tabBody}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={dm.insightsContent}
            >
              {/* Interactive mini-map — user can pan/zoom */}
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
                    scrollEnabled
                    zoomEnabled
                    rotateEnabled={false}
                    pitchEnabled={false}
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
                <View style={dm.insightMapPlaceholder}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>Route preview unavailable</Text>
                </View>
              )}

              {/* Stats from real API data */}
              <View style={dm.statsRow}>
                <View style={dm.statCard}>
                  <Text style={dm.statLabel}>📏  DISTANCE</Text>
                  <Text style={dm.statValue}>{distMiles.toFixed(1)}</Text>
                  <Text style={[dm.statDelta, { color: TEXT_MUT }]}>miles total</Text>
                </View>
                <View style={dm.statCard}>
                  <Text style={dm.statLabel}>🚗  AVG SPEED</Text>
                  <Text style={dm.statValue}>{avgSpeedMph > 0 ? `${avgSpeedMph}` : '–'}</Text>
                  <Text style={[dm.statDelta, { color: TEXT_MUT }]}>mph est.</Text>
                </View>
              </View>
              <View style={dm.statCardWide}>
                <Text style={dm.statLabel}>⏱  TRAVEL TIME</Text>
                <Text style={dm.statValue}>{activeData ? fmtSecs(activeData.durationSecs) : '–'}</Text>
                <Text style={[dm.statDelta, { color: GREEN }]}>
                  ✅  {activeData ? `Arrive ~${arrivalFrom(activeData.durationSecs)}` : 'No data'}
                </Text>
              </View>
            </ScrollView>
          )}

        </View>
      </View>
    </Modal>
  );
}





// ─── Draggable stop ───────────────────────────────────────────────────────────
function DraggableStopRow({ label, sub, isOrigin, onPressLabel, onSwap }: {
  label: string; sub: string; isOrigin: boolean;
  onPressLabel: () => void; onSwap: () => void;
}) {
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
          : <Ionicons name="location" size={22} color={GREEN} />}
      </View>
      <Pressable style={styles.stopLabelWrap} onPress={onPressLabel}>
        <Text style={styles.stopLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.stopSub}>{sub}</Text>
      </Pressable>
      <GestureDetector gesture={pan}>
        <View style={styles.dragHandle}>
          <Ionicons name="reorder-two-outline" size={22} color={TEXT_MUT} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DirectionsScreen() {
  const params = useLocalSearchParams<{ destLat: string; destLng: string; destName: string; originAddress?: string }>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  const snapPoints = useMemo(() => ['22%', '60%', '92%'], []);
  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const [originLabel, setOriginLabel] = useState(params.originAddress ?? 'My Location');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [originAddress, setOriginAddress] = useState(params.originAddress ?? 'My Location');
  const destCoords = params.destLat && params.destLng
    ? { lat: parseFloat(params.destLat), lng: parseFloat(params.destLng) } : null;
  const destLabel = params.destName ?? 'Destination';
  const [stopsSwapped, setStopsSwapped] = useState(false);

  const [editingOrigin, setEditingOrigin] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSearchResult[]>([]);
  const [suggBusy, setSuggBusy] = useState(false);

  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVE');
  const [routeByMode, setRouteByMode] = useState<Partial<Record<TravelMode, ModeRouteData>>>({});
  const [routeBusy, setRouteBusy] = useState(false);
  const [zoomDelta, setZoomDelta] = useState(0.05);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');

  // Real crash heatmap from Supabase
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
            // Only reverse geocode if no address was passed in
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
    const from = stopsSwapped ? destCoords : originCoords;
    const to   = stopsSwapped ? originCoords! : destCoords;
    try {
      const [driveRes, walkRes, bikeRes] = await Promise.allSettled([
        getRoute({ origin: from, destination: to, travel_mode: 'DRIVE' }),
        getRoute({ origin: from, destination: to, travel_mode: 'WALK' }),
        getRoute({ origin: from, destination: to, travel_mode: 'BICYCLE' }),
      ]);
      const nd: Partial<Record<TravelMode, ModeRouteData>> = {};
      const parse = (r: PromiseSettledResult<any>, mode: TravelMode) => {
        if (r.status === 'fulfilled') {
          nd[mode] = { coords: r.value.coordinates, distance: r.value.distance_meters, durationSecs: parseInt(r.value.duration.replace('s',''), 10) };
        }
      };
      parse(driveRes, 'DRIVE'); parse(walkRes, 'WALK'); parse(bikeRes, 'BICYCLE');
      const ds = nd.DRIVE?.durationSecs ?? 0;
      if (!nd.WALK && nd.DRIVE)    nd.WALK    = { ...nd.DRIVE, durationSecs: Math.round(ds * 3.8) };
      if (!nd.BICYCLE && nd.DRIVE) nd.BICYCLE = { ...nd.DRIVE, durationSecs: Math.round(ds * 2.1) };
      nd.BUS      = nd.DRIVE ? { ...nd.DRIVE, durationSecs: Math.round(ds * 1.4) } : undefined;
      nd.RIDESHARE = nd.DRIVE ? { ...nd.DRIVE, durationSecs: Math.round(ds * 1.1) } : undefined;
      setRouteByMode(nd);
    } catch (e) {
      Alert.alert('Route error', e instanceof Error ? e.message : 'Could not fetch route.');
    } finally { setRouteBusy(false); }
  }

  useEffect(() => {
    const data = routeByMode[travelMode];
    if (!mapRef.current) return;
    const coords = data?.coords?.length ? data.coords
      : (originCoords && destCoords ? [{ latitude: originCoords.lat, longitude: originCoords.lng }, { latitude: destCoords.lat, longitude: destCoords.lng }] : null);
    if (coords) mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 60, bottom: 300, left: 60 }, animated: true });
  }, [travelMode, routeByMode]);

  function handleSwapStops() {
    setStopsSwapped(s => !s);
    setRouteByMode({});
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

  function doZoom(factor: number) {
    const d = Math.min(Math.max(zoomDelta * factor, 0.001), 1.5);
    setZoomDelta(d);
    const c = destCoords ?? originCoords;
    if (c) mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }
  function handleLocate() {
    if (originCoords) mapRef.current?.animateToRegion({ latitude: originCoords.lat, longitude: originCoords.lng, latitudeDelta: zoomDelta, longitudeDelta: zoomDelta }, 500);
  }

  const sheetBgStyle = useAnimatedStyle(() => {
    const h = windowHeight - animatedPosition.value;
    const lo = windowHeight * 0.20, hi = windowHeight * 0.62, full = windowHeight * 0.89;
    return {
      borderTopLeftRadius:     interpolate(h, [lo, hi], [28, 24], Extrapolation.CLAMP),
      borderTopRightRadius:    interpolate(h, [lo, hi], [28, 24], Extrapolation.CLAMP),
      borderBottomLeftRadius:  interpolate(h, [lo, hi], [24,  0], Extrapolation.CLAMP),
      borderBottomRightRadius: interpolate(h, [lo, hi], [24,  0], Extrapolation.CLAMP),
      marginLeft:  interpolate(h, [hi, full], [8, 0], Extrapolation.CLAMP),
      marginRight: interpolate(h, [hi, full], [8, 0], Extrapolation.CLAMP),
    };
  });

  const zoomAnimStyle   = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value + 116 }));
  const locateAnimStyle = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value + 60  }));
  const hmAnimStyle     = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value + 10  }));

  const activeData = routeByMode[travelMode];
  const activeSecs = activeData?.durationSecs ?? 0;

  const modeItems: { mode: TravelMode; icon: any }[] = [
    { mode: 'DRIVE',    icon: 'car'           },
    { mode: 'WALK',     icon: 'walk'          },
    { mode: 'BUS',      icon: 'bus'           },
    { mode: 'BICYCLE',  icon: 'bicycle'       },
    { mode: 'RIDESHARE',icon: 'person-outline'},
  ];

  const mapRegion = destCoords
    ? { latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  const topLabel    = stopsSwapped ? destLabel   : originLabel;
  const topSub      = 'Starting point';
  const bottomLabel = stopsSwapped ? originLabel : destLabel;
  const bottomSub   = 'Destination';

  const routeCards = [
    { matchPct: 93, title: 'Fastest Route', dist: fmtDist(activeData?.distance ?? 21000), time: fmtSecs(activeSecs), traffic: 'Low Traffic', highlight: true },
    { matchPct: 87, title: 'Safest Route',  dist: fmtDist(activeData?.distance ? activeData.distance * 1.12 : 23500), time: fmtSecs(Math.round(activeSecs * 1.15)), traffic: 'Low Traffic', highlight: false },
  ];

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE} customMapStyle={DARK_MAP_STYLE}
        initialRegion={mapRegion} showsUserLocation showsMyLocationButton={false}>
        {originCoords && (
          <Marker coordinate={{ latitude: originCoords.lat, longitude: originCoords.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originDot}><View style={styles.originDotInner} /></View>
          </Marker>
        )}
        {destCoords && <Marker coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }} pinColor="#FF4444" />}
        {activeData?.coords?.length ? <Polyline key={travelMode} coordinates={activeData.coords} strokeColor="#4A90E2" strokeWidth={5} /> : null}
        {/* Real crash heatmap from Supabase */}
        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap
            points={crashPoints}
            opacity={0.72}
            radius={20}
            gradient={{
              colors: ['#00E5FF', '#FFD600', '#FF1744'],
              startPoints: [0.1, 0.5, 1.0],
              colorMapSize: 256,
            }}
          />
        )}
      </MapView>

      {/* Zoom */}
      <Animated.View style={[styles.zoomWrap, zoomAnimStyle]}>
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(0.5)}><Ionicons name="add" size={22} color={TEXT_PRI} /></Pressable>
        <View style={styles.zoomDiv} />
        <Pressable style={styles.zoomBtn} onPress={() => doZoom(2)}><Ionicons name="remove" size={22} color={TEXT_PRI} /></Pressable>
      </Animated.View>
      {/* Locate */}
      <Animated.View style={[styles.floatBtn, locateAnimStyle]}>
        <Pressable style={styles.floatBtnInner} onPress={handleLocate}><Ionicons name="locate" size={20} color={GREEN} /></Pressable>
      </Animated.View>
      {/* Heatmap pill */}
      <Animated.View style={[styles.heatmapWrap, hmAnimStyle]}>
        <Pressable
          style={[styles.heatmapInner, heatmapFilter !== 'off' && styles.heatmapInnerActive]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={GREEN} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapFilter !== 'off' ? (activeHeatmapInfo?.color ?? GREEN) : GREEN} />
          }
          <Text style={[styles.heatmapText, heatmapFilter !== 'off' && { color: activeHeatmapInfo?.color ?? GREEN }]}>
            {heatmapFilter === 'off' ? 'Safety Heatmap' : activeHeatmapInfo?.label ?? 'Heatmap'}
          </Text>
        </Pressable>
      </Animated.View>

      {/* Heatmap filter modal */}
      <Modal visible={showHeatmapModal} transparent animationType="slide" onRequestClose={() => setShowHeatmapModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowHeatmapModal(false)}>
          <Pressable style={hm.card} onPress={() => {}}>
            <View style={hm.header}>
              <Text style={hm.title}>Safety Heatmap</Text>
              {heatmapFilter !== 'off' && (
                <View style={hm.countBadge}>
                  {crashLoading
                    ? <ActivityIndicator size="small" color={GREEN} />
                    : <Text style={hm.countText}>{crashPoints.length.toLocaleString()} points</Text>
                  }
                </View>
              )}
            </View>
            <Text style={hm.subtitle}>Crash data from traffic records. Brighter = higher density.</Text>
            <View style={hm.filterList}>
              {HEATMAP_FILTERS.map((f, i) => {
                const active = heatmapFilter === f.id;
                return (
                  <View key={f.id}>
                    <Pressable
                      style={[hm.filterRow, active && hm.filterRowActive]}
                      onPress={() => { setHeatmapFilter(f.id); setShowHeatmapModal(false); }}
                    >
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : ITEM_BG }]}>
                        <Ionicons name={f.icon as any} size={20} color={active ? f.color : TEXT_MUT} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, active && { color: TEXT_PRI }]}>{f.label}</Text>
                        <Text style={hm.filterDesc}>{f.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={GREEN} />}
                    </Pressable>
                    {i < HEATMAP_FILTERS.length - 1 && <View style={hm.filterDiv} />}
                  </View>
                );
              })}
            </View>
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
        destAddress={params.destLat ? undefined : undefined}
        activeData={activeData ?? null}
        travelMode={travelMode}
        destLat={destCoords?.lat}
        destLng={destCoords?.lng}
        originLat={originCoords?.lat}
        originLng={originCoords?.lng}
      />

      {/* Bottom Sheet */}
      <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
        onChange={handleSheetChange} animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} />}
        handleIndicatorStyle={styles.handle} enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 28 }]}
          scrollEnabled={sheetIndex >= 1}>

          {sheetIndex === 0 ? (
            <View style={styles.miniRow}>
              <Ionicons name="navigate-outline" size={16} color={GREEN} />
              <Text style={styles.miniLabel}>Directions</Text>
              {activeData && <Text style={styles.miniMeta}>{fmtSecs(activeSecs)} · {fmtDist(activeData.distance)}</Text>}
              <Pressable style={styles.miniClose} onPress={() => router.back()}><Ionicons name="close" size={14} color={TEXT_PRI} /></Pressable>
            </View>
          ) : (
            <>
              {/* Title */}
              <View style={styles.titleRow}>
                <Text style={styles.titleText}>Directions</Text>
                <Pressable style={styles.closeBtn} onPress={() => router.back()}>
                  <View style={styles.closeBtnCircle}>
                    <Ionicons name="close" size={16} color={TEXT_PRI} />
                  </View>
                </Pressable>
              </View>

              {/* Mode selector */}
              <View style={styles.modeRow}>
                {modeItems.map(({ mode, icon }) => {
                  const active = travelMode === mode;
                  return (
                    <Pressable key={mode} style={[styles.modeChip, active && styles.modeChipActive]} onPress={() => setTravelMode(mode)}>
                      <Ionicons name={icon} size={22} color={active ? '#000' : TEXT_PRI} />
                    </Pressable>
                  );
                })}
              </View>

              {/* Stops card */}
              <View style={styles.routeCard}>
                <DraggableStopRow label={topLabel} sub={topSub} isOrigin onPressLabel={() => { setEditingOrigin(true); setOriginQuery(''); }} onSwap={handleSwapStops} />

                {editingOrigin && (
                  <View style={styles.inlineSearchWrap}>
                    <View style={styles.inlineInputRow}>
                      <TextInput value={originQuery} onChangeText={handleOriginQueryChange}
                        placeholder="Search starting point…" placeholderTextColor={TEXT_MUT}
                        autoFocus style={styles.inlineInputText} selectionColor={GREEN} />
                      {suggBusy ? <ActivityIndicator size="small" color={GREEN} />
                        : <Pressable onPress={() => { setEditingOrigin(false); setOriginSuggestions([]); }}><Ionicons name="close-circle" size={16} color={TEXT_MUT} /></Pressable>}
                    </View>
                    {originSuggestions.length > 0 && (
                      <View style={styles.suggList}>
                        {originSuggestions.map((s, i) => (
                          <View key={s.place_id}>
                            <Pressable style={styles.suggRow} onPress={() => handleSelectOrigin(s)}>
                              <Ionicons name="location-outline" size={14} color={GREEN} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.suggTitle} numberOfLines={1}>{s.name}</Text>
                                <Text style={styles.suggSub} numberOfLines={1}>{s.address}</Text>
                              </View>
                            </Pressable>
                            {i < originSuggestions.length - 1 && <View style={styles.suggDivider} />}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.connectorWrap}>
                  {[0,1,2,3].map(i => <View key={i} style={styles.connectorDash} />)}
                </View>

                <DraggableStopRow label={bottomLabel} sub={bottomSub} isOrigin={false} onPressLabel={() => {}} onSwap={handleSwapStops} />

                <View style={styles.divLine} />
                <View style={styles.addStopRow}>
                  <View style={styles.addStopIcon}><Ionicons name="add" size={18} color={GREEN} /></View>
                  <Text style={styles.addStopLabel}>My Location</Text>
                  <View style={styles.dragHandle}><Ionicons name="reorder-two-outline" size={22} color={TEXT_MUT} /></View>
                </View>
              </View>

              {/* Now / Avoid filters */}
              <View style={styles.filterRow}>
                <Pressable style={styles.filterChip}>
                  <Text style={styles.filterText}>Now</Text>
                  <Ionicons name="chevron-down" size={14} color={TEXT_MUT} />
                </Pressable>
                <Pressable style={styles.filterChip}>
                  <Text style={styles.filterText}>Avoid</Text>
                  <Ionicons name="chevron-down" size={14} color={TEXT_MUT} />
                </Pressable>
              </View>

              {routeBusy && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={GREEN} />
                  <Text style={styles.loadingText}>Calculating routes…</Text>
                </View>
              )}

              {/* Route option cards */}
              {!routeBusy && activeData && routeCards.map((card, i) => (
                <View key={i} style={[styles.routeOptionCard, card.highlight && styles.routeOptionCardActive]}>
                  {/* Match badge — LinearGradient when highlighted */}
                  <View style={[styles.matchBadge, card.highlight && styles.matchBadgeActive]}>
                    {card.highlight && (
                      <LinearGradient
                        colors={['#0A9E6E', '#1ABC93', '#12B882']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                    )}
                    <View style={styles.matchBadgeContent}>
                      <Text style={[styles.matchWord, { color: card.highlight ? '#fff' : TEXT_MUT }]}>MATCH</Text>
                      <Text style={[styles.matchPct, { color: card.highlight ? '#fff' : TEXT_PRI }]}>{card.matchPct}%</Text>
                    </View>
                  </View>
                  <Pressable style={styles.routeOptionInfo} onPress={() => setShowDetailsModal(true)}>
                    <Text style={styles.routeOptionTitle}>{card.title}</Text>
                    <Text style={styles.routeOptionMeta}>{card.time}  •  {card.dist}</Text>
                    <Text style={[styles.routeOptionTraffic, { color: card.traffic === 'Low Traffic' ? '#1ABC93' : '#FFA500' }]}>{card.traffic}</Text>
                  </Pressable>
                  {/* Start button — real LinearGradient */}
                  <Pressable
                    style={styles.startBtnWrap}
                    onPress={() => {
                      const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                      const from = stopsSwapped ? destCoords : originCoords;
                      const to   = stopsSwapped ? originCoords : destCoords;
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${from?.lat},${from?.lng}&destination=${to?.lat},${to?.lng}&travelmode=${modeMap[travelMode]}`);
                    }}
                  >
                    <LinearGradient
                      colors={['#0A9E6E', '#1ABC93', '#44D9B8']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Text style={styles.startBtnText}>Start</Text>
                  </Pressable>
                </View>
              ))}

              {!routeBusy && !activeData && (
                <Pressable style={styles.getDirectionsBtn} onPress={() => { if (originCoords) void fetchAllRoutes(); }}>
                  <Text style={styles.getDirectionsBtnText}>Get Directions</Text>
                </Pressable>
              )}
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Floating buttons
  zoomWrap: { position: 'absolute', right: 14, backgroundColor: ITEM_BG, borderRadius: 14, overflow: 'hidden', width: 42 },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, backgroundColor: DIVIDER, marginHorizontal: 8 },
  floatBtn: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21 },
  floatBtnInner: { flex: 1, borderRadius: 21, backgroundColor: ITEM_BG, justifyContent: 'center', alignItems: 'center' },
  heatmapWrap: { position: 'absolute', right: 14 },
  heatmapInner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ITEM_BG, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#00FF8840' },
  heatmapInnerActive: { borderColor: '#FF6B6B55', backgroundColor: '#1A1020' },
  heatmapText: { color: TEXT_PRI, fontSize: 12, fontWeight: '600' },

  // Map markers
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },

  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: DIVIDER },
  sheetContent: { paddingHorizontal: 16, paddingTop: 6 },

  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  miniLabel: { flex: 1, color: TEXT_PRI, fontSize: 15, fontWeight: '700' },
  miniMeta: { color: TEXT_MUT, fontSize: 13 },
  miniClose: { width: 26, height: 26, borderRadius: 13, backgroundColor: ITEM_BG, justifyContent: 'center', alignItems: 'center' },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  titleText: { color: TEXT_PRI, fontSize: 26, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  closeBtnCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: ITEM_BG, justifyContent: 'center', alignItems: 'center' },

  // Mode row — evenly spaced
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  modeChip: { flex: 1, height: 48, marginHorizontal: 3, borderRadius: 14, backgroundColor: CARD_BG, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  modeChipActive: { backgroundColor: GREEN, borderColor: GREEN },

  // Stops card
  routeCard: { backgroundColor: CARD_BG, borderRadius: 18, paddingVertical: 4, paddingHorizontal: 14, marginBottom: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12, minHeight: 64 },
  stopIconWrap: { width: 26, alignItems: 'center' },
  originCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4A90E2', borderWidth: 2.5, borderColor: '#fff' },
  stopLabelWrap: { flex: 1 },
  stopLabel: { color: TEXT_PRI, fontSize: 15, fontWeight: '600' },
  stopSub: { color: TEXT_MUT, fontSize: 12, marginTop: 2 },
  dragHandle: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },

  inlineSearchWrap: { marginLeft: 38, marginBottom: 8 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ITEM_BG, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
  inlineInputText: { flex: 1, color: TEXT_PRI, fontSize: 14 },

  suggList: { backgroundColor: ITEM_BG, borderRadius: 12, overflow: 'hidden', marginBottom: 4 },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  suggTitle: { color: TEXT_PRI, fontSize: 13, fontWeight: '600' },
  suggSub: { color: TEXT_MUT, fontSize: 11, marginTop: 1 },
  suggDivider: { height: 1, backgroundColor: DIVIDER, marginLeft: 34 },

  connectorWrap: { flexDirection: 'column', gap: 4, paddingLeft: 25, marginVertical: -6 },
  connectorDash: { width: 2, height: 5, backgroundColor: TEXT_MUT, borderRadius: 1, opacity: 0.4 },
  divLine: { height: 1, backgroundColor: DIVIDER, marginVertical: 4 },

  addStopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  addStopIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1ABC9322', justifyContent: 'center', alignItems: 'center' },
  addStopLabel: { flex: 1, color: '#4A90E2', fontSize: 14, fontWeight: '500' },

  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD_BG, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderColor: DIVIDER },
  filterText: { color: TEXT_PRI, fontSize: 14, fontWeight: '500' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  loadingText: { color: TEXT_MUT, fontSize: 14 },

  // Route option cards — match image: badge | info (pressable) | start button
  routeOptionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD_BG, borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: 'transparent', gap: 12 },
  routeOptionCardActive: { borderColor: GREEN },
  matchBadge: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', minWidth: 68, overflow: 'hidden', position: 'relative', backgroundColor: ITEM_BG },
  matchBadgeActive: { backgroundColor: 'transparent' },
  matchBadgeContent: { alignItems: 'center' },
  matchWord: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  matchPct: { fontSize: 22, fontWeight: '800' },
  routeOptionInfo: { flex: 1 },
  routeOptionTitle: { color: TEXT_PRI, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  routeOptionMeta: { color: TEXT_MUT, fontSize: 13, marginBottom: 2 },
  routeOptionTraffic: { fontSize: 12, fontWeight: '600' },
  // Gradient Start button
  startBtnWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    height: 40,
    minWidth: 68,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBtnContent: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  startBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', zIndex: 1 },
  getDirectionsBtn: { backgroundColor: GREEN, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  getDirectionsBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

// ─── Route Details Modal Styles ───────────────────────────────────────────────
const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  // height is passed inline as a dynamic value based on screen height
  card: { backgroundColor: BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 24 },
  tabRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 20 },
  tab: { paddingBottom: 8, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: TEXT_PRI },
  tabText: { color: TEXT_MUT, fontSize: 18, fontWeight: '600' },
  tabTextActive: { color: TEXT_PRI, fontWeight: '800' },
  // tabBody fills remaining card height after the tabRow (tabRow ~54px + card padding 20+24 = ~98px)
  tabBody: { flex: 1 },
  closeBtnCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: ITEM_BG, justifyContent: 'center', alignItems: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  stepIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  stepIconSimple: { width: 44, alignItems: 'center' },
  stepContent: { flex: 1 },
  stepDist: { color: TEXT_PRI, fontSize: 15, fontWeight: '700' },
  stepInst: { color: TEXT_MUT, fontSize: 13, marginTop: 2 },
  lineDivider: { height: 1, backgroundColor: DIVIDER, marginLeft: 60 },
  insightsContent: { gap: 14, paddingBottom: 20 },
  insightMapWrap: { borderRadius: 16, overflow: 'hidden', height: 220, position: 'relative' },
  insightMap: { width: '100%', height: '100%' },
  insightMapPlaceholder: { height: 220, backgroundColor: CARD_BG, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  routeTimeBubble: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  routeTimeBubbleText: { color: TEXT_PRI, fontSize: 13, fontWeight: '700' },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },
  statsRow: { flexDirection: 'row', gap: 14 },
  statCard: { flex: 1, backgroundColor: CARD_BG, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: DIVIDER },
  statCardWide: { backgroundColor: CARD_BG, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: DIVIDER },
  statLabel: { color: TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  statValue: { color: TEXT_PRI, fontSize: 28, fontWeight: '800', marginBottom: 4 },
  statDelta: { fontSize: 13, fontWeight: '600' },
});

// ─── Heatmap Modal Styles ─────────────────────────────────────────────────────
const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: CARD_BG, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: TEXT_PRI, fontSize: 22, fontWeight: '700' },
  subtitle: { color: TEXT_MUT, fontSize: 13, marginBottom: 20, lineHeight: 18 },
  countBadge: { backgroundColor: ITEM_BG, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { color: GREEN, fontSize: 12, fontWeight: '600' },
  filterList: { backgroundColor: ITEM_BG, borderRadius: 18, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  filterRowActive: { backgroundColor: 'rgba(26,188,147,0.08)' },
  filterIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  filterLabel: { color: TEXT_MUT, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  filterDesc: { color: TEXT_MUT, fontSize: 12, opacity: 0.7 },
  filterDiv: { height: 1, backgroundColor: DIVIDER, marginLeft: 70 },
});