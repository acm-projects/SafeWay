import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AppTheme } from '@/constants/theme';
import { createBookmark } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';

export default function DestinationScreen() {
  const params = useLocalSearchParams<{
    placeId: string;
    name: string;
    address: string;
    lat: string;
    lng: string;
  }>();
  const insets = useSafeAreaInsets();
  const { session, user } = useAuth();
  const jwt = session?.access_token ?? '';

  const lat = parseFloat(params.lat);
  const lng = parseFloat(params.lng);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  async function handleBookmark() {
    if (!user) {
      router.push('/login');
      return;
    }
    setBookmarkBusy(true);
    try {
      await createBookmark(jwt, {
        title: params.name || 'Saved place',
        address: params.address,
        lat,
        lng,
      });
      setBookmarked(true);
      Alert.alert('Saved', 'Bookmark added.');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unable to save bookmark.');
    } finally {
      setBookmarkBusy(false);
    }
  }

  function handleDirections() {
    router.push({
      pathname: '/directions',
      params: {
        destLat: params.lat,
        destLng: params.lng,
        destName: params.name,
      },
    });
  }

  async function handleOpenGoogleMaps() {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    await Linking.openURL(url);
  }

  return (
    <View style={styles.container}>
      {/* Map preview */}
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        scrollEnabled={false}
        zoomEnabled={false}>
        <Marker
          coordinate={{ latitude: lat, longitude: lng }}
          title={params.name}
          pinColor={AppTheme.palette.rosewood}
        />
      </MapView>

      {/* Back button overlay */}
      <Pressable style={[styles.backButton, { top: insets.top + 8 }]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={AppTheme.palette.midnightViolet} />
      </Pressable>

      {/* Details card */}
      <ScrollView
        style={styles.detailsCard}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        <View style={styles.handleBar} />

        {/* Name + bookmark icon */}
        <View style={styles.nameRow}>
          <Text style={styles.placeName}>{params.name}</Text>
          <Pressable onPress={handleBookmark} disabled={bookmarkBusy || bookmarked}>
            <Ionicons
              name={bookmarked ? 'heart' : 'heart-outline'}
              size={24}
              color={bookmarked ? AppTheme.palette.rosewood : '#D7CFDB'}
            />
          </Pressable>
        </View>

        {/* Rating placeholder */}
        <Text style={styles.ratingText}>No ratings yet</Text>

        <Text style={styles.placeAddress}>{params.address}</Text>

        {/* Details section */}
        <View style={styles.detailsSection}>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color={AppTheme.palette.teal} />
            <Text style={styles.detailText}>{params.address || 'Address not available'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={18} color={AppTheme.palette.teal} />
            <Text style={styles.detailText}>Hours not available</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" size={18} color={AppTheme.palette.teal} />
            <Text style={styles.detailText}>Phone not available</Text>
          </View>
        </View>

        {/* Open in Google Maps link */}
        <Pressable style={styles.googleMapsLink} onPress={handleOpenGoogleMaps}>
          <Ionicons name="open-outline" size={16} color={AppTheme.palette.teal} />
          <Text style={styles.linkText}>Open in Google Maps</Text>
        </Pressable>

        {/* Directions button — full width, prominent */}
        <Pressable style={styles.directionsButton} onPress={handleDirections}>
          <Ionicons name="navigate" size={20} color={AppTheme.palette.white} />
          <Text style={styles.directionsButtonText}>Directions</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.palette.white,
  },
  map: {
    height: '40%',
  },
  backButton: {
    position: 'absolute',
    left: AppTheme.spacing.lg,
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
  detailsCard: {
    flex: 1,
    backgroundColor: AppTheme.palette.midnightViolet,
    borderTopLeftRadius: AppTheme.radius.xl,
    borderTopRightRadius: AppTheme.radius.xl,
    marginTop: -20,
    paddingHorizontal: AppTheme.spacing.xl,
    paddingTop: AppTheme.spacing.sm,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
    alignSelf: 'center',
    marginBottom: AppTheme.spacing.lg,
  },

  /* Name row */
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  placeName: {
    flex: 1,
    color: AppTheme.palette.white,
    fontSize: 24,
    fontWeight: '700',
    marginRight: AppTheme.spacing.md,
  },
  ratingText: {
    color: '#D7CFDB',
    fontSize: 13,
    marginTop: 4,
  },
  placeAddress: {
    color: '#D7CFDB',
    fontSize: AppTheme.typography.body,
    marginTop: AppTheme.spacing.xs,
  },

  /* Details section */
  detailsSection: {
    marginTop: AppTheme.spacing.xl,
    gap: AppTheme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF15',
    paddingTop: AppTheme.spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.md,
  },
  detailText: {
    flex: 1,
    color: '#D7CFDB',
    fontSize: 14,
  },

  /* Google Maps link */
  googleMapsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AppTheme.spacing.sm,
    marginTop: AppTheme.spacing.xl,
    alignSelf: 'center',
  },
  linkText: {
    color: AppTheme.palette.teal,
    fontSize: AppTheme.typography.caption,
    fontWeight: '500',
  },

  /* Directions button */
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: AppTheme.spacing.sm,
    backgroundColor: AppTheme.palette.teal,
    borderRadius: AppTheme.radius.md,
    paddingVertical: 16,
    marginTop: AppTheme.spacing.xl,
  },
  directionsButtonText: {
    color: AppTheme.palette.white,
    fontWeight: '700',
    fontSize: 17,
  },
});
