import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AppTheme } from '@/constants/theme';
import { getRoute, searchPlaces } from '@/lib/api';
import type { PlaceSearchResult, RoutePoint } from '@/lib/api';

type TravelMode = 'WALK' | 'DRIVE' | 'BICYCLE';

export default function DirectionsScreen() {
  const params = useLocalSearchParams<{
    destLat: string;
    destLng: string;
    destName: string;
  }>();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // Origin / destination
  const [originLabel, setOriginLabel] = useState('Your location');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [destLabel, setDestLabel] = useState(params.destName ?? '');
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | null>(
    params.destLat && params.destLng
      ? { lat: parseFloat(params.destLat), lng: parseFloat(params.destLng) }
      : null
  );

  // Inline search
  const [editingField, setEditingField] = useState<'origin' | 'destination' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  // Route
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<RoutePoint[]>([]);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeReady, setRouteReady] = useState(false);

  // Travel mode
  const [travelMode, setTravelMode] = useState<TravelMode>('WALK');

  // Get user's current location for origin (with timeout for emulators)
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (loc) {
            setOriginCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        }
      } catch {
        // Location unavailable
      }
    })();
  }, []);

  // Auto-fit map when both pins exist
  useEffect(() => {
    if (originCoords && destCoords && mapRef.current) {
      const coords = [
        { latitude: originCoords.lat, longitude: originCoords.lng },
        { latitude: destCoords.lat, longitude: destCoords.lng },
      ];
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
    }
  }, [originCoords, destCoords]);

  // Auto-refetch route when travel mode, origin, or destination changes
  // (only if a route was already shown — avoids unexpected API calls)
  useEffect(() => {
    if (routeReady && originCoords && destCoords) {
      void handleRoute();
    }
  }, [travelMode, originCoords, destCoords]);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearchBusy(true);
    try {
      const data = await searchPlaces(searchQuery);
      setSearchResults(data);
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        Alert.alert('Rate limit reached', 'Daily API limit exceeded. Please try again tomorrow.');
      } else {
        Alert.alert('Search failed', error instanceof Error ? error.message : 'Unable to search.');
      }
    } finally {
      setSearchBusy(false);
    }
  }

  function handleSelectSearchResult(place: PlaceSearchResult) {
    if (editingField === 'origin') {
      setOriginLabel(place.name);
      setOriginCoords({ lat: place.lat, lng: place.lng });
    } else {
      setDestLabel(place.name);
      setDestCoords({ lat: place.lat, lng: place.lng });
    }
    setEditingField(null);
    setSearchQuery('');
    setSearchResults([]);
  }

  async function handleRoute() {
    if (!originCoords) {
      Alert.alert('Origin needed', 'Waiting for your location or set a starting point.');
      return;
    }
    if (!destCoords) {
      Alert.alert('Destination needed', 'Select a destination first.');
      return;
    }
    setRouteBusy(true);
    try {
      const route = await getRoute({
        origin: originCoords,
        destination: destCoords,
        travel_mode: travelMode,
      });
      setDistanceMeters(route.distance_meters);
      setDuration(route.duration);
      setRouteCoords(route.coordinates);
      setRouteReady(true);
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        Alert.alert('Rate limit reached', 'Daily API limit exceeded. Please try again tomorrow.');
      } else {
        Alert.alert('Route failed', error instanceof Error ? error.message : 'Unable to fetch route.');
      }
    } finally {
      setRouteBusy(false);
    }
  }

  async function openInGoogleMaps() {
    if (!originCoords || !destCoords) return;
    const modeMap: Record<TravelMode, string> = { WALK: 'walking', DRIVE: 'driving', BICYCLE: 'bicycling' };
    const originParam = `${originCoords.lat},${originCoords.lng}`;
    const destParam = `${destCoords.lat},${destCoords.lng}`;
    const appUrl = `comgooglemaps://?saddr=${originParam}&daddr=${destParam}&directionsmode=${modeMap[travelMode]}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&origin=${originParam}&destination=${destParam}&travelmode=${modeMap[travelMode]}`;

    const canOpen = await Linking.canOpenURL(appUrl);
    await Linking.openURL(canOpen ? appUrl : webUrl);
  }

  // Compute arrival time from duration
  function getArrivalTime(): string | null {
    if (!duration) return null;
    const seconds = parseInt(duration.replace('s', ''), 10);
    if (isNaN(seconds)) return null;
    const arrival = new Date(Date.now() + seconds * 1000);
    return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Determine default map region
  const defaultRegion = destCoords
    ? { latitude: destCoords.lat, longitude: destCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : originCoords
      ? { latitude: originCoords.lat, longitude: originCoords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
      : { latitude: 40.7291, longitude: -73.9965, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  const arrivalTime = getArrivalTime();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Controls header */}
      <View style={styles.controlsCard}>
        {/* Back button + title */}
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={AppTheme.palette.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Directions</Text>
        </View>

        {/* Origin input */}
        <Pressable
          style={styles.inputRow}
          onPress={() => {
            setEditingField('origin');
            setSearchQuery(originLabel === 'Your location' ? '' : originLabel);
          }}>
          <View style={[styles.dot, { backgroundColor: AppTheme.palette.teal }]} />
          {editingField === 'origin' ? (
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search origin"
              placeholderTextColor="#FCFCFC55"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              style={styles.inputText}
            />
          ) : (
            <Text style={styles.labelText} numberOfLines={1}>{originLabel}</Text>
          )}
        </Pressable>

        {/* Destination input */}
        <Pressable
          style={styles.inputRow}
          onPress={() => {
            setEditingField('destination');
            setSearchQuery(destLabel);
          }}>
          <View style={[styles.dot, { backgroundColor: AppTheme.palette.rosewood }]} />
          {editingField === 'destination' ? (
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search destination"
              placeholderTextColor="#FCFCFC55"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              style={styles.inputText}
            />
          ) : (
            <Text style={styles.labelText} numberOfLines={1}>{destLabel || 'Choose destination'}</Text>
          )}
        </Pressable>

        {/* Inline search results */}
        {editingField && searchResults.length > 0 && (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.place_id}
            style={styles.inlineResults}
            renderItem={({ item }) => (
              <Pressable style={styles.inlineItem} onPress={() => handleSelectSearchResult(item)}>
                <Text style={styles.inlineItemName}>{item.name}</Text>
                <Text style={styles.inlineItemAddr}>{item.address}</Text>
              </Pressable>
            )}
          />
        )}

        {/* Travel mode selector */}
        <View style={styles.modeRow}>
          {(['WALK', 'DRIVE', 'BICYCLE'] as TravelMode[]).map((mode) => (
            <Pressable
              key={mode}
              style={[styles.modeChip, travelMode === mode && styles.modeChipActive]}
              onPress={() => setTravelMode(mode)}>
              <Ionicons
                name={mode === 'WALK' ? 'walk' : mode === 'DRIVE' ? 'car' : 'bicycle'}
                size={16}
                color={travelMode === mode ? AppTheme.palette.white : '#D7CFDB'}
              />
              <Text style={[styles.modeText, travelMode === mode && styles.modeTextActive]}>
                {mode === 'WALK' ? 'Walk' : mode === 'DRIVE' ? 'Drive' : 'Bike'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Show route button */}
        <Pressable
          style={[styles.routeButton, routeBusy && styles.disabled]}
          onPress={handleRoute}
          disabled={routeBusy}>
          {routeBusy ? (
            <ActivityIndicator size="small" color={AppTheme.palette.white} />
          ) : (
            <Text style={styles.routeButtonText}>Show route</Text>
          )}
        </Pressable>
      </View>

      {/* Map with markers + polyline */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={defaultRegion}
          showsUserLocation
          showsMyLocationButton={false}>
          {/* Origin marker */}
          {originCoords && (
            <Marker
              coordinate={{ latitude: originCoords.lat, longitude: originCoords.lng }}
              title={originLabel}
              pinColor={AppTheme.palette.teal}
            />
          )}
          {/* Destination marker */}
          {destCoords && (
            <Marker
              coordinate={{ latitude: destCoords.lat, longitude: destCoords.lng }}
              title={destLabel}
              pinColor={AppTheme.palette.rosewood}
            />
          )}
          {/* Route polyline */}
          {routeCoords.length > 0 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor={AppTheme.palette.teal}
              strokeWidth={4}
            />
          )}
        </MapView>
      </View>

      {/* Route info bar + Start in Google Maps */}
      {routeReady && distanceMeters && duration && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.routeInfoRow}>
            <View style={styles.routeInfoItem}>
              <Ionicons name="time-outline" size={18} color={AppTheme.palette.teal} />
              <Text style={styles.routeInfoValue}>{formatDuration(duration)}</Text>
            </View>
            <View style={styles.routeInfoDivider} />
            <View style={styles.routeInfoItem}>
              <Ionicons name="resize-outline" size={18} color={AppTheme.palette.teal} />
              <Text style={styles.routeInfoValue}>{(distanceMeters / 1000).toFixed(1)} km</Text>
            </View>
            {arrivalTime && (
              <>
                <View style={styles.routeInfoDivider} />
                <View style={styles.routeInfoItem}>
                  <Ionicons name="flag-outline" size={18} color={AppTheme.palette.teal} />
                  <Text style={styles.routeInfoValue}>Arrive {arrivalTime}</Text>
                </View>
              </>
            )}
          </View>

          <Pressable style={styles.googleMapsButton} onPress={openInGoogleMaps}>
            <Ionicons name="navigate" size={18} color={AppTheme.palette.white} />
            <Text style={styles.googleMapsText}>Start in Google Maps</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function formatDuration(raw: string): string {
  const seconds = parseInt(raw.replace('s', ''), 10);
  if (isNaN(seconds)) return raw;
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.palette.midnightViolet,
  },

  /* Controls */
  controlsCard: {
    paddingHorizontal: AppTheme.spacing.lg,
    paddingBottom: AppTheme.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
    marginBottom: AppTheme.spacing.md,
  },
  backButton: {
    padding: AppTheme.spacing.xs,
  },
  headerTitle: {
    color: AppTheme.palette.white,
    fontSize: AppTheme.typography.title,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
    backgroundColor: '#FCFCFC10',
    borderRadius: AppTheme.radius.md,
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: 12,
    marginBottom: AppTheme.spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  inputText: {
    flex: 1,
    color: AppTheme.palette.white,
    fontSize: 15,
  },
  labelText: {
    flex: 1,
    color: AppTheme.palette.white,
    fontSize: 15,
  },

  /* Inline search */
  inlineResults: {
    maxHeight: 140,
    backgroundColor: '#1A0926',
    borderRadius: AppTheme.radius.md,
    marginBottom: AppTheme.spacing.sm,
  },
  inlineItem: {
    paddingHorizontal: AppTheme.spacing.md,
    paddingVertical: AppTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#FCFCFC10',
  },
  inlineItemName: {
    color: AppTheme.palette.white,
    fontSize: 14,
    fontWeight: '600',
  },
  inlineItemAddr: {
    color: '#D7CFDB',
    fontSize: 12,
    marginTop: 2,
  },

  /* Travel mode */
  modeRow: {
    flexDirection: 'row',
    gap: AppTheme.spacing.sm,
    marginBottom: AppTheme.spacing.md,
  },
  modeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FFFFFF30',
    borderRadius: AppTheme.radius.md,
    paddingVertical: 8,
  },
  modeChipActive: {
    backgroundColor: AppTheme.palette.teal,
    borderColor: AppTheme.palette.teal,
  },
  modeText: {
    color: '#D7CFDB',
    fontSize: 13,
    fontWeight: '500',
  },
  modeTextActive: {
    color: AppTheme.palette.white,
  },

  /* Route button */
  routeButton: {
    backgroundColor: AppTheme.palette.teal,
    borderRadius: AppTheme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  routeButtonText: {
    color: AppTheme.palette.white,
    fontWeight: '700',
    fontSize: 16,
  },

  /* Map */
  mapContainer: {
    flex: 1,
  },

  /* Bottom bar */
  bottomBar: {
    backgroundColor: AppTheme.palette.midnightViolet,
    paddingHorizontal: AppTheme.spacing.lg,
    paddingTop: AppTheme.spacing.md,
  },
  routeInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: AppTheme.spacing.md,
    marginBottom: AppTheme.spacing.md,
  },
  routeInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeInfoValue: {
    color: AppTheme.palette.white,
    fontSize: 15,
    fontWeight: '600',
  },
  routeInfoDivider: {
    width: 1,
    height: 16,
    backgroundColor: '#FFFFFF30',
  },
  googleMapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: AppTheme.palette.teal,
    borderRadius: AppTheme.radius.md,
    paddingVertical: 14,
  },
  googleMapsText: {
    color: AppTheme.palette.white,
    fontWeight: '700',
    fontSize: 16,
  },
});
