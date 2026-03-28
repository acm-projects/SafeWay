import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView,
  Share, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, NativeViewGestureHandler } from 'react-native-gesture-handler';
import MapView, { Heatmap, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue, useAnimatedStyle, interpolate, Extrapolation,
} from 'react-native-reanimated';
import * as Location from 'expo-location';

import { createBookmark, deleteBookmark, getPlaceDetails, listBookmarks, searchPlaces } from '@/lib/api';
import type { PlaceDetails, PlaceSearchResult } from '@/lib/api';
import { bookmarkStore } from '@/lib/bookmarkStore';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-context';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';

// ─── Static design tokens (dark-only fallbacks for non-themed elements) ────────
const NAVY      = '#030427';
const NAVY_CARD = '#222344';
const NAVY_ITEM = '#2A2F5A';
const GREEN     = '#1ABC93';
const TEXT_PRI  = '#FFFFFF';
const TEXT_MUT  = '#7A8FA6';
const DIVIDER   = '#1E2D45';
const GOLD      = '#FFD700';
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
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c4a5a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#212a37' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283044' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
];

const FLOAT_SIDE   = 10;
const FLOAT_BOTTOM = 14;
const FLOAT_RADIUS = 24;

function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: bg ?? NAVY }, style]}
    />
  );
}

