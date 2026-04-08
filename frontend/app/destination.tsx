import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, ActivityIndicator, Animated as RNAnimated, Image, Linking, Modal,
  Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
  useWindowDimensions, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, NativeViewGestureHandler } from 'react-native-gesture-handler';
import MapView, { Heatmap, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  interpolate, Extrapolation, useAnimatedReaction, runOnJS,
} from 'react-native-reanimated';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { createBookmark, deleteBookmark, getPlaceDetails, listBookmarks, searchPlaces } from '@/lib/api';
import type { PlaceDetails, PlaceSearchResult } from '@/lib/api';
import { bookmarkStore } from '@/lib/bookmarkStore';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-context';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';

// ─── API base URL ────────────────────────────────────────────────────────────
import Constants from 'expo-constants';
function _resolveBase(raw: string): string {
  try {
    const u = new URL(raw);
    const h = u.hostname;
    const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2' ||
      /^192\.168\./.test(h) || /^10\./.test(h);
    if (isLocal && u.protocol === 'https:') { u.protocol = 'http:'; return u.toString().replace(/\/$/, ''); }
  } catch {}
  return raw.replace(/\/$/, '');
}
const _apiBase = _resolveBase(
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ?? 'http://10.0.2.2:8000'
);

// ─── Design tokens ─────────────────────────────────────────────────────────────
const NAVY           = '#030427';
const NAVY_GLASS     = '#06072E';
const NAVY_CARD      = '#0D0E3A';
const NAVY_ITEM      = '#161750';
const GLASS_BORDER   = '#1A1B4D';
const SEAFOAM        = '#1ABC93';
const SEAFOAM_DIM    = 'rgba(26, 188, 147, 0.15)';
// Midnight Emerald palette for the View Routes button
const EMERALD_DEEP   = '#064E3B';
const EMERALD_MID    = '#047857';
const EMERALD_LIGHT  = '#059669';
const TEXT_PRI       = '#FFFFFF';
const TEXT_MUT       = '#6B7FA8';
const TEXT_SUB       = '#8A9BBF';
const DIVIDER        = '#1A1B4D';
const GOLD           = '#FFD700';
const DANGER         = '#FF4444';
const SUCCESS        = '#22C55E';
// ──────────────────────────────────────────────────────────────────────────────

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

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2533' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ba7b4' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2533' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c4a5a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#2b3544' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#2b3a33' }] },
  { featureType: 'landscape.natural.landcover', elementType: 'geometry', stylers: [{ color: '#375849' }] },
  { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ color: '#5b4a33' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#26403d' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283044' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
];

const FLOAT_SIDE   = 14;
const FLOAT_BOTTOM = 18;
const FLOAT_RADIUS = 26;
const HERO_HEIGHT  = 220;

// ─── Pulsing halo for the map marker ──────────────────────────────────────────
function PulsingMarker({ coordinate }: { coordinate: { latitude: number; longitude: number } }) {
  const pulseAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
        RNAnimated.timing(pulseAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const pulseScale  = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.6, 0.3, 0] });

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
        <RNAnimated.View style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: 28,
            backgroundColor: SEAFOAM,
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          }
        ]} />
        <View style={{
          width: 18, height: 18, borderRadius: 9,
          backgroundColor: SEAFOAM,
          borderWidth: 2.5, borderColor: '#FFFFFF',
          shadowColor: SEAFOAM, shadowOpacity: 0.9, shadowRadius: 8, elevation: 6,
        }} />
      </View>
    </Marker>
  );
}

// ─── Bottom sheet glass background ────────────────────────────────────────────
function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: NAVY_GLASS,
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

// ─── Star rating row ──────────────────────────────────────────────────────────
function StarRating({ rating, total }: { rating: number; total?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={rating >= i ? 'star' : rating >= i - 0.5 ? 'star-half' : 'star-outline'}
          size={13}
          color={GOLD}
        />
      ))}
      {total != null && (
        <Text style={{ color: TEXT_MUT, fontSize: 11, marginLeft: 2 }}>
          ({total.toLocaleString()})
        </Text>
      )}
    </View>
  );
}

