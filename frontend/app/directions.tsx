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
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { getRoute, searchPlaces } from '@/lib/api';
import type { PlaceSearchResult, RoutePoint } from '@/lib/api';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import { palette, Gradients, Colors, MapStyles } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';


if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type TravelMode = 'WALK' | 'DRIVE' | 'BICYCLE' | 'BUS' | 'RIDESHARE';
interface RouteData { coords: RoutePoint[]; distance: number; durationSecs: number; safetyScore?: number; safetyLabel?: string; }
interface ModeRouteData { routes: RouteData[]; }

// Heatmap filters — mirrors index.tsx
const HEATMAP_FILTERS: { id: HeatmapFilter | 'off'; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'off',   label: 'Off',             icon: 'eye-off-outline',   color: '#7A8FA6', desc: 'Hide heatmap' },
  { id: 'all',   label: 'All Crashes',     icon: 'warning-outline',   color: '#FF6B6B', desc: 'Every crash in the area' },
  { id: 'fatal', label: 'Fatal / Serious', icon: 'skull-outline',     color: '#FF3333', desc: 'Fatal or serious injury crashes' },
  { id: 'ped',   label: 'Pedestrian',      icon: 'walk-outline',      color: '#FFA500', desc: 'Crashes involving pedestrians' },
  { id: 'bike',  label: 'Bicycle',         icon: 'bicycle-outline',   color: '#1ABC93', desc: 'Crashes involving cyclists' },
  { id: 'hit',   label: 'Hit & Run',       icon: 'car-sport-outline', color: '#C084FC', desc: 'Hit and run incidents' },
];

