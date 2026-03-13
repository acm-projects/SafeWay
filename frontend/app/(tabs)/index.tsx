import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Heatmap, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useAnimatedStyle, useSharedValue, interpolate, Extrapolation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { listBookmarks, deleteBookmark, getWeather, createBookmark, searchPlaces } from '@/lib/api';
import type { Bookmark, WeatherData } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { palette, Colors, Glass, MapStyles } from '@/constants/theme';
import { GlassCard } from '@/components/glass-card';

// ─── Heatmap filter options ─────────────────────────────────────────────────
const HEATMAP_FILTERS: { id: HeatmapFilter | 'off'; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'off',   label: 'Off',             icon: 'eye-off-outline',   color: palette.mutedGray, desc: 'Hide heatmap' },
  { id: 'all',   label: 'All Crashes',     icon: 'warning-outline',   color: '#FF6B6B', desc: 'Every crash in the area' },
  { id: 'fatal', label: 'Fatal / Serious', icon: 'skull-outline',     color: '#FF3333', desc: 'Fatal or serious injury crashes' },
  { id: 'ped',   label: 'Pedestrian',      icon: 'walk-outline',      color: '#FFA500', desc: 'Crashes involving pedestrians' },
  { id: 'bike',  label: 'Bicycle',         icon: 'bicycle-outline',   color: palette.teal, desc: 'Crashes involving cyclists' },
  { id: 'hit',   label: 'Hit & Run',       icon: 'car-sport-outline', color: palette.lightPurple, desc: 'Hit and run incidents' },
];

// ─── Weather icon helper ────────────────────────────────────────────────────
function weatherIcon(code: number): string {
  if (code === 0) return 'sunny-outline';
  if (code <= 3) return 'partly-sunny-outline';
  if (code <= 48) return 'cloud-outline';
  if (code <= 65) return 'rainy-outline';
  if (code <= 75) return 'snow-outline';
  return 'thunderstorm-outline';
}

function weatherIconColor(code: number): string {
  if (code === 0) return '#FDB813';
  if (code <= 3) return '#87CEEB';
  if (code <= 48) return '#A0AEC0';
  if (code <= 65) return '#4299E1';
  if (code <= 75) return '#E2E8F0';
  return '#805AD5';
}

// ─── Sheet background ───────────────────────────────────────────────────────
function SheetBg({ style }: { style?: any }) {
  const colorScheme = useColorScheme() ?? 'light';
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { backgroundColor: colorScheme === 'dark' ? palette.deepPurple : '#F8F7FF' },
        style,
      ]}
    />
  );
}

