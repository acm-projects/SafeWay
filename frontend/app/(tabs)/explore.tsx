import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';

import { getNews } from '@/lib/api';
import type { NewsArticle } from '@/lib/api';
import { palette, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CATEGORIES = [
  { id: 'general', label: 'All Stories', icon: 'newspaper-outline' },
  { id: 'traffic', label: 'Traffic', icon: 'car-outline' },
  { id: 'safety', label: 'Safety', icon: 'shield-checkmark-outline' },
  { id: 'weather', label: 'Weather', icon: 'cloud-outline' },
] as const;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];

  const [category, setCategory] = useState('general');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newsLocation, setNewsLocation] = useState('');

  const fetchNews = useCallback(async (cat: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getNews(cat, newsLocation || undefined);
      setArticles(data);
    } catch {
      setArticles([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [newsLocation]);

  useEffect(() => {
    fetchNews(category);
  }, [category, fetchNews]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });

        const label = geo?.region || geo?.city || '';
        if (label) setNewsLocation(label);
      } catch {
        // Fall back to generic news when location is unavailable.
      }
    })();
  }, []);

  function handleCategoryChange(cat: string) {
    setCategory(cat);
  }

  async function openArticle(url: string) {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {}
  }

  return (
    <View style={[s.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchNews(category, true)}
            tintColor={palette.brightPurple} />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={[s.title, { color: c.text }]}>Explore</Text>
          <Text style={[s.subtitle, { color: c.textSecondary }]}>
            {newsLocation ? `Latest safety & traffic news near ${newsLocation}` : 'Latest safety & traffic news in your area'}
          </Text>
        </View>

        {/* Category pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillRow}>
          {CATEGORIES.map(cat => {
            const active = category === cat.id;
            return (
              <Pressable
                key={cat.id}
                style={[
                  s.pill,
                  active
                    ? { backgroundColor: palette.brightPurple }
                    : { backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.divider },
                ]}
                onPress={() => handleCategoryChange(cat.id)}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={14}
                  color={active ? '#FFFFFF' : c.textSecondary}
                />
                <Text style={[s.pillText, { color: active ? '#FFFFFF' : c.textSecondary }]}>
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Loading state */}
        {loading && (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={palette.brightPurple} />
            <Text style={[s.loadingText, { color: c.textSecondary }]}>Fetching news...</Text>
          </View>
        )}

        {/* Empty state */}
        {!loading && articles.length === 0 && (
          <View style={[s.emptyCard, { backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.divider }]}>
            <Ionicons name="newspaper-outline" size={48} color={palette.mutedGray} />
            <Text style={[s.emptyTitle, { color: c.text }]}>No articles found</Text>
            <Text style={[s.emptyDesc, { color: c.textSecondary }]}>
              Try a different category or check your backend connection.
            </Text>
          </View>
        )}

        {/* Articles */}
        {!loading && articles.map((article, i) => (
          <Pressable key={`${article.url}-${i}`} onPress={() => openArticle(article.url)}>
            <View style={[s.articleCard, { backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.divider }]}>
              {article.image && (
                <Image source={{ uri: article.image }} style={s.articleImage} resizeMode="cover" />
              )}
              <View style={s.articleContent}>
                {/* Category badge + time */}
                <View style={s.articleMeta}>
                  <View style={[s.categoryBadge, { backgroundColor: palette.brightPurple + '20' }]}>
                    <Text style={[s.categoryText, { color: palette.brightPurple }]}>
                      {category.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[s.timeText, { color: c.textSecondary }]}>
                    {article.publishedAt ? timeAgo(article.publishedAt) : ''}
                  </Text>
                </View>

                <Text style={[s.articleTitle, { color: c.text }]} numberOfLines={3}>
                  {article.title}
                </Text>

                {article.description && (
                  <Text style={[s.articleDesc, { color: c.textSecondary }]} numberOfLines={3}>
                    {article.description}
                  </Text>
                )}

                <View style={s.articleFooter}>
                  {article.source && (
                    <Text style={[s.sourceText, { color: c.textSecondary }]}>{article.source}</Text>
                  )}
                  <View style={s.readMore}>
                    <Text style={[s.readMoreText, { color: palette.brightPurple }]}>Read Full Story</Text>
                    <Ionicons name="arrow-forward" size={14} color={palette.brightPurple} />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16 },

  header: { marginBottom: 20 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 4 },

  pillRow: { gap: 10, paddingBottom: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  pillText: { fontSize: 13, fontWeight: '600' },

  loadingWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '500' },

  emptyCard: { padding: 32, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  articleCard: { marginBottom: 16, overflow: 'hidden' },
  articleImage: { width: '100%', height: 180, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  articleContent: { padding: 16, gap: 10 },
  articleMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  categoryText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  timeText: { fontSize: 12 },
  articleTitle: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  articleDesc: { fontSize: 14, lineHeight: 20 },
  articleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sourceText: { fontSize: 12, fontWeight: '500' },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  readMoreText: { fontSize: 13, fontWeight: '700' },
});
