const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000';

export type PlaceSearchResult = {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_maps_uri?: string;
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
  const encoded = encodeURIComponent(query.trim());
  const payload = await request<{ results: PlaceSearchResult[] }>(`/maps/search?query=${encoded}`);
  return payload.results ?? [];
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
