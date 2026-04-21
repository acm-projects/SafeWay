import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { searchPlaces } from '@/lib/api';
import type { PlaceSearchResult } from '@/lib/api';
import { useTheme } from '@/providers/theme-context';

const NEARBY = [
  { label: 'Restaurants', icon: 'restaurant-outline' as const, q: 'restaurant' },
  { label: 'Gas Stations', icon: 'car-outline'        as const, q: 'gas station' },
  { label: 'Coffee',       icon: 'cafe-outline'        as const, q: 'coffee shop' },
  { label: 'Parks',        icon: 'leaf-outline'        as const, q: 'park' },
];

function placeIconFor(name: string): { icon: string; bg: string } {
  const t = name.toLowerCase();
  if (t.includes('university') || t.includes('college') || t.includes('school'))
    return { icon: 'school-outline', bg: '#3A7BD5' };
  if (t.includes('restaurant') || t.includes('food') || t.includes('burger') || t.includes('pizza') || t.includes('grill') || t.includes('kitchen'))
    return { icon: 'restaurant-outline', bg: '#E05C5C' };
  if (t.includes('coffee') || t.includes('cafe') || t.includes('starbucks'))
    return { icon: 'cafe-outline', bg: '#A0522D' };
  if (t.includes('smoothie') || t.includes('juice') || t.includes('boba'))
    return { icon: 'nutrition-outline', bg: '#C06090' };
  if (t.includes('gas') || t.includes('fuel') || t.includes('shell') || t.includes('chevron'))
    return { icon: 'car-outline', bg: '#5A8A5A' };
  if (t.includes('park') || t.includes('trail') || t.includes('nature'))
    return { icon: 'leaf-outline', bg: '#4A9A4A' };
  if (t.includes('library') || t.includes('museum'))
    return { icon: 'library-outline', bg: '#3A7BD5' };
  if (t.includes('target') || t.includes('walmart') || t.includes('costco') || t.includes('store') || t.includes('wholesale'))
    return { icon: 'cart-outline', bg: '#C05050' };
  if (t.includes('hospital') || t.includes('medical') || t.includes('clinic'))
    return { icon: 'medical-outline', bg: '#E05C5C' };
  return { icon: 'location-outline', bg: '#4A5FC4' };
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const debRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { T } = useTheme();

  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<PlaceSearchResult[]>([]);
  const [suggestions, setSugg]      = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy]             = useState(false);
  const [suggBusy, setSuggBusy]     = useState(false);
  const [searched, setSearched]     = useState(false);
  const [recents, setRecents]       = useState<string[]>([]);
  const [showDrop, setShowDrop]     = useState(false);
  const [isListening, setIsListening] = useState(false);

  const micScale   = useSharedValue(1);
  const micOpacity = useSharedValue(1);
  const micAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: micScale.value }],
    opacity: micOpacity.value,
  }));

  function startListening() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsListening(true);
    micScale.value   = withRepeat(withSequence(withTiming(1.3, { duration: 400, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 400 })), -1, false);
    micOpacity.value = withRepeat(withSequence(withTiming(0.5, { duration: 400 }), withTiming(1, { duration: 400 })), -1, false);
    inputRef.current?.focus();
    setTimeout(() => stopListening(), 6000);
  }

  function stopListening() {
    setIsListening(false);
    micScale.value   = withTiming(1, { duration: 200 });
    micOpacity.value = withTiming(1, { duration: 200 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const t = query.trim();
    if (t.length < 2) { setSugg([]); setShowDrop(false); return; }
    debRef.current = setTimeout(async () => {
      setSuggBusy(true);
      try {
        const data = await searchPlaces(t);
        setSugg(data.slice(0, 5));
        setShowDrop(data.length > 0);
      } catch { setSugg([]); setShowDrop(false); }
      finally { setSuggBusy(false); }
    }, 350);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query]);

  async function runSearch(text: string) {
    const t = text.trim();
    if (!t) return;
    setShowDrop(false); setQuery(t); setBusy(true); setSearched(true);
    try {
      const data = await searchPlaces(t);
      setResults(data);
      setRecents(prev => [t, ...prev.filter(s => s.toLowerCase() !== t.toLowerCase())].slice(0, 5));
    } catch { setResults([]); }
    finally { setBusy(false); }
  }

  function goToPlace(place: PlaceSearchResult) {
    setShowDrop(false);
    router.replace({
      pathname: '/destination',
      params: { placeId: place.place_id, name: place.name, address: place.address, lat: String(place.lat), lng: String(place.lng) },
    });
  }

  function handleClear() {
    setQuery(''); setResults([]); setSugg([]); setSearched(false); setShowDrop(false);
    inputRef.current?.focus();
  }

  const showResults = searched && !showDrop && results.length > 0;
  const showEmpty   = searched && !busy && !showDrop && results.length === 0;
  const showPre     = !searched && !showDrop;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={{ flex: 1, paddingTop: insets.top }}>

        {/* Search bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: T.CARD }}>
            <Ionicons name="search" size={18} color={T.TEXT_MUT} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={t => {
                setQuery(t);
                if (searched) { setSearched(false); setResults([]); }
                if (isListening && t.length > 0) stopListening();
              }}
              placeholder="Where to?"
              placeholderTextColor={T.TEXT_MUT}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query)}
              style={{ flex: 1, fontSize: 16, color: T.TEXT_PRI }}
              selectionColor={T.ACCENT}
              underlineColorAndroid="transparent"
            />
            {suggBusy
              ? <ActivityIndicator size="small" color={T.ACCENT} />
              : query.length > 0
                ? <Pressable onPress={handleClear}><Ionicons name="close-circle" size={18} color={T.TEXT_MUT} /></Pressable>
                : (
                  <Pressable onPress={isListening ? stopListening : startListening} hitSlop={10}>
                    <Animated.View style={[{ width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
                      isListening && { backgroundColor: T.ACCENT }, micAnimStyle]}>
                      <Ionicons name={isListening ? 'mic' : 'mic-outline'} size={18} color={isListening ? '#FFFFFF' : T.TEXT_MUT} />
                    </Animated.View>
                  </Pressable>
                )
            }
          </View>
          <Pressable style={{ paddingHorizontal: 4, paddingVertical: 8 }} onPress={() => router.back()}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Autocomplete dropdown */}
          {showDrop && suggestions.length > 0 && (
            <View style={{ marginHorizontal: 16, marginBottom: 8, borderRadius: 18, overflow: 'hidden', elevation: 8, backgroundColor: T.CARD }}>
              {suggestions.map((item, i) => {
                const { icon, bg } = placeIconFor(item.name);
                return (
                  <View key={item.place_id}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 }} onPress={() => goToPlace(item)}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: bg }}>
                        <Ionicons name={icon as any} size={16} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: T.TEXT_PRI }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ fontSize: 12, marginTop: 1, color: T.TEXT_MUT }} numberOfLines={1}>{item.address}</Text>
                      </View>
                      <Pressable onPress={() => { setQuery(item.name); setShowDrop(false); }}>
                        <Ionicons name="return-up-back-outline" size={16} color={T.TEXT_MUT} />
                      </Pressable>
                    </Pressable>
                    {i < suggestions.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 60 }} />}
                  </View>
                );
              })}
            </View>
          )}

          {/* Pre-search */}
          {showPre && (
            <>
              {recents.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 20, marginBottom: 10, color: T.TEXT_MUT }}>RECENTS</Text>
                  <View style={{ marginHorizontal: 16, borderRadius: 18, overflow: 'hidden', backgroundColor: T.CARD }}>
                    {recents.map((term, i) => (
                      <View key={term}>
                        <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 }} onPress={() => runSearch(term)}>
                          <View style={{ width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', backgroundColor: T.ITEM }}>
                            <Ionicons name="time-outline" size={18} color={T.TEXT_MUT} />
                          </View>
                          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: T.TEXT_PRI }}>{term}</Text>
                        </Pressable>
                        {i < recents.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 68 }} />}
                      </View>
                    ))}
                  </View>
                </>
              )}
              <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 20, marginBottom: 10, color: T.TEXT_MUT }, recents.length > 0 && { marginTop: 22 }]}>FIND NEARBY</Text>
              <View style={{ marginHorizontal: 16, borderRadius: 18, overflow: 'hidden', backgroundColor: T.CARD }}>
                {NEARBY.map((item, i) => (
                  <View key={item.label}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 }} onPress={() => runSearch(item.q)}>
                      {/* Icon circle uses T.ITEM bg, icon color uses T.ACCENT so it's purple in light mode */}
                      <View style={{ width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', backgroundColor: T.ITEM }}>
                        <Ionicons name={item.icon} size={18} color="#1ABC93" />
                      </View>
                      <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: T.TEXT_PRI }}>{item.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={T.TEXT_MUT} />
                    </Pressable>
                    {i < NEARBY.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER, marginLeft: 68 }} />}
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Full results */}
          {showResults && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 20, marginBottom: 10, color: T.TEXT_MUT }}>RESULTS</Text>
              {results.map((item, i) => {
                const { icon, bg } = placeIconFor(item.name);
                return (
                  <View key={item.place_id}>
                    <Pressable style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 }} onPress={() => goToPlace(item)}>
                      <View style={{ width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', backgroundColor: bg }}>
                        <Ionicons name={icon as any} size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: T.TEXT_PRI }} numberOfLines={1}>{item.name}</Text>
                        <Text style={{ fontSize: 12, marginTop: 1, color: T.TEXT_MUT }} numberOfLines={1}>{item.address}</Text>
                      </View>
                    </Pressable>
                    {i < results.length - 1 && <View style={{ height: 1, backgroundColor: T.DIVIDER }} />}
                  </View>
                );
              })}
            </>
          )}

          {showEmpty && (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
              <Ionicons name="search-outline" size={48} color={T.TEXT_MUT} />
              <Text style={{ fontSize: 16, color: T.TEXT_MUT }}>No results found</Text>
            </View>
          )}
        </ScrollView>

        {busy && (
          <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: T.isDark ? 'rgba(11,17,32,0.7)' : 'rgba(242,244,248,0.85)' }]}>
            <ActivityIndicator size="large" color={T.ACCENT} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}