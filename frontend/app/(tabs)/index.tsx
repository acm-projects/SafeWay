import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Heatmap, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';

const GMAPS_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  '';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import ReAnimated, {
  useAnimatedStyle, useSharedValue, interpolate, Extrapolation,
  withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { NativeViewGestureHandler } from 'react-native-gesture-handler';

import { listBookmarks, deleteBookmark, getWeather, createBookmark, searchPlaces } from '@/lib/api';
import type { Bookmark, WeatherData } from '@/lib/api';
import { bookmarkStore } from '@/lib/bookmarkStore';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-context';
import { useCrashHeatmap } from '@/lib/useCrashHeatmap';
import type { HeatmapFilter } from '@/lib/useCrashHeatmap';
import StreetViewModal from '@/components/StreetViewModal';

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

const HEATMAP_FILTERS: { id: HeatmapFilter | 'off'; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'off',   label: 'Off',             icon: 'eye-off-outline',   color: '#7A8FA6', desc: 'Hide heatmap' },
  { id: 'all',   label: 'All Crashes',     icon: 'warning-outline',   color: '#FF6B6B', desc: 'Every crash in the area' },
  { id: 'fatal', label: 'Fatal / Serious', icon: 'skull-outline',     color: '#FF3333', desc: 'Fatal or serious injury crashes' },
  { id: 'ped',   label: 'Pedestrian',      icon: 'walk-outline',      color: '#FFA500', desc: 'Crashes involving pedestrians' },
  { id: 'bike',  label: 'Bicycle',         icon: 'bicycle-outline',   color: '#1ABC93', desc: 'Crashes involving cyclists' },
  { id: 'hit',   label: 'Hit & Run',       icon: 'car-sport-outline', color: '#C084FC', desc: 'Hit and run incidents' },
];

const MAP_STYLE_OPTIONS: { id: 'standard'|'satellite'|'hybrid'|'terrain'; label: string; icon: string }[] = [
  { id: 'standard',  label: 'Default',   icon: 'map-outline'        },
  { id: 'satellite', label: 'Satellite', icon: 'earth-outline'      },
  { id: 'hybrid',    label: 'Hybrid',    icon: 'globe-outline'      },
  { id: 'terrain',   label: 'Terrain',   icon: 'trail-sign-outline' },
];

const FLOAT_SIDE   = 10;  // gap left & right of the floating sheet
const FLOAT_BOTTOM = 8;  // gap below the floating sheet
const FLOAT_RADIUS = 24;  // corner radius of the floating sheet

function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return (
    <ReAnimated.View pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: bg ?? '#030427' }, style]} />
  );
}

