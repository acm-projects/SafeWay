import RoadHeatmap from '@/app/RoadHeatmap';
import { useNearbyUsers } from '@/lib/useNearbyUsers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import ReAnimated, {
  useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing, withSpring,
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
import MapPegmanStreetView from '@/components/MapPegmanStreetView';
import { GOOGLE_MAPS_DARK_STYLE } from '@/constants/googleMapDarkStyle';
import { loadMapSession, scheduleSaveMapSession } from '@/lib/mapSession';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// Safety + context helpers
// ─────────────────────────────────────────────────────────────────────────────
type SafetyLevel = 'safe' | 'moderate' | 'caution';

function getSafetyLevel(): SafetyLevel {
  const h = new Date().getHours();
  if (h >= 6 && h < 20) return 'safe';
  if (h >= 20 && h < 22) return 'moderate';
  return 'caution';
}

// ─── FIXED: "caution" now uses the app's teal/amber palette — no red outlines ───
const SAFETY_CONFIG: Record<SafetyLevel, { glow: string; label: string; icon: string }> = {
  safe:     { glow: '#1ABC93', label: 'Good Conditions',  icon: 'shield-checkmark' },
  moderate: { glow: '#F0A500', label: 'Stay Alert',       icon: 'shield-half'      },
  caution:  { glow: '#F0A500', label: 'Drive Carefully',  icon: 'shield-outline'   },
};