function StarRating({ rating, total }: { rating: number; total?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={rating >= i ? 'star' : rating >= i - 0.5 ? 'star-half' : 'star-outline'}
          size={14}
          color={GOLD}
        />
      ))}
      {total != null && (
        <Text style={{ color: TEXT_MUT, fontSize: 12, marginLeft: 2 }}>
          ({total.toLocaleString()})
        </Text>
      )}
    </View>
  );
}

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

  // Percentage-based max snap — reliable across all devices/densities.
  // Top card + buttons occupy ~28% from top; 72% height guarantees no overlap.
  const snapPoints = useMemo(() => {
    // Match directions: cap sheet so it never covers the top card + buttons
    const safeMax = windowHeight - (insets.top + 118) - 8;
    const miniSnap = 70 + insets.bottom;
    return [miniSnap, Math.round(windowHeight * 0.52), safeMax];
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

  // Destination search card state (mirrors directions.tsx)
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

  // Native gesture for horizontal photo scroll inside BottomSheet
  const photoScrollRef = useRef<NativeViewGestureHandler>(null);

  // Crash heatmap data
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

  // Check if already saved in bookmarkStore on mount
  useEffect(() => {
    const name = params.name ?? '';
    if (bookmarkStore.has(name)) setSaved(true);
  }, [params.name]);

  async function handleSave() {
    if (saved) {
      // Unsave — remove from store and backend
      const name = details?.name ?? params.name ?? '';
      bookmarkStore.remove(savedBookmarkId ?? name);
      setSaved(false);
      setSavedBookmarkId(null);
      if (jwt && savedBookmarkId && !savedBookmarkId.startsWith('local_')) {
        try { await deleteBookmark(jwt, savedBookmarkId); } catch {}
      }
      return;
    }
    // Save
    const title = details?.name ?? params.name ?? '';
    const address = details?.address ?? params.address ?? '';
    const localId = `local_${Date.now()}`;
    bookmarkStore.add({ id: localId, title, address, lat, lng, place_id: params.placeId });
    setSaved(true);
    setSavedBookmarkId(localId);
    if (jwt) {
      try {
        await createBookmark(jwt, { title, address, lat, lng });
      } catch {}
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

  const wrapperStyle = useAnimatedStyle(() => ({
    left:   FLOAT_SIDE,
    right:  FLOAT_SIDE,
    bottom: FLOAT_BOTTOM,
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
    // Handle overnight hours (e.g. 9:00 AM – 4:00 AM next day)
    if (closeMins <= openMins) {
      return cur >= openMins || cur < closeMins;
    }
    return cur >= openMins && cur < closeMins;
  })();

  // Show today's actual hours line (not always Monday)
  const todayHoursLine = (() => {
    if (!ohText) return '';
    const lines = ohText.split('\n');
    return lines.find(l => l.startsWith(todayName)) ?? lines[0] ?? '';
  })();

  const TOP_BTNS = insets.top + 118; // below the top route card

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
        <Marker coordinate={{ latitude: lat, longitude: lng }} pinColor={T.ACCENT} />
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

      {/* Back button */}
      <Pressable style={[s.backBtn, { top: insets.top + 10, backgroundColor: T.isDark ? 'rgba(11,17,32,0.9)' : T.CARD }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={T.TEXT_PRI} />
      </Pressable>

      {/* Top route card — exact same structure as directions.tsx */}
      <View style={[s.topRouteCard, { top: insets.top + 10, backgroundColor: T.CARD }]}>
        <View style={s.topRouteInner}>
          <View style={s.topRouteDotCol}>
            <View style={s.originDotSmall} />
            <View style={[s.topRouteLine, { backgroundColor: T.DIVIDER }]} />
            <Ionicons name="location" size={15} color="#FF5A5A" />
          </View>

          <View style={s.topRouteFields}>
            {/* Origin field */}
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
                  placeholderTextColor={T.TEXT_MUT}
                  autoFocus
                  style={[s.topRouteInput, { color: T.TEXT_PRI }]}
                  selectionColor={T.ACCENT}
                  onBlur={() => setEditingOrigin(false)}
                />
              ) : (
                <Text style={[s.topRouteLabel, { color: T.TEXT_PRI }]} numberOfLines={1}>{originLabel || currentAddress}</Text>
              )}
            </Pressable>

            <View style={[s.topFieldDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />

            {/* Destination field */}
            <Pressable style={s.topRouteField} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
              {editingDest ? (
                <TextInput
                  value={destQuery}
                  onChangeText={handleDestQueryChange}
                  placeholder="Destination…"
                  placeholderTextColor={T.TEXT_MUT}
                  autoFocus
                  style={[s.topRouteInput, { color: T.TEXT_PRI }]}
                  selectionColor={T.ACCENT}
                  onBlur={() => { if (!destSuggestions.length) setEditingDest(false); }}
                />
              ) : (
                <Text style={[s.topRouteLabel, { color: T.TEXT_PRI }]} numberOfLines={1}>{placeName}</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={[s.topRouteSwapBtn, { backgroundColor: T.ITEM }]}
            onPress={() => {
              setOriginLabel(placeName);
              router.replace({
                pathname: '/destination',
                params: { placeId: params.placeId, name: params.name, address: params.address, lat: params.lat, lng: params.lng },
              });
            }}
          >
            <Ionicons name="swap-vertical" size={18} color={T.TEXT_MUT} />
          </Pressable>
        </View>

        {editingOrigin && originSuggestions.length > 0 && (
          <View style={[s.topSuggList, { backgroundColor: T.ITEM }]}>
            {originSuggestions.map((sg, i) => (
              <View key={sg.place_id}>
                <Pressable style={s.topSuggRow} onPress={() => {
                  setOriginLabel(sg.name); setOriginQuery(sg.name);
                  setOriginCoords({ lat: sg.lat, lng: sg.lng });
                  setOriginSuggestions([]); setEditingOrigin(false);
                }}>
                  <Ionicons name="location-outline" size={14} color={T.ACCENT} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.topSuggTitle, { color: T.TEXT_PRI }]} numberOfLines={1}>{sg.name}</Text>
                    <Text style={[s.topSuggSub, { color: T.TEXT_MUT }]} numberOfLines={1}>{sg.address}</Text>
                  </View>
                </Pressable>
                {i < originSuggestions.length - 1 && <View style={[s.topSuggDiv, { backgroundColor: T.DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}

        {editingDest && destSuggestions.length > 0 && (
          <View style={[s.topSuggList, { backgroundColor: T.ITEM }]}>
            {destSuggestions.map((sg, i) => (
              <View key={sg.place_id}>
                <Pressable style={s.topSuggRow} onPress={() => {
                  setDestQuery(''); setDestSuggestions([]); setEditingDest(false);
                  router.replace({ pathname: '/destination', params: { placeId: sg.place_id, name: sg.name, address: sg.address, lat: String(sg.lat), lng: String(sg.lng) } });
                }}>
                  <Ionicons name="location-outline" size={14} color={T.ACCENT} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.topSuggTitle, { color: T.TEXT_PRI }]} numberOfLines={1}>{sg.name}</Text>
                    <Text style={[s.topSuggSub, { color: T.TEXT_MUT }]} numberOfLines={1}>{sg.address}</Text>
                  </View>
                </Pressable>
                {i < destSuggestions.length - 1 && <View style={[s.topSuggDiv, { backgroundColor: T.DIVIDER }]} />}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Locate / Center — fixed top-right below route card */}
      {/* Zoom — fixed top-right, matches directions layout */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS, borderRadius: 14, overflow: 'hidden', width: 42, backgroundColor: T.ITEM }}>
        <Pressable style={s.zoomBtn} onPress={() => doZoom(0.5)}><Ionicons name="add" size={22} color={T.TEXT_PRI} /></Pressable>
        <View style={[s.zoomDiv, { backgroundColor: T.DIVIDER }]} />
        <Pressable style={s.zoomBtn} onPress={() => doZoom(2)}><Ionicons name="remove" size={22} color={T.TEXT_PRI} /></Pressable>
      </View>

      {/* Locate — fixed below zoom */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 100, width: 42, height: 42, borderRadius: 21 }}>
        <Pressable style={[s.floatBtnInner, { backgroundColor: T.ITEM }]} onPress={handleCenter}>
          <Ionicons name="locate" size={20} color={T.ACCENT} />
        </Pressable>
      </View>

      {/* Heatmap pill — fixed below locate */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BTNS + 152 }}>
        <Pressable
          style={[s.heatmapInner, { backgroundColor: T.ITEM }, heatmapFilter !== 'off' && s.heatmapInnerActive]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={T.ACCENT} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapFilter !== 'off' ? (activeHeatmapInfo?.color ?? T.ACCENT) : T.ACCENT} />
          }
          {heatmapFilter !== 'off' && (
            <Text style={[s.heatmapText, { color: activeHeatmapInfo?.color ?? T.ACCENT }]}>
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
                const activeBg = '#030427';
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

      {/* Outer: static float position. Inner: static overflow:hidden clip — never re-triggers */}
      <Animated.View pointerEvents="box-none" style={{ position:'absolute', left:FLOAT_SIDE, right:FLOAT_SIDE, bottom:FLOAT_BOTTOM, top:0 }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { overflow:'hidden', borderRadius:FLOAT_RADIUS }]}>
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        enableDynamicSizing={false}
        animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bg={T.BG} />}
        handleIndicatorStyle={[s.handle, { backgroundColor: T.HANDLE }]}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={[s.sheetContent, { paddingBottom: insets.bottom + FLOAT_BOTTOM + 24 }]}
          scrollEnabled
        >
          <>
              {/* ── Header — centered, auto-shrink for long names ── */}
              <View style={s.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[s.placeName, { color: T.TEXT_PRI }]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >{placeName}</Text>
                  <View style={[s.subtitleRow, { marginTop: 6 }]}>
                    <Text style={[s.placeType, { color: T.TEXT_MUT }]}>{placeType}</Text>
                    {placeAddr ? (
                      <Text style={[s.placeType, { color: '#4A90E2' }]}>
                        {'  •  '}{placeAddr.split(',').slice(-2, -1)[0]?.trim()}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Pressable style={[s.closeBtn, { backgroundColor: T.ITEM }]} onPress={() => router.back()}>
                  <Ionicons name="close" size={18} color={T.TEXT_PRI} />
                </Pressable>
              </View>

              {/* ── Rating ── */}
              {details?.rating != null && (
                <View style={s.ratingRow}>
                  <Text style={[s.ratingNum, { color: T.TEXT_PRI }]}>{details.rating.toFixed(1)}</Text>
                  <StarRating rating={details.rating} total={details.user_ratings_total} />
                </View>
              )}

              {/* ── Hours ── */}
              {ohText ? (
                <View style={s.hoursRow}>
                  {isOpenNow !== null && (
                    <Text style={[s.openTag, { color: isOpenNow ? '#22C55E' : '#FF4444' }]}>
                      {isOpenNow ? 'Open' : 'Closed'}
                    </Text>
                  )}
                  {todayHoursLine ? (
                    <Text style={[s.hoursText, { color: T.TEXT_MUT }]} numberOfLines={1}>
                      {isOpenNow !== null ? '  •  ' : ''}{todayHoursLine}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* ── View Routes ── gradient with white border, left-aligned */}
              <Pressable
                style={[s.routesBtn, { borderWidth: 1.5, borderColor: '#FFFFFF' }]}
                onPress={() =>
                  router.push({
                    pathname: '/directions',
                    params: {
                      destLat: String(lat),
                      destLng: String(lng),
                      destName: placeName,
                      originAddress: originLabel || currentAddress,
                      ...(originCoords ? { originLat: String(originCoords.lat), originLng: String(originCoords.lng) } : {}),
                    },
                  })
                }
              >
                <LinearGradient
                  colors={['#4FA8A0', '#71BB81']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={s.routesBtnContent}>
                  <Ionicons name="navigate" size={18} color="#FFFFFF" />
                  <Text style={s.routesBtnText}>View Routes</Text>
                </View>
              </Pressable>

              {/* ── Action buttons ── */}
              <View style={s.actionRow}>
                {[
                  {
                    icon: 'call-outline',
                    label: 'Call',
                    onPress: () => {
                      if (details?.phone) Linking.openURL(`tel:${details.phone}`);
                      else Alert.alert('No phone number available');
                    },
                  },
                  { icon: 'globe-outline', label: 'Website', onPress: openWebsite },
                  { icon: 'list-outline',       label: 'Services', onPress: () => setShowServicesModal(true) },
                  { icon: 'ellipsis-horizontal', label: 'More',    onPress: () => setShowMoreModal(true) },
                ].map(a => (
                  <Pressable key={a.label} style={[s.actionBtn, { backgroundColor: T.ITEM, borderWidth: 1, borderColor: '#FFFFFF' }]} onPress={a.onPress}>
                    <Ionicons name={a.icon as any} size={22} color={T.TEXT_PRI} />
                    <Text style={[s.actionLabel, { color: T.TEXT_PRI }]}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>

              {/* ── Photos — NativeViewGestureHandler lets horizontal scroll work inside BottomSheet ── */}
              {details?.photo_urls && details.photo_urls.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={[s.sectionTitle, { color: T.TEXT_PRI }]}>Photos</Text>
                  <NativeViewGestureHandler ref={photoScrollRef} disallowInterruption>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginHorizontal: -16 }}
                      contentContainerStyle={{ paddingLeft: 16, paddingRight: 24, gap: 10 }}
                    >
                      {details.photo_urls.map((url, i) => (
                        <Image
                          key={i}
                          source={{ uri: url }}
                          style={{ width: 220, height: 150, borderRadius: 14 }}
                        />
                      ))}
                    </ScrollView>
                  </NativeViewGestureHandler>
                </View>
              )}

              {/* ── About ── */}
              <View style={{ marginTop: 16, marginBottom: 8 }}>
                <Text style={[s.sectionTitle, { color: T.TEXT_PRI }]}>About</Text>
                {detailsLoading ? (
                  <View style={[s.aboutCard, { backgroundColor: T.CARD, alignItems: 'center', paddingVertical: 24 }]}>
                    <ActivityIndicator color={T.ACCENT} />
                    <Text style={{ color: T.TEXT_MUT, fontSize: 13, marginTop: 10 }}>Loading details…</Text>
                  </View>
                ) : (
                  <View style={[s.aboutCard, { backgroundColor: T.CARD }]}>
                    {aboutRows.map((item, i) => (
                      <View key={i}>
                        <Pressable
                          style={s.aboutRow}
                          onPress={item.onPress ?? (() => {})}
                        >
                          <Ionicons name={item.icon as any} size={18} color={item.onPress ? T.ACCENT : T.TEXT_MUT} style={{ marginTop: 2 }} />
                          <Text style={[s.aboutText, { color: T.TEXT_MUT }, item.onPress && { color: T.ACCENT }]}>{item.label}</Text>
                        </Pressable>
                        {i < aboutRows.length - 1 && <View style={[s.aboutDiv, { backgroundColor: 'rgba(255,255,255,0.35)' }]} />}
                      </View>
                    ))}
                  </View>
                )}
              </View>
          </>
        </BottomSheetScrollView>

      {/* ── Services modal ── */}
      <Modal visible={showServicesModal} transparent animationType="slide" onRequestClose={() => setShowServicesModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowServicesModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: T.CARD }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={[hm.title, { color: T.TEXT_PRI }]}>Services & Amenities</Text>
              <Pressable onPress={() => setShowServicesModal(false)}>
                <Ionicons name="close" size={22} color={T.TEXT_MUT} />
              </Pressable>
            </View>
            {details?.types && details.types.length > 0 ? (
              <View style={{ backgroundColor: T.ITEM, borderRadius: 16, overflow: 'hidden' }}>
                {details.types.map((type, i) => (
                  <View key={type}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 }}>
                      <Ionicons name="checkmark-circle" size={18} color={T.ACCENT} />
                      <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 14, fontWeight: '500' }}>
                        {type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </Text>
                    </View>
                    {i < details!.types!.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 46 }} />}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{ color: T.TEXT_MUT, fontSize: 14 }}>No services information available.</Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── More modal ── */}
      <Modal visible={showMoreModal} transparent animationType="slide" onRequestClose={() => setShowMoreModal(false)}>
        <Pressable style={hm.backdrop} onPress={() => setShowMoreModal(false)}>
          <Pressable style={[hm.card, { backgroundColor: T.CARD }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={[hm.title, { color: T.TEXT_PRI }]}>More Options</Text>
              <Pressable onPress={() => setShowMoreModal(false)}>
                <Ionicons name="close" size={22} color={T.TEXT_MUT} />
              </Pressable>
            </View>
            <View style={{ backgroundColor: T.ITEM, borderRadius: 16, overflow: 'hidden' }}>
              {[
                { icon: 'share-social-outline', label: 'Share', iconColor: T.ACCENT, onPress: () => { setShowMoreModal(false); Share.share({ message: `${placeName}\n${placeAddr}`, title: placeName }).catch(() => {}); } },
                { icon: 'flag-outline', label: 'Report a Problem', iconColor: T.ACCENT, onPress: () => { setShowMoreModal(false); Alert.alert('Report', "Thanks for the report! We'll look into it."); } },
                { icon: saved ? 'bookmark' : 'bookmark-outline', label: saved ? 'Saved to Bookmarks' : 'Add to Bookmarks', iconColor: saved ? '#FFD700' : T.ACCENT, onPress: () => { setShowMoreModal(false); void handleSave(); } },
                { icon: 'navigate-outline', label: 'Open in Maps', iconColor: T.ACCENT, onPress: () => { setShowMoreModal(false); if (details?.google_maps_uri) Linking.openURL(details.google_maps_uri); } },
              ].map((item, i) => (
                <View key={item.label}>
                  <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 15 }} onPress={item.onPress}>
                    <Ionicons name={item.icon as any} size={20} color={item.iconColor} />
                    <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15, fontWeight: '500' }}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={T.TEXT_MUT} />
                  </Pressable>
                  {i < 3 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 50 }} />}
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
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
  floatBtn: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21 },
  floatBtnInner: {
    flex: 1, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center',
  },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, marginHorizontal: 8 },
  heatmapWrap: { position: 'absolute', right: 14 },
  heatmapInner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 22,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  heatmapInnerActive: { borderWidth: 1, borderColor: '#1ABC9340' },
  heatmapText: { fontSize: 12, fontWeight: '600' },
  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 2 },
  miniRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 8 },
  miniTitle: { flex: 1, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  miniClose: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  placeName: { fontSize: 28, fontWeight: '800', lineHeight: 30 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', marginTop: -30,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  placeType: { fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  ratingNum: { fontSize: 14, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  openTag: { fontSize: 13, fontWeight: '700' },
  hoursText: { flex: 1, fontSize: 13 },
  routesBtn: {
    height: 48, borderRadius: 16, overflow: 'hidden', marginBottom: 14,
    alignSelf: 'flex-start', minWidth: 180,
  },
  routesBtnContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24,
  },
  routesBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  actionBtn: {
    flex: 1, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 6,
  },
  actionLabel: { fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  aboutCard: { borderRadius: 16, overflow: 'hidden' },
  aboutRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  aboutText: { flex: 1, fontSize: 13, lineHeight: 18 },
  aboutDiv: { height: 1, marginLeft: 44, marginBottom: 2 },
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