// ── Heatmap chooser modal ──────────────────────────────────────────────────────
function HeatmapModal({ visible, activeFilter, onSelect, onClose, crashCount, loading, mapStyleType, onSelectMapStyle }: {
  visible: boolean;
  activeFilter: HeatmapFilter | 'off';
  onSelect: (id: HeatmapFilter | 'off') => void;
  onClose: () => void;
  crashCount: number;
  loading: boolean;
  mapStyleType: 'standard'|'satellite'|'hybrid'|'terrain';
  onSelectMapStyle: (s: 'standard'|'satellite'|'hybrid'|'terrain') => void;
}) {
  const { T } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={[{ borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40, backgroundColor: T.CARD }]} onPress={() => {}}>

          <Text style={{ color: T.TEXT_PRI, fontSize: 22, fontWeight: '700', marginBottom: 12 }}>Map Style</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 }}>
            {MAP_STYLE_OPTIONS.map(opt => {
              const active = mapStyleType === opt.id;
              const activeBg = T.isDark ? '#0D2B22' : '#EDE8FF';
              return (
                <Pressable key={opt.id}
                  style={[{ flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', gap: 6, borderWidth: 2, borderColor: 'transparent', backgroundColor: T.ITEM },
                    active && { borderColor: T.ACCENT, backgroundColor: activeBg }]}
                  onPress={() => onSelectMapStyle(opt.id)}>
                  <Ionicons name={opt.icon as any} size={22} color={active ? T.ACCENT : T.TEXT_MUT} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: active ? T.ACCENT : T.TEXT_MUT }}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: 1, backgroundColor: T.DIVIDER, marginVertical: 20 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: T.TEXT_PRI, fontSize: 22, fontWeight: '700' }}>Safety Heatmap</Text>
            {activeFilter !== 'off' && (
              <View style={{ backgroundColor: T.ITEM, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                {loading
                  ? <ActivityIndicator size="small" color={T.ACCENT} />
                  : <Text style={{ color: T.ACCENT, fontSize: 12, fontWeight: '600' }}>{crashCount.toLocaleString()} points</Text>
                }
              </View>
            )}
          </View>
          <Text style={{ color: T.TEXT_MUT, fontSize: 13, marginBottom: 20, lineHeight: 18 }}>Crash data from traffic records. Brighter = higher density.</Text>
          <View style={{ backgroundColor: T.ITEM, borderRadius: 18, overflow: 'hidden' }}>
            {HEATMAP_FILTERS.map((f, i) => {
              const active = activeFilter === f.id;
              return (
                <View key={f.id}>
                  <Pressable
                    style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
                      active && { backgroundColor: 'rgba(26,188,147,0.08)' }]}
                    onPress={() => { onSelect(f.id); onClose(); }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: active ? f.color + '33' : T.BG }}>
                      <Ionicons name={f.icon as any} size={20} color={active ? f.color : T.TEXT_MUT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', marginBottom: 2, color: active ? T.TEXT_PRI : T.TEXT_MUT }}>{f.label}</Text>
                      <Text style={{ fontSize: 12, opacity: 0.7, color: T.TEXT_MUT }}>{f.desc}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={T.ACCENT} />}
                  </Pressable>
                  {i < HEATMAP_FILTERS.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 70 }} />}
                </View>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ProfileModal({ visible, onClose, user, signOut, bookmarkCount, allBookmarks, onRemoveBookmark }: {
  visible: boolean; onClose: () => void; user: any; signOut: () => void;
  bookmarkCount: number;
  allBookmarks: { id: string; title: string; address?: string }[];
  onRemoveBookmark: (id: string) => void;
}) {
  const { isDark, toggleTheme, T } = useTheme();
  const [showPlacesList, setShowPlacesList] = useState(false);
  const initials    = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Guest';
  const email       = user?.email ?? '';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: T.CARD, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 20, alignItems: 'center' }} onPress={() => {}}>
          <Pressable style={{ position: 'absolute', top: 16, right: 16, width: 32, height: 32, borderRadius: 16, backgroundColor: T.ITEM, justifyContent: 'center', alignItems: 'center' }} onPress={onClose}>
            <Ionicons name="close" size={18} color={T.TEXT_PRI} />
          </Pressable>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: T.ICON_BG, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: T.TEXT_PRI, fontSize: 28, fontWeight: '700' }}>{initials}</Text>
          </View>
          <Text style={{ color: T.TEXT_PRI, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>{displayName}</Text>
          <Text style={{ color: T.TEXT_MUT, fontSize: 14, marginBottom: 20 }}>{email}</Text>

          {/* Dark / Light mode toggle */}
          <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: T.ITEM, borderRadius: 14, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#3A2D6A' : '#EDE8FF' }}>
              <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={isDark ? '#B39DDB' : T.ACCENT} />
            </View>
            <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15, fontWeight: '500' }}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: '#D8D0F0', true: T.ACCENT + 'AA' }}
              thumbColor={isDark ? T.ACCENT : '#FFFFFF'}
            />
          </View>
          <View style={{ width: '100%', backgroundColor: T.ITEM, borderRadius: 16, overflow: 'hidden' }}>
            {[
              { icon: 'bookmark-outline', label: 'Places', value: String(bookmarkCount), color: '#5E5CE6', onPress: () => setShowPlacesList(true) },
              { icon: 'flag-outline', label: 'Reports', color: '#FF453A', onPress: undefined },
              { icon: 'map-outline', label: 'Offline Maps', value: 'Download', color: '#636366', onPress: undefined },
            ].map((item, i) => (
              <View key={item.label}>
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }} onPress={item.onPress}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: item.color, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name={item.icon as any} size={18} color="#fff" />
                  </View>
                  <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15, fontWeight: '500' }}>{item.label}</Text>
                  {item.value && <Text style={{ color: T.TEXT_MUT, fontSize: 15 }}>{item.value}</Text>}
                  <Ionicons name="chevron-forward" size={16} color={T.TEXT_MUT} />
                </Pressable>
                {i < 2 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 60 }} />}
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 60 }} />
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }} onPress={() => { onClose(); signOut(); }}>
              <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: T.BG, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="log-out-outline" size={18} color={T.ACCENT} />
              </View>
              <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15, fontWeight: '500' }}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={16} color={T.TEXT_MUT} />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      {/* Places list sub-modal */}
      <Modal visible={showPlacesList} transparent animationType="slide" onRequestClose={() => setShowPlacesList(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => setShowPlacesList(false)}>
          <Pressable style={{ backgroundColor: T.CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '70%' }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: T.TEXT_PRI, fontSize: 18, fontWeight: '700' }}>Saved Places ({allBookmarks.length})</Text>
              <Pressable onPress={() => setShowPlacesList(false)}>
                <Ionicons name="close" size={20} color={T.TEXT_PRI} />
              </Pressable>
            </View>
            {allBookmarks.length === 0 ? (
              <Text style={{ color: T.TEXT_MUT, fontSize: 14, textAlign: 'center', paddingVertical: 20 }}>No saved places yet</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: T.ITEM, borderRadius: 16, overflow: 'hidden' }}>
                  {allBookmarks.map((bm, i) => (
                    <View key={bm.id}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 }}>
                        <Ionicons name="bookmark" size={18} color={T.ACCENT} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: T.TEXT_PRI, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{bm.title}</Text>
                          {bm.address ? <Text style={{ color: T.TEXT_MUT, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{bm.address}</Text> : null}
                        </View>
                        <Pressable onPress={() => { onRemoveBookmark(bm.id); }} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color="#FF4444" />
                        </Pressable>
                      </View>
                      {i < allBookmarks.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 46 }} />}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

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
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const bookmarksScrollRef = useRef<NativeViewGestureHandler>(null);
  const mapRef = useRef<MapView>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const jwt = session?.access_token ?? '';
  const { height: windowHeight } = useWindowDimensions();

  // Min snap: handle(~14) + searchRow(44) + no extra margin = just the pill visible
  const snapPoints = useMemo(() => {
    const searchBarOnly = 86;
    const mid = Math.round(windowHeight * 0.52);
    const max = Math.round(windowHeight * 0.92);
    return [searchBarOnly, mid, max];
  }, [windowHeight, insets.bottom]);
  const animatedPosition = useSharedValue(windowHeight);

  const [userLocation, setUserLocation]     = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [mapStyleType, setMapStyleType] = useState<'standard'|'satellite'|'hybrid'|'terrain'>('standard');
  const [heatmapFilter, setHeatmapFilter] = useState<HeatmapFilter | 'off'>('off');
  const [showStreetView, setShowStreetView] = useState(false);
  const [streetViewLat, setStreetViewLat] = useState(0);
  const [streetViewLng, setStreetViewLng] = useState(0);
  // Pegman drag state
  const [isDraggingPegman, setIsDraggingPegman] = useState(false);
  const [showCoverageLayer, setShowCoverageLayer] = useState(false);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pegmanPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pegmanStartPos = useRef({ x: 0, y: 0 });
  const pegmanButtonLayout = useRef({ x: 0, y: 0, width: 42, height: 42 });
  const [bookmarks, setBookmarks]           = useState<Bookmark[]>([]);
  const [weather, setWeather]               = useState<WeatherData | null>(null);
  const [sheetIndex, setSheetIndex]         = useState(1);
  const [zoomLevel, setZoomLevel]           = useState(0.04);
  const [placeModal, setPlaceModal]         = useState<'home'|'work'|'school'|null>(null);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [addQuery, setAddQuery]             = useState('');
  const [addSugg, setAddSugg]               = useState<any[]>([]);
  const [addBusy, setAddBusy]               = useState(false);
  const addDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placeQuery, setPlaceQuery]         = useState('');
  const [placeSugg, setPlaceSugg]           = useState<any[]>([]);
  const [placeBusy, setPlaceBusy]           = useState(false);
  const placeDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [homeLabel, setHomeLabel]           = useState<string | null>(null);
  const [workLabel, setWorkLabel]           = useState<string | null>(null);
  const [schoolLabel, setSchoolLabel]       = useState<string | null>(null);
  const [homePlace, setHomePlace]           = useState<any | null>(null);
  const [workPlace, setWorkPlace]           = useState<any | null>(null);
  const [schoolPlace, setSchoolPlace]       = useState<any | null>(null);
  const [homeMicListening, setHomeMicListening] = useState(false);
  const homeMicScale   = useSharedValue(1);
  const homeMicOpacity = useSharedValue(1);
  const homeMicStyle = useAnimatedStyle(() => ({
    transform: [{ scale: homeMicScale.value }],
    opacity: homeMicOpacity.value,
  }));
  // ── Pegman drag-and-drop PanResponder ────────────────────────────────────
  const CANCEL_RADIUS = 70; // pixels — if dropped within this of the button, cancel
  const pegmanPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setIsDraggingPegman(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        pegmanPos.setValue({ x: 0, y: 0 });
        // Wait 1 second before revealing coverage layer so the WebView white flash
        // has time to pass invisibly in the background
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        coverageTimerRef.current = setTimeout(() => setShowCoverageLayer(true), 1000);
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pegmanPos.x, dy: pegmanPos.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: async (_, gs) => {
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        setIsDraggingPegman(false);
        setShowCoverageLayer(false);
        pegmanPos.setValue({ x: 0, y: 0 });

        // If dropped within CANCEL_RADIUS of the start, user changed their mind — cancel
        const dist = Math.sqrt(gs.dx * gs.dx + gs.dy * gs.dy);
        if (dist < CANCEL_RADIUS) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }

        // Convert drop screen coords to map lat/lng
        const dropX = pegmanButtonLayout.current.x + pegmanButtonLayout.current.width / 2 + gs.dx;
        const dropY = pegmanButtonLayout.current.y + pegmanButtonLayout.current.height / 2 + gs.dy;
        try {
          const coord = await mapRef.current?.coordinateForPoint({ x: dropX, y: dropY });
          if (coord) {
            setStreetViewLat(coord.latitude);
            setStreetViewLng(coord.longitude);
            setShowStreetView(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch {
          const loc = userLocation ?? { lat: 41.8781, lng: -87.6298 };
          setStreetViewLat(loc.lat);
          setStreetViewLng(loc.lng);
          setShowStreetView(true);
        }
      },
      onPanResponderTerminate: () => {
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        setIsDraggingPegman(false);
        setShowCoverageLayer(false);
        pegmanPos.setValue({ x: 0, y: 0 });
      },
    })
  ).current;

  function startHomeMic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHomeMicListening(true);
    homeMicScale.value   = withRepeat(withSequence(withTiming(1.3, { duration: 400, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 400 })), -1, false);
    homeMicOpacity.value = withRepeat(withSequence(withTiming(0.5, { duration: 400 }), withTiming(1, { duration: 400 })), -1, false);
    setTimeout(() => {
      setHomeMicListening(false);
      homeMicScale.value   = withTiming(1);
      homeMicOpacity.value = withTiming(1);
      router.push('/search');
    }, 300);
  }

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 10_000,
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
    // Run weather fetch once locationLoading is done — use real coords if available,
    // otherwise fall back to default map coords (New York) so weather always shows.
    if (locationLoading) return;
    const lat = userLocation?.lat ?? 41.8781;
    const lng = userLocation?.lng ?? -87.6298;
    (async () => {
      // Try backend first
      try {
        const w = await getWeather(lat, lng);
        setWeather(w);
        return;
      } catch {}
      // Fallback: call Open-Meteo directly using the same new API format as the backend
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,weather_code,wind_speed_10m` +
          `&temperature_unit=fahrenheit`
        );
        if (!r.ok) return;
        const d = await r.json();
        const current = d.current ?? {};
        const code: number = current.weather_code ?? 0;
        const descriptions: Record<number, string> = {
          0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
          45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
          55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
          71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Light showers',
          81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm',
          96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
        };
        setWeather({
          temperature: Math.round(current.temperature_2m ?? 0),
          unit: 'F',
          description: descriptions[code] ?? 'Clear sky',
          weather_code: code,
          wind_speed: Math.round(current.wind_speed_10m ?? 0),
        });
      } catch {}
    })();
  }, [locationLoading, userLocation]);

  useEffect(() => {
    if (!jwt) { setBookmarks([]); return; }
    void loadBookmarks();
  }, [jwt]);

  // Reload bookmarks when returning from destination/search screens
  useFocusEffect(useCallback(() => {
    if (jwt) void loadBookmarks();
    // Also sync from bookmarkStore (catches saves made on destination when backend is offline)
    const storeItems = bookmarkStore.getAll();
    setLocalBookmarks(storeItems.filter(s =>
      !['Home: ', 'Work: ', 'School: '].some(p => s.title.startsWith(p))
    ));
  }, [jwt]));

  // Live-subscribe to bookmarkStore for instant updates
  useEffect(() => {
    const unsubscribe = bookmarkStore.subscribe(() => {
      const storeItems = bookmarkStore.getAll();
      setLocalBookmarks(storeItems.filter(s =>
        !['Home: ', 'Work: ', 'School: '].some(p => s.title.startsWith(p))
      ));
    });
    return unsubscribe;
  }, []);

  async function loadBookmarks() {
    try {
      const bms = await listBookmarks(jwt);
      setBookmarks(bms);
      const home   = bms.find(b => b.title.startsWith('Home: '));
      const work   = bms.find(b => b.title.startsWith('Work: '));
      const school = bms.find(b => b.title.startsWith('School: '));
      if (home)   { setHomeLabel(home.title.replace(/^Home: /, '')); setHomePlace(home); }
      if (work)   { setWorkLabel(work.title.replace(/^Work: /, '')); setWorkPlace(work); }
      if (school) { setSchoolLabel(school.title.replace(/^School: /, '')); setSchoolPlace(school); }
    } catch { setBookmarks([]); }
  }

  async function handleDeleteBookmark(id: string) {
    try { await deleteBookmark(jwt, id); await loadBookmarks(); }
    catch (e) { Alert.alert('Delete failed', e instanceof Error ? e.message : 'Error'); }
  }

  function recordRecent(place: { id: string; title: string; address: string; lat: number; lng: number }) {
    setRecentPlaces(prev => {
      const filtered = prev.filter(p => p.title !== place.title);
      return [place, ...filtered].slice(0, 5);
    });
  }

  async function handleDeleteShortcut(type: 'home' | 'work' | 'school') {
    const labelMap = { home: 'Home', work: 'Work', school: 'School' };
    const prefix = labelMap[type] + ': ';
    const match = bookmarks.find(bm => bm.title.startsWith(prefix));
    if (match) { try { await deleteBookmark(jwt, match.id); await loadBookmarks(); } catch {} }
    if (type === 'home') setHomeLabel(null);
    else if (type === 'work') setWorkLabel(null);
    else setSchoolLabel(null);
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
    const labelMap = { home: 'Home', work: 'Work', school: 'School' };
    const label = labelMap[placeModal!];
    if (placeModal === 'home') { setHomeLabel(place.name); setHomePlace(place); }
    else if (placeModal === 'work') { setWorkLabel(place.name); setWorkPlace(place); }
    else { setSchoolLabel(place.name); setSchoolPlace(place); }
    setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]);
    if (jwt) {
      try {
        await createBookmark(jwt, { title: label + ': ' + place.name, address: place.address, lat: place.lat, lng: place.lng });
        await loadBookmarks();
      } catch {}
    }
  }

  function handleAddQueryChange(text: string) {
    setAddQuery(text);
    if (addDebRef.current) clearTimeout(addDebRef.current);
    if (text.trim().length < 2) { setAddSugg([]); return; }
    addDebRef.current = setTimeout(async () => {
      setAddBusy(true);
      try { setAddSugg((await searchPlaces(text.trim())).slice(0, 6)); }
      catch { setAddSugg([]); }
      finally { setAddBusy(false); }
    }, 350);
  }

  const [localBookmarks, setLocalBookmarks] = useState<any[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<{ id: string; title: string; address: string; lat: number; lng: number }[]>([]);

  async function handleAddBookmark(place: any) {
    setShowAddModal(false); setAddQuery(''); setAddSugg([]);
    const localEntry = { id: `local_${Date.now()}`, place_id: place.place_id ?? '', title: place.name, address: place.address ?? '', lat: place.lat, lng: place.lng };
    // Add to shared store — triggers live subscription update everywhere
    bookmarkStore.add(localEntry);
    if (jwt) {
      try {
        await createBookmark(jwt, { title: place.name, address: place.address, lat: place.lat, lng: place.lng });
        await loadBookmarks();
      } catch { /* store entry remains */ }
    }
  }

  function handleMyLocation() {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({ latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    }
  }
  function handleZoomIn() {
    const d = Math.max(zoomLevel * 0.5, 0.002); setZoomLevel(d);
    const c = userLocation ?? { lat: 41.8781, lng: -87.6298 };
    mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }
  function handleZoomOut() {
    const d = Math.min(zoomLevel * 2, 1.5); setZoomLevel(d);
    const c = userLocation ?? { lat: 41.8781, lng: -87.6298 };
    mapRef.current?.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: d, longitudeDelta: d }, 300);
  }

  const handleSheetChange = useCallback((i: number) => setSheetIndex(i), []);

  // Always-floating styles — no transition, no glitch
  const sheetBgStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius:     FLOAT_RADIUS,
    borderTopRightRadius:    FLOAT_RADIUS,
    borderBottomLeftRadius:  FLOAT_RADIUS,
    borderBottomRightRadius: FLOAT_RADIUS,
  }));
  const outerWrapStyle = useAnimatedStyle(() => ({
    left:   FLOAT_SIDE,
    right:  FLOAT_SIDE,
    bottom: insets.bottom + FLOAT_BOTTOM,
  }));
  const clipWrapStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius:     FLOAT_RADIUS,
    borderTopRightRadius:    FLOAT_RADIUS,
    borderBottomLeftRadius:  FLOAT_RADIUS,
    borderBottomRightRadius: FLOAT_RADIUS,
  }));

  // Float buttons at top-right, fixed below safe area — not animated from bottom
  const TOP_BUTTONS_TOP = insets.top + 10;

  const mapRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : { latitude: 41.8781, longitude: -87.6298, latitudeDelta: 0.06, longitudeDelta: 0.06 };

  const [currentRegion, setCurrentRegion] = useState(mapRegion);


  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : null;
  const weatherIcon = (() => {
    const d = (weather?.description ?? '').toLowerCase();
    if (d.includes('thunder')) return 'thunderstorm-outline';
    if (d.includes('snow') || d.includes('blizzard')) return 'snow-outline';
    if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return 'rainy-outline';
    if (d.includes('cloud') || d.includes('overcast')) return 'cloudy-outline';
    if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return 'cloud-outline';
    return 'sunny-outline';
  })();

  const shortcuts = [
    { key: 'home',   icon: 'home',       label: 'Home',   sub: homeLabel,   modal: 'home'   as const, place: homePlace   },
    { key: 'work',   icon: 'briefcase',  label: 'Work',   sub: workLabel,   modal: 'work'   as const, place: workPlace   },
    { key: 'school', icon: 'school',     label: 'School', sub: schoolLabel, modal: 'school' as const, place: schoolPlace },
  ];

  if (isLoading || locationLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.BG }}>
        <ActivityIndicator size="large" color={T.ACCENT} />
        <Text style={{ marginTop: 16, color: T.ACCENT, fontSize: 14, fontWeight: '500' }}>Loading SafeWay…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.BG }}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE} initialRegion={mapRegion}
        mapType={mapStyleType}
        showsUserLocation showsMyLocationButton={false}
        customMapStyle={mapStyleType === 'standard' ? (T.isDark ? DARK_MAP_STYLE : []) : []}
        onRegionChange={r => setCurrentRegion(r)}>
        {bookmarks.map(bm => (
          <Marker key={bm.id} coordinate={{ latitude: bm.lat, longitude: bm.lng }}
            title={bm.title} description={bm.address} pinColor={T.ACCENT} />
        ))}
        {heatmapFilter !== 'off' && crashPoints.length > 0 && (
          <Heatmap points={crashPoints} opacity={0.75} radius={20}
            gradient={{ colors: ['#00E5FF', '#FFD600', '#FF1744'], startPoints: [0.1, 0.5, 1.0], colorMapSize: 256 }}
          />
        )}
      </MapView>

      {/* Street View coverage WebView — only mounted while dragging so it never blocks map touches.
          Wrapped in a native View with pointerEvents=none so Android can't intercept gestures. */}
      {isDraggingPegman && GMAPS_KEY ? (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <WebView
            style={[StyleSheet.absoluteFillObject, { opacity: showCoverageLayer ? 0.9 : 0 }]}
            source={{ html: `<!DOCTYPE html><html><head>
              <meta name="viewport" content="width=device-width,initial-scale=1"/>
              <style>*{margin:0;padding:0}html,body,#map{width:100%;height:100%;background:transparent}</style>
            </head><body>
              <div id="map"></div>
              <script>
                function init() {
                  new google.maps.StreetViewCoverageLayer().setMap(
                    new google.maps.Map(document.getElementById('map'), {
                      center:{lat:${currentRegion.latitude},lng:${currentRegion.longitude}},
                      zoom:Math.round(Math.log2(360/${currentRegion.longitudeDelta})),
                      disableDefaultUI:true,
                      backgroundColor:'transparent',
                      gestureHandling:'none',
                      mapTypeId:'roadmap'
                    })
                  );
                }
              </script>
              <script src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=init" async defer></script>
            </body></html>` }}
            javaScriptEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            scrollEnabled={false}
            backgroundColor="#00000000"
          />
        </View>
      ) : null}

      {/* Zoom — fixed top-right, doesn't move with sheet */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BUTTONS_TOP, borderRadius: 14, overflow: 'hidden', width: 42, backgroundColor: T.ITEM }}>
        <Pressable style={{ width: 42, height: 42, justifyContent: 'center', alignItems: 'center' }} onPress={handleZoomIn}>
          <Ionicons name="add" size={22} color={T.TEXT_PRI} />
        </Pressable>
        <View style={{ height: 1, backgroundColor: T.DIVIDER, marginHorizontal: 8 }} />
        <Pressable style={{ width: 42, height: 42, justifyContent: 'center', alignItems: 'center' }} onPress={handleZoomOut}>
          <Ionicons name="remove" size={22} color={T.TEXT_PRI} />
        </Pressable>
      </View>

      {/* Locate — fixed below zoom */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BUTTONS_TOP + 100, width: 42, height: 42, borderRadius: 21 }}>
        <Pressable style={{ flex: 1, borderRadius: 21, backgroundColor: T.ITEM, justifyContent: 'center', alignItems: 'center' }} onPress={handleMyLocation}>
          <Ionicons name="locate" size={20} color={T.ACCENT} />
        </Pressable>
      </View>

      {/* Pegman — drag onto map to open Street View */}
      <View
        style={{ position: 'absolute', right: 14, top: TOP_BUTTONS_TOP + 152, width: 42, height: 42, borderRadius: 21 }}
        onLayout={(e) => {
          e.target.measure((_x, _y, width, height, pageX, pageY) => {
            pegmanButtonLayout.current = { x: pageX, y: pageY, width, height };
          });
        }}
      >
        <Animated.View
          style={[{
            width: 42, height: 42, borderRadius: 21,
            backgroundColor: isDraggingPegman ? T.ACCENT : T.ITEM,
            justifyContent: 'center', alignItems: 'center',
            transform: pegmanPos.getTranslateTransform(),
            // Only elevate while dragging — lets BottomSheet stay above at rest
            ...(isDraggingPegman ? {
              shadowColor: T.ACCENT,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.5,
              shadowRadius: 8,
              elevation: 24,
              zIndex: 999,
            } : {}),
          }]}
          {...pegmanPanResponder.panHandlers}
        >
          <Ionicons name="walk" size={22} color={isDraggingPegman ? '#fff' : T.ACCENT} />
        </Animated.View>
      </View>

      {/* Blue overlay hint when dragging pegman */}

      {/* Heatmap pill — fixed below pegman */}
      <View style={{ position: 'absolute', right: 14, top: TOP_BUTTONS_TOP + 204 }}>
        <Pressable
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.ITEM, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'transparent' },
            heatmapFilter !== 'off' && { borderColor: T.ACCENT + '55' }]}
          onPress={() => setShowHeatmapModal(true)}
        >
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color={T.ACCENT} style={{ marginRight: 2 }} />
            : <Ionicons name="layers-outline" size={14} color={heatmapFilter !== 'off' ? (activeFilterInfo?.color ?? T.ACCENT) : T.ACCENT} />
          }
          {heatmapFilter !== 'off' && (
            <Text style={{ color: activeFilterInfo?.color ?? T.ACCENT, fontSize: 12, fontWeight: '600' }}>
              {activeFilterInfo?.label ?? 'Heatmap'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Profile modal */}
      <ProfileModal visible={showProfileModal} onClose={() => setShowProfileModal(false)} user={user} signOut={signOut}
        bookmarkCount={bookmarks.filter(b => !b.title.startsWith('Home: ') && !b.title.startsWith('Work: ') && !b.title.startsWith('School: ')).length + localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)).length}
        allBookmarks={[
          ...bookmarks.filter(b => !b.title.startsWith('Home: ') && !b.title.startsWith('Work: ') && !b.title.startsWith('School: ')).map(b => ({ id: b.id, title: b.title, address: b.address })),
          ...localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)).map(lb => ({ id: lb.id, title: lb.title, address: lb.address })),
        ]}
        onRemoveBookmark={(id: string) => {
          bookmarkStore.remove(id);
          if (!String(id).startsWith('local_')) void handleDeleteBookmark(id);
        }}
      />

      {/* Heatmap chooser */}
      <HeatmapModal
        visible={showHeatmapModal}
        activeFilter={heatmapFilter}
        onSelect={setHeatmapFilter}
        onClose={() => setShowHeatmapModal(false)}
        crashCount={crashPoints.length}
        loading={crashLoading}
        mapStyleType={mapStyleType}
        onSelectMapStyle={setMapStyleType}
      />

      {/* Home/Work/School picker — fully themed */}
      <Modal visible={placeModal !== null} transparent animationType="slide"
        onRequestClose={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
          <Pressable style={{ backgroundColor: T.CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: T.TEXT_PRI, fontSize: 18, fontWeight: '700' }}>
                Set {placeModal === 'home' ? 'Home' : placeModal === 'work' ? 'Work' : 'School'}
              </Text>
              <Pressable onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
                <Ionicons name="close" size={20} color={T.TEXT_PRI} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.ITEM, borderRadius: 14, borderWidth: 1.5, borderColor: T.ACCENT + '40', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
              <Ionicons name="search" size={16} color={T.ACCENT} />
              <TextInput value={placeQuery} onChangeText={handlePlaceQueryChange}
                placeholder="Search address…" placeholderTextColor={T.TEXT_MUT}
                autoFocus style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15 }} selectionColor={T.ACCENT} />
              {placeBusy && <ActivityIndicator size="small" color={T.ACCENT} />}
            </View>
            {placeSugg.length > 0 && (
              <View style={{ backgroundColor: T.ITEM, borderRadius: 14, overflow: 'hidden' }}>
                {placeSugg.map((s, i) => (
                  <View key={s.place_id}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 }} onPress={() => handleSavePlace(s)}>
                      <Ionicons name="location-outline" size={16} color={T.ACCENT} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.TEXT_PRI, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color: T.TEXT_MUT, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{s.address}</Text>
                      </View>
                    </Pressable>
                    {i < placeSugg.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 42 }} />}
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add Bookmark modal */}
      <Modal visible={showAddModal} transparent animationType="slide"
        onRequestClose={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}>
          <Pressable style={{ backgroundColor: T.CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: T.TEXT_PRI, fontSize: 18, fontWeight: '700' }}>Add a Place</Text>
              <Pressable onPress={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}>
                <Ionicons name="close" size={20} color={T.TEXT_PRI} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.ITEM, borderRadius: 14, borderWidth: 1.5, borderColor: T.ACCENT + '40', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
              <Ionicons name="search" size={16} color={T.ACCENT} />
              <TextInput value={addQuery} onChangeText={handleAddQueryChange}
                placeholder="Search for a place…" placeholderTextColor={T.TEXT_MUT}
                autoFocus style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15 }} selectionColor={T.ACCENT} />
              {addBusy && <ActivityIndicator size="small" color={T.ACCENT} />}
            </View>
            {addSugg.length > 0 && (
              <View style={{ backgroundColor: T.ITEM, borderRadius: 14, overflow: 'hidden' }}>
                {addSugg.map((s, i) => (
                  <View key={s.place_id}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 }} onPress={() => handleAddBookmark(s)}>
                      <Ionicons name="location-outline" size={16} color={T.ACCENT} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: T.TEXT_PRI, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color: T.TEXT_MUT, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{s.address}</Text>
                      </View>
                      <Ionicons name="arrow-forward" size={14} color={T.TEXT_MUT} />
                    </Pressable>
                    {i < addSugg.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 42 }} />}
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Outer: animates position only — no overflow so layout changes never re-clip */}
      <ReAnimated.View
        pointerEvents="box-none"
        style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }, outerWrapStyle]}
      >
        {/* Inner: overflow:hidden for pill clipping — only radius changes, never layout */}
        <ReAnimated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }, clipWrapStyle]}
        >
      <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
        onChange={handleSheetChange} animatedPosition={animatedPosition}
        backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bg={T.BG} />}
        handleIndicatorStyle={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.HANDLE }}
        enablePanDownToClose={false}>

        <BottomSheetScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 0, paddingBottom: insets.bottom + FLOAT_BOTTOM + 24 }}
          scrollEnabled={sheetIndex === 2}>

          {/* Search row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.CARD, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 10, height: 44 }} onPress={() => router.push('/search')}>
              <Ionicons name="search" size={16} color={T.TEXT_MUT} />
              <Text style={{ color: T.TEXT_MUT, fontSize: 15, flex: 1 }}>Where to?</Text>
              <Pressable onPress={startHomeMic} hitSlop={12} onStartShouldSetResponder={() => true}>
                <ReAnimated.View style={[{ width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
                  homeMicListening && { backgroundColor: T.ACCENT }, homeMicStyle]}>
                  <Ionicons name="mic" size={18} color="#FFFFFF" />
                </ReAnimated.View>
              </Pressable>
            </Pressable>
            <Pressable style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A4A60', justifyContent: 'center', alignItems: 'center' }} onPress={() => setShowProfileModal(true)}>
              {userInitials
                ? <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{userInitials}</Text>
                : <Ionicons name="person-outline" size={18} color="#FFFFFF" />}
            </Pressable>
          </View>

          {weather && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.CARD, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 }}>
              <Ionicons name={weatherIcon as any} size={18} color={T.ACCENT} />
              <Text style={{ color: T.TEXT_PRI, fontSize: 14, fontWeight: '600' }}>
                {weather.description ?? 'Clear'}  ·  {Math.round(weather.temperature ?? 0)}°F
              </Text>
            </View>
          )}

          {/* BOOKMARKED LOCATIONS — always rendered, never gated by sheetIndex */}
          <>
            <Text style={{ color: T.TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 }}>BOOKMARKED LOCATIONS</Text>
              <View style={{ backgroundColor: T.CARD, borderRadius: 18, paddingTop: 14, paddingBottom: 14, overflow: 'visible' }}>
                <Text style={{ color: T.TEXT_PRI, fontSize: 15, fontWeight: '600', paddingHorizontal: 16, marginBottom: 10 }}>
                  {bookmarks.length + localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)).length} {(bookmarks.length + localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)).length) === 1 ? 'Place' : 'Places'}
                </Text>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 16 }} />
                {user ? (
                  <NativeViewGestureHandler ref={bookmarksScrollRef} disallowInterruption>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingHorizontal: 16, gap: 20, paddingBottom: 4 }}>
                      {shortcuts.map(sc => (
                        <Pressable key={sc.key}
                          style={{ alignItems: 'center', gap: 4, width: 68 }}
                          onPress={() => {
                            if (sc.sub && sc.place) {
                              recordRecent({ id: sc.place.place_id ?? sc.place.id ?? '', title: sc.sub, address: sc.place.address ?? '', lat: sc.place.lat, lng: sc.place.lng });
                              router.push({ pathname: '/destination', params: {
                                placeId: sc.place.place_id ?? sc.place.id ?? '',
                                name: sc.sub,
                                address: sc.place.address ?? '',
                                lat: String(sc.place.lat),
                                lng: String(sc.place.lng),
                              }});
                            } else {
                              setPlaceModal(sc.modal); setPlaceQuery(''); setPlaceSugg([]);
                            }
                          }}
                          onLongPress={() => {
                            if (!sc.sub) return;
                            Alert.alert(`Remove ${sc.label}?`, sc.sub, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => void handleDeleteShortcut(sc.modal) },
                            ]);
                          }}>
                          {/* Circle — #E6E9F3 bg, #4A63BA icon */}
                          <View style={[
                            { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E6E9F3', justifyContent: 'center', alignItems: 'center' },
                            sc.sub && { borderWidth: 2.5, borderColor: '#4A63BA' },
                          ]}>
                            <Ionicons name={sc.icon as any} size={26} color="#4A63BA" />
                          </View>
                          <Text style={{ color: T.TEXT_PRI, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>{sc.label}</Text>
                          <Text style={{ color: T.TEXT_MUT, fontSize: 11, textAlign: 'center' }} numberOfLines={2}>
                            {sc.sub ?? 'Add'}
                          </Text>
                        </Pressable>
                      ))}
                      {[
                        ...bookmarks.filter(bm => !bm.title.startsWith('Home: ') && !bm.title.startsWith('Work: ') && !bm.title.startsWith('School: ')),
                        ...localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)),
                      ].map((bm: any) => (
                        <Pressable key={bm.id} style={{ alignItems: 'center', gap: 4, width: 68 }}
                          onPress={() => { recordRecent({ id: bm.place_id ?? bm.id, title: bm.title, address: bm.address ?? '', lat: bm.lat, lng: bm.lng }); router.push({ pathname: '/destination', params: { placeId: bm.place_id ?? bm.id, name: bm.title, address: bm.address ?? '', lat: String(bm.lat), lng: String(bm.lng) } })}}
                          onLongPress={() => Alert.alert('Remove bookmark?', bm.title, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => {
                              bookmarkStore.remove(bm.id);
                              if (!String(bm.id).startsWith('local_')) void handleDeleteBookmark(bm.id);
                            }},
                          ])}>
                          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#E6E9F3', justifyContent: 'center', alignItems: 'center' }}>
                            <Ionicons name="bookmark-outline" size={22} color="#4A63BA" />
                          </View>
                          <Text style={{ color: T.TEXT_PRI, fontSize: 12, fontWeight: '600', textAlign: 'center' }} numberOfLines={2}>{bm.title}</Text>
                        </Pressable>
                      ))}
                      <Pressable style={{ alignItems: 'center', gap: 4, width: 68 }} onPress={() => { setAddQuery(''); setAddSugg([]); setShowAddModal(true); }}>
                        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#E6E9F3', justifyContent: 'center', alignItems: 'center' }}>
                          <Ionicons name="add" size={28} color="#4A63BA" />
                        </View>
                        <Text style={{ color: T.TEXT_PRI, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>Add</Text>
                      </Pressable>
                    </ScrollView>
                  </NativeViewGestureHandler>
                ) : (
                  <Pressable style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 }} onPress={() => router.push('/login')}>
                    <Ionicons name="log-in-outline" size={16} color={T.ACCENT} />
                    <Text style={{ color: T.ACCENT, fontSize: 13, fontWeight: '600' }}>Log in to save places</Text>
                  </Pressable>
                )}
              </View>

              {/* RECENTS */}
              <Text style={{ color: T.TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10, marginTop: 20 }}>RECENTS</Text>
              <View style={{ backgroundColor: T.CARD, borderRadius: 12, overflow: 'hidden' }}>
                {recentPlaces.length > 0 ? recentPlaces.map((rp, i) => {
                  const { icon, bg } = placeIconFor(rp.title);
                  return (
                    <View key={rp.id}>
                      <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14 }}
                        onPress={() => router.push({ pathname: '/destination', params: { placeId: rp.id, name: rp.title, address: rp.address, lat: String(rp.lat), lng: String(rp.lng) } })}>
                        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
                          <Ionicons name={icon as any} size={18} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: T.TEXT_PRI, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{rp.title}</Text>
                          {rp.address ? <Text style={{ color: T.TEXT_MUT, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{rp.address}</Text> : null}
                        </View>
                      </Pressable>
                      {i < recentPlaces.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 68 }} />}
                    </View>
                  );
                }) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 14 }}>
                    <Text style={{ color: T.TEXT_MUT, fontSize: 13 }}>No recent places yet</Text>
                  </View>
                )}
              </View>
          </>
        </BottomSheetScrollView>
      </BottomSheet>
        </ReAnimated.View>
      </ReAnimated.View>

      {/* Street View Modal — opened by pegman button or long-pressing the map */}
      <StreetViewModal
        visible={showStreetView}
        lat={streetViewLat}
        lng={streetViewLng}
        placeName="Street View"
        onClose={() => setShowStreetView(false)}
        onNoCoverage={() => {
          // Silently spring pegman back — no screen shown to user
          Animated.spring(pegmanPos, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            friction: 5,
            tension: 80,
          }).start();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      />
    </View>
  );
}