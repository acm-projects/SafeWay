import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import Animated, {
  useAnimatedStyle, useSharedValue, interpolate, Extrapolation,
} from 'react-native-reanimated';

import { listBookmarks, deleteBookmark, getWeather, createBookmark, searchPlaces } from '@/lib/api';
import type { Bookmark, WeatherData } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const NAVY       = '#0B1120';
const NAVY_CARD  = '#141D2E';
const NAVY_ITEM  = '#1A2540';
const BLUE_ICON  = '#2A3F6F';
const GREEN      = '#1ABC93';
const TEXT_PRI   = '#FFFFFF';
const TEXT_MUT   = '#7A8FA6';
const DIVIDER    = '#1E2D45';
// ──────────────────────────────────────────────────────────────────────────────

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

// Map style options for heatmap chooser
const MAP_STYLES = [
  { id: 'default',  label: 'Default',  icon: 'map-outline' as const },
  { id: 'safety',   label: 'Safety',   icon: 'shield-checkmark-outline' as const },
  { id: 'traffic',  label: 'Traffic',  icon: 'car-outline' as const },
  { id: 'terrain',  label: 'Terrain',  icon: 'earth-outline' as const },
];

function SheetBg({ style }: { style?: any }) {
  return (
    <Animated.View pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: NAVY }, style]} />
  );
}

