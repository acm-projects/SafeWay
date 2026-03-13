import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { searchPlaces, saveRecentSearch, listRecentSearches } from '@/lib/api';
import type { PlaceSearchResult, RecentSearch } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { palette, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const NEARBY = [
  { label: 'Restaurants', icon: 'restaurant-outline' as const, q: 'restaurant' },
  { label: 'Gas Stations', icon: 'car-outline'        as const, q: 'gas station' },
  { label: 'Coffee',       icon: 'cafe-outline'        as const, q: 'coffee shop' },
  { label: 'Parks',        icon: 'leaf-outline'        as const, q: 'park' },
];

function placeIconFor(name: string): { icon: string; bg: string } {
  const t = name.toLowerCase();
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
  if (t.includes('store') || t.includes('shop'))
    return { icon: 'cart-outline', bg: palette.mediumPurple };
  if (t.includes('hospital') || t.includes('medical'))
    return { icon: 'medical-outline', bg: '#E05C5C' };
  return { icon: 'location-outline', bg: palette.brightPurple };
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const debRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { session } = useAuth();
  const jwt = session?.access_token ?? '';
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];

  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<PlaceSearchResult[]>([]);
  const [suggestions, setSugg]      = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy]             = useState(false);
  const [suggBusy, setSuggBusy]     = useState(false);
  const [searched, setSearched]     = useState(false);
  const [recents, setRecents]       = useState<RecentSearch[]>([]);
  const [showDrop, setShowDrop]     = useState(false);

  // Load recent searches from API
  useEffect(() => {
    if (jwt) {
      listRecentSearches(jwt).then(setRecents).catch(() => {});
    }
  }, [jwt]);

  // Live autocomplete
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
    } catch { setResults([]); }
    finally { setBusy(false); }
  }

  async function goToPlace(place: PlaceSearchResult) {
    setShowDrop(false);
    // Save to recent searches
    if (jwt) {
      try {
        await saveRecentSearch(jwt, {
          query: place.name,
          place_id: place.place_id,
          place_name: place.name,
          place_address: place.address,
          lat: place.lat,
          lng: place.lng,
        });
      } catch {}
    }
    router.replace({
      pathname: '/destination',
      params: { placeId: place.place_id, name: place.name, address: place.address, lat: String(place.lat), lng: String(place.lng) },
    });
  }

  function handleClear() {
    setQuery(''); setResults([]); setSugg([]); setSearched(false); setShowDrop(false);
    inputRef.current?.focus();
  }

  const showResults  = searched && !showDrop && results.length > 0;
  const showEmpty    = searched && !busy && !showDrop && results.length === 0;
  const showPre      = !searched && !showDrop;

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) + 100, backgroundColor: c.background }]}>

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={[s.inputWrap, { backgroundColor: c.cardSolid, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.textSecondary} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={t => { setQuery(t); if (searched) { setSearched(false); setResults([]); } }}
            placeholder="Where to?"
            placeholderTextColor={c.textSecondary}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => runSearch(query)}
            style={[s.input, { color: c.text }]}
            selectionColor={palette.brightPurple}
          />
          {suggBusy
            ? <ActivityIndicator size="small" color={palette.brightPurple} />
            : query.length > 0
              ? <Pressable onPress={handleClear}><Ionicons name="close-circle" size={18} color={c.textSecondary} /></Pressable>
              : <Ionicons name="mic-outline" size={18} color={c.textSecondary} />}
        </View>
        <Pressable style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={[s.cancelText, { color: c.text }]}>Cancel</Text>
        </Pressable>
      </View>

      {/* Autocomplete dropdown */}
      {showDrop && suggestions.length > 0 && (
        <View style={[s.dropdown, { backgroundColor: c.cardSolid }]}>
          {suggestions.map((item, i) => {
            const { icon, bg } = placeIconFor(item.name);
            return (
            <View key={item.place_id}>
              <Pressable style={s.dropRow} onPress={() => goToPlace(item)}>
                <View style={[s.dropIcon, { backgroundColor: bg + '33' }]}>
                  <Ionicons name={icon as any} size={16} color={bg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.dropTitle, { color: c.text }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[s.dropSub, { color: c.textSecondary }]} numberOfLines={1}>{item.address}</Text>
                </View>
                <Pressable onPress={() => { setQuery(item.name); setShowDrop(false); }}>
                  <Ionicons name="return-up-back-outline" size={16} color={c.textSecondary} />
                </Pressable>
              </Pressable>
              {i < suggestions.length - 1 && <View style={[s.rowDiv, { backgroundColor: c.divider }]} />}
            </View>
            );
          })}
        </View>
      )}

      {/* Pre-search: recents + nearby */}
      {showPre && (
        <>
          {recents.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { color: c.textSecondary }]}>RECENTS</Text>
              <View style={[s.listCard, { backgroundColor: c.cardSolid }]}>
                {recents.slice(0, 5).map((r, i) => (
                  <View key={r.id}>
                    <Pressable style={s.listRow} onPress={() => {
                      if (r.place_name && r.lat && r.lng) {
                        router.replace({ pathname: '/destination', params: { placeId: r.place_id ?? r.id, name: r.place_name, address: r.place_address ?? '', lat: String(r.lat), lng: String(r.lng) } });
                      } else {
                        runSearch(r.query);
                      }
                    }}>
                      <View style={[s.listIcon, { backgroundColor: c.inputBg }]}>
                        <Ionicons name="time-outline" size={18} color={c.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.listTitle, { color: c.text }]}>{r.place_name ?? r.query}</Text>
                        {r.place_address ? <Text style={[s.dropSub, { color: c.textSecondary }]} numberOfLines={1}>{r.place_address}</Text> : null}
                      </View>
                    </Pressable>
                    {i < Math.min(recents.length, 5) - 1 && <View style={[s.rowDiv, { backgroundColor: c.divider }]} />}
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={[s.sectionLabel, { color: c.textSecondary }, recents.length > 0 && { marginTop: 22 }]}>FIND NEARBY</Text>
          <View style={[s.listCard, { backgroundColor: c.cardSolid }]}>
            {NEARBY.map((item, i) => (
              <View key={item.label}>
                <Pressable style={s.listRow} onPress={() => runSearch(item.q)}>
                  <View style={[s.listIcon, { backgroundColor: palette.brightPurple + '20' }]}>
                    <Ionicons name={item.icon} size={18} color={palette.brightPurple} />
                  </View>
                  <Text style={[s.listTitle, { color: c.text }]}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />
                </Pressable>
                {i < NEARBY.length - 1 && <View style={[s.rowDiv, { backgroundColor: c.divider }]} />}
              </View>
            ))}
          </View>
        </>
      )}

      {/* Full results */}
      {showResults && (
        <>
          <Text style={[s.sectionLabel, { color: c.textSecondary }]}>RESULTS</Text>
          <View style={[s.resultsCard, { backgroundColor: c.cardSolid, borderRadius: 18 }]}>
            <FlatList
              data={results}
              keyExtractor={item => item.place_id}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={[s.rowDiv, { backgroundColor: c.divider }]} />}
              renderItem={({ item }) => {
                const { icon, bg } = placeIconFor(item.name);
                return (
                <Pressable style={s.listRow} onPress={() => goToPlace(item)}>
                  <View style={[s.listIcon, { backgroundColor: bg + '33' }]}>
                    <Ionicons name={icon as any} size={18} color={bg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.listTitle, { color: c.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[s.dropSub, { color: c.textSecondary }]} numberOfLines={1}>{item.address}</Text>
                  </View>
                </Pressable>
                );
              }}
            />
          </View>
        </>
      )}

      {showEmpty && (
        <View style={s.empty}>
          <Ionicons name="search-outline" size={48} color={c.textSecondary} />
          <Text style={[s.emptyText, { color: c.textSecondary }]}>No results found</Text>
        </View>
      )}

      {busy && (
        <View style={[s.loadOverlay, { backgroundColor: colorScheme === 'dark' ? 'rgba(26,10,46,0.7)' : 'rgba(255,255,255,0.7)' }]}>
          <ActivityIndicator size="large" color={palette.brightPurple} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 10 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
  input: { flex: 1, fontSize: 16 },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  cancelText: { fontSize: 15, fontWeight: '500' },

  dropdown: { marginHorizontal: 16, marginBottom: 8, borderRadius: 18, overflow: 'hidden', elevation: 8 },
  dropRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  dropIcon: { width: 34, height: 34, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  dropTitle: { fontSize: 14, fontWeight: '600' },
  dropSub: { fontSize: 12, marginTop: 1 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 20, marginBottom: 10 },

  listCard: { marginHorizontal: 16, borderRadius: 18, overflow: 'hidden' },
  resultsCard: { marginHorizontal: 16, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  listIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  listTitle: { flex: 1, fontSize: 15, fontWeight: '600' },

  rowDiv: { height: 1, marginLeft: 68 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 16 },
  loadOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
});