function SheetBg({ style, bgColor }: { style?: any; bgColor: string }) {
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: bgColor }, style]} />;
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
  activeData: RouteData | null;
  travelMode: TravelMode;
  destLat?: number;
  destLng?: number;
  originLat?: number;
  originLng?: number;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
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
        <View style={[dm.card, { height: CARD_HEIGHT, backgroundColor: c.background }]}>

          {/* ── Tab row + close ── */}
          <View style={dm.tabRow}>
            <Pressable onPress={() => setTab('details')} style={[dm.tab, tab === 'details' && [dm.tabActive, { borderBottomColor: c.text }]]}>
              <Text style={[dm.tabText, { color: c.textSecondary }, tab === 'details' && [dm.tabTextActive, { color: c.text }]]}>Details</Text>
            </Pressable>
            <Pressable onPress={() => setTab('insights')} style={[dm.tab, tab === 'insights' && [dm.tabActive, { borderBottomColor: c.text }]]}>
              <Text style={[dm.tabText, { color: c.textSecondary }, tab === 'insights' && [dm.tabTextActive, { color: c.text }]]}>Route Insights</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose}>
              <View style={[dm.closeBtnCircle, { backgroundColor: c.inputBg }]}>
                <Ionicons name="close" size={16} color={c.text} />
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
                  <Text style={[dm.stepDist, { color: c.text }]}>From {originLabel}</Text>
                  <Text style={[dm.stepInst, { color: c.textSecondary }]} numberOfLines={2}>{originAddress || 'Getting location…'}</Text>
                </View>
              </View>
              <View style={[dm.lineDivider, { backgroundColor: c.divider }]} />

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
                        color={c.text}
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
                      <Text style={[dm.stepDist, { color: c.text }]}>{step.dist}</Text>
                      <Text style={[dm.stepInst, { color: c.textSecondary }]}>{step.instruction}</Text>
                    </View>
                  </View>
                  <View style={[dm.lineDivider, { backgroundColor: c.divider }]} />
                </View>
              )) : (
                <View style={dm.stepRow}>
                  <View style={dm.stepContent}>
                    <Text style={{ color: c.textSecondary, fontSize: 13 }}>Loading directions…</Text>
                  </View>
                </View>
              )}

              {/* Destination */}
              <View style={dm.stepRow}>
                <View style={[dm.stepIcon, { backgroundColor: '#1ABC9322' }]}>
                  <Ionicons name="location" size={20} color={palette.brightPurple} />
                </View>
                <View style={dm.stepContent}>
                  <Text style={[dm.stepDist, { color: c.text }]}>{destLabel}</Text>
                  <Text style={[dm.stepInst, { color: c.textSecondary }]}>Destination</Text>
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
                    customMapStyle={colorScheme === 'dark' ? MapStyles.dark : MapStyles.light}
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
                      <Text style={[dm.routeTimeBubbleText, { color: c.text }]}>{fmtSecs(activeData.durationSecs)}</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={[dm.insightMapPlaceholder, { backgroundColor: c.cardSolid }]}>
                  <Text style={{ color: c.textSecondary, fontSize: 12 }}>Route preview unavailable</Text>
                </View>
              )}

              {/* Stats from real API data */}
              <View style={dm.statsRow}>
                <View style={[dm.statCard, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
                  <Text style={[dm.statLabel, { color: c.textSecondary }]}>📏  DISTANCE</Text>
                  <Text style={[dm.statValue, { color: c.text }]}>{distMiles.toFixed(1)}</Text>
                  <Text style={[dm.statDelta, { color: c.textSecondary }]}>miles total</Text>
                </View>
                <View style={[dm.statCard, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
                  <Text style={[dm.statLabel, { color: c.textSecondary }]}>🚗  AVG SPEED</Text>
                  <Text style={[dm.statValue, { color: c.text }]}>{avgSpeedMph > 0 ? `${avgSpeedMph}` : '–'}</Text>
                  <Text style={[dm.statDelta, { color: c.textSecondary }]}>mph est.</Text>
                </View>
              </View>
              <View style={[dm.statCardWide, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
                <Text style={[dm.statLabel, { color: c.textSecondary }]}>⏱  TRAVEL TIME</Text>
                <Text style={[dm.statValue, { color: c.text }]}>{activeData ? fmtSecs(activeData.durationSecs) : '–'}</Text>
                <Text style={[dm.statDelta, { color: palette.brightPurple }]}>
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





// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DirectionsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  const params = useLocalSearchParams<{ destLat: string; destLng: string; destName: string; originAddress?: string; originLat?: string; originLng?: string }>();
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
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(
    params.destLat && params.destLng ? { lat: parseFloat(params.destLat), lng: parseFloat(params.destLng) } : null
  );
  const [destLabel, setDestLabel] = useState(params.destName ?? 'Destination');

  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editingDest, setEditingDest] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSearchResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceSearchResult[]>([]);
  const [suggBusy, setSuggBusy] = useState(false);

  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVE');
  const [routeByMode, setRouteByMode] = useState<Partial<Record<TravelMode, ModeRouteData>>>({});
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeBusy, setRouteBusy] = useState(false);
  const [zoomDelta, setZoomDelta] = useState(0.05);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');

  // Real crash heatmap from Supabase
  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 200_000,
  });
  const activeHeatmapInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);

  useEffect(() => {
    // If origin params provided from destination screen, use them directly
    if (params.originLat && params.originLng) {
      setOriginCoords({ lat: parseFloat(params.originLat), lng: parseFloat(params.originLng) });
      if (params.originAddress) {
        setOriginLabel(params.originAddress);
        setOriginAddress(params.originAddress);
      }
      return;
    }
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
    if (params.destLat && params.destLng) {
      setDestCoords({ lat: parseFloat(params.destLat), lng: parseFloat(params.destLng) });
      setDestLabel(params.destName ?? 'Destination');
    }
  }, [params.destLat, params.destLng, params.destName]);

  useEffect(() => {
    if (originCoords && destCoords) void fetchAllRoutes();
  }, [originCoords, destCoords]);

  async function fetchAllRoutes() {
    if (!originCoords || !destCoords) return;
    setRouteBusy(true);
    setSelectedRouteIndex(0);
    const from = originCoords;
    const to = destCoords;
    try {
      const [driveRes, walkRes, bikeRes] = await Promise.allSettled([
        getRoute({ origin: from, destination: to, travel_mode: 'DRIVE' }),
        getRoute({ origin: from, destination: to, travel_mode: 'WALK' }),
        getRoute({ origin: from, destination: to, travel_mode: 'BICYCLE' }),
      ]);
      const nd: Partial<Record<TravelMode, ModeRouteData>> = {};
      const toRouteData = (r: any): RouteData => ({
        coords: r.coordinates ?? [],
        distance: r.distance_meters ?? 0,
        durationSecs: parseInt(String(r.duration || '0').replace('s',''), 10),
        safetyScore: r.safety_score ?? undefined,
        safetyLabel: r.safety_label ?? undefined,
      });
      const parse = (res: PromiseSettledResult<any>, mode: TravelMode) => {
        if (res.status === 'fulfilled' && res.value?.routes?.length) {
          nd[mode] = { routes: res.value.routes.map(toRouteData) };
        }
      };
      parse(driveRes, 'DRIVE'); parse(walkRes, 'WALK'); parse(bikeRes, 'BICYCLE');
      const driveRoutes = nd.DRIVE?.routes ?? [];
      const ds = driveRoutes[0]?.durationSecs ?? 0;
      if (!nd.WALK && driveRoutes.length) {
        nd.WALK = { routes: [{ ...driveRoutes[0], durationSecs: Math.round(ds * 3.8) }] };
      }
      if (!nd.BICYCLE && driveRoutes.length) {
        nd.BICYCLE = { routes: [{ ...driveRoutes[0], durationSecs: Math.round(ds * 2.1) }] };
      }
      if (driveRoutes.length && !nd.BUS) {
        nd.BUS = { routes: [{ ...driveRoutes[0], durationSecs: Math.round(ds * 1.4) }] };
      }
      if (driveRoutes.length && !nd.RIDESHARE) {
        nd.RIDESHARE = { routes: [{ ...driveRoutes[0], durationSecs: Math.round(ds * 1.1) }] };
      }
      setRouteByMode(nd);
    } catch (e) {
      Alert.alert('Route error', e instanceof Error ? e.message : 'Could not fetch route.');
    } finally { setRouteBusy(false); }
  }

  useEffect(() => {
    const modeData = routeByMode[travelMode];
    const routesForMode = modeData?.routes ?? [];
    const safeIdx = Math.min(selectedRouteIndex, Math.max(0, routesForMode.length - 1));
    const active = routesForMode[safeIdx] ?? null;
    if (!mapRef.current) return;
    const coords = active?.coords?.length ? active.coords
      : (originCoords && destCoords ? [{ latitude: originCoords.lat, longitude: originCoords.lng }, { latitude: destCoords.lat, longitude: destCoords.lng }] : null);
    if (coords) mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 60, bottom: 300, left: 60 }, animated: true });
  }, [travelMode, routeByMode, selectedRouteIndex]);

  function handleSwapOriginDest() {
    if (!originCoords || !destCoords) return;
    const o = { label: originLabel, address: originAddress, coords: originCoords };
    const d = { label: destLabel, coords: destCoords };
    setOriginLabel(d.label);
    setOriginAddress(d.label);
    setOriginCoords(d.coords);
    setDestLabel(o.label);
    setDestCoords(o.coords);
    setRouteByMode({});
    setTimeout(() => { void fetchAllRoutes(); }, 50);
  }

  function resetOriginToMyLocation() {
    setEditingOrigin(false);
    setOriginQuery('');
    setOriginSuggestions([]);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          setOriginCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          try {
            const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            if (geo) {
              const parts = [geo.streetNumber, geo.street, geo.city].filter(Boolean);
              const addr = parts.join(' ') || 'My Location';
              setOriginLabel(addr);
              setOriginAddress(addr);
            } else {
              setOriginLabel('My Location');
              setOriginAddress('My Location');
            }
          } catch {
            setOriginLabel('My Location');
            setOriginAddress('My Location');
          }
        }
      } catch {}
    })();
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
    setOriginAddress(place.address ?? place.name);
    setEditingOrigin(false);
    setOriginQuery('');
    setOriginSuggestions([]);
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
    setEditingDest(false);
    setDestQuery('');
    setDestSuggestions([]);
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

  // Fixed top position so controls stay in map area and never cover sheet content
  const mapControlsTop = insets.top + 130;

  const modeData = routeByMode[travelMode];
  const routesForMode = modeData?.routes ?? [];
  const safeIdx = Math.min(selectedRouteIndex, Math.max(0, routesForMode.length - 1));
  const activeData = routesForMode[safeIdx] ?? null;
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


  const routeCards = routesForMode.map((r, i) => {
    const isFastest = i === 0;
    const safestIdx = routesForMode.reduce((best, rr, idx) =>
      ((rr.safetyScore ?? 999) < (routesForMode[best]?.safetyScore ?? 999)) ? idx : best, 0);
    const isSafest = i === safestIdx && routesForMode.length > 1;
    const title = isFastest && isSafest ? 'Fastest & Safest' : isFastest ? 'Fastest Route' : isSafest ? 'Safest Route' : `Route ${i + 1}`;
    return {
      ...r,
      index: i,
      title,
      dist: fmtDist(r.distance),
      time: fmtSecs(r.durationSecs),
      riskPct: r.safetyScore != null ? Math.round(r.safetyScore) : null,
      safetyLabel: r.safetyLabel,
      isSelected: i === safeIdx,
    };
  });

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE} customMapStyle={colorScheme === 'dark' ? MapStyles.dark : MapStyles.light}
        initialRegion={mapRegion} showsUserLocation showsMyLocationButton={false}>
        {originCoords && (
          <Marker coordinate={{ latitude: originCoords.lat, longitude: originCoords.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originDot}><View style={styles.originDotInner} /></View>
          </Marker>
        )}
        {destCoords && <Marker coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }} pinColor="#FF4444" />}
        {activeData?.coords?.length ? <Polyline key={travelMode} coordinates={activeData.coords} strokeColor="#4A90E2" strokeWidth={5} /> : null}
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

      {/* Origin / Destination — top of screen, search-bar style */}
      <View style={[styles.topRouteCard, { top: insets.top + 10, backgroundColor: c.mapOverlay, borderColor: c.divider }]}>
        <View style={styles.topRouteRows}>
          <View style={styles.routeInputRow}>
            <View style={styles.routeInputIcon}><View style={styles.originDotSmall} /></View>
            {editingOrigin ? (
              <View style={styles.inlineSearchWrap}>
                <View style={[styles.inlineInputRow, { backgroundColor: c.cardSolid }]}>
                  <TextInput
                    value={originQuery}
                    onChangeText={handleOriginQueryChange}
                    placeholder="Search starting point…"
                    placeholderTextColor={c.textSecondary}
                    autoFocus
                    style={[styles.inlineInputText, { color: c.text }]}
                    selectionColor={palette.brightPurple}
                  />
                  {suggBusy ? <ActivityIndicator size="small" color={palette.brightPurple} /> : null}
                  <Pressable onPress={resetOriginToMyLocation}><Ionicons name="close-circle" size={18} color={c.textSecondary} /></Pressable>
                </View>
                {originSuggestions.length > 0 && (
                  <View style={[styles.suggList, { backgroundColor: c.mapOverlay }]}>
                    {originSuggestions.map((s) => (
                      <Pressable key={s.place_id} style={styles.suggRow} onPress={() => handleSelectOrigin(s)}>
                        <Ionicons name="location-outline" size={14} color={palette.brightPurple} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.suggTitle, { color: c.text }]} numberOfLines={1}>{s.name}</Text>
                          <Text style={[styles.suggSub, { color: c.textSecondary }]} numberOfLines={1}>{s.address}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Pressable style={styles.routeInputLabelWrap} onPress={() => { setEditingDest(false); setEditingOrigin(true); setOriginQuery(''); }}>
                <Text style={[styles.routeInputLabel, { color: c.text }]} numberOfLines={1}>{originLabel}</Text>
                <Pressable onPress={(e) => { e.stopPropagation(); resetOriginToMyLocation(); }} hitSlop={8}><Ionicons name="close-circle-outline" size={18} color={c.textSecondary} /></Pressable>
              </Pressable>
            )}
          </View>

          <View style={styles.routeInputRow}>
            <View style={styles.routeInputIcon}><Ionicons name="location" size={18} color={palette.brightPurple} /></View>
            {editingDest ? (
              <View style={styles.inlineSearchWrap}>
                <View style={[styles.inlineInputRow, { backgroundColor: c.inputBg }]}>
                  <TextInput
                    value={destQuery}
                    onChangeText={handleDestQueryChange}
                    placeholder="Search destination…"
                    placeholderTextColor={c.textSecondary}
                    autoFocus
                    style={[styles.inlineInputText, { color: c.text }]}
                    selectionColor={palette.brightPurple}
                  />
                  {suggBusy ? <ActivityIndicator size="small" color={palette.brightPurple} /> : null}
                  <Pressable onPress={() => { setEditingDest(false); setDestSuggestions([]); }}><Ionicons name="close-circle" size={18} color={c.textSecondary} /></Pressable>
                </View>
                {destSuggestions.length > 0 && (
                  <View style={[styles.suggList, { backgroundColor: c.mapOverlay }]}>
                    {destSuggestions.map((s) => (
                      <Pressable key={s.place_id} style={styles.suggRow} onPress={() => handleSelectDest(s)}>
                        <Ionicons name="location-outline" size={14} color={palette.brightPurple} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.suggTitle, { color: c.text }]} numberOfLines={1}>{s.name}</Text>
                          <Text style={[styles.suggSub, { color: c.textSecondary }]} numberOfLines={1}>{s.address}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Pressable style={styles.routeInputLabelWrap} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
                <Text style={[styles.routeInputLabel, { color: c.text }]} numberOfLines={1}>{destLabel}</Text>
                <Pressable onPress={(e) => { e.stopPropagation(); setEditingDest(true); setDestQuery(''); }} hitSlop={8}><Ionicons name="create-outline" size={18} color={c.textSecondary} /></Pressable>
              </Pressable>
            )}
          </View>
        </View>
        <Pressable style={styles.swapBtnRight} onPress={handleSwapOriginDest}>
          <Ionicons name="swap-vertical" size={20} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* Back */}
      <Pressable style={[styles.backBtn, { top: insets.top + 10, backgroundColor: c.mapOverlay }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={c.text} />
      </Pressable>

      {/* Map controls */}
      <View style={[styles.mapControlsColumn, { top: mapControlsTop }]}>
        <View style={[styles.zoomWrap, { backgroundColor: c.mapOverlay }]}>
          <Pressable style={styles.zoomBtn} onPress={() => doZoom(0.5)}><Ionicons name="add" size={22} color={c.text} /></Pressable>
          <View style={[styles.zoomDiv, { backgroundColor: c.divider }]} />
          <Pressable style={styles.zoomBtn} onPress={() => doZoom(2)}><Ionicons name="remove" size={22} color={c.text} /></Pressable>
        </View>
        <Pressable style={[styles.floatBtnInner, { backgroundColor: c.mapOverlay }]} onPress={handleLocate}>
          <Ionicons name="locate" size={20} color={palette.brightPurple} />
        </Pressable>
        <Pressable
          style={[styles.floatBtnInner, { backgroundColor: c.mapOverlay }, heatmapFilter !== 'off' && { borderWidth: 1.5, borderColor: palette.brightPurple + '60' }]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={palette.brightPurple} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={16} color={heatmapFilter !== 'off' ? (activeHeatmapInfo?.color ?? palette.brightPurple) : palette.brightPurple} />
          }
        </Pressable>
      </View>

      {/* Heatmap filter modal */}
      <Modal visible={showHeatmapModal} transparent animationType="slide" onRequestClose={() => setShowHeatmapModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowHeatmapModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: c.background }]} onPress={() => {}}>
            <View style={hm.header}>
              <Text style={[hm.title, { color: c.text }]}>Safety Heatmap</Text>
              {heatmapFilter !== 'off' && (
                <View style={[hm.countBadge, { backgroundColor: c.cardSolid }]}>
                  {crashLoading
                    ? <ActivityIndicator size="small" color={palette.brightPurple} />
                    : <Text style={[hm.countText, { color: palette.brightPurple }]}>{crashPoints.length.toLocaleString()} points</Text>
                  }
                </View>
              )}
            </View>
            <Text style={[hm.subtitle, { color: c.textSecondary }]}>Crash data from traffic records. Brighter = higher density.</Text>
            <View style={[hm.filterList, { backgroundColor: c.cardSolid }]}>
              {HEATMAP_FILTERS.map((f, i) => {
                const active = heatmapFilter === f.id;
                return (
                  <View key={f.id}>
                    <Pressable
                      style={[hm.filterRow, active && { backgroundColor: palette.brightPurple + '14' }]}
                      onPress={() => { setHeatmapFilter(f.id); setShowHeatmapModal(false); }}
                    >
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : c.cardSolid }]}>
                        <Ionicons name={f.icon as any} size={20} color={active ? f.color : c.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[hm.filterLabel, { color: c.textSecondary }, active && { color: c.text }]}>{f.label}</Text>
                        <Text style={[hm.filterDesc, { color: c.textSecondary }]}>{f.desc}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={palette.brightPurple} />}
                    </Pressable>
                    {i < HEATMAP_FILTERS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: c.divider }]} />}
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
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bgColor={c.background} />}
        handleIndicatorStyle={[styles.handle, { backgroundColor: palette.brightPurple + '40' }]} enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, 12) + 100 }]}
          scrollEnabled={sheetIndex >= 1}>

          {sheetIndex === 0 ? (
            <View style={styles.miniRow}>
              <Ionicons name="navigate-outline" size={16} color={palette.brightPurple} />
              <View style={styles.miniLabelWrap}>
                <Text style={[styles.miniLabel, { color: c.text }]}>Directions</Text>
                {originLabel && destLabel && (
                  <Text style={[styles.miniSub, { color: c.textSecondary }]} numberOfLines={1}>{originLabel} → {destLabel}</Text>
                )}
              </View>
              {activeData && <Text style={[styles.miniMeta, { color: c.textSecondary }]}>{fmtSecs(activeSecs)} · {fmtDist(activeData.distance)}</Text>}
              <Pressable style={[styles.miniClose, { backgroundColor: c.cardSolid }]} onPress={() => router.back()}><Ionicons name="close" size={14} color={c.text} /></Pressable>
            </View>
          ) : (
            <>
              <View style={styles.titleRow}>
                <Text style={[styles.titleText, { color: c.text }]}>Directions</Text>
                <Pressable style={styles.closeBtn} onPress={() => router.back()}>
                  <View style={[styles.closeBtnCircle, { backgroundColor: c.cardSolid }]}>
                    <Ionicons name="close" size={16} color={c.text} />
                  </View>
                </Pressable>
              </View>

              <View style={styles.modeRow}>
                {modeItems.map(({ mode, icon }) => {
                  const active = travelMode === mode;
                  return (
                    <Pressable key={mode} style={[styles.modeChip, { backgroundColor: c.cardSolid, borderColor: 'transparent' }, active && { backgroundColor: palette.brightPurple, borderColor: palette.brightPurple }]} onPress={() => setTravelMode(mode)}>
                      <Ionicons name={icon} size={22} color={active ? '#FFFFFF' : c.text} />
                    </Pressable>
                  );
                })}
              </View>

              {/* Now / Avoid filters */}
              <View style={styles.filterRow}>
                <Pressable style={[styles.filterChip, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
                  <Text style={[styles.filterText, { color: c.text }]}>Now</Text>
                  <Ionicons name="chevron-down" size={14} color={c.textSecondary} />
                </Pressable>
                <Pressable style={[styles.filterChip, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
                  <Text style={[styles.filterText, { color: c.text }]}>Avoid</Text>
                  <Ionicons name="chevron-down" size={14} color={c.textSecondary} />
                </Pressable>
              </View>

              {routeBusy && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={palette.brightPurple} />
                  <Text style={[styles.loadingText, { color: c.textSecondary }]}>Calculating routes…</Text>
                </View>
              )}

              {!routeBusy && activeData && routeCards.map((card, i) => (
                <Pressable
                  key={i}
                  style={[styles.routeOptionCard, { backgroundColor: c.cardSolid, borderColor: 'transparent' }, card.isSelected && { borderColor: palette.brightPurple, borderWidth: 2 }]}
                  onPress={() => setSelectedRouteIndex(card.index)}
                >
                  <View style={[styles.riskBadge, { backgroundColor: c.cardSolid }, card.isSelected && { backgroundColor: 'transparent' }]}>
                    {card.isSelected && (
                      <LinearGradient
                        colors={[...Gradients.button]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                    )}
                    <View style={styles.matchBadgeContent}>
                      <Text style={[styles.riskWord, { color: card.isSelected ? '#fff' : c.textSecondary }]}>RISK</Text>
                      <Text style={[styles.matchPct, { color: card.isSelected ? '#fff' : c.text }]}>
                        {card.riskPct != null ? `${card.riskPct}%` : '–'}
                      </Text>
                    </View>
                  </View>
                  <Pressable style={styles.routeOptionInfo} onPress={() => setShowDetailsModal(true)}>
                    <View style={styles.routeOptionTitleRow}>
                      <Text style={[styles.routeOptionTitle, { color: c.text }]}>{card.title}</Text>
                      {card.isSelected && (
                        <View style={[styles.selectedChip, { backgroundColor: palette.brightPurple + '33' }]}>
                          <Ionicons name="checkmark-circle" size={14} color={palette.brightPurple} />
                          <Text style={[styles.selectedChipText, { color: palette.brightPurple }]}>Selected</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.routeOptionMeta, { color: c.textSecondary }]}>{card.time}  •  {card.dist}</Text>
                    {card.safetyLabel && card.safetyLabel !== 'unknown' && (
                      <Text style={[styles.routeOptionTraffic, {
                        color: card.safetyLabel === 'low' ? palette.teal : card.safetyLabel === 'medium' ? palette.warning : palette.danger,
                      }]}>
                        {card.safetyLabel === 'low' ? 'Low risk' : card.safetyLabel === 'medium' ? 'Moderate risk' : 'High risk'}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.startBtnWrap}
                    onPress={() => {
                      const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling', BUS: 'transit', RIDESHARE: 'driving' };
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${originCoords?.lat},${originCoords?.lng}&destination=${destCoords?.lat},${destCoords?.lng}&travelmode=${modeMap[travelMode]}`);
                    }}
                  >
                    <LinearGradient
                      colors={[...Gradients.button]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Text style={styles.startBtnText}>Start</Text>
                  </Pressable>
                </Pressable>
              ))}

              {!routeBusy && !activeData && (
                <Pressable style={[styles.getDirectionsBtn, { overflow: 'hidden' }]} onPress={() => { if (originCoords) void fetchAllRoutes(); }}>
                  <LinearGradient colors={[...Gradients.button]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
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
  container: { flex: 1 },

  mapControlsColumn: { position: 'absolute', right: 14, flexDirection: 'column', gap: 8 },
  zoomWrap: { borderRadius: 14, overflow: 'hidden', width: 42 },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  floatBtnInner: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },

  // Map markers
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },

  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 6 },

  // Top route card (origin/destination bar)
  topRouteCard: {
    position: 'absolute',
    left: 56,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
    zIndex: 10,
  },
  topRouteRows: { flex: 1 },
  routeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  routeInputIcon: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  originDotSmall: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: 'rgba(74,144,226,0.4)' },
  routeInputLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  routeInputLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  swapBtnRight: { padding: 8, justifyContent: 'center' },
  backBtn: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', zIndex: 11 },

  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  miniLabelWrap: { flex: 1, minWidth: 0 },
  miniLabel: { fontSize: 15, fontWeight: '700' },
  miniSub: { fontSize: 12, marginTop: 2 },
  miniMeta: { fontSize: 13 },
  miniClose: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  titleText: { fontSize: 26, fontWeight: '800' },
  closeBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  closeBtnCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },

  // Mode row — evenly spaced
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  modeChip: { flex: 1, height: 48, marginHorizontal: 3, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  modeChipActive: { backgroundColor: palette.brightPurple, borderColor: palette.brightPurple },

  // Stops card
  routeCard: { borderRadius: 18, paddingVertical: 4, paddingHorizontal: 14, marginBottom: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12, minHeight: 64 },
  stopIconWrap: { width: 26, alignItems: 'center' },
  originCircle: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#4A90E2', borderWidth: 2.5, borderColor: '#fff' },
  stopLabelWrap: { flex: 1 },
  stopLabel: { fontSize: 15, fontWeight: '600' },
  stopSub: { fontSize: 12, marginTop: 2 },
  dragHandle: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },

  inlineSearchWrap: { flex: 1, marginBottom: 4 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
  inlineInputText: { flex: 1, fontSize: 14 },

  suggList: { borderRadius: 12, overflow: 'hidden', marginBottom: 4 },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  suggTitle: { fontSize: 13, fontWeight: '600' },
  suggSub: { fontSize: 11, marginTop: 1 },
  suggDivider: { height: 1, marginLeft: 34 },

  connectorWrap: { flexDirection: 'column', gap: 4, paddingLeft: 25, marginVertical: -6 },
  connectorDash: { width: 2, height: 5, borderRadius: 1, opacity: 0.4 },
  divLine: { height: 1, marginVertical: 4 },

  addStopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  addStopIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1ABC9322', justifyContent: 'center', alignItems: 'center' },
  addStopLabel: { flex: 1, color: '#4A90E2', fontSize: 14, fontWeight: '500' },

  filterRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  filterText: { fontSize: 14, fontWeight: '500' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  loadingText: { fontSize: 14 },

  // Route option cards — risk badge | info (pressable) | start button
  routeOptionCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: 'transparent', gap: 12 },
  routeOptionCardActive: { borderColor: palette.brightPurple, borderWidth: 2 },
  riskBadge: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', minWidth: 68, overflow: 'hidden', position: 'relative' },
  riskBadgeActive: { backgroundColor: 'transparent' },
  matchBadgeContent: { alignItems: 'center' },
  riskWord: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  matchPct: { fontSize: 22, fontWeight: '800' },
  routeOptionInfo: { flex: 1 },
  routeOptionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  routeOptionTitle: { fontSize: 15, fontWeight: '700' },
  selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(26,188,147,0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  selectedChipText: { color: palette.brightPurple, fontSize: 11, fontWeight: '700' },
  routeOptionMeta: { fontSize: 13, marginBottom: 2 },
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
  getDirectionsBtn: { backgroundColor: palette.brightPurple, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  getDirectionsBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

// ─── Route Details Modal Styles ───────────────────────────────────────────────
const dm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  // height is passed inline as a dynamic value based on screen height
  card: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 24 },
  tabRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 20 },
  tab: { paddingBottom: 8, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabActive: {},
  tabText: { fontSize: 18, fontWeight: '600' },
  tabTextActive: { fontWeight: '800' },
  // tabBody fills remaining card height after the tabRow (tabRow ~54px + card padding 20+24 = ~98px)
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
  routeTimeBubbleText: { fontSize: 13, fontWeight: '700' },
  originDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,144,226,0.3)', justifyContent: 'center', alignItems: 'center' },
  originDotInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4A90E2', borderWidth: 2, borderColor: '#fff' },
  statsRow: { flexDirection: 'row', gap: 14 },
  statCard: { flex: 1, borderRadius: 16, padding: 16, borderWidth: 1 },
  statCardWide: { borderRadius: 16, padding: 16, borderWidth: 1 },
  statLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  statValue: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  statDelta: { fontSize: 13, fontWeight: '600' },

  safetyBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 14 },
  safetyLabelText: { fontSize: 15, fontWeight: '700' },
  safetyScoreText: { fontSize: 12, marginTop: 2 },
});

// ─── Heatmap Modal Styles ─────────────────────────────────────────────────────
const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  countBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { color: palette.brightPurple, fontSize: 12, fontWeight: '600' },
  filterList: { borderRadius: 18, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  filterRowActive: { backgroundColor: 'rgba(26,188,147,0.08)' },
  filterIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  filterLabel: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  filterDesc: { fontSize: 12, opacity: 0.7 },
  filterDiv: { height: 1, marginLeft: 70 },
});