function getTimeContext(): { label: string; icon: string; suggestion: 'home' | 'work' | 'school' } {
  const h = new Date().getHours();
  if (h >= 5  && h < 9)  return { label: 'Good morning',   icon: 'sunny-outline',         suggestion: 'work'   };
  if (h >= 9  && h < 12) return { label: 'Good morning',   icon: 'partly-sunny-outline',  suggestion: 'school' };
  if (h >= 12 && h < 17) return { label: 'Good afternoon', icon: 'sunny-outline',         suggestion: 'work'   };
  if (h >= 17 && h < 21) return { label: 'Good evening',   icon: 'moon-outline',          suggestion: 'home'   };
  return                         { label: 'Good night',     icon: 'moon-outline',          suggestion: 'home'   };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route sparkline (decorative SVG path)
// ─────────────────────────────────────────────────────────────────────────────
function RouteSpark({ color, width: w = 110, height: h = 26 }: { color: string; width?: number; height?: number }) {
  const d = `M 4 ${h * 0.7} C ${w * 0.2} ${h * 0.15}, ${w * 0.38} ${h * 0.9}, ${w * 0.58} ${h * 0.38} S ${w * 0.82} ${h * 0.1}, ${w - 4} ${h * 0.5}`;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <SvgGradient id="rg" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={0.25} />
          <Stop offset="1" stopColor={color} stopOpacity={1} />
        </SvgGradient>
      </Defs>
      <Path d={d} stroke="url(#rg)" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Glass overlay helper
// ─────────────────────────────────────────────────────────────────────────────
function GlassOverlay({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={{ flex: 1, backgroundColor: `rgba(255,255,255,${opacity})` }} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subtle ambient glow ring — replaces old SafetyPulse border flash
// Uses a very soft glow, not a hard border ring, so it never looks alarming
// ─────────────────────────────────────────────────────────────────────────────
function AmbientGlow({ color, children, style }: { color: string; children: React.ReactNode; style?: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  // Very subtle opacity — just a gentle presence, not alarming
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.25] });
  return (
    <View style={[{ position: 'relative' }, style]}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', inset: -1, borderRadius: 24,
          borderWidth: 1, borderColor: color, opacity,
        }}
      />
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category / gradient data — uses app's navy/teal palette, no jarring purples
// ─────────────────────────────────────────────────────────────────────────────
const SHORTCUT_GRADIENTS: Record<string, [string, string, string]> = {
  home:   ['#0D1525', '#142038', '#1C2E50'],
  work:   ['#0E1A2E', '#152540', '#1A3050'],
  school: ['#10182A', '#162235', '#1E2E48'],
};

const CATEGORY_GRADIENTS: Record<string, [string, string, string]> = {
  school:     ['#0D2244', '#133A6A', '#1760B0'],
  restaurant: ['#3D1010', '#6A1818', '#992828'],
  coffee:     ['#2A1A0E', '#4A2E18', '#6D4C41'],
  smoothie:   ['#2A0E28', '#4A1848', '#7A2868'],
  gas:        ['#0B2E10', '#165220', '#1E7A30'],
  park:       ['#0E2E0E', '#1A4A1A', '#2A6A2A'],
  hospital:   ['#3D0A0A', '#6A1010', '#991818'],
  library:    ['#0A1F44', '#12306B', '#1A4FAF'],
  store:      ['#2A0E3A', '#4A1A6A', '#6A2A9A'],
  hotel:      ['#1A0E3A', '#2A1A6A', '#3A2A8A'],
  airport:    ['#0A2A44', '#123060', '#1A4A80'],
  gym:        ['#3A1A06', '#5A2A0A', '#7A4010'],
  default:    ['#111828', '#1a2538', '#1e2d42'],
};

function getCategoryKey(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('university') || t.includes('college') || t.includes('school')) return 'school';
  if (t.includes('restaurant') || t.includes('food') || t.includes('burger') || t.includes('pizza') || t.includes('kitchen') || t.includes('grill')) return 'restaurant';
  if (t.includes('coffee') || t.includes('cafe') || t.includes('starbucks')) return 'coffee';
  if (t.includes('smoothie') || t.includes('juice') || t.includes('boba')) return 'smoothie';
  if (t.includes('gas') || t.includes('fuel') || t.includes('shell') || t.includes('chevron')) return 'gas';
  if (t.includes('park') || t.includes('trail') || t.includes('nature')) return 'park';
  if (t.includes('hospital') || t.includes('medical') || t.includes('clinic') || t.includes('urgent')) return 'hospital';
  if (t.includes('library') || t.includes('museum')) return 'library';
  if (t.includes('target') || t.includes('walmart') || t.includes('costco') || t.includes('store') || t.includes('shop') || t.includes('market')) return 'store';
  if (t.includes('hotel') || t.includes('inn') || t.includes('motel')) return 'hotel';
  if (t.includes('airport') || t.includes('flight')) return 'airport';
  if (t.includes('gym') || t.includes('fitness')) return 'gym';
  return 'default';
}

function placeIconFor(title: string): { icon: string; bg: string } {
  const t = title.toLowerCase();
  if (t.includes('university') || t.includes('college') || t.includes('school'))  return { icon: 'school-outline',     bg: '#1A4FAF' };
  if (t.includes('restaurant') || t.includes('food') || t.includes('burger') || t.includes('pizza') || t.includes('kitchen') || t.includes('grill')) return { icon: 'restaurant-outline', bg: '#882020' };
  if (t.includes('coffee') || t.includes('cafe') || t.includes('starbucks'))      return { icon: 'cafe-outline',        bg: '#6D4C41' };
  if (t.includes('smoothie') || t.includes('juice') || t.includes('boba'))        return { icon: 'nutrition-outline',   bg: '#7A2868' };
  if (t.includes('gas') || t.includes('fuel') || t.includes('shell') || t.includes('chevron')) return { icon: 'car-outline', bg: '#1E7A30' };
  if (t.includes('park') || t.includes('trail') || t.includes('nature'))          return { icon: 'leaf-outline',        bg: '#2A6A2A' };
  if (t.includes('hospital') || t.includes('medical') || t.includes('clinic'))    return { icon: 'medical-outline',     bg: '#882020' };
  if (t.includes('library') || t.includes('museum'))                               return { icon: 'library-outline',     bg: '#1A4FAF' };
  if (t.includes('target') || t.includes('walmart') || t.includes('costco') || t.includes('store') || t.includes('shop') || t.includes('market') || t.includes('wholesale')) return { icon: 'cart-outline', bg: '#6A2A9A' };
  if (t.includes('hotel') || t.includes('inn') || t.includes('motel'))            return { icon: 'bed-outline',         bg: '#3A2A8A' };
  if (t.includes('airport') || t.includes('flight'))                               return { icon: 'airplane-outline',    bg: '#1A4A80' };
  if (t.includes('gym') || t.includes('fitness'))                                  return { icon: 'barbell-outline',     bg: '#7A4010' };
  return { icon: 'location-outline', bg: '#1A4FAF' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero Card — refined, ambient glow, no alarming red ring
// ─────────────────────────────────────────────────────────────────────────────
function HeroDestinationCard({
  label, sub, safetyLevel, gradientColors, icon, onPress, onLongPress,
}: {
  label: string; sub: string | null; safetyLevel: SafetyLevel;
  gradientColors: [string, string, string]; icon: string;
  onPress: () => void; onLongPress?: () => void;
}) {
  const safety = SAFETY_CONFIG[safetyLevel];
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AmbientGlow color="rgba(255,255,255,0.35)" style={{ marginBottom: 10 }}>
      <ReAnimated.View style={animStyle}>
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          onPressIn={() => { scale.value = withSpring(0.97, { damping: 14, stiffness: 380 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          onPressOut={() => scale.value = withSpring(1, { damping: 10, stiffness: 260 })}
        >
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 22, padding: 18, overflow: 'hidden',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <GlassOverlay opacity={0.06} />
            {/* Decorative orbs */}
            <View style={{ position: 'absolute', right: -35, top: -35, width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.04)' }} />
            <View style={{ position: 'absolute', left: -20, bottom: -25, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.02)' }} />

            {/* Single row: icon + label + Go button */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name={icon as any} size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: '600', letterSpacing: 0.8 }}>
                    {label.toUpperCase()}
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
                    {sub ?? 'Tap to set destination'}
                  </Text>
                </View>
              </View>

              {/* Go button */}
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14,
                paddingHorizontal: 16, paddingVertical: 9,
                flexDirection: 'row', alignItems: 'center', gap: 6,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              }}>
                <Ionicons name="navigate" size={14} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Go</Text>
              </View>
            </View>
          </LinearGradient>
        </Pressable>
      </ReAnimated.View>
    </AmbientGlow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Secondary pill card (Work / School / extras)
// ─────────────────────────────────────────────────────────────────────────────
function SecondaryPill({
  label, sub, icon, gradientColors, onPress, onLongPress, flex,
}: {
  label: string; sub: string | null; icon: string;
  gradientColors: [string, string, string];
  onPress: () => void; onLongPress?: () => void;
  flex?: number;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <ReAnimated.View style={[flex != null ? { flex } : {}, animStyle]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => { scale.value = withSpring(0.94, { damping: 15, stiffness: 400 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        onPressOut={() => scale.value = withSpring(1, { damping: 10, stiffness: 280 })}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 18, padding: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <GlassOverlay opacity={0.05} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.13)', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name={icon as any} size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6 }}>
                {label.toUpperCase()}
              </Text>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>
                {sub ?? 'Add place'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.28)" />
          </View>
        </LinearGradient>
      </Pressable>
    </ReAnimated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add place pill — refined to match app's teal accent
// ─────────────────────────────────────────────────────────────────────────────
function AddPill({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <ReAnimated.View style={animStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.93, { damping: 15, stiffness: 400 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        onPressOut={() => scale.value = withSpring(1, { damping: 10, stiffness: 280 })}
        style={{
          borderRadius: 18, padding: 14,
          borderWidth: 1, borderColor: 'rgba(26,188,147,0.18)',
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: 'rgba(26,188,147,0.06)',
        }}
      >
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(26,188,147,0.15)', justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="add" size={20} color="#1ABC93" />
        </View>
        <Text style={{ color: '#1ABC93', fontSize: 13, fontWeight: '600' }}>Add Place</Text>
      </Pressable>
    </ReAnimated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stacked recent card (deck-of-cards)
// ─────────────────────────────────────────────────────────────────────────────
function RecentStackCard({
  item, stackIndex, totalCount, onPress, onRemove,
}: {
  item: { id: string; title: string; address: string; lat: number; lng: number };
  stackIndex: number; totalCount: number;
  onPress: () => void; onRemove: () => void;
}) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const catKey = getCategoryKey(item.title);
  const [g1, g2, g3] = CATEGORY_GRADIENTS[catKey] ?? CATEGORY_GRADIENTS.default;
  const { icon } = placeIconFor(item.title);
  const isFront = stackIndex === totalCount - 1;
  const depth = totalCount - 1 - stackIndex;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 6 && Math.abs(gs.dy) < 20,
      onPanResponderMove: (_, gs) => { swipeX.setValue(gs.dx); },
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) > 90) {
          Animated.timing(swipeX, { toValue: gs.dx > 0 ? SCREEN_WIDTH + 80 : -SCREEN_WIDTH - 80, duration: 230, useNativeDriver: true }).start(() => {
            onRemove();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          });
        } else {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 6, tension: 80 }).start();
        }
      },
    })
  ).current;

  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const STACK_Y = 7;
  const STACK_SCALE = 0.04;

  return (
    <ReAnimated.View
      style={[
        {
          position: stackIndex === 0 ? 'relative' : 'absolute',
          top: depth * STACK_Y,
          left: depth * 2,
          right: -(depth * 2),
          zIndex: stackIndex + 1,
          borderRadius: 20,
          overflow: 'hidden',
          opacity: Math.max(0.55, 1 - depth * 0.14),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: depth * 2 + 4 },
          shadowOpacity: Math.max(0.12, 0.36 - depth * 0.06),
          shadowRadius: 12,
          elevation: stackIndex + 2,
          transform: [{ scale: 1 - depth * STACK_SCALE }],
        },
        pressStyle,
      ]}
    >
      <Animated.View style={{ transform: [{ translateX: swipeX }] }} {...(isFront ? panResponder.panHandlers : {})}>
        <Pressable
          onPress={isFront ? onPress : undefined}
          onPressIn={() => { if (isFront) { scale.value = withSpring(0.97, { damping: 14, stiffness: 360 }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } }}
          onPressOut={() => scale.value = withSpring(1, { damping: 10, stiffness: 260 })}
        >
          <LinearGradient
            colors={[g1, g2, g3]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ padding: 16, borderRadius: 20, overflow: 'hidden' }}
          >
            <GlassOverlay opacity={0.07} />
            <View style={{ position: 'absolute', right: -22, top: -22, width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.04)' }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name={icon as any} size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                {item.address ? <Text style={{ color: 'rgba(255,255,255,0.48)', fontSize: 12, marginTop: 2 }} numberOfLines={1}>{item.address}</Text> : null}
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="navigate-outline" size={13} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Go</Text>
              </View>
            </View>

            {isFront && totalCount > 1 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 4 }}>
                <Ionicons name="swap-horizontal-outline" size={11} color="rgba(255,255,255,0.28)" />
                <Text style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10 }}>Swipe to dismiss · {totalCount} recent{totalCount !== 1 ? 's' : ''}</Text>
              </View>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </ReAnimated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Map constants
// ─────────────────────────────────────────────────────────────────────────────
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

const FLOAT_SIDE   = 10;
const FLOAT_BOTTOM = 8;
const FLOAT_RADIUS = 24;

function SheetBg({ style, bg }: { style?: any; bg?: string }) {
  return (
    <ReAnimated.View pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: bg ?? '#030427' }, style]} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap modal
// ─────────────────────────────────────────────────────────────────────────────
function HeatmapModal({ visible, activeFilter, onSelect, onClose, crashCount, loading, mapStyleType, onSelectMapStyle, showNearbyUsers, onToggleNearbyUsers }: {  visible: boolean; activeFilter: HeatmapFilter | 'off';
  onSelect: (id: HeatmapFilter | 'off') => void; onClose: () => void;
  crashCount: number; loading: boolean;
  mapStyleType: 'standard'|'satellite'|'hybrid'|'terrain';
  onSelectMapStyle: (s: 'standard'|'satellite'|'hybrid'|'terrain') => void;
  showNearbyUsers: boolean;
  onToggleNearbyUsers: (v: boolean) => void;
}) {
  const { T } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 40, backgroundColor: T.CARD }} onPress={() => {}}>
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:4, marginBottom:16 }}>
  <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
    <Ionicons name="people-outline" size={20} color={T.TEXT_PRI} />
    <View>
      <Text style={{ color:T.TEXT_PRI, fontSize:15, fontWeight:'600' }}>Nearby Users</Text>
      <Text style={{ color:T.TEXT_MUT, fontSize:12 }}>Show anonymized users near you</Text>
    </View>
  </View>
  <Switch value={showNearbyUsers} onValueChange={onToggleNearbyUsers} trackColor={{ false: '#C8D8E8', true: T.ACCENT + 'AA' }} thumbColor={showNearbyUsers ? T.ACCENT : '#FFFFFF'} />
</View>
          <Text style={{ color: T.TEXT_PRI, fontSize: 22, fontWeight: '700', marginBottom: 12 }}>Map Style</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
            {MAP_STYLE_OPTIONS.map(opt => {
              const active = mapStyleType === opt.id;
              return (
                <Pressable key={opt.id}
                  style={[{ flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', gap: 6, borderWidth: 2, borderColor: 'transparent', backgroundColor: T.ITEM },
                    active && { borderColor: T.ACCENT, backgroundColor: T.isDark ? '#0D2B22' : '#EDE8FF' }]}
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
                {loading ? <ActivityIndicator size="small" color={T.ACCENT} />
                  : <Text style={{ color: T.ACCENT, fontSize: 12, fontWeight: '600' }}>{crashCount.toLocaleString()} points</Text>}
              </View>
            )}
          </View>
          <Text style={{ color: T.TEXT_MUT, fontSize: 13, marginBottom: 20, lineHeight: 18 }}>Crash data from traffic records. Brighter = higher density.</Text>
          <View style={{ backgroundColor: T.ITEM, borderRadius: 18, overflow: 'hidden' }}>
            {HEATMAP_FILTERS.map((f, i) => {
              const active = activeFilter === f.id;
              return (
                <View key={f.id}>
                  <Pressable style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
                    active && { backgroundColor: 'rgba(26,188,147,0.08)' }]}
                    onPress={() => { onSelect(f.id); onClose(); }}>
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

// ─────────────────────────────────────────────────────────────────────────────
// Profile modal
// ─────────────────────────────────────────────────────────────────────────────
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
          <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: T.ITEM, borderRadius: 14, marginBottom: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#0D2B22' : '#D8F5EB' }}>
              <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={isDark ? '#1ABC93' : T.ACCENT} />
            </View>
            <Text style={{ flex: 1, color: T.TEXT_PRI, fontSize: 15, fontWeight: '500' }}>{isDark ? 'Dark Mode' : 'Light Mode'}</Text>
            <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: '#C8D8E8', true: T.ACCENT + 'AA' }} thumbColor={isDark ? T.ACCENT : '#FFFFFF'} />
          </View>
          <View style={{ width: '100%', backgroundColor: T.ITEM, borderRadius: 16, overflow: 'hidden' }}>
            {[
              { icon: 'bookmark-outline', label: 'Places', value: String(bookmarkCount), color: '#1A4FAF', onPress: () => setShowPlacesList(true) },
              { icon: 'flag-outline', label: 'Reports', color: '#E05050', onPress: undefined },
              { icon: 'map-outline', label: 'Offline Maps', value: 'Download', color: '#3A5A7A', onPress: undefined },
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
      <Modal visible={showPlacesList} transparent animationType="slide" onRequestClose={() => setShowPlacesList(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => setShowPlacesList(false)}>
          <Pressable style={{ backgroundColor: T.CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '70%' }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: T.TEXT_PRI, fontSize: 18, fontWeight: '700' }}>Saved Places ({allBookmarks.length})</Text>
              <Pressable onPress={() => setShowPlacesList(false)}><Ionicons name="close" size={20} color={T.TEXT_PRI} /></Pressable>
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
                        <Pressable onPress={() => onRemoveBookmark(bm.id)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color="#E05050" />
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

// ─────────────────────────────────────────────────────────────────────────────
// Main HomeScreen
// ─────────────────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { session, user, isLoading, signOut } = useAuth();
  const { T } = useTheme();
  const insets = useSafeAreaInsets();
  const bookmarksScrollRef = useRef<NativeViewGestureHandler>(null);
  const mapRef             = useRef<MapView>(null);
  const bottomSheetRef     = useRef<BottomSheet>(null);
  const jwt = session?.access_token ?? '';
  const { height: windowHeight } = useWindowDimensions();

  const safetyLevel = getSafetyLevel();
  const timeCtx     = getTimeContext();

  const snapPoints = useMemo(() => {
    const searchBarOnly = 86;
    const mid = Math.round(windowHeight * 0.52);
    const max = Math.round(windowHeight * 0.92);
    return [searchBarOnly, mid, max];
  }, [windowHeight]);

  const animatedPosition = useSharedValue(windowHeight);

  const [showNearbyUsers, setShowNearbyUsers] = useState(false);
  const [userLocation, setUserLocation]       = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const [mapStyleType, setMapStyleType]       = useState<'standard'|'satellite'|'hybrid'|'terrain'>('standard');
  const [heatmapFilter, setHeatmapFilter]     = useState<HeatmapFilter | 'off'>('off');
  const [bookmarks, setBookmarks]           = useState<Bookmark[]>([]);
  const [localBookmarks, setLocalBookmarks] = useState<any[]>([]);
  const [recentPlaces, setRecentPlaces]     = useState<{ id: string; title: string; address: string; lat: number; lng: number }[]>([]);
  const [weather, setWeather]               = useState<WeatherData | null>(null);
  const [sheetIndex, setSheetIndex]         = useState(1);
  const [zoomLevel, setZoomLevel]           = useState(0.04);
  const [placeModal, setPlaceModal]         = useState<'home'|'work'|'school'|null>(null);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [addQuery, setAddQuery]             = useState('');
  const [addSugg, setAddSugg]               = useState<any[]>([]);
  const [addBusy, setAddBusy]               = useState(false);
  const addDebRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function startHomeMic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHomeMicListening(true);
    homeMicScale.value   = withRepeat(withSequence(withTiming(1.3, { duration: 400, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 400 })), -1, false);
    homeMicOpacity.value = withRepeat(withSequence(withTiming(0.5, { duration: 400 }), withTiming(1, { duration: 400 })), -1, false);
    setTimeout(() => {
      setHomeMicListening(false);
      homeMicScale.value = withTiming(1); homeMicOpacity.value = withTiming(1);
      router.push('/search');
    }, 300);
  }

  const { points: crashPoints, loading: crashLoading } = useCrashHeatmap({
    filter: heatmapFilter === 'off' ? 'all' : heatmapFilter,
    enabled: heatmapFilter !== 'off',
    limit: 10_000,
  });
  const activeFilterInfo = HEATMAP_FILTERS.find(f => f.id === heatmapFilter);
  const nearbyUsers = useNearbyUsers(userLocation?.lat ?? null, userLocation?.lng ?? null);

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
    if (locationLoading) return;
    const lat = userLocation?.lat ?? 41.8781;
    const lng = userLocation?.lng ?? -87.6298;
    (async () => {
      try { const w = await getWeather(lat, lng); setWeather(w); return; } catch {}
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit`);
        if (!r.ok) return;
        const d = await r.json();
        const current = d.current ?? {};
        const code: number = current.weather_code ?? 0;
        const descriptions: Record<number, string> = {
          0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
          45:'Foggy',51:'Light drizzle',53:'Drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',
          71:'Light snow',73:'Snow',75:'Heavy snow',80:'Light showers',81:'Showers',95:'Thunderstorm',
        };
        setWeather({ temperature: Math.round(current.temperature_2m ?? 0), unit: 'F', description: descriptions[code] ?? 'Clear sky', weather_code: code, wind_speed: Math.round(current.wind_speed_10m ?? 0) });
      } catch {}
    })();
  }, [locationLoading, userLocation]);

  useEffect(() => {
    if (!jwt) { setBookmarks([]); return; }
    void loadBookmarks();
  }, [jwt]);

  useFocusEffect(useCallback(() => {
    if (jwt) void loadBookmarks();
    const storeItems = bookmarkStore.getAll();
    setLocalBookmarks(storeItems.filter(s => !['Home: ','Work: ','School: '].some(p => s.title.startsWith(p))));
  }, [jwt]));

  useEffect(() => {
    void (async () => {
      const s = await loadMapSession();
      if (s?.mapStyleType) setMapStyleType(s.mapStyleType);
      if (s?.heatmapFilter) setHeatmapFilter(s.heatmapFilter as HeatmapFilter | 'off');
      if (typeof s?.latitudeDelta === 'number') setZoomLevel(s.latitudeDelta);
      if (
        mapRef.current &&
        typeof s?.latitude === 'number' &&
        typeof s?.longitude === 'number' &&
        typeof s?.latitudeDelta === 'number'
      ) {
        const lngD = typeof s.longitudeDelta === 'number' ? s.longitudeDelta : s.latitudeDelta;
        mapRef.current.animateToRegion(
          {
            latitude: s.latitude,
            longitude: s.longitude,
            latitudeDelta: s.latitudeDelta,
            longitudeDelta: lngD,
          },
          0,
        );
        setCurrentRegion({
          latitude: s.latitude,
          longitude: s.longitude,
          latitudeDelta: s.latitudeDelta,
          longitudeDelta: lngD,
        });
      }
    })();
  }, []);

  useEffect(() => {
    scheduleSaveMapSession({ mapStyleType, heatmapFilter });
  }, [mapStyleType, heatmapFilter]);

  useEffect(() => {
    const unsubscribe = bookmarkStore.subscribe(() => {
      const storeItems = bookmarkStore.getAll();
      setLocalBookmarks(storeItems.filter(s => !['Home: ','Work: ','School: '].some(p => s.title.startsWith(p))));
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
      if (home)   { setHomeLabel(home.title.replace(/^Home: /,''));     setHomePlace(home); }
      if (work)   { setWorkLabel(work.title.replace(/^Work: /,''));     setWorkPlace(work); }
      if (school) { setSchoolLabel(school.title.replace(/^School: /,'')); setSchoolPlace(school); }
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

  async function handleDeleteShortcut(type: 'home'|'work'|'school') {
    const prefix = { home:'Home: ', work:'Work: ', school:'School: ' }[type];
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
      catch { setPlaceSugg([]); } finally { setPlaceBusy(false); }
    }, 350);
  }

  async function handleSavePlace(place: any) {
    const labelMap = { home:'Home', work:'Work', school:'School' };
    const label = labelMap[placeModal!];
    if (placeModal === 'home') { setHomeLabel(place.name); setHomePlace(place); }
    else if (placeModal === 'work') { setWorkLabel(place.name); setWorkPlace(place); }
    else { setSchoolLabel(place.name); setSchoolPlace(place); }
    setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]);
    if (jwt) { try { await createBookmark(jwt, { title: label+': '+place.name, address: place.address, lat: place.lat, lng: place.lng }); await loadBookmarks(); } catch {} }
  }

  function handleAddQueryChange(text: string) {
    setAddQuery(text);
    if (addDebRef.current) clearTimeout(addDebRef.current);
    if (text.trim().length < 2) { setAddSugg([]); return; }
    addDebRef.current = setTimeout(async () => {
      setAddBusy(true);
      try { setAddSugg((await searchPlaces(text.trim())).slice(0, 6)); }
      catch { setAddSugg([]); } finally { setAddBusy(false); }
    }, 350);
  }

  async function handleAddBookmark(place: any) {
    setShowAddModal(false); setAddQuery(''); setAddSugg([]);
    const localEntry = { id:`local_${Date.now()}`, place_id: place.place_id??'', title: place.name, address: place.address??'', lat: place.lat, lng: place.lng };
    bookmarkStore.add(localEntry);
    if (jwt) { try { await createBookmark(jwt, { title: place.name, address: place.address, lat: place.lat, lng: place.lng }); await loadBookmarks(); } catch {} }
  }

  function handleMyLocation() {
    if (userLocation && mapRef.current)
      mapRef.current.animateToRegion({ latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
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

  const sheetBgStyle   = useAnimatedStyle(() => ({ borderRadius: FLOAT_RADIUS }));
  const outerWrapStyle = useAnimatedStyle(() => ({ left: FLOAT_SIDE, right: FLOAT_SIDE, bottom: insets.bottom + FLOAT_BOTTOM }));
  const clipWrapStyle  = useAnimatedStyle(() => ({ borderRadius: FLOAT_RADIUS }));

  const TOP_BUTTONS_TOP = insets.top + 10;
  const mapRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    : { latitude: 41.8781, longitude: -87.6298, latitudeDelta: 0.06, longitudeDelta: 0.06 };
  const [currentRegion, setCurrentRegion] = useState(mapRegion);

  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : null;
  const weatherIcon = (() => {
    const d = (weather?.description ?? '').toLowerCase();
    if (d.includes('thunder')) return 'thunderstorm-outline';
    if (d.includes('snow'))    return 'snow-outline';
    if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return 'rainy-outline';
    if (d.includes('cloud') || d.includes('overcast')) return 'cloudy-outline';
    if (d.includes('fog'))     return 'cloud-outline';
    return 'sunny-outline';
  })();

  const shortcuts = [
    { key:'home',   icon:'home',      label:'Home',   sub:homeLabel,   modal:'home'   as const, place:homePlace   },
    { key:'work',   icon:'briefcase', label:'Work',   sub:workLabel,   modal:'work'   as const, place:workPlace   },
    { key:'school', icon:'school',    label:'School', sub:schoolLabel, modal:'school' as const, place:schoolPlace },
  ];
  const heroShortcut        = shortcuts.find(s => s.key === timeCtx.suggestion) ?? shortcuts[0];
  const secondaryShortcuts  = shortcuts.filter(s => s.key !== timeCtx.suggestion);
  const extraBookmarks      = [
    ...bookmarks.filter(bm => !bm.title.startsWith('Home: ') && !bm.title.startsWith('Work: ') && !bm.title.startsWith('School: ')),
    ...localBookmarks.filter(lb => !bookmarks.some((b: Bookmark) => b.title === lb.title)),
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

      {/* ── MAP ── */}
      <MapView ref={mapRef} style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE} initialRegion={mapRegion}
        mapType={mapStyleType}
        showsUserLocation showsMyLocationButton={false}
        customMapStyle={mapStyleType === 'standard' ? (T.isDark ? GOOGLE_MAPS_DARK_STYLE : []) : []}
        onRegionChange={r => setCurrentRegion(r)}
        onRegionChangeComplete={r => {
          setCurrentRegion(r);
          setZoomLevel(r.latitudeDelta);
          scheduleSaveMapSession({
            latitude: r.latitude,
            longitude: r.longitude,
            latitudeDelta: r.latitudeDelta,
            longitudeDelta: r.longitudeDelta,
            mapStyleType,
            heatmapFilter,
          });
        }}>
        {bookmarks.map(bm => (
          <Marker key={bm.id} coordinate={{ latitude: bm.lat, longitude: bm.lng }}
            title={bm.title} description={bm.address} pinColor={T.ACCENT} />
        ))}
        {showNearbyUsers && nearbyUsers.map(u => (
  <Marker key={u.user_id} coordinate={{ latitude: u.latitude, longitude: u.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF8C00', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 }}>
  <Text style={{ fontSize: 14 }}>{u.emoji}</Text>
</View>
  </Marker>
))}
        {heatmapFilter !== 'off' && (
  <RoadHeatmap filter={heatmapFilter} opacity={1.0} />
)}
      </MapView>

      {/* Vignettes */}
      <LinearGradient colors={[T.isDark ? 'rgba(7,13,72,0.82)' : 'rgba(255,255,255,0.72)', 'transparent']}
        style={{ position:'absolute', top:0, left:0, right:0, height:120, zIndex:5 }} pointerEvents="none" />
      <LinearGradient colors={['transparent', T.isDark ? 'rgba(7,13,72,0.82)' : 'rgba(245,245,255,0.70)']}
        style={{ position:'absolute', bottom:0, left:0, right:0, height:180, zIndex:5 }} pointerEvents="none" />

      {/* ── Map controls — refined style ── */}
      <View style={{ position:'absolute', right:14, top:TOP_BUTTONS_TOP, borderRadius:14, width:42, backgroundColor:T.BG, zIndex:6, elevation:6, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.18, shadowRadius:6 }}>
        <Pressable style={{ width:42, height:42, justifyContent:'center', alignItems:'center' }} onPress={handleZoomIn}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={{ height:1, backgroundColor:'rgba(255,255,255,0.12)', marginHorizontal:8 }} />
        <Pressable style={{ width:42, height:42, justifyContent:'center', alignItems:'center' }} onPress={handleZoomOut}>
          <Ionicons name="remove" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={{ position:'absolute', right:14, top:TOP_BUTTONS_TOP+100, width:42, height:42, borderRadius:21, zIndex:6, elevation:6, shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.18, shadowRadius:6 }}>
        <Pressable style={{ flex:1, borderRadius:21, backgroundColor:T.BG, justifyContent:'center', alignItems:'center' }} onPress={handleMyLocation}>
          <Ionicons name="locate" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      <MapPegmanStreetView
        mapRef={mapRef}
        currentRegion={currentRegion}
        fallbackLatLng={userLocation ?? { lat: 41.8781, lng: -87.6298 }}
        top={TOP_BUTTONS_TOP + 152}
        controlBg={T.BG}
        dragHighlightBg={T.CARD}
        stackBelowSheet
      />

      {/* ── Heatmap toggle pill — refined ── */}
      <View style={{ position:'absolute', right:14, top:TOP_BUTTONS_TOP+204, zIndex:6, elevation:6 }}>
        <Pressable
          style={[{
            flexDirection:'row', alignItems:'center', gap:6,
            backgroundColor:T.BG, borderRadius:22,
            paddingHorizontal:12, paddingVertical:8,
            borderWidth:1, borderColor: heatmapFilter !== 'off' ? 'rgba(255,255,255,0.28)' : 'transparent',
            shadowColor:'#000', shadowOffset:{width:0,height:2}, shadowOpacity:0.15, shadowRadius:4, elevation:3,
          }]}
          onPress={() => setShowHeatmapModal(true)}>
          {crashLoading && heatmapFilter !== 'off'
            ? <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight:2 }} />
            : <Ionicons name="layers-outline" size={14} color="#FFFFFF" />}
          {heatmapFilter !== 'off' && (
            <Text style={{ color: '#FFFFFF', fontSize:12, fontWeight:'600' }}>
              {activeFilterInfo?.label ?? 'Heatmap'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── Modals ── */}
      <ProfileModal visible={showProfileModal} onClose={() => setShowProfileModal(false)} user={user} signOut={signOut}
        bookmarkCount={bookmarks.filter(b => !b.title.startsWith('Home: ') && !b.title.startsWith('Work: ') && !b.title.startsWith('School: ')).length + localBookmarks.filter(lb => !bookmarks.some((b:Bookmark) => b.title===lb.title)).length}
        allBookmarks={[
          ...bookmarks.filter(b => !b.title.startsWith('Home: ') && !b.title.startsWith('Work: ') && !b.title.startsWith('School: ')).map(b => ({ id:b.id, title:b.title, address:b.address })),
          ...localBookmarks.filter(lb => !bookmarks.some((b:Bookmark) => b.title===lb.title)).map(lb => ({ id:lb.id, title:lb.title, address:lb.address })),
        ]}
        onRemoveBookmark={(id:string) => { bookmarkStore.remove(id); if (!String(id).startsWith('local_')) void handleDeleteBookmark(id); }}
      />
      <HeatmapModal visible={showHeatmapModal} activeFilter={heatmapFilter} onSelect={setHeatmapFilter}
  onClose={() => setShowHeatmapModal(false)} crashCount={crashPoints.length}
  loading={crashLoading} mapStyleType={mapStyleType} onSelectMapStyle={setMapStyleType}
  showNearbyUsers={showNearbyUsers} onToggleNearbyUsers={setShowNearbyUsers}
/>

      {/* Place picker */}
      <Modal visible={placeModal !== null} transparent animationType="slide"
        onRequestClose={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
        <Pressable style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' }}
          onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}>
          <Pressable style={{ backgroundColor:T.CARD, borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:40 }} onPress={() => {}}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <Text style={{ color:T.TEXT_PRI, fontSize:18, fontWeight:'700' }}>Set {placeModal==='home'?'Home':placeModal==='work'?'Work':'School'}</Text>
              <Pressable onPress={() => { setPlaceModal(null); setPlaceQuery(''); setPlaceSugg([]); }}><Ionicons name="close" size={20} color={T.TEXT_PRI} /></Pressable>
            </View>
            <View style={{ flexDirection:'row', alignItems:'center', gap:10, backgroundColor:T.ITEM, borderRadius:14, borderWidth:1.5, borderColor:T.ACCENT+'40', paddingHorizontal:14, paddingVertical:12, marginBottom:12 }}>
              <Ionicons name="search" size={16} color={T.ACCENT} />
              <TextInput value={placeQuery} onChangeText={handlePlaceQueryChange}
                placeholder="Search address…" placeholderTextColor={T.TEXT_MUT}
                autoFocus style={{ flex:1, color:T.TEXT_PRI, fontSize:15 }} selectionColor={T.ACCENT} />
              {placeBusy && <ActivityIndicator size="small" color={T.ACCENT} />}
            </View>
            {placeSugg.length > 0 && (
              
              <View style={{ backgroundColor:T.ITEM, borderRadius:14, overflow:'hidden' }}>
                {placeSugg.map((s,i) => (
                  <View key={s.place_id}>
                    <Pressable style={{ flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:14, paddingVertical:13 }} onPress={() => handleSavePlace(s)}>
                      <Ionicons name="location-outline" size={16} color={T.ACCENT} />
                      <View style={{ flex:1 }}>
                        <Text style={{ color:T.TEXT_PRI, fontSize:14, fontWeight:'600' }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color:T.TEXT_MUT, fontSize:12, marginTop:2 }} numberOfLines={1}>{s.address}</Text>
                      </View>
                    </Pressable>
                    {i < placeSugg.length-1 && <View style={{ height:1, backgroundColor:T.DIVIDER, marginLeft:42 }} />}
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add bookmark */}
      <Modal visible={showAddModal} transparent animationType="slide"
        onRequestClose={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}>
        <Pressable style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' }}
          onPress={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}>
          <Pressable style={{ backgroundColor:T.CARD, borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:40 }} onPress={() => {}}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <Text style={{ color:T.TEXT_PRI, fontSize:18, fontWeight:'700' }}>Add a Place</Text>
              <Pressable onPress={() => { setShowAddModal(false); setAddQuery(''); setAddSugg([]); }}><Ionicons name="close" size={20} color={T.TEXT_PRI} /></Pressable>
            </View>
            <View style={{ flexDirection:'row', alignItems:'center', gap:10, backgroundColor:T.ITEM, borderRadius:14, borderWidth:1.5, borderColor:T.ACCENT+'40', paddingHorizontal:14, paddingVertical:12, marginBottom:12 }}>
              <Ionicons name="search" size={16} color={T.ACCENT} />
              <TextInput value={addQuery} onChangeText={handleAddQueryChange}
                placeholder="Search for a place…" placeholderTextColor={T.TEXT_MUT}
                autoFocus style={{ flex:1, color:T.TEXT_PRI, fontSize:15 }} selectionColor={T.ACCENT} />
              {addBusy && <ActivityIndicator size="small" color={T.ACCENT} />}
            </View>
            {addSugg.length > 0 && (
              <View style={{ backgroundColor:T.ITEM, borderRadius:14, overflow:'hidden' }}>
                {addSugg.map((s,i) => (
                  <View key={s.place_id}>
                    <Pressable style={{ flexDirection:'row', alignItems:'center', gap:12, paddingHorizontal:14, paddingVertical:13 }} onPress={() => handleAddBookmark(s)}>
                      <Ionicons name="location-outline" size={16} color={T.ACCENT} />
                      <View style={{ flex:1 }}>
                        <Text style={{ color:T.TEXT_PRI, fontSize:14, fontWeight:'600' }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color:T.TEXT_MUT, fontSize:12, marginTop:2 }} numberOfLines={1}>{s.address}</Text>
                      </View>
                      <Ionicons name="arrow-forward" size={14} color={T.TEXT_MUT} />
                    </Pressable>
                    {i < addSugg.length-1 && <View style={{ height:1, backgroundColor:T.DIVIDER, marginLeft:42 }} />}
                  </View>
                ))}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── BOTTOM SHEET ── */}
      <ReAnimated.View pointerEvents="box-none"
        style={[{ position:'absolute', left:0, right:0, bottom:0, top:0, zIndex:32, elevation:32 }, outerWrapStyle]}>
        <ReAnimated.View pointerEvents="box-none"
          style={[StyleSheet.absoluteFillObject, { overflow:'hidden' }, clipWrapStyle]}>

          <BottomSheet ref={bottomSheetRef} index={1} snapPoints={snapPoints}
            onChange={handleSheetChange} animatedPosition={animatedPosition}
            backgroundComponent={({ style }) => <SheetBg style={[style, sheetBgStyle]} bg={T.BG} />}
            handleIndicatorStyle={{ width:36, height:4, borderRadius:2, backgroundColor:T.HANDLE }}
            enablePanDownToClose={false}>

            <BottomSheetScrollView
              contentContainerStyle={{ paddingHorizontal:16, paddingTop:0, paddingBottom: insets.bottom + FLOAT_BOTTOM + 24 }}
              scrollEnabled={sheetIndex === 2}>

              {/* ── Search row ── */}
              <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginBottom:14 }}>
                {/* Search bar — original style */}
                <Pressable style={{ flex:1, flexDirection:'row', alignItems:'center', gap:8, backgroundColor:T.CARD, borderRadius:28, paddingHorizontal:16, paddingVertical:10, height:44 }}
                  onPress={() => router.push('/search')}>
                  <Ionicons name="search" size={16} color={T.TEXT_MUT} />
                  <Text style={{ color:T.TEXT_MUT, fontSize:15, flex:1 }}>Where to?</Text>
                  <ReAnimated.View style={[{
                    width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center',
                  }, homeMicListening && { backgroundColor: T.ACCENT }, homeMicStyle]}>
                    <Pressable onPress={startHomeMic} hitSlop={12} onStartShouldSetResponder={() => true}>
                      <Ionicons name="mic" size={18} color="#FFFFFF" />
                    </Pressable>
                  </ReAnimated.View>
                </Pressable>

                {/* Profile button — original style */}
                <Pressable style={{ width:44, height:44, borderRadius:22, backgroundColor:'#3A4A60', justifyContent:'center', alignItems:'center' }}
                  onPress={() => setShowProfileModal(true)}>
                  {userInitials
                    ? <Text style={{ color:'#FFFFFF', fontSize:14, fontWeight:'700' }}>{userInitials}</Text>
                    : <Ionicons name="person-outline" size={18} color="#FFFFFF" />}
                </Pressable>
              </View>

              {/* ── Greeting + weather row ── */}
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:7 }}>
                  <Ionicons name={timeCtx.icon as any} size={15} color={T.ACCENT} />
                  <Text style={{ color:T.TEXT_PRI, fontSize:15, fontWeight:'700' }}>{timeCtx.label}</Text>
                </View>
                {weather && (
                  <View style={{ flexDirection:'row', alignItems:'center', gap:5, backgroundColor:T.CARD, borderRadius:20, paddingHorizontal:11, paddingVertical:5 }}>
                    <Ionicons name={weatherIcon as any} size={13} color={T.ACCENT} />
                    <Text style={{ color:T.TEXT_PRI, fontSize:12, fontWeight:'600' }}>
                      {Math.round(weather.temperature ?? 0)}°F  ·  {weather.description}
                    </Text>
                  </View>
                )}
              </View>

              {user ? (
                <>
                  {/* Section header */}
                  <View style={{ flexDirection:'row', alignItems:'center', marginBottom:12 }}>
                    <Text style={{ color:T.TEXT_MUT, fontSize:11, fontWeight:'700', letterSpacing:1.2 }}>SAVED PLACES</Text>
                  </View>

                  {/* ── Hero destination card ── */}
                  <HeroDestinationCard
                    label={heroShortcut.label}
                    sub={heroShortcut.sub}
                    safetyLevel={safetyLevel}
                    gradientColors={SHORTCUT_GRADIENTS[heroShortcut.key] as [string,string,string]}
                    icon={heroShortcut.icon}
                    onPress={() => {
                      if (heroShortcut.sub && heroShortcut.place) {
                        recordRecent({ id: heroShortcut.place.place_id ?? heroShortcut.place.id ?? '', title: heroShortcut.sub, address: heroShortcut.place.address ?? '', lat: heroShortcut.place.lat, lng: heroShortcut.place.lng });
                        router.push({ pathname:'/destination', params: { placeId: heroShortcut.place.place_id ?? heroShortcut.place.id ?? '', name: heroShortcut.sub, address: heroShortcut.place.address ?? '', lat: String(heroShortcut.place.lat), lng: String(heroShortcut.place.lng) } });
                      } else { setPlaceModal(heroShortcut.modal); setPlaceQuery(''); setPlaceSugg([]); }
                    }}
                    onLongPress={() => {
                      if (!heroShortcut.sub) return;
                      Alert.alert(`Remove ${heroShortcut.label}?`, heroShortcut.sub, [
                        { text:'Cancel', style:'cancel' },
                        { text:'Remove', style:'destructive', onPress: () => void handleDeleteShortcut(heroShortcut.modal) },
                      ]);
                    }}
                  />

                  {/* ── Secondary pills row ── */}
                  <View style={{ flexDirection:'row', gap:10, marginBottom:10 }}>
                    {secondaryShortcuts.map(sc => (
                      <SecondaryPill
                        key={sc.key}
                        label={sc.label} sub={sc.sub} icon={sc.icon}
                        gradientColors={SHORTCUT_GRADIENTS[sc.key] as [string,string,string]}
                        flex={1}
                        onPress={() => {
                          if (sc.sub && sc.place) {
                            recordRecent({ id: sc.place.place_id ?? sc.place.id ?? '', title: sc.sub, address: sc.place.address ?? '', lat: sc.place.lat, lng: sc.place.lng });
                            router.push({ pathname:'/destination', params: { placeId: sc.place.place_id ?? sc.place.id ?? '', name: sc.sub, address: sc.place.address ?? '', lat: String(sc.place.lat), lng: String(sc.place.lng) } });
                          } else { setPlaceModal(sc.modal); setPlaceQuery(''); setPlaceSugg([]); }
                        }}
                        onLongPress={() => {
                          if (!sc.sub) return;
                          Alert.alert(`Remove ${sc.label}?`, sc.sub, [
                            { text:'Cancel', style:'cancel' },
                            { text:'Remove', style:'destructive', onPress: () => void handleDeleteShortcut(sc.modal) },
                          ]);
                        }}
                      />
                    ))}
                  </View>

                  {/* ── Extra bookmarks horizontal strip ── */}
                  {extraBookmarks.length > 0 && (
                    <NativeViewGestureHandler ref={bookmarksScrollRef} disallowInterruption>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap:8, paddingBottom:4 }}>
                        {extraBookmarks.map((bm: any) => {
                          const catKey = getCategoryKey(bm.title);
                          const g = CATEGORY_GRADIENTS[catKey] ?? CATEGORY_GRADIENTS.default;
                          const { icon } = placeIconFor(bm.title);
                          return (
                            <SecondaryPill
                              key={bm.id}
                              label={bm.title} sub={bm.address ?? null} icon={icon}
                              gradientColors={g as [string,string,string]}
                              onPress={() => {
                                recordRecent({ id: bm.place_id ?? bm.id, title: bm.title, address: bm.address ?? '', lat: bm.lat, lng: bm.lng });
                                router.push({ pathname:'/destination', params: { placeId: bm.place_id ?? bm.id, name: bm.title, address: bm.address ?? '', lat: String(bm.lat), lng: String(bm.lng) } });
                              }}
                              onLongPress={() => Alert.alert('Remove bookmark?', bm.title, [
                                { text:'Cancel', style:'cancel' },
                                { text:'Delete', style:'destructive', onPress: () => { bookmarkStore.remove(bm.id); if (!String(bm.id).startsWith('local_')) void handleDeleteBookmark(bm.id); } },
                              ])}
                            />
                          );
                        })}
                        <AddPill onPress={() => { setAddQuery(''); setAddSugg([]); setShowAddModal(true); }} />
                      </ScrollView>
                    </NativeViewGestureHandler>
                  )}
                  {extraBookmarks.length === 0 && (
                    <AddPill onPress={() => { setAddQuery(''); setAddSugg([]); setShowAddModal(true); }} />
                  )}
                </>
              ) : (
                <Pressable
                  style={{
                    flexDirection:'row', alignItems:'center', justifyContent:'center',
                    gap:8, paddingVertical:18, borderRadius:18, marginBottom:10,
                    backgroundColor: 'rgba(26,188,147,0.08)',
                    borderWidth:1, borderColor:'rgba(26,188,147,0.2)',
                  }}
                  onPress={() => router.push('/login')}>
                  <Ionicons name="log-in-outline" size={16} color={T.ACCENT} />
                  <Text style={{ color:T.ACCENT, fontSize:13, fontWeight:'600' }}>Log in to save places</Text>
                </Pressable>
              )}

              {/* ── RECENTS — stacked deck ── */}
              <Text style={{ color:T.TEXT_MUT, fontSize:11, fontWeight:'700', letterSpacing:1.2, marginBottom:12, marginTop:20 }}>RECENTS</Text>

              {recentPlaces.length > 0 ? (
                <View style={{ minHeight: 76 + Math.min(recentPlaces.length - 1, 3) * 7, marginBottom:8 }}>
                  {[...recentPlaces].reverse().map((rp, revIdx) => {
                    const stackIndex = recentPlaces.length - 1 - revIdx;
                    return (
                      <RecentStackCard
                        key={rp.id}
                        item={rp}
                        stackIndex={stackIndex}
                        totalCount={recentPlaces.length}
                        onPress={() => router.push({ pathname:'/destination', params: { placeId:rp.id, name:rp.title, address:rp.address, lat:String(rp.lat), lng:String(rp.lng) } })}
                        onRemove={() => setRecentPlaces(prev => prev.filter(p => p.id !== rp.id))}
                      />
                    );
                  })}
                </View>
              ) : (
                <View style={{ borderRadius:18, paddingVertical:24, paddingHorizontal:20, alignItems:'center', gap:8, borderWidth:1, borderColor:'rgba(255,255,255,0.06)', backgroundColor:'rgba(255,255,255,0.02)' }}>
                  <View style={{ width:44, height:44, borderRadius:22, backgroundColor:T.ITEM, justifyContent:'center', alignItems:'center' }}>
                    <Ionicons name="time-outline" size={22} color={T.TEXT_MUT} />
                  </View>
                  <Text style={{ color:T.TEXT_MUT, fontSize:13, fontWeight:'600' }}>No recent places yet</Text>
                  <Text style={{ color:T.TEXT_MUT, fontSize:12, opacity:0.55, textAlign:'center' }}>Destinations you navigate to will appear here</Text>
                </View>
              )}

            </BottomSheetScrollView>
          </BottomSheet>
        </ReAnimated.View>
      </ReAnimated.View>

    </View>
  );
}