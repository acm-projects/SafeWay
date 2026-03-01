import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

import { AppTheme } from '@/constants/theme';
import { searchPlaces } from '@/lib/api';
import type { PlaceSearchResult } from '@/lib/api';

const CATEGORIES = [
  { label: 'Gas', icon: 'car-outline' as const, query: 'gas station' },
  { label: 'Food', icon: 'restaurant-outline' as const, query: 'restaurant' },
  { label: 'Parks', icon: 'leaf-outline' as const, query: 'park' },
  { label: 'Coffee', icon: 'cafe-outline' as const, query: 'coffee shop' },
];

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  async function runSearch(searchText: string) {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setBusy(true);
    setHasSearched(true);
    try {
      const data = await searchPlaces(trimmed);
      setResults(data);
      // Add to recent searches (deduplicate, keep last 3)
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
        return [trimmed, ...filtered].slice(0, 3);
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        Alert.alert('Rate limit reached', 'Daily API limit exceeded. Please try again tomorrow.');
      } else {
        Alert.alert('Search failed', error instanceof Error ? error.message : 'Unable to search places.');
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSelectPlace(place: PlaceSearchResult) {
    router.replace({
      pathname: '/destination',
      params: {
        placeId: place.place_id,
        name: place.name,
        address: place.address,
        lat: String(place.lat),
        lng: String(place.lng),
      },
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      {/* Search header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={AppTheme.palette.midnightViolet} />
        </Pressable>
        <View style={styles.inputWrapper}>
          <Ionicons name="search" size={18} color="#7A6B85" />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search a destination"
            placeholderTextColor="#7A6B85"
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => runSearch(query)}
            style={styles.input}
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(''); setResults([]); setHasSearched(false); }}>
              <Ionicons name="close-circle" size={20} color="#7A6B85" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Results */}
      {results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.place_id}
          contentContainerStyle={styles.resultsList}
          renderItem={({ item }) => (
            <Pressable style={styles.resultItem} onPress={() => handleSelectPlace(item)}>
              <View style={styles.resultIcon}>
                <Ionicons name="location-outline" size={20} color={AppTheme.palette.teal} />
              </View>
              <View style={styles.resultContent}>
                <Text style={styles.resultName}>{item.name}</Text>
                <Text style={styles.resultAddress}>{item.address}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : hasSearched && !busy ? (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={48} color="#D7CFDB" />
          <Text style={styles.emptyText}>No results found</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.suggestionsContent}>
          {/* Title */}
          <Text style={styles.sectionTitle}>Search destinations</Text>

          {/* Category chips */}
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.label}
                style={styles.categoryChip}
                onPress={() => runSearch(cat.query)}>
                <Ionicons name={cat.icon} size={18} color={AppTheme.palette.teal} />
                <Text style={styles.categoryLabel}>{cat.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Recent</Text>
              {recentSearches.map((term) => (
                <Pressable
                  key={term}
                  style={styles.recentItem}
                  onPress={() => runSearch(term)}>
                  <Ionicons name="time-outline" size={18} color="#7A6B85" />
                  <Text style={styles.recentText}>{term}</Text>
                </Pressable>
              ))}
            </>
          )}

        </ScrollView>
      )}

      {/* Loading overlay */}
      {busy && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={AppTheme.palette.teal} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.palette.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: AppTheme.spacing.md,
    gap: AppTheme.spacing.sm,
    paddingBottom: AppTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#E8DEE9',
  },
  backButton: {
    padding: AppTheme.spacing.xs,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F0F6',
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: 10,
    gap: AppTheme.spacing.sm,
  },
  input: {
    flex: 1,
    color: AppTheme.palette.midnightViolet,
    fontSize: AppTheme.typography.body,
  },

  /* Suggestions (before search) */
  suggestionsContent: {
    padding: AppTheme.spacing.lg,
    gap: AppTheme.spacing.lg,
  },
  sectionTitle: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 18,
    fontWeight: '700',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: AppTheme.spacing.sm,
  },
  categoryChip: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E8F5F6',
    borderRadius: AppTheme.radius.md,
    paddingVertical: 14,
  },
  categoryLabel: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 12,
    fontWeight: '600',
  },

  /* Recent searches */
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.sm,
  },
  recentText: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 15,
  },

  /* Results */
  resultsList: {
    paddingHorizontal: AppTheme.spacing.md,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBF1',
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8F5F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultContent: {
    flex: 1,
  },
  resultName: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 15,
    fontWeight: '600',
  },
  resultAddress: {
    color: '#7A6B85',
    fontSize: AppTheme.typography.caption,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
  },
  emptyText: {
    color: '#7A6B85',
    fontSize: AppTheme.typography.body,
  },

  /* Loading */
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(252, 252, 252, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
