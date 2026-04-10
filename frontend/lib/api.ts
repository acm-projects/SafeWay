import Constants from 'expo-constants';

// Force HTTP for local/LAN backend URLs — uvicorn serves plain HTTP, never TLS.
// If the .env accidentally has https://, this corrects it at runtime so React Native
// doesn't throw "Network request failed" from a failed SSL handshake.
function _resolveBaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname;
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '10.0.2.2' ||           // Android emulator host alias
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (isLocal && u.protocol === 'https:') {
      u.protocol = 'http:';
      return u.toString().replace(/\/$/, '');
    }
  } catch {
    // not a valid URL, return as-is
  }
  return raw.replace(/\/$/, '');
}

const _rawBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:8000';
/** Resolved base URL (HTTP fix for local dev). Safe to use in hooks outside this module. */
export const apiBaseUrl = _resolveBaseUrl(_rawBaseUrl);

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
  segment_risks?: any[];
  high_risk_coords?: Array<{ latitude: number; longitude: number }>;
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
  avoid?: string[];
}): Promise<SafetyRoutesResponse> {
  const res = await request<any>('/maps/route', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  return {
    travel_mode: res.travel_mode ?? res.travelMode ?? 'DRIVE',
    routes: (res.routes ?? []).map((r: any) => {
      const rawDist = r.distance_meters ?? r.distance ?? 0;
      const routeKmVal = r.route_km;
      // SafeWay A* sometimes returns distance_meters=0 but has route_km — derive fallback
      const effectiveDist = rawDist > 0 ? rawDist : (routeKmVal ? Math.round(routeKmVal * 1000) : 0);
      return {
        distance_meters: effectiveDist,
        duration: typeof r.duration === 'string'
          ? r.duration
          : r.durationSecs != null
            ? `${r.durationSecs}s`
            : r.duration?.value != null
              ? `${r.duration.value}s`
              : '0s',
        polyline: r.polyline ?? '',
        coordinates: r.coordinates ?? (r.polyline ? decodePolyline(r.polyline) : []),
        safety_score: r.safety_score ?? null,
        safety_label: r.safety_label ?? 'unknown',
        route_source: r.route_source ?? r.routeSource ?? 'google',
        risk_per_km: r.risk_per_km,
        total_exposure: r.total_exposure,
        route_km: routeKmVal,
        n_high_risk: r.n_high_risk ?? r.nHighRisk ?? 0,
        top_risk_factors: r.top_risk_factors ?? r.topRiskFactors,
        time_band: r.time_band ?? r.timeBand,
        segment_risks: r.segment_risks ?? r.segmentRisks,
        time_penalty_pct: r.time_penalty_pct ?? r.timePenaltyPct,
        risk_reduction_pct: r.risk_reduction_pct ?? r.riskReductionPct,
        aadt_avg: r.aadt_avg ?? r.aadtAvg,
        aadt_max: r.aadt_max ?? r.aadtMax,
        high_risk_coords: r.high_risk_coords ?? [],
      };
    }),
  };
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

/** Local wall-clock time → RFC3339 with offset (for Google Routes departure/arrival). */
function localWallTimeToRFC3339(hour: number, minute: number): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(hour, minute, 0, 0);
  const now = new Date();
  if (d.getTime() < now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const se = pad(d.getSeconds());
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  return `${y}-${mo}-${da}T${h}:${mi}:${se}${sign}${oh}:${om}`;
}

export type RouteTimingInput =
  | { kind: 'now' }
  | { kind: 'depart'; hour: number; minute: number }
  | { kind: 'arrive'; hour: number; minute: number };

export async function getMultipleRoutes(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travel_mode: 'DRIVE' | 'WALK' | 'BICYCLE';
  avoid?: Set<string>;
  /** When set (DRIVE + traffic-aware), influences ETA via departure or arrival time. */
  timing?: RouteTimingInput;
}): Promise<AlternativeRoute[]> {
  if (!googleMapsKey) return [];

  const body: Record<string, any> = {
    origin: { location: { latLng: { latitude: params.origin.lat, longitude: params.origin.lng } } },
    destination: { location: { latLng: { latitude: params.destination.lat, longitude: params.destination.lng } } },
    travelMode: params.travel_mode,
    // Google Routes API v2 only supports computeAlternativeRoutes for DRIVE/TWO_WHEELER.
    // Sending it for WALK or BICYCLE causes a 400 error and returns no routes at all.
    computeAlternativeRoutes: params.travel_mode === 'DRIVE' || (params.travel_mode as string) === 'TWO_WHEELER',
  };
  if (params.travel_mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    // Pass avoid preferences as routeModifiers
    if (params.avoid && params.avoid.size > 0) {
      body.routeModifiers = {
        avoidTolls:    params.avoid.has('tolls'),
        avoidHighways: params.avoid.has('highways'),
        avoidFerries:  params.avoid.has('ferries'),
      };
    }
    const t = params.timing;
    if (t && t.kind === 'depart') {
      body.departureTime = localWallTimeToRFC3339(t.hour, t.minute);
    } else if (t && t.kind === 'arrive') {
      body.arrivalTime = localWallTimeToRFC3339(t.hour, t.minute);
    }
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

// ── Turn-by-turn directions via Google Routes API ─────────────────────────────
export type DirectionStep = {
  distanceMeters: number;
  staticDuration: string;
  htmlInstruction: string;
  maneuver: string;
};

export async function getRouteDirections(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  travel_mode: 'DRIVE' | 'WALK' | 'BICYCLE';
}): Promise<DirectionStep[]> {
  if (!googleMapsKey) return [];
  try {
    const body = {
      origin: { location: { latLng: { latitude: params.origin.lat, longitude: params.origin.lng } } },
      destination: { location: { latLng: { latitude: params.destination.lat, longitude: params.destination.lng } } },
      travelMode: params.travel_mode,
    };
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleMapsKey,
        'X-Goog-FieldMask': 'routes.legs.steps',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const steps: any[] = data.routes?.[0]?.legs?.[0]?.steps ?? [];
    return steps.map((s: any) => ({
      distanceMeters: s.distanceMeters ?? 0,
      staticDuration: s.staticDuration ?? '0s',
      htmlInstruction: s.navigationInstruction?.instructions ?? '',
      maneuver: s.navigationInstruction?.maneuver ?? 'STRAIGHT',
    }));
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