// ─── Safety score bar ─────────────────────────────────────────────────────────
function SafetyBar({ score, loading }: { score: number; loading?: boolean }) {
  const fillAnim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.timing(fillAnim, {
      toValue: score / 100,
      duration: 800,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [score]);

  const label =
    score >= 80 ? 'SECURE PATHS AVAILABLE' :
    score >= 50 ? 'MODERATE SAFETY' :
    'USE CAUTION ON THIS ROUTE';

  const barColor =
    score >= 80 ? SEAFOAM :
    score >= 50 ? '#F5A623' :
    '#FF4444';

  return (
    <View style={safety.wrap}>
      <View style={safety.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="shield-checkmark" size={11} color={barColor} />
          <Text style={[safety.label, { color: barColor }]}>{label}</Text>
        </View>
        {loading
          ? <ActivityIndicator size="small" color={barColor} style={{ width: 20 }} />
          : <Text style={[safety.score, { color: barColor }]}>{score}%</Text>}
      </View>
      <View style={safety.track}>
        <RNAnimated.View style={[
          safety.fill,
          {
            backgroundColor: barColor,
            width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            shadowColor: barColor,
          }
        ]} />
      </View>
    </View>
  );
}

// ─── Circular action button ───────────────────────────────────────────────────
function CircleAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={action.wrap}>
      <View style={action.circle}>
        <Ionicons name={icon as any} size={20} color={TEXT_PRI} />
      </View>
      <Text style={action.label}>{label}</Text>
    </Pressable>
  );
}

