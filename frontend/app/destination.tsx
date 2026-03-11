import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, ActivityIndicator, Image, Linking, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
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

import { createBookmark, getPlaceDetails, searchPlaces } from '@/lib/api';
import type { PlaceDetails, PlaceSearchResult } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import { palette, Gradients, Colors, MapStyles } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const GOLD = '#FFD700';

function SheetBg({ style, bgColor }: { style?: any; bgColor: string }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: bgColor }, style]}
    />
  );
}

function StarRating({ rating, total, secondaryColor }: { rating: number; total?: number; secondaryColor: string }) {
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
        <Text style={{ color: secondaryColor, fontSize: 12, marginLeft: 2 }}>
          ({total.toLocaleString()})
        </Text>
      )}
    </View>
  );
}

export default function DestinationScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  const params = useLocalSearchParams<{
    placeId: string; name: string; address: string; lat: string; lng: string;
  }>();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { height: windowHeight } = useWindowDimensions();
  const jwt = session?.access_token ?? '';

  const initialLat = parseFloat(params.lat ?? '0');
  const initialLng = parseFloat(params.lng ?? '0');

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

  // Origin/destination for route input card (Google Maps-style)
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [originLabel, setOriginLabel] = useState('My Location');
  const [originAddress, setOriginAddress] = useState('');
  const [originPlaceId, setOriginPlaceId] = useState('');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number }>({ lat: initialLat, lng: initialLng });
  const [destLabel, setDestLabel] = useState(params.name ?? 'Destination');
  const [destAddress, setDestAddress] = useState(params.address ?? '');
  const [destPlaceId, setDestPlaceId] = useState(params.placeId ?? '');
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [editingDest, setEditingDest] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSearchResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<PlaceSearchResult[]>([]);
  const [suggBusy, setSuggBusy] = useState(false);

  // Crash heatmap data — only fetches when toggled on
  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: 'all',
    enabled: heatmapEnabled,
    limit: 200_000,
  });

  // Reverse-geocode user's current position for origin label + coords
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
            const addr = parts.join(' ') || 'My Location';
            setCurrentAddress(addr);
            setOriginLabel(addr);
          }
        }
      } catch {}
    })();
  }, []);

  // Initialize destination from params on first load
  useEffect(() => {
    setDestCoords({ lat: initialLat, lng: initialLng });
    setDestLabel(params.name ?? 'Destination');
    setDestPlaceId(params.placeId ?? '');
  }, [params.placeId, params.name, params.lat, params.lng]);

  // Fetch rich place details when destination has a place ID
  useEffect(() => {
    if (destPlaceId) {
      setDetailsLoading(true);
      getPlaceDetails(destPlaceId)
        .then(d => { if (d) setDetails(d); })
        .catch(() => {})
        .finally(() => setDetailsLoading(false));
    } else {
      setDetails(null);
    }
    setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        400,
      );
    }, 400);
  }, [destPlaceId, destCoords.lat, destCoords.lng]);

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

  function handleSelectOrigin(place: PlaceSearchResult) {
    setOriginLabel(place.name);
    setOriginCoords({ lat: place.lat, lng: place.lng });
    setOriginPlaceId(place.place_id);
    setEditingOrigin(false);
    setOriginQuery('');
    setOriginSuggestions([]);
  }

  function handleSelectDest(place: PlaceSearchResult) {
    setDestLabel(place.name);
    setDestAddress(place.address);
    setDestCoords({ lat: place.lat, lng: place.lng });
    setDestPlaceId(place.place_id);
    setEditingDest(false);
    setDestQuery('');
    setDestSuggestions([]);
  }

  function handleSwapOriginDest() {
    const o = { label: originLabel, address: originAddress, coords: originCoords, placeId: originPlaceId };
    const d = { label: destLabel, address: destAddress, coords: destCoords, placeId: destPlaceId };
    setOriginLabel(d.label);
    setOriginAddress(d.address);
    setOriginCoords(d.coords);
    setOriginPlaceId(d.placeId);
    setDestLabel(o.label);
    setDestAddress(o.address);
    setDestCoords(o.coords ?? destCoords);
    setDestPlaceId(o.placeId);
    if (!o.placeId) setDetails(null);
  }

  function resetOriginToMyLocation() {
    setEditingOrigin(false);
    setOriginQuery('');
    setOriginSuggestions([]);
    setOriginLabel('My Location');
    setOriginAddress('');
    setOriginPlaceId('');
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          setOriginCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          const [geo] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          if (geo) {
            const parts = [geo.streetNumber, geo.street, geo.city].filter(Boolean);
            setOriginLabel(parts.join(' ') || 'My Location');
          }
        }
      } catch {}
    })();
  }

  async function handleSave() {
    if (!jwt) { Alert.alert('Sign in to save places'); return; }
    try {
      await createBookmark(jwt, {
        title: details?.name ?? destLabel,
        address: details?.address ?? destAddress,
        lat: destCoords.lat,
        lng: destCoords.lng,
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
      Linking.openURL(
        `https://www.google.com/search?q=${encodeURIComponent(destLabel ?? '')}`,
      );
      return;
    }
    Linking.openURL(url).catch(() => {
      Linking.openURL(
        `https://www.google.com/search?q=${encodeURIComponent(destLabel ?? '')}`,
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

  // Fixed top position so controls stay in map area and never cover sheet content
  const mapControlsTop = insets.top + 130;

  const placeName = details?.name    ?? destLabel       ?? 'Place';
  const placeAddr = details?.address ?? destAddress       ?? '';
  const rawType   = details?.types?.[0] ?? '';
  const placeType = rawType
    ? rawType.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
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
      { latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: zoomDelta, longitudeDelta: zoomDelta },
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
    <View style={[s.container, { backgroundColor: c.background }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={colorScheme === 'dark' ? MapStyles.dark : MapStyles.light}
        initialRegion={{ latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation
        showsMyLocationButton={false}
        scrollEnabled
        zoomEnabled
      >
        <Marker coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }} pinColor={palette.brightPurple} />
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

      {/* Origin / Destination — top of screen */}
      <View style={[s.topRouteCard, { top: insets.top + 10, backgroundColor: c.mapOverlay, borderColor: c.divider }]}>
        <View style={s.topRouteRows}>
          <View style={s.routeInputRow}>
            <View style={s.routeInputIcon}><View style={s.originDot} /></View>
            {editingOrigin ? (
              <View style={s.inlineSearchWrap}>
                <View style={[s.inlineInputRow, { backgroundColor: c.cardSolid }]}>
                  <TextInput
                    value={originQuery}
                    onChangeText={handleOriginQueryChange}
                    placeholder="Search starting point…"
                    placeholderTextColor={c.textSecondary}
                    autoFocus
                    style={[s.inlineInputText, { color: c.text }]}
                    selectionColor={palette.brightPurple}
                  />
                  {suggBusy ? <ActivityIndicator size="small" color={palette.brightPurple} /> : null}
                  <Pressable onPress={resetOriginToMyLocation}><Ionicons name="close-circle" size={18} color={c.textSecondary} /></Pressable>
                </View>
                {originSuggestions.length > 0 && (
                  <View style={[s.suggList, { backgroundColor: c.mapOverlay }]}>
                    {originSuggestions.map((place) => (
                      <Pressable key={place.place_id} style={s.suggRow} onPress={() => handleSelectOrigin(place)}>
                        <Ionicons name="location-outline" size={14} color={palette.brightPurple} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.suggTitle, { color: c.text }]} numberOfLines={1}>{place.name}</Text>
                          <Text style={[s.suggSub, { color: c.textSecondary }]} numberOfLines={1}>{place.address}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Pressable style={s.routeInputLabelWrap} onPress={() => { setEditingDest(false); setEditingOrigin(true); setOriginQuery(''); }}>
                <Text style={[s.routeInputLabel, { color: c.text }]} numberOfLines={1}>{originLabel}</Text>
                <Pressable onPress={(e) => { e.stopPropagation(); resetOriginToMyLocation(); }} hitSlop={8}><Ionicons name="close-circle-outline" size={18} color={c.textSecondary} /></Pressable>
              </Pressable>
            )}
          </View>

          <View style={s.routeInputRow}>
            <View style={s.routeInputIcon}><Ionicons name="location" size={18} color={palette.brightPurple} /></View>
            {editingDest ? (
              <View style={s.inlineSearchWrap}>
                <View style={[s.inlineInputRow, { backgroundColor: c.cardSolid }]}>
                  <TextInput
                    value={destQuery}
                    onChangeText={handleDestQueryChange}
                    placeholder="Search destination…"
                    placeholderTextColor={c.textSecondary}
                    autoFocus
                    style={[s.inlineInputText, { color: c.text }]}
                    selectionColor={palette.brightPurple}
                  />
                  {suggBusy ? <ActivityIndicator size="small" color={palette.brightPurple} /> : null}
                  <Pressable onPress={() => { setEditingDest(false); setDestSuggestions([]); }}><Ionicons name="close-circle" size={18} color={c.textSecondary} /></Pressable>
                </View>
                {destSuggestions.length > 0 && (
                  <View style={[s.suggList, { backgroundColor: c.mapOverlay }]}>
                    {destSuggestions.map((place) => (
                      <Pressable key={place.place_id} style={s.suggRow} onPress={() => handleSelectDest(place)}>
                        <Ionicons name="location-outline" size={14} color={palette.brightPurple} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.suggTitle, { color: c.text }]} numberOfLines={1}>{place.name}</Text>
                          <Text style={[s.suggSub, { color: c.textSecondary }]} numberOfLines={1}>{place.address}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Pressable style={s.routeInputLabelWrap} onPress={() => { setEditingOrigin(false); setEditingDest(true); setDestQuery(''); }}>
                <Text style={[s.routeInputLabel, { color: c.text }]} numberOfLines={1}>{destLabel}</Text>
                <Pressable onPress={(e) => { e.stopPropagation(); setEditingDest(true); setDestQuery(''); }} hitSlop={8}><Ionicons name="create-outline" size={18} color={c.textSecondary} /></Pressable>
              </Pressable>
            )}
          </View>
        </View>
        <Pressable style={s.swapBtnRight} onPress={handleSwapOriginDest}>
          <Ionicons name="swap-vertical" size={20} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* Back */}
      <Pressable style={[s.backBtn, { top: insets.top + 10, backgroundColor: c.mapOverlay }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={20} color={c.text} />
      </Pressable>

      {/* Map controls */}
      <View style={[s.mapControlsColumn, { top: mapControlsTop }]}>
        <Pressable style={[s.floatBtnInner, { backgroundColor: c.mapOverlay }]} onPress={handleCenter}>
          <Ionicons name="navigate-outline" size={20} color={palette.brightPurple} />
        </Pressable>
        <Pressable
          style={[s.floatBtnInner, { backgroundColor: c.mapOverlay }, heatmapEnabled && { borderWidth: 1.5, borderColor: palette.brightPurple + '60' }]}
          onPress={() => setHeatmapEnabled(e => !e)}
        >
          {crashLoading
            ? <ActivityIndicator size="small" color={palette.brightPurple} style={{ width: 14 }} />
            : <Ionicons name="layers-outline" size={16} color={heatmapEnabled ? '#FF6B6B' : palette.brightPurple} />
          }
        </Pressable>
      </View>

      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bgColor={c.background} />}
        handleIndicatorStyle={[s.handle, { backgroundColor: palette.brightPurple + '40' }]}
        enablePanDownToClose={false}
      >
        <BottomSheetScrollView
          contentContainerStyle={[s.sheetContent, { paddingBottom: Math.max(insets.bottom, 12) + 100 }]}
          scrollEnabled={sheetIndex === 2}
        >
          {sheetIndex === 0 ? (
            <View style={s.miniRow}>
              <Text style={[s.miniTitle, { color: c.text }]} numberOfLines={1}>{placeName}</Text>
              <Pressable style={[s.miniClose, { backgroundColor: c.cardSolid }]} onPress={() => router.back()}>
                <Ionicons name="close" size={14} color={c.text} />
              </Pressable>
            </View>
          ) : (
            <>
              <View style={s.headerRow}>
                <Text style={[s.placeName, { color: c.text }]}>{placeName}</Text>
                <Pressable style={[s.closeBtn, { backgroundColor: c.cardSolid }]} onPress={() => router.back()}>
                  <Ionicons name="close" size={18} color={c.text} />
                </Pressable>
              </View>

              <View style={s.subtitleRow}>
                <Text style={[s.placeType, { color: c.textSecondary }]}>{placeType}</Text>
                {placeAddr ? (
                  <Text style={[s.placeType, { color: palette.brightPurple }]}>
                    {'  •  '}{placeAddr.split(',').slice(-2, -1)[0]?.trim()}
                  </Text>
                ) : null}
              </View>

              {details?.rating != null && (
                <View style={s.ratingRow}>
                  <Text style={[s.ratingNum, { color: c.text }]}>{details.rating.toFixed(1)}</Text>
                  <StarRating rating={details.rating} total={details.user_ratings_total} secondaryColor={c.textSecondary} />
                </View>
              )}

              {ohText ? (
                <View style={s.hoursRow}>
                  {isOpenNow !== null && (
                    <Text style={[s.openTag, { color: isOpenNow ? palette.teal : palette.danger }]}>
                      {isOpenNow ? 'Open' : 'Closed'}
                    </Text>
                  )}
                  {firstHoursLine ? (
                    <Text style={[s.hoursText, { color: c.textSecondary }]} numberOfLines={1}>
                      {isOpenNow !== null ? '  •  ' : ''}{firstHoursLine}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                style={s.routesBtn}
                onPress={() => {
                  if (!originCoords) return;
                  router.push({
                    pathname: '/directions',
                    params: {
                      destLat: String(destCoords.lat),
                      destLng: String(destCoords.lng),
                      destName: destLabel,
                      originAddress: originLabel,
                      originLat: String(originCoords.lat),
                      originLng: String(originCoords.lng),
                    },
                  });
                }}
                disabled={!originCoords}
              >
                <LinearGradient
                  colors={[...Gradients.button]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={s.routesBtnContent}>
                  <Ionicons name="navigate" size={18} color="#FFFFFF" />
                  <Text style={s.routesBtnText}>View Routes</Text>
                </View>
              </Pressable>

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
                  <Pressable key={a.label} style={[s.actionBtn, { backgroundColor: c.cardSolid }]} onPress={a.onPress}>
                    <Ionicons name={a.icon as any} size={22} color={c.text} />
                    <Text style={[s.actionLabel, { color: c.text }]}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>

              {details?.photo_urls && details.photo_urls.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={[s.sectionTitle, { color: c.text }]}>Photos</Text>
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

              <View style={{ marginTop: 16, marginBottom: 8 }}>
                <Text style={[s.sectionTitle, { color: c.text }]}>About</Text>
                {detailsLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: c.cardSolid, borderRadius: 14 }}>
                    <ActivityIndicator color={palette.brightPurple} />
                    <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 10 }}>Loading details…</Text>
                  </View>
                ) : (
                  <View style={{ overflow: 'hidden', backgroundColor: c.cardSolid, borderRadius: 14 }}>
                    {aboutRows.map((item, i) => (
                      <View key={i}>
                        <Pressable
                          style={s.aboutRow}
                          onPress={item.onPress ?? (() => {})}
                        >
                          <Ionicons name={item.icon as any} size={18} color={item.onPress ? palette.brightPurple : c.textSecondary} style={{ marginTop: 2 }} />
                          <Text style={[s.aboutText, { color: c.textSecondary }, item.onPress && { color: palette.brightPurple }]}>{item.label}</Text>
                        </Pressable>
                        {i < aboutRows.length - 1 && <View style={[s.aboutDiv, { backgroundColor: c.divider }]} />}
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
  container: { flex: 1 },
  backBtn: {
    position: 'absolute', left: 14, zIndex: 10,
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  mapControlsColumn: { position: 'absolute', right: 14, flexDirection: 'column', gap: 8 },
  floatBtnInner: {
    width: 42, height: 42, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center',
  },
  handle: { width: 36, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 8 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  miniTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  miniClose: {
    width: 26, height: 26, borderRadius: 13,
    justifyContent: 'center', alignItems: 'center',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  placeName: { flex: 1, fontSize: 24, fontWeight: '800', lineHeight: 30 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  placeType: { fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  ratingNum: { fontSize: 14, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  openTag: { fontSize: 13, fontWeight: '700' },
  hoursText: { flex: 1, fontSize: 13 },
  topRouteCard: {
    position: 'absolute',
    left: 56,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
    zIndex: 10,
  },
  topRouteRows: { flex: 1 },
  routeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  routeInputIcon: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  originDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.royalBlue, borderWidth: 2, borderColor: 'rgba(59,130,246,0.4)' },
  routeInputLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  routeInputLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  swapBtnRight: { padding: 8, justifyContent: 'center' },
  inlineSearchWrap: { flex: 1, marginBottom: 4 },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
  inlineInputText: { flex: 1, fontSize: 14 },
  suggList: { borderRadius: 12, overflow: 'hidden', marginBottom: 4 },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  suggTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  suggSub: { fontSize: 11, marginTop: 1 },
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
  routesBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  actionBtn: {
    flex: 1, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', gap: 6,
  },
  actionLabel: { fontSize: 12, fontWeight: '500' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  aboutRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  aboutText: { flex: 1, fontSize: 13, lineHeight: 18 },
  aboutDiv: { height: 1, marginLeft: 44 },
});