// ── Profile modal ──────────────────────────────────────────────────────────────
function ProfileModal({ visible, onClose, user, signOut }: {
  visible: boolean; onClose: () => void; user: any; signOut: () => void;
}) {
  const initials    = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Guest';
  const email       = user?.email ?? '';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pm.backdrop} onPress={onClose}>
        <Pressable style={pm.card} onPress={() => {}}>
          <Pressable style={pm.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={18} color={TEXT_PRI} />
          </Pressable>
          <View style={pm.avatar}><Text style={pm.avatarText}>{initials}</Text></View>
          <Text style={pm.name}>{displayName}</Text>
          <Text style={pm.email}>{email}</Text>
          <View style={pm.menu}>
            {[
              { icon: 'bookmark-outline', label: 'Places', value: '0', color: '#5E5CE6' },
              { icon: 'flag-outline', label: 'Reports', color: '#FF453A' },
              { icon: 'map-outline', label: 'Offline Maps', value: 'Download', color: '#636366' },
            ].map((item, i) => (
              <View key={item.label}>
                <Pressable style={pm.row}>
                  <View style={[pm.rowIcon, { backgroundColor: item.color }]}>
                    <Ionicons name={item.icon as any} size={18} color="#fff" />
                  </View>
                  <Text style={pm.rowLabel}>{item.label}</Text>
                  {item.value && <Text style={pm.rowValue}>{item.value}</Text>}
                  <Ionicons name="chevron-forward" size={16} color={TEXT_MUT} />
                </Pressable>
                {i < 2 && <View style={pm.div} />}
              </View>
            ))}
            <View style={pm.div} />
            <Pressable style={pm.row} onPress={() => { onClose(); signOut(); }}>
              <View style={[pm.rowIcon, { backgroundColor: '#2C2C2E' }]}>
                <Ionicons name="log-out-outline" size={18} color={GREEN} />
              </View>
              <Text style={pm.rowLabel}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={16} color={TEXT_MUT} />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Heatmap chooser modal ──────────────────────────────────────────────────────
function HeatmapModal({ visible, selected, onSelect, onClose }: {
  visible: boolean; selected: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={hm.backdrop} onPress={onClose}>
        <Pressable style={hm.card} onPress={() => {}}>
          <Text style={hm.title}>Choose Map</Text>
          <View style={hm.grid}>
            {MAP_STYLES.map(s => (
              <Pressable
                key={s.id}
                style={[hm.tile, selected === s.id && hm.tileActive]}
                onPress={() => { onSelect(s.id); onClose(); }}>
                <View style={hm.tilePreview}>
                  <Ionicons name={s.icon} size={28} color={selected === s.id ? GREEN : TEXT_MUT} />
                </View>
                <Text style={[hm.tileLabel, selected === s.id && { color: GREEN }]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Place type → icon + color ─────────────────────────────────────────────────
function placeIconFor(title: string): { icon: string; bg: string } {
  const t = title.toLowerCase();
  if (t.includes('university') || t.includes('college') || t.includes('school'))
    return { icon: 'school-outline', bg: '#3A7BD5' };
  if (t.includes('restaurant') || t.includes('food') || t.includes('burger') || t.includes('pizza') || t.includes('kitchen') || t.includes('grill'))
    return { icon: 'restaurant-outline', bg: '#E05C5C' };
  if (t.includes('coffee') || t.includes('cafe') || t.includes('starbucks'))
    return { icon: 'cafe-outline', bg: '#A0522D' };
  if (t.includes('smoothie') || t.includes('juice') || t.includes('boba'))
    return { icon: 'nutrition-outline', bg: '#C06090' };
  if (t.includes('gas') || t.includes('fuel') || t.includes('shell') || t.includes('chevron'))
    return { icon: 'car-outline', bg: '#5A8A5A' };
  if (t.includes('park') || t.includes('trail') || t.includes('nature'))
    return { icon: 'leaf-outline', bg: '#4A9A4A' };
  if (t.includes('hospital') || t.includes('medical') || t.includes('clinic') || t.includes('urgent'))
    return { icon: 'medical-outline', bg: '#E05C5C' };
  if (t.includes('library') || t.includes('museum'))
    return { icon: 'library-outline', bg: '#3A7BD5' };
  if (t.includes('target') || t.includes('walmart') || t.includes('costco') || t.includes('store') || t.includes('shop') || t.includes('market') || t.includes('wholesale'))
    return { icon: 'cart-outline', bg: '#C05050' };
  if (t.includes('hotel') || t.includes('inn') || t.includes('motel'))
    return { icon: 'bed-outline', bg: '#7A5FC4' };
  if (t.includes('airport') || t.includes('flight'))
    return { icon: 'airplane-outline', bg: '#4A7AB5' };
  if (t.includes('gym') || t.includes('fitness'))
    return { icon: 'barbell-outline', bg: '#E08030' };
  return { icon: 'location-outline', bg: '#4A5FC4' };
}

export default function HomeScreen() {
  const { session, user, isLoading, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const jwt = session?.access_token ?? '';
  const { height: windowHeight } = useWindowDimensions();

  const snapPoints = useMemo(() => ['14%', '52%', '90%'], []);
  const animatedPosition = useSharedValue(windowHeight);

  const [userLocation, setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [selectedMap, setSelectedMap]       = useState('default');
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

  useEffect(() => {
    let cancelled = false;
    // Hard fallback: always clear loading after 4s no matter what
    const hardTimeout = setTimeout(() => {
      if (!cancelled) setLocationLoading(false);
    }, 4000);
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
      try {
        const w = await getWeather(userLocation.lat, userLocation.lng);
        setWeather(w);
      } catch {
        // Backend not reachable — skip weather silently
      }
    })();
  }, [userLocation]);

  useEffect(() => {
    if (!jwt) { setBookmarks([]); return; }
    void loadBookmarks();
  }, [jwt]);

  async function loadBookmarks() {
    try {
      const bms = await listBookmarks(jwt);
      setBookmarks(bms);
    } catch {
      // Backend not reachable — show empty state
      setBookmarks([]);
    }
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
    const c = userLocation ?? { lat: 40.7291, lng: -73.9965 };
    mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }
  function handleZoomOut() {
    const d = Math.min(zoomLevel * 2, 1.5); setZoomLevel(d);
    const c = userLocation ?? { lat: 40.7291, lng: -73.9965 };
    mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
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

  const TAB_H = 0;
  const zoomAnim    = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value - TAB_H + 116 }));
  const locateAnim  = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value - TAB_H + 60  }));
  const heatmapAnim = useAnimatedStyle(() => ({ bottom: windowHeight - animatedPosition.value - TAB_H + 10  }));

  const mapRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.06, longitudeDelta: 0.06 };

  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : null;
  const recents = bookmarks.slice(0, 5);

  const shortcuts = [
    { key: 'home',   icon: 'home',       label: 'Home',   sub: homeLabel,   modal: 'home'   as const },
    { key: 'work',   icon: 'briefcase',  label: 'Work',   sub: workLabel,   modal: 'work'   as const },
    { key: 'school', icon: 'school',     label: 'School', sub: schoolLabel, modal: 'school' as const },
  ];

  if (isLoading || locationLoading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={GREEN} />
        <Text style={s.loadingText}>Loading SafeWay…</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE} initialRegion={mapRegion}
        showsUserLocation showsMyLocationButton={false}
        customMapStyle={DARK_MAP_STYLE}>
        {bookmarks.map(bm => (
          <Marker key={bm.id} coordinate={{ latitude: bm.lat, longitude: bm.lng }}
            title={bm.title} description={bm.address} pinColor={GREEN} />
        ))}
      </MapView>

      {/* Zoom */}
      <Animated.View style={[s.zoomWrap, zoomAnim]}>
        <Pressable style={s.zoomBtn} onPress={handleZoomIn}><Ionicons name="add" size={22} color={TEXT_PRI} /></Pressable>
        <View style={s.zoomDiv} />
        <Pressable style={s.zoomBtn} onPress={handleZoomOut}><Ionicons name="remove" size={22} color={TEXT_PRI} /></Pressable>
      </Animated.View>

      {/* Locate */}
      <Animated.View style={[s.floatBtn, locateAnim]}>
        <Pressable style={s.floatBtnInner} onPress={handleMyLocation}>
          <Ionicons name="locate" size={20} color={GREEN} />
        </Pressable>
      </Animated.View>

      {/* Heatmap pill */}
      <Animated.View style={[s.heatmapWrap, heatmapAnim]}>
        <Pressable style={s.heatmapInner} onPress={() => setShowHeatmapModal(true)}>
          <Ionicons name="layers-outline" size={14} color={GREEN} />
          <Text style={s.heatmapText}>Safety Heatmap</Text>
        </Pressable>
      </Animated.View>

      {/* Profile modal */}
      <ProfileModal visible={showProfileModal} onClose={() => setShowProfileModal(false)} user={user} signOut={signOut} />

      {/* Heatmap chooser */}
      <HeatmapModal visible={showHeatmapModal} selected={selectedMap}
        onSelect={setSelectedMap} onClose={() => setShowHeatmapModal(false)} />

      {/* Home/Work/School picker */}
      <Modal visible={placeModal !== null} transparent animationType="slide"
        onRequestClose={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
        <Pressable style={hw.backdrop} onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
          <Pressable style={hw.card} onPress={() => {}}>
            <View style={hw.header}>
              <Text style={hw.title}>Set {placeModal === 'home' ? 'Home' : placeModal === 'work' ? 'Work' : 'School'}</Text>
              <Pressable onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
                <Ionicons name="close" size={20} color={TEXT_PRI} />
              </Pressable>
            </View>
            <View style={hw.inputWrap}>
              <Ionicons name="search" size={16} color={GREEN} />
              <TextInput value={placeQuery} onChangeText={handlePlaceQueryChange}
                placeholder="Search address…" placeholderTextColor={TEXT_MUT}
                autoFocus style={hw.input} selectionColor={GREEN} />
              {placeBusy && <ActivityIndicator size="small" color={GREEN} />}
            </View>
            {placeSugg.length > 0 && (
              <View style={hw.suggList}>
                {placeSugg.map((s, i) => (
                  <View key={s.place_id}>
                    <Pressable style={hw.suggRow} onPress={() => handleSavePlace(s)}>
                      <Ionicons name="location-outline" size={16} color={GREEN} />
                      <View style={{ flex: 1 }}>
                        <Text style={hw.suggTitle} numberOfLines={1}>{s.name}</Text>
                        <Text style={hw.suggSub} numberOfLines={1}>{s.address}</Text>
                      </View>
                    </Pressable>
                    {i < placeSugg.length - 1 && <View style={hw.div} />}
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
        handleIndicatorStyle={s.handle} enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={[s.sheetContent, { paddingBottom: insets.bottom + 24 }]}
          scrollEnabled={sheetIndex === 2}>

          {/* Search row */}
          <View style={s.searchRow}>
            <Pressable style={s.searchBar} onPress={() => router.push('/search')}>
              <Ionicons name="search" size={16} color={TEXT_MUT} />
              <Text style={s.searchPlaceholder}>Where to?</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="mic-outline" size={18} color={TEXT_MUT} />
            </Pressable>
            <Pressable style={s.avatar} onPress={() => setShowProfileModal(true)}>
              {userInitials
                ? <Text style={s.avatarText}>{userInitials}</Text>
                : <Ionicons name="person-outline" size={18} color={TEXT_PRI} />}
            </Pressable>
          </View>

          {sheetIndex >= 1 && (
            <>
              {/* BOOKMARKED LOCATIONS */}
              <Text style={s.sectionLabel}>BOOKMARKED LOCATIONS</Text>
              <View style={s.bookmarkCard}>
                <Text style={s.placesCount}>{bookmarks.length} Places</Text>
                <View style={s.cardDivider} />
                {user ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    nestedScrollEnabled directionalLockEnabled={false}
                    contentContainerStyle={s.shortcutRow}>
                    {shortcuts.map(sc => (
                      <Pressable key={sc.key} style={s.shortcut}
                        onPress={() => { setPlaceModal(sc.modal); setPlaceQuery(''); setPlaceSugg([]); }}>
                        <View style={[s.shortcutCircle, sc.sub && { borderWidth: 2.5, borderColor: GREEN }]}>
                          <Ionicons name={sc.icon as any} size={26} color="#4A5FC4" />
                        </View>
                        <Text style={s.shortcutLabel}>{sc.label}</Text>
                        <Text style={s.shortcutSub} numberOfLines={1}>{sc.sub ?? 'Add'}</Text>
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
                          <Ionicons name="bookmark-outline" size={22} color="#4A5FC4" />
                        </View>
                        <Text style={s.shortcutLabel} numberOfLines={1}>{bm.title}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={s.shortcut} onPress={() => router.push('/search')}>
                      <View style={[s.shortcutCircle, { backgroundColor: '#D8DCF0' }]}>
                        <Ionicons name="add" size={28} color="#4A5FC4" />
                      </View>
                      <Text style={s.shortcutLabel}>Add</Text>
                    </Pressable>
                  </ScrollView>
                ) : (
                  <Pressable style={s.loginBtn} onPress={() => router.push('/login')}>
                    <Ionicons name="log-in-outline" size={16} color={GREEN} />
                    <Text style={s.loginBtnText}>Log in to save places</Text>
                  </Pressable>
                )}
              </View>

              {/* RECENTS */}
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>RECENTS</Text>
              <View style={s.recentCard}>
                {recents.length > 0 ? recents.map((bm, i) => {
                const { icon, bg } = placeIconFor(bm.title);
                return (
                  <View key={bm.id}>
                    <Pressable style={s.recentRow}
                      onPress={() => router.push({ pathname: '/destination', params: { placeId: bm.id, name: bm.title, address: bm.address ?? '', lat: String(bm.lat), lng: String(bm.lng) } })}>
                      <View style={[s.recentIconWrap, { backgroundColor: bg }]}>
                        <Ionicons name={icon as any} size={18} color="#fff" />
                      </View>
                      <View style={s.recentContent}>
                        <Text style={s.recentTitle}>{bm.title}</Text>
                        {bm.address ? <Text style={s.recentSub} numberOfLines={1}>{bm.address}</Text> : null}
                      </View>
                    </Pressable>
                    {i < recents.length - 1 && <View style={s.rowDiv} />}
                  </View>
                );
              }) : (
                  <View style={s.recentRow}>
                    <Text style={s.emptyText}>No recent places yet</Text>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: NAVY },
  loadingText: { marginTop: 16, color: GREEN, fontSize: 14, fontWeight: '500' },

  zoomWrap: { position: 'absolute', right: 14, backgroundColor: NAVY_ITEM, borderRadius: 14, overflow: 'hidden', width: 42 },
  zoomBtn: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
  zoomDiv: { height: 1, backgroundColor: '#2A3A55', marginHorizontal: 8 },
  floatBtn: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21 },
  floatBtnInner: { flex: 1, borderRadius: 21, backgroundColor: NAVY_ITEM, justifyContent: 'center', alignItems: 'center' },
  heatmapWrap: { position: 'absolute', right: 14 },
  heatmapInner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: NAVY_ITEM, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8 },
  heatmapText: { color: TEXT_PRI, fontSize: 12, fontWeight: '600' },

  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#2A3A55' },
  sheetContent: { paddingHorizontal: 16, paddingTop: 10 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: NAVY_CARD, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 13 },
  searchPlaceholder: { color: TEXT_MUT, fontSize: 15, flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3A4A60', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: TEXT_PRI, fontSize: 14, fontWeight: '700' },

  sectionLabel: { color: TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },

  bookmarkCard: { backgroundColor: NAVY_CARD, borderRadius: 18, paddingTop: 14, paddingBottom: 14, overflow: 'visible' },
  placesCount: { color: TEXT_PRI, fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginBottom: 10 },
  cardDivider: { height: 1, backgroundColor: DIVIDER, marginBottom: 16 },
  shortcutRow: { paddingHorizontal: 16, gap: 20, paddingBottom: 4 },
  shortcut: { alignItems: 'center', gap: 6, minWidth: 60 },
  shortcutCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E8ECF8', justifyContent: 'center', alignItems: 'center' },
  shortcutLabel: { color: TEXT_PRI, fontSize: 12, fontWeight: '600' },
  shortcutSub: { color: TEXT_MUT, fontSize: 11 },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  loginBtnText: { color: GREEN, fontSize: 13, fontWeight: '600' },

  recentCard: { backgroundColor: NAVY_CARD, borderRadius: 18, overflow: 'hidden' },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14 },
  recentIconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: NAVY_ITEM, justifyContent: 'center', alignItems: 'center' },
  recentContent: { flex: 1 },
  recentTitle: { color: TEXT_PRI, fontSize: 14, fontWeight: '600' },
  recentSub: { color: TEXT_MUT, fontSize: 12, marginTop: 2 },
  rowDiv: { height: 1, backgroundColor: DIVIDER, marginLeft: 68 },
  emptyText: { color: TEXT_MUT, fontSize: 13 },
});

const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: NAVY_CARD, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 20, alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 16, right: 16, width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY_ITEM, justifyContent: 'center', alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2A3F6F', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { color: TEXT_PRI, fontSize: 28, fontWeight: '700' },
  name: { color: TEXT_PRI, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  email: { color: TEXT_MUT, fontSize: 14, marginBottom: 20 },
  menu: { width: '100%', backgroundColor: NAVY_ITEM, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  rowLabel: { flex: 1, color: TEXT_PRI, fontSize: 15, fontWeight: '500' },
  rowValue: { color: TEXT_MUT, fontSize: 15 },
  div: { height: 1, backgroundColor: DIVIDER, marginLeft: 60 },
});

const hm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: NAVY_CARD, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40 },
  title: { color: TEXT_PRI, fontSize: 22, fontWeight: '700', marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', backgroundColor: NAVY_ITEM, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  tileActive: { borderColor: GREEN },
  tilePreview: { height: 110, justifyContent: 'center', alignItems: 'center' },
  tileLabel: { color: TEXT_MUT, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 10, backgroundColor: '#0E1728' },
});

const hw = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#1C1C1E', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { color: TEXT_PRI, fontSize: 18, fontWeight: '700' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: NAVY_ITEM, borderRadius: 14, borderWidth: 1.5, borderColor: '#1ABC9340', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  input: { flex: 1, color: TEXT_PRI, fontSize: 15 },
  suggList: { backgroundColor: '#2C2C2E', borderRadius: 14, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  suggTitle: { color: TEXT_PRI, fontSize: 14, fontWeight: '600' },
  suggSub: { color: TEXT_MUT, fontSize: 12, marginTop: 2 },
  div: { height: 1, backgroundColor: '#3A3A3C', marginLeft: 42 },
});