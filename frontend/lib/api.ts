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

export type RouteResponse = {
  distance_meters: number;
  duration: string;
  travel_mode: string;
  polyline: string;
  coordinates: RoutePoint[];
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
  const t = query.trim();
  if (!t) return [];

  // Call Google Places Text Search (New) API directly from the client so that
  // search works on physical devices regardless of backend reachability.
  if (googleMapsKey) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleMapsKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri',
        },
        body: JSON.stringify({ textQuery: t, maxResultCount: 8 }),
      });
      if (res.ok) {
        const data = await res.json();
        const places: any[] = data.places ?? [];
        return places.map((p: any) => ({
          place_id: p.id ?? '',
          name: p.displayName?.text ?? '',
          address: p.formattedAddress ?? '',
          lat: p.location?.latitude ?? 0,
          lng: p.location?.longitude ?? 0,
          google_maps_uri: p.googleMapsUri,
        }));
      }
    } catch {
      // fall through to backend fallback
    }
  }

  // Fallback: try the backend
  try {
    const payload = await request<{ results: PlaceSearchResult[] }>(`/maps/search?query=${encodeURIComponent(t)}`);
    return payload.results ?? [];
  } catch {
    return [];
  }
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

// ── Rich route from backend with safety scoring, SHAP factors, AADT ──────────
export type SafetyRoute = {
  distance_meters: number;
  duration: string;            // e.g. "600s"
  polyline: string;
  coordinates: RoutePoint[];
  safety_score: number | null;
  safety_label: string;        // "safe" | "moderate" | "high_risk" | "unknown"
  route_source: 'google' | 'safeway';
  risk_per_km?: number;
  total_exposure?: number;
  route_km?: number;
  n_high_risk?: number;
  top_risk_factors?: { factor: string; weight: number }[];
  time_band?: string;
  segment_risks?: number[];
  time_penalty_pct?: number;
  risk_reduction_pct?: number;
  aadt_avg?: number;
  aadt_max?: number;
};

export type SafetyRoutesResponse = {
  routes: SafetyRoute[];
  travel_mode: string;
};

export async function getBackendRoutes(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travel_mode?: 'DRIVE' | 'WALK' | 'BICYCLE';
  departure_hour?: number;
}): Promise<SafetyRoutesResponse> {
  return request<SafetyRoutesResponse>('/maps/route', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Multiple alternative routes via Google Routes API directly ────────────────
// The backend only returns routes[0]. This function calls the Routes API
// directly from the frontend with computeAlternativeRoutes=true to get up to
// 3 routes (main + up to 2 alternatives) for a given mode.

export type AlternativeRoute = {
  index: number;            // 0 = primary, 1+ = alternatives
  coords: RoutePoint[];
  distance: number;         // metres
  durationSecs: number;
  label: string;            // e.g. "Fastest", "Alternative 1"
  routeLabels: string[];    // raw labels from Google: ["DEFAULT_ROUTE", "DEFAULT_ROUTE_ALTERNATE"]
};

function decodePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export async function getMultipleRoutes(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travel_mode: 'DRIVE' | 'WALK' | 'BICYCLE';
}): Promise<AlternativeRoute[]> {
  if (!googleMapsKey) return [];

  const body: Record<string, any> = {
    origin: { location: { latLng: { latitude: params.origin.lat, longitude: params.origin.lng } } },
    destination: { location: { latLng: { latitude: params.destination.lat, longitude: params.destination.lng } } },
    travelMode: params.travel_mode,
    computeAlternativeRoutes: true,
  };
  if (params.travel_mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
  }

  const fields = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels,routes.description';

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleMapsKey,
        'X-Goog-FieldMask': fields,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const routes: any[] = data.routes ?? [];

    const ROUTE_NAMES = ['Fastest Route', 'Alternative Route', 'Scenic Route'];

    return routes.map((r: any, i: number) => {
      const polyline = r.polyline?.encodedPolyline ?? '';
      const durationSecs = parseInt((r.duration ?? '0s').replace('s', ''), 10);
      const labels: string[] = r.routeLabels ?? [];
      const name = ROUTE_NAMES[i] ?? `Route ${i + 1}`;
      return {
        index: i,
        coords: decodePolyline(polyline),
        distance: r.distanceMeters ?? 0,
        durationSecs,
        label: name,
        routeLabels: labels,
      };
    });
  } catch {
    return [];
  }
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

export async function createEmergencyContact(
  jwt: string,
  payload: { name: string; phone: string; relationship: string },
): Promise<any> {
  return request('/emergency-contacts', {
    method: 'POST',
    headers: authHeaders(jwt),
    body: JSON.stringify(payload),
  });
}

export async function updateUserSettings(
  jwt: string,
  payload: Record<string, any>,
): Promise<any> {
  return request('/user/settings', {
    method: 'PUT',
    headers: authHeaders(jwt),
    body: JSON.stringify(payload),
  });
}