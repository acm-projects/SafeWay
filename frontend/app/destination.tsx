import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, ActivityIndicator, Image, Linking, Pressable, ScrollView,
  StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Heatmap, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useSharedValue, useAnimatedStyle, interpolate, Extrapolation,
} from 'react-native-reanimated';
import * as Location from 'expo-location';

import { createBookmark, getPlaceDetails } from '@/lib/api';
import type { PlaceDetails } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const NAVY      = '#0B1120';
const NAVY_CARD = '#141D2E';
const NAVY_ITEM = '#1A2540';
const GREEN     = '#1ABC93';
const TEXT_PRI  = '#FFFFFF';
const TEXT_MUT  = '#7A8FA6';
const DIVIDER   = '#1E2D45';
const GOLD      = '#FFD700';
// ──────────────────────────────────────────────────────────────────────────────

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

function SheetBg({ style }: { style?: any }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: NAVY }, style]}
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
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const { height: windowHeight } = useWindowDimensions();
  const jwt = session?.access_token ?? '';

  const lat = parseFloat(params.lat ?? '0');
  const lng = parseFloat(params.lng ?? '0');

  const snapPoints = useMemo(() => ['12%', '48%', '90%'], []);
  const animatedPosition = useSharedValue(windowHeight);
  const [sheetIndex, setSheetIndex] = useState(1);
  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  const [details, setDetails]       = useState<PlaceDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [saved, setSaved]           = useState(false);
  const [zoomDelta, setZoomDelta] = useState(0.012);
  const [currentAddress, setCurrentAddress] = useState('My Location');
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);

  // Crash heatmap data — only fetches when toggled on
  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: 'all',
    enabled: heatmapEnabled,
    limit: 5_000,
  });

  // Reverse-geocode user's current position for the directions label
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
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

  // Fetch rich place details directly from Google Places API v1
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

  async function handleSave() {
    if (!jwt) { Alert.alert('Sign in to save places'); return; }
    try {
      await createBookmark(jwt, {
        title: details?.name ?? params.name,
        address: details?.address ?? params.address,
        lat, lng,
      });
      setSaved(true);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Error');
    }
  }

  // Open website in the device's default browser / Google app
  function openWebsite() {
    const url = details?.website;
    if (!url) {
      // Fallback: Google search for the place
      Linking.openURL(
        `https://www.google.com/search?q=${encodeURIComponent(params.name ?? '')}`,
      );
      return;
    }
    Linking.openURL(url).catch(() => {
      Linking.openURL(
        `https://www.google.com/search?q=${encodeURIComponent(params.name ?? '')}`,
      );
    });
  }

  const sheetBgStyle = useAnimatedStyle(() => {
    const h = windowHeight - animatedPosition.value;
    const lo = windowHeight * 0.10, hi = windowHeight * 0.50, full = windowHeight * 0.87;
    return {
      borderTopLeftRadius:     interpolate(h, [lo, hi], [26, 22], Extrapolation.CLAMP),
      borderTopRightRadius:    interpolate(h, [lo, hi], [26, 22], Extrapolation.CLAMP),
      borderBottomLeftRadius:  interpolate(h, [lo, hi], [22,  0], Extrapolation.CLAMP),
      borderBottomRightRadius: interpolate(h, [lo, hi], [22,  0], Extrapolation.CLAMP),
      marginLeft:  interpolate(h, [hi, full], [8, 0], Extrapolation.CLAMP),
      marginRight: interpolate(h, [hi, full], [8, 0], Extrapolation.CLAMP),
    };
  });

  const locateAnim  = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value + 60 }));
  const heatmapAnim = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value + 10 }));

  const placeName = details?.name    ?? params.name    ?? 'Place';
  const placeAddr = details?.address ?? params.address ?? '';
  const rawType   = details?.types?.[0] ?? '';
  const placeType = rawType
    ? rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Location';

  // Determine open/closed status
  const ohText = details?.opening_hours ?? '';
  const isOpenNow = ohText
    ? ohText.toLowerCase().includes('open now') ? true
      : ohText.toLowerCase().includes('closed') ? false
      : null
    : null;
  const firstHoursLine = ohText.split('\n')[0] ?? '';

  function handleCenter() {
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: zoomDelta, longitudeDelta: zoomDelta },
      400,
    );
  }

  // Build About rows from real API data
  const aboutRows: { icon: string; label: string; onPress?: () => void }[] = [];
  if (placeAddr) {
    aboutRows.push({ icon: 'location-outline', label: placeAddr });
  }
  if (ohText) {
    const lines = ohText.split('\n').filter(Boolean);
    aboutRows.push({
      icon: 'time-outline',
      label: lines.length > 1 ? lines.join('\n') : lines[0] ?? 'Hours not available',
    });
  } else if (!detailsLoading) {
    aboutRows.push({ icon: 'time-outline', label: 'Hours not available' });
  }
  if (details?.phone) {
    aboutRows.push({
      icon: 'call-outline',
      label: details.phone,
      onPress: () => Linking.openURL(`tel:${details!.phone!}`),
    });
  } else if (!detailsLoading) {
    aboutRows.push({ icon: 'call-outline', label: 'Phone not available' });
  }
  if (details?.website) {
    aboutRows.push({ icon: 'globe-outline', label: details.website, onPress: openWebsite });
  }
  if (details?.editorial_summary) {
    aboutRows.push({ icon: 'information-circle-outline', label: details.editorial_summary });
  }
  if (details?.google_maps_uri) {
    aboutRows.push({
      icon: 'map-outline',
      label: 'View on Google Maps',
      onPress: () => Linking.openURL(details!.google_maps_uri!),
    });
  }

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK_MAP_STYLE}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation
        showsMyLocationButton={false}
        scrollEnabled
        zoomEnabled
      >
        <Marker coordinate={{ latitude: lat, longitude: lng }} pinColor={GREEN} />
        {/* Real crash heatmap — only rendered when toggled on */}
        {heatmapEnabled && crashPoints.length > 0 && (
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

      {/* Back */}
      <Pressable style={[s.backBtn, { top: insets.top + 10 }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={TEXT_PRI} />
      </Pressable>

      {/* Locate / Center */}
      <Animated.View style={[s.floatBtn, locateAnim]}>
        <Pressable style={s.floatBtnInner} onPress={handleCenter}>
          <Ionicons name="navigate-outline" size={20} color={GREEN} />
        </Pressable>
      </Animated.View>

      {/* Heatmap pill — tap to toggle */}
      <Animated.View style={[s.heatmapWrap, heatmapAnim]}>
        <Pressable
          style={[s.heatmapInner, heatmapEnabled && s.heatmapInnerActive]}
          onPress={() => setHeatmapEnabled(e => !e)}
        >
          {crashLoading
            ? <ActivityIndicator size="small" color={GREEN} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapEnabled ? '#FF6B6B' : GREEN} />
          }
          <Text style={[s.heatmapText, heatmapEnabled && { color: '#FF6B6B' }]}>
            {heatmapEnabled
              ? crashPoints.length > 0
                ? `${crashPoints.length.toLocaleString()} crashes`
                : 'Loading…'
              : 'Safety Heatmap'
            }
          </Text>
        </Pressable>
      </Animated.View>

      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} />}
        handleIndicatorStyle={s.handle}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={[s.sheetContent, { paddingBottom: insets.bottom + 24 }]}
          scrollEnabled={sheetIndex === 2}
        >
          {sheetIndex === 0 ? (
            <View style={s.miniRow}>
              <Text style={s.miniTitle} numberOfLines={1}>{placeName}</Text>
              <Pressable style={s.miniClose} onPress={() => router.back()}>
                <Ionicons name="close" size={14} color={TEXT_PRI} />
              </Pressable>
            </View>
          ) : (
            <>
              {/* ── Header ── */}
              <View style={s.headerRow}>
                <Text style={s.placeName}>{placeName}</Text>
                <Pressable style={s.closeBtn} onPress={() => router.back()}>
                  <Ionicons name="close" size={18} color={TEXT_PRI} />
                </Pressable>
              </View>

              {/* ── Subtitle: type • city ── */}
              <View style={s.subtitleRow}>
                <Text style={s.placeType}>{placeType}</Text>
                {placeAddr ? (
                  <Text style={[s.placeType, { color: GREEN }]}>
                    {'  •  '}{placeAddr.split(',').slice(-2, -1)[0]?.trim()}
                  </Text>
                ) : null}
              </View>

              {/* ── Rating row ── */}
              {details?.rating != null && (
                <View style={s.ratingRow}>
                  <Text style={s.ratingNum}>{details.rating.toFixed(1)}</Text>
                  <StarRating rating={details.rating} total={details.user_ratings_total} />
                </View>
              )}

              {/* ── Hours status ── */}
              {ohText ? (
                <View style={s.hoursRow}>
                  {isOpenNow !== null && (
                    <Text style={[s.openTag, { color: isOpenNow ? GREEN : '#FF4444' }]}>
                      {isOpenNow ? 'Open' : 'Closed'}
                    </Text>
                  )}
                  {firstHoursLine ? (
                    <Text style={s.hoursText} numberOfLines={1}>
                      {isOpenNow !== null ? '  •  ' : ''}{firstHoursLine}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* ── View Routes — real gradient button ── */}
              <Pressable
                style={s.routesBtn}
                onPress={() =>
                  router.push({
                    pathname: '/directions',
                    params: {
                      destLat: String(lat),
                      destLng: String(lng),
                      destName: placeName,
                      originAddress: currentAddress,
                    },
                  })
                }
              >
                <LinearGradient
                  colors={['#0A9E6E', '#1ABC93', '#44D9B8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={s.routesBtnContent}>
                  <Ionicons name="navigate" size={18} color="#000" />
                  <Text style={s.routesBtnText}>View Routes</Text>
                </View>
              </Pressable>

              {/* ── Action buttons row ── */}
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
                  { icon: 'list-outline',       label: 'Services', onPress: () => {} },
                  { icon: 'ellipsis-horizontal', label: 'More',    onPress: () => {} },
                ].map(a => (
                  <Pressable key={a.label} style={s.actionBtn} onPress={a.onPress}>
                    <Ionicons name={a.icon as any} size={22} color={TEXT_PRI} />
                    <Text style={s.actionLabel}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>

              {/* ── Photos ── */}
              {details?.photo_urls && details.photo_urls.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={s.sectionTitle}>Photos</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginHorizontal: -16 }}
                  >
                    {details.photo_urls.map((url, i) => (
                      <Image
                        key={i}
                        source={{ uri: url }}
                        style={{
                          width: 180,
                          height: 130,
                          borderRadius: 14,
                          marginLeft: i === 0 ? 16 : 8,
                        }}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* ── About ── */}
              <View style={{ marginTop: 16, marginBottom: 8 }}>
                <Text style={s.sectionTitle}>About</Text>
                {detailsLoading ? (
                  <View style={[s.aboutCard, { alignItems: 'center', paddingVertical: 24 }]}>
                    <ActivityIndicator color={GREEN} />
                    <Text style={{ color: TEXT_MUT, fontSize: 13, marginTop: 10 }}>Loading details…</Text>
                  </View>
                ) : (
                  <View style={s.aboutCard}>
                    {aboutRows.map((item, i) => (
                      <View key={i}>
                        <Pressable
                          style={s.aboutRow}
                          onPress={item.onPress ?? (() => {})}
                        >
                          <Ionicons name={item.icon as any} size={18} color={item.onPress ? GREEN : TEXT_MUT} style={{ marginTop: 2 }} />
                          <Text style={[s.aboutText, item.onPress && { color: GREEN }]}>{item.label}</Text>
                        </Pressable>
                        {i < aboutRows.length - 1 && <View style={s.aboutDiv} />}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },
  backBtn: {
    position: 'absolute', left: 14, zIndex: 10,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(11,17,32,0.9)',
    justifyContent: 'center', alignItems: 'center',
  },
  floatBtn: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21 },
  floatBtnInner: {
    flex: 1, borderRadius: 21, backgroundColor: NAVY_ITEM,
    justifyContent: 'center', alignItems: 'center',
  },
  heatmapWrap: { position: 'absolute', right: 14 },
  heatmapInner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: NAVY_ITEM, borderRadius: 22,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  heatmapInnerActive: { borderColor: '#FF6B6B55', backgroundColor: '#1A1020' },
  heatmapText: { color: TEXT_PRI, fontSize: 12, fontWeight: '600' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#2A3A55' },
  sheetContent: { paddingHorizontal: 16, paddingTop: 8 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  miniTitle: { flex: 1, color: TEXT_PRI, fontSize: 15, fontWeight: '700' },
  miniClose: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: NAVY_ITEM,
    justifyContent: 'center', alignItems: 'center',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  placeName: { flex: 1, color: TEXT_PRI, fontSize: 24, fontWeight: '800', lineHeight: 30 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY_ITEM,
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  placeType: { color: TEXT_MUT, fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  ratingNum: { color: TEXT_PRI, fontSize: 14, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  openTag: { fontSize: 13, fontWeight: '700' },
  hoursText: { flex: 1, color: TEXT_MUT, fontSize: 13 },
  // Gradient button — overflow:hidden clips the absolute fill columns to borderRadius
  routesBtn: {
    height: 52,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  routesBtnContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  routesBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  actionBtn: {
    flex: 1, backgroundColor: NAVY_ITEM, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 6,
  },
  actionLabel: { color: TEXT_PRI, fontSize: 12, fontWeight: '500' },
  sectionTitle: { color: TEXT_PRI, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  aboutCard: { backgroundColor: NAVY_CARD, borderRadius: 16, overflow: 'hidden' },
  aboutRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  aboutText: { flex: 1, color: TEXT_MUT, fontSize: 13, lineHeight: 18 },
  aboutDiv: { height: 1, backgroundColor: DIVIDER, marginLeft: 44 },
});