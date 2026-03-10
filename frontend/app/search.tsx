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

import { searchPlaces } from '@/lib/api';
import type { PlaceSearchResult } from '@/lib/api';

// ─── Design tokens (matching new navy palette) ────────────────────────────────
const NAVY      = '#0B1120';
const NAVY_CARD = '#141D2E';
const NAVY_ITEM = '#1A2540';
const GREEN     = '#1ABC93';
const TEXT_PRI  = '#FFFFFF';
const TEXT_MUT  = '#7A8FA6';
const DIVIDER   = '#1E2D45';
// ──────────────────────────────────────────────────────────────────────────────

const NEARBY = [
  { label: 'Restaurants', icon: 'restaurant-outline' as const, q: 'restaurant' },
  { label: 'Gas Stations', icon: 'car-outline'        as const, q: 'gas station' },
  { label: 'Coffee',       icon: 'cafe-outline'        as const, q: 'coffee shop' },
  { label: 'Parks',        icon: 'leaf-outline'        as const, q: 'park' },
];

// ─── Place type → icon + color ────────────────────────────────────────────────
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

  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<PlaceSearchResult[]>([]);
  const [suggestions, setSugg]      = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy]             = useState(false);
  const [suggBusy, setSuggBusy]     = useState(false);
  const [searched, setSearched]     = useState(false);
  const [recents, setRecents]       = useState<string[]>([]);
  const [showDrop, setShowDrop]     = useState(false);

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

  const showResults  = searched && !showDrop && results.length > 0;
  const showEmpty    = searched && !busy && !showDrop && results.length === 0;
  const showPre      = !searched && !showDrop;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.inputWrap}>
          <Ionicons name="search" size={18} color={TEXT_MUT} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={t => { setQuery(t); if (searched) { setSearched(false); setResults([]); } }}
            placeholder="Where to?"
            placeholderTextColor={TEXT_MUT}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => runSearch(query)}
            style={s.input}
            selectionColor={GREEN}
          />
          {suggBusy
            ? <ActivityIndicator size="small" color={GREEN} />
            : query.length > 0
              ? <Pressable onPress={handleClear}><Ionicons name="close-circle" size={18} color={TEXT_MUT} /></Pressable>
              : <Ionicons name="mic-outline" size={18} color={TEXT_MUT} />}
        </View>
        <Pressable style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      {/* Autocomplete dropdown */}
      {showDrop && suggestions.length > 0 && (
        <View style={s.dropdown}>
          {suggestions.map((item, i) => {
            const { icon, bg } = placeIconFor(item.name);
            return (
            <View key={item.place_id}>
              <Pressable style={s.dropRow} onPress={() => goToPlace(item)}>
                <View style={[s.dropIcon, { backgroundColor: bg }]}>
                  <Ionicons name={icon as any} size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.dropTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.dropSub} numberOfLines={1}>{item.address}</Text>
                </View>
                <Pressable onPress={() => { setQuery(item.name); setShowDrop(false); }}>
                  <Ionicons name="return-up-back-outline" size={16} color={TEXT_MUT} />
                </Pressable>
              </Pressable>
              {i < suggestions.length - 1 && <View style={s.rowDiv} />}
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
              <Text style={s.sectionLabel}>RECENTS</Text>
              <View style={s.listCard}>
                {recents.map((term, i) => (
                  <View key={term}>
                    <Pressable style={s.listRow} onPress={() => runSearch(term)}>
                      <View style={s.listIcon}>
                        <Ionicons name="time-outline" size={18} color={TEXT_MUT} />
                      </View>
                      <Text style={s.listTitle}>{term}</Text>
                    </Pressable>
                    {i < recents.length - 1 && <View style={s.rowDiv} />}
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={[s.sectionLabel, recents.length > 0 && { marginTop: 22 }]}>FIND NEARBY</Text>
          <View style={s.listCard}>
            {NEARBY.map((item, i) => (
              <View key={item.label}>
                <Pressable style={s.listRow} onPress={() => runSearch(item.q)}>
                  <View style={s.listIcon}>
                    <Ionicons name={item.icon} size={18} color={GREEN} />
                  </View>
                  <Text style={s.listTitle}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={TEXT_MUT} />
                </Pressable>
                {i < NEARBY.length - 1 && <View style={s.rowDiv} />}
              </View>
            ))}
          </View>
        </>
      )}

      {/* Full results */}
      {showResults && (
        <>
          <Text style={s.sectionLabel}>RESULTS</Text>
          <FlatList
            data={results}
            keyExtractor={item => item.place_id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16 }}
            ItemSeparatorComponent={() => <View style={s.rowDivFull} />}
            renderItem={({ item }) => {
              const { icon, bg } = placeIconFor(item.name);
              return (
              <Pressable style={s.listRow} onPress={() => goToPlace(item)}>
                <View style={[s.listIcon, { backgroundColor: bg }]}>
                  <Ionicons name={icon as any} size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.listTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.dropSub} numberOfLines={1}>{item.address}</Text>
                </View>
              </Pressable>
              );
            }}
          />
        </>
      )}

      {showEmpty && (
        <View style={s.empty}>
          <Ionicons name="search-outline" size={48} color={TEXT_MUT} />
          <Text style={s.emptyText}>No results found</Text>
        </View>
      )}

      {busy && (
        <View style={s.loadOverlay}>
          <ActivityIndicator size="large" color={GREEN} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY },

  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 10 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: NAVY_CARD, borderRadius: 28, paddingHorizontal: 16, paddingVertical: 12 },
  input: { flex: 1, color: TEXT_PRI, fontSize: 16 },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  cancelText: { color: TEXT_PRI, fontSize: 15, fontWeight: '500' },

  dropdown: { marginHorizontal: 16, marginBottom: 8, backgroundColor: NAVY_CARD, borderRadius: 18, overflow: 'hidden', elevation: 8 },
  dropRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  dropIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: NAVY_ITEM, justifyContent: 'center', alignItems: 'center' },
  dropTitle: { color: TEXT_PRI, fontSize: 14, fontWeight: '600' },
  dropSub: { color: TEXT_MUT, fontSize: 12, marginTop: 1 },

  sectionLabel: { color: TEXT_MUT, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, paddingHorizontal: 20, marginBottom: 10 },

  listCard: { marginHorizontal: 16, backgroundColor: NAVY_CARD, borderRadius: 18, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  listIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: NAVY_ITEM, justifyContent: 'center', alignItems: 'center' },
  listTitle: { flex: 1, color: TEXT_PRI, fontSize: 15, fontWeight: '600' },

  rowDiv: { height: 1, backgroundColor: DIVIDER, marginLeft: 68 },
  rowDivFull: { height: 1, backgroundColor: DIVIDER },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { color: TEXT_MUT, fontSize: 16 },
  loadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,17,32,0.7)', justifyContent: 'center', alignItems: 'center' },
});