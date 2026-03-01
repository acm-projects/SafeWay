import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AppTheme } from '@/constants/theme';
import { listBookmarks, deleteBookmark, getWeather } from '@/lib/api';
import type { Bookmark, WeatherData } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export default function HomeScreen() {
  const { session, user, isLoading, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const jwt = session?.access_token ?? '';

  // Location state
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);

  // Account dropdown
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // Weather
  const [weather, setWeather] = useState<WeatherData | null>(null);

  // Request location permission and get current position.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted' && !cancelled) {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (loc && !cancelled) {
            setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        }
      } catch {
        // Location unavailable — fall back to default
      }
      if (!cancelled) setLocationLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Load weather when we have location
  useEffect(() => {
    if (!userLocation) return;
    (async () => {
      try {
        const data = await getWeather(userLocation.lat, userLocation.lng);
        setWeather(data);
      } catch {
        // Weather is non-critical
      }
    })();
  }, [userLocation]);

  // Load bookmarks when signed in
  useEffect(() => {
    if (!jwt) {
      setBookmarks([]);
      return;
    }
    void loadBookmarks();
  }, [jwt]);

  async function loadBookmarks() {
    if (!jwt) return;
    try {
      const items = await listBookmarks(jwt);
      setBookmarks(items);
    } catch {
      // Silent fail — bookmarks are not critical
    }
  }

  async function handleDeleteBookmark(bookmarkId: string) {
    if (!jwt) return;
    try {
      await deleteBookmark(jwt, bookmarkId);
      await loadBookmarks();
    } catch (error) {
      Alert.alert('Delete failed', error instanceof Error ? error.message : 'Unable to remove bookmark.');
    }
  }

  function handleMyLocation() {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }, 500);
    }
  }

  // Weather icon based on code
  function getWeatherIcon(code: number): string {
    if (code === 0 || code === 1) return 'sunny-outline';
    if (code === 2) return 'partly-sunny-outline';
    if (code === 3) return 'cloud-outline';
    if (code >= 45 && code <= 48) return 'cloud-outline';
    if (code >= 51 && code <= 65) return 'rainy-outline';
    if (code >= 71 && code <= 75) return 'snow-outline';
    if (code >= 80 && code <= 82) return 'rainy-outline';
    if (code >= 95) return 'thunderstorm-outline';
    return 'cloud-outline';
  }

  const mapRegion = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
    : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  if (isLoading || locationLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={AppTheme.palette.teal} />
        <Text style={styles.loadingText}>Loading SafeWay...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={mapRegion}
        region={mapRegion}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={() => setShowAccountMenu(false)}>
        {/* Bookmark markers */}
        {bookmarks.map((bm) => (
          <Marker
            key={bm.id}
            coordinate={{ latitude: bm.lat, longitude: bm.lng }}
            title={bm.title}
            description={bm.address}
            pinColor={AppTheme.palette.sunlitClay}
          />
        ))}
      </MapView>

      {/* Top bar: SafeWay label + Account icon */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <Text style={styles.logoText}>SafeWay</Text>
        <Pressable
          style={styles.accountButton}
          onPress={() => setShowAccountMenu((prev) => !prev)}>
          <Ionicons
            name={user ? 'person-circle' : 'person-circle-outline'}
            size={32}
            color={AppTheme.palette.midnightViolet}
          />
        </Pressable>
      </View>

      {/* Account dropdown menu */}
      {showAccountMenu && (
        <View style={[styles.accountMenu, { top: insets.top + 52 }]}>
          {user ? (
            <>
              <Text style={styles.menuEmail} numberOfLines={1}>
                {user.email}
              </Text>
              <View style={styles.menuDivider} />
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setShowAccountMenu(false);
                  signOut();
                }}>
                <Ionicons name="log-out-outline" size={18} color={AppTheme.palette.rosewood} />
                <Text style={styles.menuItemText}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setShowAccountMenu(false);
                router.push('/login');
              }}>
              <Ionicons name="log-in-outline" size={18} color={AppTheme.palette.teal} />
              <Text style={styles.menuItemText}>Sign in</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Search bar — tapping navigates to full-screen search */}
      <Pressable
        style={[styles.searchBar, { top: insets.top + 56 }]}
        onPress={() => router.push('/search')}>
        <Ionicons name="search" size={20} color="#7A6B85" />
        <Text style={styles.searchPlaceholder}>Search a destination</Text>
      </Pressable>

      {/* My location button */}
      <Pressable style={styles.myLocationButton} onPress={handleMyLocation}>
        <Ionicons name="locate" size={22} color={AppTheme.palette.midnightViolet} />
      </Pressable>

      {/* Bottom sheet */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.handleBar} />

        {/* Weather widget */}
        {weather && (
          <View style={styles.weatherRow}>
            <Ionicons
              name={getWeatherIcon(weather.weather_code) as any}
              size={22}
              color={AppTheme.palette.sunlitClay}
            />
            <Text style={styles.weatherTemp}>{Math.round(weather.temperature)}{'\u00B0'}F</Text>
            <Text style={styles.weatherDesc}>{weather.description}</Text>
          </View>
        )}

        {/* Bookmarks section */}
        <Text style={styles.sectionTitle}>Bookmarks</Text>
        {user ? (
          bookmarks.length > 0 ? (
            <FlatList
              data={bookmarks}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.bookmarksRow}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.bookmarkChip}
                  onPress={() => {
                    router.push({
                      pathname: '/destination',
                      params: {
                        placeId: item.id,
                        name: item.title,
                        address: item.address ?? '',
                        lat: String(item.lat),
                        lng: String(item.lng),
                      },
                    });
                  }}
                  onLongPress={() => {
                    Alert.alert('Remove bookmark?', item.title, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => void handleDeleteBookmark(item.id) },
                    ]);
                  }}>
                  <Ionicons name="bookmark" size={14} color={AppTheme.palette.sunlitClay} />
                  <Text style={styles.chipText}>{item.title}</Text>
                </Pressable>
              )}
            />
          ) : (
            <Text style={styles.placeholderText}>No bookmarks yet. Search and save places!</Text>
          )
        ) : (
          <Pressable style={styles.loginButton} onPress={() => router.push('/login')}>
            <Ionicons name="log-in-outline" size={18} color={AppTheme.palette.white} />
            <Text style={styles.loginButtonText}>Log In to save bookmarks</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.palette.white,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppTheme.palette.white,
  },
  loadingText: {
    marginTop: 16,
    color: AppTheme.palette.midnightViolet,
    fontSize: 16,
  },

  /* Top bar */
  topBar: {
    position: 'absolute',
    left: AppTheme.spacing.lg,
    right: AppTheme.spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '700',
    color: AppTheme.palette.midnightViolet,
    letterSpacing: 0.5,
  },
  accountButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: AppTheme.palette.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },

  /* Account dropdown */
  accountMenu: {
    position: 'absolute',
    right: AppTheme.spacing.lg,
    backgroundColor: AppTheme.palette.white,
    borderRadius: AppTheme.radius.md,
    padding: AppTheme.spacing.sm,
    minWidth: 180,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 100,
  },
  menuEmail: {
    paddingHorizontal: AppTheme.spacing.sm,
    paddingVertical: 6,
    color: AppTheme.palette.midnightViolet,
    fontSize: 13,
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#E8DEE9',
    marginVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    paddingHorizontal: AppTheme.spacing.sm,
    paddingVertical: 8,
  },
  menuItemText: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 15,
    fontWeight: '500',
  },

  /* Search bar */
  searchBar: {
    position: 'absolute',
    left: AppTheme.spacing.lg,
    right: AppTheme.spacing.lg,
    backgroundColor: AppTheme.palette.white,
    borderRadius: AppTheme.radius.xl,
    paddingHorizontal: AppTheme.spacing.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  searchPlaceholder: {
    color: '#7A6B85',
    fontSize: AppTheme.typography.body,
  },

  /* My location button */
  myLocationButton: {
    position: 'absolute',
    right: AppTheme.spacing.lg,
    bottom: 220,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppTheme.palette.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },

  /* Bottom sheet */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: AppTheme.palette.midnightViolet,
    borderTopLeftRadius: AppTheme.radius.xl,
    borderTopRightRadius: AppTheme.radius.xl,
    paddingHorizontal: AppTheme.spacing.lg,
    paddingTop: AppTheme.spacing.sm,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
    alignSelf: 'center',
    marginBottom: AppTheme.spacing.md,
  },

  /* Weather */
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    backgroundColor: '#FFFFFF10',
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: 10,
    marginBottom: AppTheme.spacing.md,
  },
  weatherTemp: {
    color: AppTheme.palette.white,
    fontSize: 16,
    fontWeight: '700',
  },
  weatherDesc: {
    color: '#D7CFDB',
    fontSize: 13,
  },

  sectionTitle: {
    color: AppTheme.palette.white,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: AppTheme.spacing.xs,
  },
  placeholderText: {
    color: '#D7CFDB',
    fontSize: AppTheme.typography.caption,
  },

  /* Login button */
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: AppTheme.spacing.sm,
    backgroundColor: AppTheme.palette.teal,
    borderRadius: AppTheme.radius.md,
    paddingVertical: 12,
    marginTop: AppTheme.spacing.xs,
  },
  loginButtonText: {
    color: AppTheme.palette.white,
    fontSize: 14,
    fontWeight: '600',
  },

  /* Bookmark chips */
  bookmarksRow: {
    gap: AppTheme.spacing.sm,
    paddingBottom: 2,
  },
  bookmarkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF18',
    borderWidth: 1,
    borderColor: '#FFFFFF44',
    borderRadius: AppTheme.radius.xl,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipText: {
    color: AppTheme.palette.white,
    fontSize: AppTheme.typography.caption,
  },
});
