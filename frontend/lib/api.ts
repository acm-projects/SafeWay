import Constants from 'expo-constants';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8000';

// `EXPO_PUBLIC_*` vars are inlined at build time. When running via `npx expo start`
// with a local .env they work directly. As a fallback we also read from
// Constants.expoConfig.extra (set in app.config.ts) so the key is available in
// development even if the env var wasn't exported to the shell.
const googleMapsKey: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  '';

export type PlaceSearchResult = {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_maps_uri?: string;
};

export type PlaceDetails = {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  phone?: string;
  opening_hours?: string;
  photo_urls?: string[];
  types?: string[];
  google_maps_uri?: string;
  editorial_summary?: string;
};

export type Bookmark = {
  id: string;
  user_id: string;
  title: string;
  address?: string;
  lat: number;
  lng: number;
  created_at: string;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type RouteInfo = {
  distance_meters: number;
  duration: string;
  polyline: string;
  coordinates: RoutePoint[];
  safety_score?: number;
  safety_label?: string;
};

export type RouteResponse = {
  routes: RouteInfo[];
  travel_mode: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) message = String(payload.detail);
    } catch {
      // Fallback to generic message when response has no JSON body.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const encoded = encodeURIComponent(query.trim());
  const payload = await request<{ results: PlaceSearchResult[] }>(`/maps/search?query=${encoded}`);
  return payload.results ?? [];
}

// Returns true for real Google Place IDs (e.g. ChIJ...).
// Bookmark rows from the DB have UUID format — skip the API call for those.
function isGooglePlaceId(id: string): boolean {
  // Google place IDs start with "ChIJ" or occasionally other prefixes,
  // but they are never UUID (8-4-4-4-12 hex) format.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return !uuidPattern.test(id);
}

// Fetch rich place details directly from the Google Places API (New) v1.
// Never hits the backend (which has no /maps/place endpoint).
// Returns null for UUIDs (bookmarks) or if the API call fails.
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  if (!placeId || !isGooglePlaceId(placeId)) return null;
  if (!googleMapsKey) return null;

  try {
    const fields = [
      'id', 'displayName', 'formattedAddress', 'location',
      'rating', 'userRatingCount', 'websiteUri', 'nationalPhoneNumber',
      'regularOpeningHours', 'currentOpeningHours', 'photos', 'types',
      'googleMapsUri', 'editorialSummary',
    ].join(',');

    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleMapsKey,
          'X-Goog-FieldMask': fields,
        },
      }
    );
    if (!response.ok) return null;
    const p = await response.json();

    // Build photo URLs
    const photoUrls: string[] = (p.photos ?? []).slice(0, 6).map((ph: any) => {
      const ref = ph.name;
      return `https://places.googleapis.com/v1/${ref}/media?maxHeightPx=800&maxWidthPx=800&key=${googleMapsKey}`;
    });

    // Parse opening hours into readable lines
    let openingHours: string | undefined;
    const oh = p.currentOpeningHours ?? p.regularOpeningHours;
    if (oh?.weekdayDescriptions?.length) {
      openingHours = oh.weekdayDescriptions.join('\n');
    } else if (oh?.openNow !== undefined) {
      openingHours = oh.openNow ? 'Open now' : 'Closed';
    }

    return {
      place_id: p.id ?? placeId,
      name: p.displayName?.text ?? '',
      address: p.formattedAddress ?? '',
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
      rating: p.rating,
      user_ratings_total: p.userRatingCount,
      website: p.websiteUri,
      phone: p.nationalPhoneNumber,
      opening_hours: openingHours,
      photo_urls: photoUrls,
      types: p.types,
      google_maps_uri: p.googleMapsUri,
      editorial_summary: p.editorialSummary?.text,
    };
  } catch {
    return null;
  }
}