// ─── Heatmap chooser modal ──────────────────────────────────────────────────
function HeatmapModal({ visible, activeFilter, onSelect, onClose, crashCount, loading }: {
  visible: boolean;
  activeFilter: HeatmapFilter | 'off';
  onSelect: (id: HeatmapFilter | 'off') => void;
  onClose: () => void;
  crashCount: number;
  loading: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={hm.backdrop} onPress={onClose}>
        <Pressable style={[hm.card, { backgroundColor: colorScheme === 'dark' ? palette.darkPurple : '#FFFFFF' }]} onPress={() => {}}>
          <View style={hm.header}>
            <Text style={[hm.title, { color: c.text }]}>Safety Heatmap</Text>
            {activeFilter !== 'off' && (
              <View style={[hm.countBadge, { backgroundColor: Glass[colorScheme].background }]}>
                {loading
                  ? <ActivityIndicator size="small" color={palette.teal} />
                  : <Text style={[hm.countText, { color: palette.teal }]}>{crashCount.toLocaleString()} points</Text>
                }
              </View>
            )}
          </View>
          <Text style={[hm.subtitle, { color: c.textSecondary }]}>Crash data from traffic records. Brighter = higher density.</Text>
          <View style={[hm.filterList, { backgroundColor: Glass[colorScheme].background }]}>
            {HEATMAP_FILTERS.map((f, i) => {
              const active = activeFilter === f.id;
              return (
                <View key={f.id}>
                  <Pressable
                    style={[hm.filterRow, active && { backgroundColor: palette.brightPurple + '15' }]}
                    onPress={() => { onSelect(f.id); onClose(); }}
                  >
                    <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '33' : Glass[colorScheme].background }]}>
                      <Ionicons name={f.icon as any} size={20} color={active ? f.color : c.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[hm.filterLabel, { color: active ? c.text : c.textSecondary }]}>{f.label}</Text>
                      <Text style={[hm.filterDesc, { color: c.textSecondary }]}>{f.desc}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={palette.teal} />}
                  </Pressable>
                  {i < HEATMAP_FILTERS.length - 1 && <View style={[hm.filterDiv, { backgroundColor: c.divider }]} />}
                </View>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Place type → icon + color ──────────────────────────────────────────────
function placeIconFor(title: string): { icon: string; bg: string } {
  const t = title.toLowerCase();
  if (t.includes('university') || t.includes('college') || t.includes('school'))
    return { icon: 'school-outline', bg: palette.royalBlue };
  if (t.includes('restaurant') || t.includes('food') || t.includes('burger') || t.includes('pizza'))
    return { icon: 'restaurant-outline', bg: '#E05C5C' };
  if (t.includes('coffee') || t.includes('cafe'))
    return { icon: 'cafe-outline', bg: '#A0522D' };
  if (t.includes('gas') || t.includes('fuel'))
    return { icon: 'car-outline', bg: '#5A8A5A' };
  if (t.includes('park') || t.includes('trail'))
    return { icon: 'leaf-outline', bg: palette.teal };
  if (t.includes('hospital') || t.includes('medical'))
    return { icon: 'medical-outline', bg: '#E05C5C' };
  if (t.includes('store') || t.includes('shop') || t.includes('market'))
    return { icon: 'cart-outline', bg: palette.mediumPurple };
  return { icon: 'location-outline', bg: palette.brightPurple };
}

export default function HomeScreen() {
  const { session, user, isLoading, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const jwt = session?.access_token ?? '';
  const { height: windowHeight } = useWindowDimensions();
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];

  const snapPoints = useMemo(() => ['14%', '52%', '90%'], []);
  const animatedPosition = useSharedValue(windowHeight);

  const [userLocation, setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [bookmarks, setBookmarks]           = useState<Bookmark[]>([]);
  const [weather, setWeather]               = useState<WeatherData | null>(null);
  const [sheetIndex, setSheetIndex]         = useState(1);
  const [zoomLevel, setZoomLevel]           = useState(0.04);
  const [placeModal, setPlaceModal]         = useState<'home'|'work'|'school'|null>(null);
  const [placeQuery, setPlaceQuery]         = useState('');
  const [placeSugg, setPlaceSugg]           = useState<any[]>([]);
  const [placeBusy, setPlaceBusy]           = useState(false);
  const placeDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [homeLabel, setHomeLabel]           = useState<string | null>(null);
  const [workLabel, setWorkLabel]           = useState<string | null>(null);
  const [schoolLabel, setSchoolLabel]       = useState<string | null>(null);

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 200_000,
  });
  const activeFilterInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);

  useEffect(() => {
    let cancelled = false;
    const hardTimeout = setTimeout(() => { if (!cancelled) setLocationLoading(false); }, 4000);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted' && !cancelled) {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise<null>(r => setTimeout(() => r(null), 3000)),
          ]);
          if (loc && !cancelled) setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch {}
      if (!cancelled) setLocationLoading(false);
    })();
    return () => { cancelled = true; clearTimeout(hardTimeout); };
  }, []);

  useEffect(() => {
    if (!userLocation) return;
    (async () => {
      try { setWeather(await getWeather(userLocation.lat, userLocation.lng)); } catch {}
    })();
  }, [userLocation]);

  // When user location is first received, animate map from fallback (NYC) to actual location
  const hasAnimatedToUserRef = useRef(false);
  useEffect(() => {
    if (!userLocation || hasAnimatedToUserRef.current) return;
    hasAnimatedToUserRef.current = true;
    const t = setTimeout(() => {
      mapRef.current?.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 500);
    }, 100);
    return () => clearTimeout(t);
  }, [userLocation]);

  useEffect(() => {
    if (!jwt) { setBookmarks([]); return; }
    void loadBookmarks();
  }, [jwt]);

  async function loadBookmarks() {
    try { setBookmarks(await listBookmarks(jwt)); } catch { setBookmarks([]); }
  }

  async function handleDeleteBookmark(id: string) {
    try { await deleteBookmark(jwt, id); await loadBookmarks(); }
    catch (e) { Alert.alert('Delete failed', e instanceof Error ? e.message : 'Error'); }
  }

  function handlePlaceQueryChange(text: string) {
    setPlaceQuery(text);
    if (placeDebRef.current) clearTimeout(placeDebRef.current);
    if (text.trim().length < 2) { setPlaceSugg([]); return; }
    placeDebRef.current = setTimeout(async () => {
      setPlaceBusy(true);
      try { setPlaceSugg((await searchPlaces(text.trim())).slice(0, 5)); }
      catch { setPlaceSugg([]); }
      finally { setPlaceBusy(false); }
    }, 350);
  }

  async function handleSavePlace(place: any) {
    if (!jwt) return;
    const labelMap = { home: 'Home', work: 'Work', school: 'School' };
    const label = labelMap[placeModal!];
    try {
      await createBookmark(jwt, { title: label + ': ' + place.name, address: place.address, lat: place.lat, lng: place.lng });
      if (placeModal === 'home') setHomeLabel(place.name);
      else if (placeModal === 'work') setWorkLabel(place.name);
      else setSchoolLabel(place.name);
      await loadBookmarks();
    } catch (e) { Alert.alert('Save failed', e instanceof Error ? e.message : 'Error'); }
    setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]);
  }

  function handleMyLocation() {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({ latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    }
  }
  function handleZoomIn() {
    const d = Math.max(zoomLevel * 0.5, 0.002); setZoomLevel(d);
    const center = userLocation ?? { lat: 40.7291, lng: -73.9965 };
    mapRef.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }
  function handleZoomOut() {
    const d = Math.min(zoomLevel * 2, 1.5); setZoomLevel(d);
    const center = userLocation ?? { lat: 40.7291, lng: -73.9965 };
    mapRef.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }

  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const sheetBgStyle = useAnimatedStyle(() => {
    const h    = windowHeight - animatedPosition.value;
    const lo   = windowHeight * 0.12, hi = windowHeight * 0.55, full = windowHeight * 0.87;
    const r    = interpolate(h, [lo, hi], [26, 22], Extrapolation.CLAMP);
    const bR   = interpolate(h, [lo, hi], [22, 0],  Extrapolation.CLAMP);
    const mg   = interpolate(h, [hi, full], [8, 0],  Extrapolation.CLAMP);
    return { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomLeftRadius: bR, borderBottomRightRadius: bR, marginLeft: mg, marginRight: mg };
  });

  const mapControlsTop = insets.top + 20;

  const mapRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.06, longitudeDelta: 0.06 };

  const recents = bookmarks.slice(0, 5);

  const shortcuts = [
    { key: 'home',   icon: 'home',       label: 'Home',   sub: homeLabel,   modal: 'home'   as const },
    { key: 'work',   icon: 'briefcase',  label: 'Work',   sub: workLabel,   modal: 'work'   as const },
    { key: 'school', icon: 'school',     label: 'School', sub: schoolLabel, modal: 'school' as const },
  ];

  if (isLoading || locationLoading) {
    return (
      <View style={[s.centered, { backgroundColor: palette.deepPurple }]}>
        <ActivityIndicator size="large" color={palette.brightPurple} />
        <Text style={s.loadingText}>Loading SafeWay…</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={mapRegion}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={colorScheme === 'dark' ? MapStyles.dark : MapStyles.light}
      >
        {bookmarks.map(bm => (
          <Marker key={bm.id} coordinate={{ latitude: bm.lat, longitude: bm.lng }}
            title={bm.title} description={bm.address} pinColor={palette.brightPurple} />
        ))}
        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap
            points={crashPoints}
            opacity={0.75}
            radius={20}
            gradient={{
              colors: ['#22D3EE', '#8B5CF6', '#EF4444'],
              startPoints: [0.1, 0.5, 1.0],
              colorMapSize: 256,
            }}
          />
        )}
      </MapView>

      {/* Map controls */}
      <View style={[s.mapControlsColumn, { top: mapControlsTop }]}>
        <View style={[s.zoomWrap, { backgroundColor: Glass[colorScheme].backgroundStrong }]}>
          <Pressable style={s.zoomBtn} onPress={handleZoomIn}>
            <Ionicons name="add" size={22} color={c.text} />
          </Pressable>
          <View style={[s.zoomDiv, { backgroundColor: c.divider }]} />
          <Pressable style={s.zoomBtn} onPress={handleZoomOut}>
            <Ionicons name="remove" size={22} color={c.text} />
          </Pressable>
        </View>
        <Pressable style={[s.floatBtnInner, { backgroundColor: Glass[colorScheme].backgroundStrong }]} onPress={handleMyLocation}>
          <Ionicons name="locate" size={20} color={palette.brightPurple} />
        </Pressable>
        <Pressable
          style={[
            s.floatBtnInner,
            { backgroundColor: Glass[colorScheme].backgroundStrong },
            heatmapFilter !== 'off' && { borderWidth: 1.5, borderColor: palette.brightPurple + '60' },
          ]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={palette.brightPurple} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={16} color={heatmapFilter !== 'off' ? (activeFilterInfo?.color ?? palette.brightPurple) : palette.brightPurple} />
          }
        </Pressable>
      </View>

      {/* SOS floating button */}
      <Pressable style={[s.sosBtn, { bottom: windowHeight * 0.15 + 20 }]}>
        <LinearGradient colors={[palette.danger, '#DC2626']} style={StyleSheet.absoluteFill} />
        <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
      </Pressable>

      {/* Heatmap chooser */}
      <HeatmapModal
        visible={showHeatmapModal}
        activeFilter={heatmapFilter}
        onSelect={setHeatmapFilter}
        onClose={() => setShowHeatmapModal(false)}
        crashCount={crashPoints.length}
        loading={crashLoading}
      />

      {/* Home/Work/School picker modal */}
      <Modal visible={placeModal !== null} transparent animationType="slide"
        onRequestClose={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
        <Pressable style={hw.backdrop} onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
          <Pressable style={[hw.card, { backgroundColor: colorScheme === 'dark' ? palette.darkPurple : '#FFFFFF' }]} onPress={() => {}}>
            <View style={hw.header}>
              <Text style={[hw.title, { color: c.text }]}>Set {placeModal === 'home' ? 'Home' : placeModal === 'work' ? 'Work' : 'School'}</Text>
              <Pressable onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
                <Ionicons name="close" size={20} color={c.text} />
              </Pressable>
            </View>
            <View style={[hw.inputWrap, { backgroundColor: Glass[colorScheme].background, borderColor: palette.brightPurple + '40' }]}>
              <Ionicons name="search" size={16} color={palette.brightPurple} />
              <TextInput value={placeQuery} onChangeText={handlePlaceQueryChange}
                placeholder="Search address…" placeholderTextColor={c.textSecondary}
                autoFocus style={[hw.input, { color: c.text }]} selectionColor={palette.brightPurple} />
              {placeBusy && <ActivityIndicator size="small" color={palette.brightPurple} />}
            </View>
            {placeSugg.length > 0 && (
              <View style={[hw.suggList, { backgroundColor: Glass[colorScheme].background }]}>
                {placeSugg.map((place, i) => (
                  <View key={place.place_id}>
                    <Pressable style={hw.suggRow} onPress={() => handleSavePlace(place)}>
                      <Ionicons name="location-outline" size={16} color={palette.brightPurple} />
                      <View style={{ flex: 1 }}>
                        <Text style={[hw.suggTitle, { color: c.text }]} numberOfLines={1}>{place.name}</Text>
                        <Text style={[hw.suggSub, { color: c.textSecondary }]} numberOfLines={1}>{place.address}</Text>
                      </View>
                    </Pressable>
                    {i < placeSugg.length - 1 && <View style={[hw.div, { backgroundColor: c.divider }]} />}
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Bottom Sheet */}
      <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
        onChange={handleSheetChange} animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} />}
        handleIndicatorStyle={[s.handle, { backgroundColor: palette.brightPurple + '40' }]}
        enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[s.sheetContent, { paddingBottom: insets.bottom + 100 }]}
          scrollEnabled={sheetIndex === 2}>

          {/* Search row */}
          <View style={s.searchRow}>
            <Pressable style={[s.searchBar, { backgroundColor: Glass[colorScheme].background, borderColor: Glass[colorScheme].border }]} onPress={() => router.push('/search')}>
              <Ionicons name="search" size={16} color={c.textSecondary} />
              <Text style={[s.searchPlaceholder, { color: c.textSecondary }]}>Where to?</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="mic-outline" size={18} color={c.textSecondary} />
            </Pressable>
          </View>

          {sheetIndex >= 1 && (
            <>
              {/* Weather widget */}
              {weather && (
                <GlassCard style={s.weatherCard}>
                  <View style={s.weatherRow}>
                    <Ionicons name={weatherIcon(weather.weather_code) as any} size={32} color={weatherIconColor(weather.weather_code)} />
                    <View style={s.weatherInfo}>
                      <Text style={[s.weatherTemp, { color: c.text }]}>
                        {Math.round(weather.temperature)}°{weather.unit}
                      </Text>
                      <Text style={[s.weatherDesc, { color: c.textSecondary }]}>{weather.description}</Text>
                    </View>
                    <View style={s.weatherExtra}>
                      <View style={s.weatherExtraItem}>
                        <Ionicons name="speedometer-outline" size={14} color={palette.cyan} />
                        <Text style={[s.weatherExtraText, { color: c.textSecondary }]}>{weather.wind_speed} mph</Text>
                      </View>
                    </View>
                  </View>
                </GlassCard>
              )}

              {/* BOOKMARKED LOCATIONS */}
              <Text style={[s.sectionLabel, { color: c.textSecondary }]}>BOOKMARKED LOCATIONS</Text>
              <GlassCard style={s.bookmarkCard}>
                <Text style={[s.placesCount, { color: c.text }]}>{bookmarks.length} Places</Text>
                <View style={[s.cardDivider, { backgroundColor: c.divider }]} />
                {user ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    nestedScrollEnabled directionalLockEnabled={false}
                    contentContainerStyle={s.shortcutRow}>
                    {shortcuts.map(sc => (
                      <Pressable key={sc.key} style={s.shortcut}
                        onPress={() => { setPlaceModal(sc.modal); setPlaceQuery(''); setPlaceSugg([]); }}>
                        <View style={[s.shortcutCircle, sc.sub && { borderWidth: 2.5, borderColor: palette.teal }]}>
                          <Ionicons name={sc.icon as any} size={26} color={palette.brightPurple} />
                        </View>
                        <Text style={[s.shortcutLabel, { color: c.text }]}>{sc.label}</Text>
                        <Text style={[s.shortcutSub, { color: c.textSecondary }]} numberOfLines={1}>{sc.sub ?? 'Add'}</Text>
                      </Pressable>
                    ))}
                    {bookmarks.map(bm => (
                      <Pressable key={bm.id} style={s.shortcut}
                        onPress={() => router.push({ pathname: '/destination', params: { placeId: bm.id, name: bm.title, address: bm.address ?? '', lat: String(bm.lat), lng: String(bm.lng) } })}
                        onLongPress={() => Alert.alert('Remove?', bm.title, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => void handleDeleteBookmark(bm.id) },
                        ])}>
                        <View style={s.shortcutCircle}>
                          <Ionicons name="bookmark-outline" size={22} color={palette.brightPurple} />
                        </View>
                        <Text style={[s.shortcutLabel, { color: c.text }]} numberOfLines={1}>{bm.title}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={s.shortcut} onPress={() => router.push('/search')}>
                      <View style={[s.shortcutCircle, { backgroundColor: palette.brightPurple + '20' }]}>
                        <Ionicons name="add" size={28} color={palette.brightPurple} />
                      </View>
                      <Text style={[s.shortcutLabel, { color: c.text }]}>Add</Text>
                    </Pressable>
                  </ScrollView>
                ) : (
                  <Pressable style={s.loginBtn} onPress={() => router.push('/login')}>
                    <Ionicons name="log-in-outline" size={16} color={palette.brightPurple} />
                    <Text style={[s.loginBtnText, { color: palette.brightPurple }]}>Log in to save places</Text>
                  </Pressable>
                )}
              </GlassCard>

              {/* RECENTS */}
              <Text style={[s.sectionLabel, { color: c.textSecondary, marginTop: 20 }]}>RECENTS</Text>
              <GlassCard style={s.recentCard}>
                {recents.length > 0 ? recents.map((bm, i) => {
                  const { icon, bg } = placeIconFor(bm.title);
                  return (
                    <View key={bm.id}>
                      <Pressable style={s.recentRow}
                        onPress={() => router.push({ pathname: '/destination', params: { placeId: bm.id, name: bm.title, address: bm.address ?? '', lat: String(bm.lat), lng: String(bm.lng) } })}>
                        <View style={[s.recentIconWrap, { backgroundColor: bg + '33' }]}>
                          <Ionicons name={icon as any} size={18} color={bg} />
                        </View>
                        <View style={s.recentContent}>
                          <Text style={[s.recentTitle, { color: c.text }]}>{bm.title}</Text>
                          {bm.address ? <Text style={[s.recentSub, { color: c.textSecondary }]} numberOfLines={1}>{bm.address}</Text> : null}
                        </View>
                      </Pressable>
                      {i < recents.length - 1 && <View style={[s.rowDiv, { backgroundColor: c.divider }]} />}
                    </View>
                  );
                }) : (
                  <View style={s.recentRow}>
                    <Text style={[s.emptyText, { color: c.textSecondary }]}>No recent places yet</Text>
                  </View>
                )}
              </GlassCard>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.deepPurple },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: palette.brightPurple, fontSize: 14, fontWeight: '500' },

  mapControlsColumn: { position: 'absolute', right: 14, flexDirection: 'column', gap: 8 },
  zoomWrap: { borderRadius: 14, overflow: 'hidden', width: 42 },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  floatBtnInner: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },

  sosBtn: {
    position: 'absolute',
    left: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },

  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 10 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1 },
  searchPlaceholder: { fontSize: 15, flex: 1 },

  weatherCard: { padding: 16, marginBottom: 18 },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  weatherInfo: { flex: 1 },
  weatherTemp: { fontSize: 28, fontWeight: '700' },
  weatherDesc: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  weatherExtra: { alignItems: 'flex-end' },
  weatherExtraItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weatherExtraText: { fontSize: 12, fontWeight: '500' },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },

  bookmarkCard: { paddingTop: 14, paddingBottom: 14, overflow: 'visible' },
  placesCount: { fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginBottom: 10 },
  cardDivider: { height: 1, marginBottom: 16 },
  shortcutRow: { paddingHorizontal: 16, gap: 20, paddingBottom: 4 },
  shortcut: { alignItems: 'center', gap: 6, minWidth: 60 },
  shortcutCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.brightPurple + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shortcutLabel: { fontSize: 12, fontWeight: '600' },
  shortcutSub: { fontSize: 11 },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  loginBtnText: { fontSize: 13, fontWeight: '600' },

  recentCard: { overflow: 'hidden' },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  recentIconWrap: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  recentContent: { flex: 1 },
  recentTitle: { fontSize: 14, fontWeight: '600' },
  recentSub: { fontSize: 12, marginTop: 2 },
  rowDiv: { height: 1, marginLeft: 68 },
  emptyText: { fontSize: 13 },
});

const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  countBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { fontSize: 12, fontWeight: '600' },
  filterList: { borderRadius: 18, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  filterIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  filterLabel: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  filterDesc: { fontSize: 12, opacity: 0.7 },
  filterDiv: { height: 1, marginLeft: 70 },
});

const hw = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  input: { flex: 1, fontSize: 15 },
  suggList: { borderRadius: 14, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  suggTitle: { fontSize: 14, fontWeight: '600' },
  suggSub: { fontSize: 12, marginTop: 2 },
  div: { height: 1, marginLeft: 42 },
});
