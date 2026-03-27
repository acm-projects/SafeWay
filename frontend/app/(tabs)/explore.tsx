import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppTheme } from '@/constants/theme';

export default function GuideScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
      ]}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>SafeWay</ThemedText>
        <ThemedText style={styles.tagline}>Your safety-first navigation companion</ThemedText>
      </View>

      <View style={styles.card}>
        <View style={styles.stepBadge}>
          <ThemedText style={styles.stepNumber}>1</ThemedText>
        </View>
        <ThemedText style={styles.cardTitle}>Backend env</ThemedText>
        <ThemedText style={styles.cardBody}>
          Set DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and GOOGLE_MAPS_API_KEY in backend/.env
        </ThemedText>
      </View>

      <View style={styles.card}>
        <View style={styles.stepBadge}>
          <ThemedText style={styles.stepNumber}>2</ThemedText>
        </View>
        <ThemedText style={styles.cardTitle}>Frontend env</ThemedText>
        <ThemedText style={styles.cardBody}>
          Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_API_BASE_URL, and
          GOOGLE_MAPS_API_KEY in frontend/.env
        </ThemedText>
      </View>

      <View style={styles.card}>
        <View style={styles.stepBadge}>
          <ThemedText style={styles.stepNumber}>3</ThemedText>
        </View>
        <ThemedText style={styles.cardTitle}>Supabase Google OAuth</ThemedText>
        <ThemedText style={styles.cardBody}>
          Add your redirect URI (safeway://auth/callback) in Supabase Auth provider settings. Enable Google
          provider with your OAuth client credentials.
        </ThemedText>
      </View>

      <View style={styles.card}>
        <View style={styles.stepBadge}>
          <ThemedText style={styles.stepNumber}>4</ThemedText>
        </View>
        <ThemedText style={styles.cardTitle}>Start navigating</ThemedText>
        <ThemedText style={styles.cardBody}>
          Login, search a destination, render the safest route, save bookmarks, and launch navigation in Google
          Maps.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

import MapView, { Heatmap, PROVIDER_GOOGLE } from 'react-native-maps';

const points = [
  { latitude: 32.7767, longitude: -96.7970, weight: 10 }, // Dallas
  { latitude: 32.7801, longitude: -96.8012, weight: 5 },
  { latitude: 32.7750, longitude: -96.7900, weight: 8 },
];

<MapView provider={PROVIDER_GOOGLE} style={{ flex: 1 }}>
  <Heatmap
    points={points}
    radius={40}
    opacity={0.7}
    gradient={{
      colors: ['#00FF00', '#FF0000'],
      startPoints: [0.1, 1.0],
      colorMapSize: 256,
    }}
  />
</MapView>

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.palette.white,
  },
  content: {
    paddingHorizontal: AppTheme.spacing.lg,
    gap: AppTheme.spacing.md,
  },
  header: {
    alignItems: 'center',
    gap: AppTheme.spacing.xs,
    marginBottom: AppTheme.spacing.md,
  },
  title: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 1,
  },
  tagline: {
    color: AppTheme.palette.rosewood,
    fontSize: AppTheme.typography.caption,
    fontWeight: '500',
  },
  card: {
    backgroundColor: AppTheme.palette.midnightViolet,
    borderRadius: AppTheme.radius.lg,
    padding: AppTheme.spacing.lg,
    gap: AppTheme.spacing.sm,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: AppTheme.palette.teal,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  stepNumber: {
    color: AppTheme.palette.white,
    fontSize: 14,
    fontWeight: '700',
  },
  cardTitle: {
    color: AppTheme.palette.sunlitClay,
    fontSize: AppTheme.typography.body,
    fontWeight: '600',
  },
  cardBody: {
    color: '#D7CFDB',
    fontSize: AppTheme.typography.caption,
    lineHeight: 20,
  },
});