// ─── Midnight Emerald "Magnetic" View Routes Button ──────────────────────────
function ViewRoutesButton({ onPress }: { onPress: () => void }) {
  const scale    = useSharedValue(1);
  const brightness = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: brightness.value,
  }));

  function triggerHaptic() {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  }

  function handlePressIn() {
    scale.value    = withSpring(0.96, { damping: 18, stiffness: 280 });
    brightness.value = withTiming(0.92, { duration: 80 });
  }

  function handlePressOut() {
    scale.value    = withSpring(1.0, { damping: 14, stiffness: 200 });
    brightness.value = withTiming(1, { duration: 120 });
  }

  return (
    <Animated.View style={[vrb.outer, animatedStyle]}>
      <Pressable
        onPress={() => { triggerHaptic(); onPress(); }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{ borderRadius: 50, overflow: 'hidden' }}
      >
        {/* Midnight Emerald gradient */}
        <LinearGradient
          colors={[EMERALD_DEEP, EMERALD_MID, EMERALD_LIGHT]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={vrb.gradient}
        >
          {/* Glassmorphism: subtle white top sheen */}
          <LinearGradient
            colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[StyleSheet.absoluteFillObject, { borderRadius: 50 }]}
          />

          {/* 1px glass border overlay */}
          <View style={vrb.glassBorder} />

          {/* Content */}
          <View style={vrb.content}>
            <View style={vrb.iconWrap}>
              <Ionicons name="navigate" size={17} color="#FFFFFF" />
            </View>
            <Text style={vrb.text}>View Routes</Text>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.6)" style={{ marginLeft: 2 }} />
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function DestinationScreen() {
  const params = useLocalSearchParams<{
    placeId: string; name: string; address: string; lat: string; lng: string;
  }>();
  const { session } = useAuth();
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const { height: windowHeight } = useWindowDimensions();
  const jwt = session?.access_token ?? '';

  const lat = parseFloat(params.lat ?? '0');
  const lng = parseFloat(params.lng ?? '0');

  const snapPoints = useMemo(() => {
    const safeMax = windowHeight - (insets.top + 118) - 8;
    const miniSnap = HERO_HEIGHT + 90;
    return [miniSnap, Math.round(windowHeight * 0.62), safeMax];
  }, [windowHeight, insets.top]);

  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);
  const [showServicesModal, setShowServicesModal] = useState(false);
  const [showMoreModal, setShowMoreModal] = useState(false);

  const [details, setDetails]       = useState<PlaceDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saved, setSaved]           = useState(false);
  const [savedBookmarkId, setSavedBookmarkId] = useState<string | null>(null);
  const [zoomDelta, setZoomDelta] = useState(0.012);
  const [currentAddress, setCurrentAddress] = useState('My Location');
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [mapStyleType, setMapStyleType] = useState<'standard'|'satellite'|'hybrid'|'terrain'>('standard');
  const activeHeatmapInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);

  const [destQuery, setDestQuery] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<PlaceSearchResult[]>([]);
  const [destSearchBusy, setDestSearchBusy] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSearchResult[]>([]);
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editingDest, setEditingDest] = useState(false);
  const [originLabel, setOriginLabel] = useState(currentAddress);
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const searchDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoScrollRef = useRef<NativeViewGestureHandler>(null);

  const [safetyScore, setSafetyScore] = useState<number>(72);
  const [safetyLoading, setSafetyLoading] = useState(false);

  useEffect(() => {
    if (!lat || !lng) return;
    setSafetyLoading(true);
    const originLat = lat + 0.0005;
    const originLng = lng + 0.0005;
    fetch(`${_apiBase}/maps/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin:      { lat: originLat, lng: originLng },
        destination: { lat, lng },
        travel_mode: 'WALK',
        departure_hour: new Date().getHours(),
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const routes: any[] = data?.routes ?? [];
        const scored = routes.find((r: any) => r.safety_score != null);
        if (scored != null) {
          const raw = Math.min(100, Math.max(0, scored.safety_score));
          setSafetyScore(Math.round(100 - raw));
        }
      })
      .catch(() => {})
      .finally(() => setSafetyLoading(false));
  }, [lat, lng]);

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 5_000,
  });

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          setOriginCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          if (geo) {
            const parts = [geo.streetNumber, geo.street, geo.city].filter(Boolean);
            setCurrentAddress(parts.join(' ') || 'My Location');
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (params.placeId) {
      setDetailsLoading(true);
      getPlaceDetails(params.placeId)
        .then(d => { if (d) setDetails(d); })
        .catch(() => {})
        .finally(() => setDetailsLoading(false));
    }
    setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        400,
      );
    }, 400);
  }, [params.placeId]);

  function handleDestQueryChange(text: string) {
    setDestQuery(text);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (text.trim().length < 2) { setDestSuggestions([]); return; }
    searchDebRef.current = setTimeout(async () => {
      setDestSearchBusy(true);
      try { setDestSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
      catch { setDestSuggestions([]); }
      finally { setDestSearchBusy(false); }
    }, 350);
  }

  useEffect(() => {
    const name = params.name ?? '';
    if (bookmarkStore.has(name)) setSaved(true);
  }, [params.name]);

  async function handleSave() {
    if (saved) {
      const name = details?.name ?? params.name ?? '';
      bookmarkStore.remove(savedBookmarkId ?? name);
      setSaved(false);
      setSavedBookmarkId(null);
      if (jwt && savedBookmarkId && !savedBookmarkId.startsWith('local_')) {
        try { await deleteBookmark(jwt, savedBookmarkId); } catch {}
      }
      return;
    }
    const title = details?.name ?? params.name ?? '';
    const address = details?.address ?? params.address ?? '';
    const localId = `local_${Date.now()}`;
    bookmarkStore.add({ id: localId, title, address, lat, lng, place_id: params.placeId });
    setSaved(true);
    setSavedBookmarkId(localId);
    if (jwt) {
      try { await createBookmark(jwt, { title, address, lat, lng }); } catch {}
    }
  }

  function openWebsite() {
    const url = details?.website;
    if (!url) {
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(params.name ?? '')}`);
      return;
    }
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(params.name ?? '')}`);
    });
  }

  const sheetBgStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius:     FLOAT_RADIUS,
    borderTopRightRadius:    FLOAT_RADIUS,
    borderBottomLeftRadius:  FLOAT_RADIUS,
    borderBottomRightRadius: FLOAT_RADIUS,
  }));

  const placeName = details?.name    ?? params.name    ?? 'Place';
  const placeAddr = details?.address ?? params.address ?? '';
  const rawType   = details?.types?.[0] ?? '';
  const placeType = rawType
    ? rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Location';

  const ohText = details?.opening_hours ?? '';
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const isOpenNow = (() => {
    if (!ohText) return null;
    const lines = ohText.split('\n');
    const todayLine = lines.find(l => l.startsWith(todayName));
    if (!todayLine) return null;
    if (todayLine.toLowerCase().includes('closed')) return false;
    const match = todayLine.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (!match) return null;
    const toMins = (s: string) => {
      const m = s.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
      if (!m) return 0;
      let h = parseInt(m[1]); const min = parseInt(m[2]); const ap = m[3].toUpperCase();
      if (ap === 'AM' && h === 12) h = 0;
      if (ap === 'PM' && h !== 12) h += 12;
      return h * 60 + min;
    };
    const cur = new Date().getHours() * 60 + new Date().getMinutes();
    const openMins = toMins(match[1]);
    const closeMins = toMins(match[2]);
    if (closeMins <= openMins) return cur >= openMins || cur < closeMins;
    return cur >= openMins && cur < closeMins;
  })();

  const todayHoursLine = (() => {
    if (!ohText) return '';
    const lines = ohText.split('\n');
    return lines.find(l => l.startsWith(todayName)) ?? lines[0] ?? '';
  })();

  const TOP_BTNS = insets.top + 118;

  function doZoom(factor: number) {
    const d = Math.min(Math.max(zoomDelta * factor, 0.001), 1.5);
    setZoomDelta(d);
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }

  function handleCenter() {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: zoomDelta, longitudeDelta: zoomDelta },
      400,
    );
  }

  const aboutRows: { icon: string; label: string; onPress?: () => void }[] = [];
  if (placeAddr) aboutRows.push({ icon: 'location-outline', label: placeAddr });
  if (ohText) {
    const lines = ohText.split('\n').filter(Boolean);
    aboutRows.push({ icon: 'time-outline', label: lines.length > 1 ? lines.join('\n') : lines[0] ?? 'Hours not available' });
  } else if (!detailsLoading) {
    aboutRows.push({ icon: 'time-outline', label: 'Hours not available' });
  }
  if (details?.phone) {
    aboutRows.push({ icon: 'call-outline', label: details.phone, onPress: () => Linking.openURL(`tel:${details!.phone!}`) });
  } else if (!detailsLoading) {
    aboutRows.push({ icon: 'call-outline', label: 'Phone not available' });
  }
  if (details?.editorial_summary) {
    aboutRows.unshift({ icon: 'information-circle-outline', label: details.editorial_summary });
  }
  if (details?.google_maps_uri) {
    aboutRows.push({ icon: 'map-outline', label: 'View on Google Maps', onPress: () => Linking.openURL(details!.google_maps_uri!) });
  }

  const heroPhoto = details?.photo_urls?.[0] ?? null;
  const extraPhotos = details?.photo_urls?.slice(1) ?? [];

  return (
    <View style={[s.container, { backgroundColor: T.BG }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapStyleType === 'standard' ? (T.isDark ? DARK_MAP_STYLE : []) : undefined}
        mapType={mapStyleType === 'standard' ? 'standard' : mapStyleType}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation
        showsMyLocationButton={false}
        scrollEnabled
        zoomEnabled
      >
        <PulsingMarker coordinate={{ latitude: lat, longitude: lng }} />
        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap
            points={crashPoints}
            opacity={0.75}
            radius={22}
            gradient={{
              colors: ['#00E5FF', '#FFD600', '#FF1744'],
              startPoints: [0.1, 0.5, 1.0],
              colorMapSize: 256,
            }}
          />
        )}
      </MapView>

      {/* ── Top gradient vignette ── */}
      <LinearGradient
        colors={['rgba(3,4,39,0.90)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140, zIndex: 5 }}
        pointerEvents="none"
      />

      {/* ── Bottom gradient vignette ── */}
      <LinearGradient
        colors={['transparent', 'rgba(3,4,39,0.55)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 240, zIndex: 5 }}
        pointerEvents="none"
      />

      {/* ── Back button ── */}
      <Pressable
        style={[s.backBtn, { top: insets.top + 10 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={19} color={TEXT_PRI} />
      </Pressable>

      {/* ── Top route card ── */}
      <View style={[s.topRouteCard, { top: insets.top + 10, backgroundColor: NAVY_GLASS, borderColor: GLASS_BORDER }]}>
        <View style={s.topRouteInner}>
          <View style={s.topRouteDotCol}>
            <View style={s.originDotSmall} />
            <View style={[s.topRouteLine, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
            <Ionicons name="location" size={15} color="#FF5A5A" />
          </View>

          <View style={s.topRouteFields}>
            <Pressable style={s.topRouteField} onPress={() => { setEditingDest(false); setEditingOrigin(true); setOriginQuery(''); }}>
              {editingOrigin ? (
                <TextInput
                  value={originQuery}
                  onChangeText={text => {
                    setOriginQuery(text);
                    setOriginLabel(text);
                    if (originDebRef.current) clearTimeout(originDebRef.current);
                    if (text.trim().length < 2) { setOriginSuggestions([]); return; }
                    originDebRef.current = setTimeout(async () => {
                      try { setOriginSuggestions((await searchPlaces(text.trim())).slice(0, 4)); }
                      catch { setOriginSuggestions([]); }
                    }, 350);
                  }}
                  placeholder="Starting point…"
                  placeholderTextColor={TEXT_MUT}
                  autoFocus
                  style={[s.topRouteInput, { color: TEXT_PRI }]}
                  selectionColor={SEAFOAM}
                  onBlur={() => setEditingOrigin(false)}
                />
              ) : (
                <Text style={[s.topRouteLabel, { color: TEXT_PRI }]} numberOfLines={1}>{originLabel || currentAddress}</Text>
              )}
            </Pressable>

            <View style={[s.topFieldDivider, { backgroundColor: 'rgba(255,255,255,0.10)' }]} />

            <Pressable style={s.topRouteField} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
              {editingDest ? (
                <TextInput
                  value={destQuery}
                  onChangeText={handleDestQueryChange}
                  placeholder="Destination…"
                  placeholderTextColor={TEXT_MUT}
                  autoFocus
                  style={[s.topRouteInput, { color: TEXT_PRI }]}
                  selectionColor={SEAFOAM}
                  onBlur={() => { if (!destSuggestions.length) setEditingDest(false); }}
                />
              ) : (
                <Text style={[s.topRouteLabel, { color: TEXT_PRI }]} numberOfLines={1}>{placeName}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={[s.topRouteSwapBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
            onPress={() => {
              setOriginLabel(placeName);
              router.replace({
                pathname: '/destination',
                params: { placeId: params.placeId, name: params.name, address: params.address, lat: params.lat, lng: params.lng },
              });
            }}
          >
            <Ionicons name="swap-vertical" size={18} color={TEXT_MUT} />
          </Pressable>
        </View>

        {editingOrigin && originSuggestions.length > 0 && (
          <View style={[s.topSuggList, { backgroundColor: NAVY_CARD }]}>
            {originSuggestions.map((sg, i) => (
              <View key={sg.place_id}>
                <Pressable style={s.topSuggRow} onPress={() => {
                  setOriginLabel(sg.name); setOriginQuery(sg.name);
                  setOriginCoords({ lat: sg.lat, lng: sg.lng });
                  setOriginSuggestions([]); setEditingOrigin(false);
                }}>
                  <Ionicons name="location-outline" size={14} color={SEAFOAM} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.topSuggTitle, { color: TEXT_PRI }]} numberOfLines={1}>{sg.name}</Text>
                    <Text style={[s.topSuggSub, { color: TEXT_MUT }]} numberOfLines={1}>{sg.address}</Text>
                  </View>
                </Pressable>
                {i < originSuggestions.length - 1 && <View style={[s.topSuggDiv, { backgroundColor: DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}

        {editingDest && destSuggestions.length > 0 && (
          <View style={[s.topSuggList, { backgroundColor: NAVY_CARD }]}>
            {destSuggestions.map((sg, i) => (
              <View key={sg.place_id}>
                <Pressable style={s.topSuggRow} onPress={() => {
                  setDestQuery(''); setDestSuggestions([]); setEditingDest(false);
                  router.replace({ pathname: '/destination', params: { placeId: sg.place_id, name: sg.name, address: sg.address, lat: String(sg.lat), lng: String(sg.lng) } });
                }}>
                  <Ionicons name="location-outline" size={14} color={SEAFOAM} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.topSuggTitle, { color: TEXT_PRI }]} numberOfLines={1}>{sg.name}</Text>
                    <Text style={[s.topSuggSub, { color: TEXT_MUT }]} numberOfLines={1}>{sg.address}</Text>
                  </View>
                </Pressable>
                {i < destSuggestions.length - 1 && <View style={[s.topSuggDiv, { backgroundColor: DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Zoom cluster ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS, borderRadius: 14, overflow: 'hidden', width: 42, backgroundColor: T.ITEM }}>
        <Pressable style={s.zoomBtn} onPress={() => doZoom(0.5)}>
          <Ionicons name="add" size={22} color={T.TEXT_PRI} />
        </Pressable>
        <View style={[s.zoomDiv, { backgroundColor: T.DIVIDER }]} />
        <Pressable style={s.zoomBtn} onPress={() => doZoom(2)}>
          <Ionicons name="remove" size={22} color={T.TEXT_PRI} />
        </Pressable>
      </View>

      {/* ── Locate ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 100, width: 42, height: 42, borderRadius: 21 }}>
        <Pressable
          style={[s.floatBtnInner, { backgroundColor: T.ITEM }]}
          onPress={handleCenter}
        >
          <Ionicons name="locate" size={20} color={T.ACCENT} />
        </Pressable>
      </View>

      {/* ── Heatmap pill ── */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 152 }}>
        <Pressable
          style={[
            s.heatmapInner,
            { backgroundColor: T.ITEM, borderColor: heatmapFilter !== 'off' ? T.ACCENT + '55' : 'transparent' },
          ]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={T.ACCENT} style={{ marginRight: 2 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapFilter !== 'off' ? (activeHeatmapInfo?.color ?? T.ACCENT) : T.ACCENT} />
          }
          {heatmapFilter !== 'off' && (
            <Text style={[s.heatmapText, { color: activeHeatmapInfo?.color ?? T.ACCENT }]}>
              {activeHeatmapInfo?.label ?? 'Heatmap'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── Heatmap / map style modal ── */}
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
                      <View style={[hm.filterIcon, { backgroundColor: active ? f.color + '25' : NAVY }]}>
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

      {/* ── Floating glass island: the bottom sheet wrapper ── */}
      <Animated.View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: FLOAT_SIDE, right: FLOAT_SIDE, bottom: insets.bottom * 0.5 + FLOAT_BOTTOM, top: 0 }}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', borderRadius: FLOAT_RADIUS, backgroundColor: 'transparent' }]}
        >
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        enableDynamicSizing={false}
        animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} />}
        handleComponent={() => (
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{
              width: 38, height: 4, borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.2)',
            }} />
          </View>
        )}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + FLOAT_BOTTOM + 32 }}
          scrollEnabled
        >
          <>
            {/* ══ HERO PHOTO ══════════════════════════════════════════════════════ */}
            <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
            <View style={hero.wrap}>
              {heroPhoto ? (
                <Image source={{ uri: heroPhoto }} style={hero.img} resizeMode="cover" />
              ) : (
                <LinearGradient colors={[NAVY_CARD, NAVY_ITEM]} style={hero.img}>
                  <Ionicons name="image-outline" size={40} color={TEXT_MUT} />
                </LinearGradient>
              )}

              <LinearGradient
                colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.0)']}
                style={hero.scrimTop}
                pointerEvents="none"
              />

              <LinearGradient
                colors={['rgba(5,6,45,0)', 'rgba(5,6,45,0.85)']}
                style={hero.scrimBottom}
                pointerEvents="none"
              />

              <Pressable style={hero.closeBtn} onPress={() => router.back()}>
                <Ionicons name="close" size={16} color={TEXT_PRI} />
              </Pressable>

              <View style={hero.titleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={hero.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {placeName}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <Text style={hero.subtitle}>{placeType}</Text>
                    {placeAddr ? (
                      <>
                        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: TEXT_MUT, opacity: 0.5 }} />
                        <Text style={hero.subtitle}>{placeAddr.split(',').slice(-2, -1)[0]?.trim()}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
            </View>
            {/* ══ END HERO ════════════════════════════════════════════════════════ */}

            {/* ── Content body ── */}
            <View style={s.sheetContent}>

              {/* ── Rating & hours row ── */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ gap: 5 }}>
                  {details?.rating != null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[s.ratingNum, { color: TEXT_PRI }]}>{details.rating.toFixed(1)}</Text>
                      <StarRating rating={details.rating} total={details.user_ratings_total} />
                    </View>
                  )}
                  {ohText ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isOpenNow !== null && (
                        <View style={{
                          paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
                          backgroundColor: isOpenNow ? 'rgba(34,197,94,0.15)' : 'rgba(255,68,68,0.15)',
                        }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: isOpenNow ? SUCCESS : DANGER }}>
                            {isOpenNow ? 'OPEN' : 'CLOSED'}
                          </Text>
                        </View>
                      )}
                      {todayHoursLine ? (
                        <Text style={{ color: TEXT_MUT, fontSize: 12 }} numberOfLines={1}>
                          {todayHoursLine.replace(/^[A-Za-z]+:\s*/, '')}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                {/* Bookmark pill */}
                <Pressable
                  onPress={() => void handleSave()}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 50,
                    borderWidth: 1, borderColor: saved ? GOLD + '60' : GLASS_BORDER,
                    backgroundColor: saved ? 'rgba(255,215,0,0.10)' : 'transparent',
                  }}
                >
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={14} color={saved ? GOLD : TEXT_MUT} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: saved ? GOLD : TEXT_MUT }}>
                    {saved ? 'Saved' : 'Save'}
                  </Text>
                </Pressable>
              </View>

              {/* ── VIEW ROUTES — Midnight Emerald Magnetic Button ── */}
              <ViewRoutesButton
                onPress={() =>
                  router.push({
                    pathname: '/directions',
                    params: {
                      destLat: String(lat), destLng: String(lng), destName: placeName,
                      originAddress: originLabel || currentAddress,
                      ...(originCoords ? { originLat: String(originCoords.lat), originLng: String(originCoords.lng) } : {}),
                    },
                  })
                }
              />

              {/* ── Circular icon action buttons ── */}
              <View style={s.actionRow}>
                {[
                  {
                    icon: 'call-outline', label: 'Call',
                    onPress: () => {
                      if (details?.phone) Linking.openURL(`tel:${details.phone}`);
                      else Alert.alert('No phone number available');
                    },
                  },
                  { icon: 'globe-outline', label: 'Website', onPress: openWebsite },
                  { icon: 'list-outline', label: 'Services', onPress: () => setShowServicesModal(true) },
                  { icon: 'share-social-outline', label: 'Share',
                    onPress: () => Share.share({ message: `${placeName}\n${placeAddr}`, title: placeName }).catch(() => {}) },
                  { icon: 'ellipsis-horizontal', label: 'More', onPress: () => setShowMoreModal(true) },
                ].map(a => (
                  <CircleAction key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} />
                ))}
              </View>

              {/* ── Extra photos ── */}
              {extraPhotos.length > 0 && (
                <View style={{ marginTop: 18 }}>
                  <Text style={[s.sectionTitle, { color: TEXT_PRI }]}>Photos</Text>
                  <NativeViewGestureHandler ref={photoScrollRef} disallowInterruption>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginHorizontal: -16 }}
                      contentContainerStyle={{ paddingLeft: 16, paddingRight: 24, gap: 10 }}
                    >
                      {extraPhotos.map((url, i) => (
                        <Image key={i} source={{ uri: url }} style={{ width: 200, height: 130, borderRadius: 14 }} />
                      ))}
                    </ScrollView>
                  </NativeViewGestureHandler>
                </View>
              )}

              {/* ── About ── */}
              <View style={{ marginTop: 18, marginBottom: 8 }}>
                <Text style={[s.sectionTitle, { color: TEXT_PRI }]}>About</Text>
                {detailsLoading ? (
                  <View style={[s.aboutCard, { backgroundColor: NAVY_CARD, alignItems: 'center', paddingVertical: 24 }]}>
                    <ActivityIndicator color={SEAFOAM} />
                    <Text style={{ color: TEXT_MUT, fontSize: 13, marginTop: 10 }}>Loading details…</Text>
                  </View>
                ) : (
                  <View style={[s.aboutCard, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]}>
                    {aboutRows.map((item, i) => (
                      <View key={i}>
                        <Pressable style={s.aboutRow} onPress={item.onPress ?? (() => {})}>
                          <Ionicons
                            name={item.icon as any}
                            size={16}
                            color={item.onPress ? SEAFOAM : TEXT_MUT}
                            style={{ marginTop: 2 }}
                          />
                          <Text style={[s.aboutText, { color: item.onPress ? SEAFOAM : TEXT_SUB }]}>{item.label}</Text>
                        </Pressable>
                        {i < aboutRows.length - 1 && (
                          <View style={[s.aboutDiv, { backgroundColor: DIVIDER }]} />
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

            </View>{/* end sheetContent */}
          </>
        </BottomSheetScrollView>

        {/* ── Services modal ── */}
        <Modal visible={showServicesModal} transparent animationType="slide" onRequestClose={() => setShowServicesModal(false)}>
          <Pressable style={hm.backdrop} onPress={() => setShowServicesModal(false)}>
            <Pressable style={[hm.card, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]} onPress={() => {}}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={[hm.title, { color: TEXT_PRI }]}>Services & Amenities</Text>
                <Pressable onPress={() => setShowServicesModal(false)}>
                  <Ionicons name="close" size={22} color={TEXT_MUT} />
                </Pressable>
              </View>
              {details?.types && details.types.length > 0 ? (
                <View style={{ backgroundColor: NAVY_ITEM, borderRadius: 16, overflow: 'hidden' }}>
                  {details.types.map((type, i) => (
                    <View key={type}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 }}>
                        <Ionicons name="checkmark-circle" size={18} color={SEAFOAM} />
                        <Text style={{ flex: 1, color: TEXT_PRI, fontSize: 14, fontWeight: '500' }}>
                          {type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </Text>
                      </View>
                      {i < details!.types!.length - 1 && <View style={{ height: 1, backgroundColor: DIVIDER, marginLeft: 46 }} />}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ color: TEXT_MUT, fontSize: 14 }}>No services information available.</Text>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── More modal ── */}
        <Modal visible={showMoreModal} transparent animationType="slide" onRequestClose={() => setShowMoreModal(false)}>
          <Pressable style={hm.backdrop} onPress={() => setShowMoreModal(false)}>
            <Pressable style={[hm.card, { backgroundColor: NAVY_CARD, borderWidth: 1, borderColor: GLASS_BORDER }]} onPress={() => {}}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={[hm.title, { color: TEXT_PRI }]}>More Options</Text>
                <Pressable onPress={() => setShowMoreModal(false)}>
                  <Ionicons name="close" size={22} color={TEXT_MUT} />
                </Pressable>
              </View>
              <View style={{ backgroundColor: NAVY_ITEM, borderRadius: 16, overflow: 'hidden' }}>
                {[
                  { icon: 'share-social-outline', label: 'Share',
                    onPress: () => { setShowMoreModal(false); Share.share({ message: `${placeName}\n${placeAddr}`, title: placeName }).catch(() => {}); } },
                  { icon: 'flag-outline', label: 'Report a Problem',
                    onPress: () => { setShowMoreModal(false); Alert.alert('Report', "Thanks for the report! We'll look into it."); } },
                  { icon: saved ? 'bookmark' : 'bookmark-outline', label: saved ? 'Saved to Bookmarks' : 'Add to Bookmarks',
                    iconColor: saved ? GOLD : SEAFOAM,
                    onPress: () => { setShowMoreModal(false); void handleSave(); } },
                  { icon: 'navigate-outline', label: 'Open in Maps',
                    onPress: () => { setShowMoreModal(false); if (details?.google_maps_uri) Linking.openURL(details.google_maps_uri); } },
                ].map((item, i) => (
                  <View key={item.label}>
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 15 }}
                      onPress={item.onPress}
                    >
                      <Ionicons name={item.icon as any} size={20} color={(item as any).iconColor ?? SEAFOAM} />
                      <Text style={{ flex: 1, color: TEXT_PRI, fontSize: 15, fontWeight: '500' }}>{item.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={TEXT_MUT} />
                    </Pressable>
                    {i < 3 && <View style={{ height: 1, backgroundColor: DIVIDER, marginLeft: 50 }} />}
                  </View>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>

      </BottomSheet>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ─── StyleSheets ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },

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

  floatBtnInner: { flex: 1, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  heatmapInner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1,
  },
  heatmapText: { fontSize: 12, fontWeight: '600' },

  sheetContent: { paddingHorizontal: 16, paddingTop: 14 },

  ratingNum: { fontSize: 14, fontWeight: '800' },

  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 4,
  },

  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10, letterSpacing: 0.2 },
  aboutCard: { borderRadius: 16, overflow: 'hidden' },
  aboutRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  aboutText: { flex: 1, fontSize: 13, lineHeight: 19 },
  aboutDiv: { height: 1, marginLeft: 42, marginBottom: 0 },
});

// ─── View Routes Button styles ────────────────────────────────────────────────
const vrb = StyleSheet.create({
  outer: {
    marginBottom: 16,
    alignSelf: 'stretch',
    // Deep soft black shadow — grounding, not glowing
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  gradient: {
    height: 52,
    borderRadius: 50,
    overflow: 'hidden',
    position: 'relative',
  },
  // 1px glassmorphism border — subtle white edge
  glassBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

// ─── Hero photo styles ────────────────────────────────────────────────────────
const hero = StyleSheet.create({
  wrap: {
    height: HERO_HEIGHT,
    borderRadius: FLOAT_RADIUS - 6,
    overflow: 'hidden',
    position: 'relative',
  },
  img: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  scrimTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 90,
  },
  scrimBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 100,
  },
  closeBtn: {
    position: 'absolute',
    top: 12, right: 12,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.50)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 10,
  },
  titleRow: {
    position: 'absolute', bottom: 14, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'flex-end',
  },
  title: {
    fontSize: 26, fontWeight: '800', color: TEXT_PRI,
    lineHeight: 30, letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  subtitle: {
    fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '500',
  },
});

// ─── Safety bar styles ────────────────────────────────────────────────────────
const safety = StyleSheet.create({
  wrap: {
    marginBottom: 16,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: 'rgba(26,188,147,0.07)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(26,188,147,0.18)',
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  label: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.8,
  },
  score: {
    fontSize: 11, fontWeight: '800',
  },
  track: {
    height: 5, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%', borderRadius: 3,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4,
  },
});

// ─── Circular action button styles ───────────────────────────────────────────
const action = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  circle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'transparent',
    borderWidth: 3, borderColor: GLASS_BORDER,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SEAFOAM, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  label: {
    fontSize: 11, color: TEXT_MUT, fontWeight: '500',
  },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────
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