export async function getRoute(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travel_mode?: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TWO_WHEELER';
}): Promise<RouteResponse> {
  return request<RouteResponse>('/maps/route', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

function authHeaders(jwt: string) {
  return { Authorization: `Bearer ${jwt}` };
}

export async function listBookmarks(jwt: string): Promise<Bookmark[]> {
  return request<Bookmark[]>('/bookmarks', { headers: authHeaders(jwt) });
}

export async function createBookmark(
  jwt: string,
  payload: { title: string; address?: string; lat: number; lng: number }
): Promise<Bookmark> {
  return request<Bookmark>('/bookmarks', {
    method: 'POST',
    headers: authHeaders(jwt),
    body: JSON.stringify(payload),
  });
}

export async function deleteBookmark(jwt: string, bookmarkId: string): Promise<{ deleted: boolean; id: string }> {
  return request<{ deleted: boolean; id: string }>(`/bookmarks/${bookmarkId}`, {
    method: 'DELETE',
    headers: authHeaders(jwt),
  });
}

export type WeatherData = {
  temperature: number;
  unit: string;
  description: string;
  weather_code: number;
  wind_speed: number;
};

export async function getWeather(lat: number, lng: number): Promise<WeatherData> {
  return request<WeatherData>(`/weather?lat=${lat}&lng=${lng}`);
}

// ── Recent Searches ─────────────────────────────────────────────────────────

export type RecentSearch = {
  id: string;
  query: string;
  place_id?: string;
  place_name?: string;
  place_address?: string;
  lat?: number;
  lng?: number;
  searched_at: string;
};

export async function listRecentSearches(jwt: string): Promise<RecentSearch[]> {
  return request<RecentSearch[]>('/recent-searches', { headers: authHeaders(jwt) });
}

export async function saveRecentSearch(
  jwt: string,
  data: { query: string; place_id?: string; place_name?: string; place_address?: string; lat?: number; lng?: number }
): Promise<RecentSearch> {
  return request<RecentSearch>('/recent-searches', {
    method: 'POST',
    headers: authHeaders(jwt),
    body: JSON.stringify(data),
  });
}

export async function deleteRecentSearch(jwt: string, id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/recent-searches/${id}`, {
    method: 'DELETE',
    headers: authHeaders(jwt),
  });
}

export async function clearRecentSearches(jwt: string): Promise<void> {
  await request<{ cleared: boolean }>('/recent-searches', {
    method: 'DELETE',
    headers: authHeaders(jwt),
  });
}

// ── Emergency Contacts ──────────────────────────────────────────────────────

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relationship?: string;
  priority: number;
  created_at: string;
};

export async function listEmergencyContacts(jwt: string): Promise<EmergencyContact[]> {
  return request<EmergencyContact[]>('/emergency-contacts', { headers: authHeaders(jwt) });
}

export async function createEmergencyContact(
  jwt: string,
  data: { name: string; phone: string; relationship?: string; priority?: number }
): Promise<EmergencyContact> {
  return request<EmergencyContact>('/emergency-contacts', {
    method: 'POST',
    headers: authHeaders(jwt),
    body: JSON.stringify(data),
  });
}

export async function deleteEmergencyContact(jwt: string, id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/emergency-contacts/${id}`, {
    method: 'DELETE',
    headers: authHeaders(jwt),
  });
}

// ── User Settings ───────────────────────────────────────────────────────────

export type UserSettings = {
  sos_direct_911: boolean;
  sos_silent_share: boolean;
};

export async function getUserSettings(jwt: string): Promise<UserSettings> {
  return request<UserSettings>('/user-settings', { headers: authHeaders(jwt) });
}

export async function updateUserSettings(jwt: string, data: UserSettings): Promise<UserSettings> {
  return request<UserSettings>('/user-settings', {
    method: 'PUT',
    headers: authHeaders(jwt),
    body: JSON.stringify(data),
  });
}

// ── News ────────────────────────────────────────────────────────────────────

export type NewsArticle = {
  title: string;
  description: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: string;
};

export async function getNews(category?: string, location?: string): Promise<NewsArticle[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (location) params.set('location', location);
  const q = params.toString() ? `?${params.toString()}` : '';
  const data = await request<{ articles: NewsArticle[] }>(`/news${q}`);
  return data.articles ?? [];
}