import os
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal

import psycopg2
import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import Client, create_client

# Load .env from backend directory
load_dotenv(Path(__file__).resolve().parent / ".env")


app = FastAPI(title="SafeWay API")


# ---------------------------------------------------------------------------
# Simple in-memory daily rate limiter for Google API calls (free-tier guard)
# ---------------------------------------------------------------------------
DAILY_API_LIMIT = 200  # hard cap — keeps us well under 50

_api_call_count = 0
_api_call_date = datetime.now(timezone.utc).date()


def _check_and_increment_api_limit():
    """Increment the daily counter. Raises HTTP 429 if we've hit the limit."""
    global _api_call_count, _api_call_date
    today = datetime.now(timezone.utc).date()
    if today != _api_call_date:
        _api_call_count = 0
        _api_call_date = today
    if _api_call_count >= DAILY_API_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily API limit reached ({DAILY_API_LIMIT} calls). Resets at midnight UTC.",
        )
    _api_call_count += 1

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BookmarkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    lat: float
    lng: float


class LatLng(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    travel_mode: Literal["DRIVE", "WALK", "BICYCLE", "TWO_WHEELER"] = "WALK"
    departure_hour: int | None = None  # Phase G: 0-23, defaults to current hour


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_anon_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_anon_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in backend .env")
    return create_client(supabase_url, supabase_anon_key)


def get_db_conn():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Missing DATABASE_URL in backend .env",
        )
    return psycopg2.connect(database_url)


def decode_polyline(encoded: str) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    index = 0
    lat = 0
    lng = 0

    while index < len(encoded):
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if result & 1 else result >> 1
        lat += dlat

        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if result & 1 else result >> 1
        lng += dlng

        points.append({"latitude": lat / 1e5, "longitude": lng / 1e5})

    return points


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Expected Bearer token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    try:
        supabase = get_supabase_client()
        auth_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token") from exc

    user = getattr(auth_response, "user", None)
    if not user or not user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")

    return str(user.id)


@app.get("/")
def read_root():
    return {"service": "SafeWay API", "status": "ok"}


@app.get("/db-check")
def check_supabase_db():
    """Verify Supabase PostgreSQL database connection."""
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        return {"ok": True, "message": "Supabase database connection OK"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/bookmarks")
def list_bookmarks(user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id, title, address, lat, lng, created_at
                FROM public.bookmarks
                WHERE user_id = %s
                ORDER BY created_at DESC
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        return [
            {
                "id": str(row[0]),
                "user_id": str(row[1]),
                "title": row[2],
                "address": row[3],
                "lat": row[4],
                "lng": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
            }
            for row in rows
        ]
    finally:
        conn.close()


@app.post("/bookmarks", status_code=status.HTTP_201_CREATED)
def create_bookmark(payload: BookmarkCreate, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.bookmarks (user_id, title, address, lat, lng)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, user_id, title, address, lat, lng, created_at
                """,
                (user_id, payload.title, payload.address, payload.lat, payload.lng),
            )
            row = cur.fetchone()
        conn.commit()
        return {
            "id": str(row[0]),
            "user_id": str(row[1]),
            "title": row[2],
            "address": row[3],
            "lat": row[4],
            "lng": row[5],
            "created_at": row[6].isoformat() if row[6] else None,
        }
    finally:
        conn.close()


@app.delete("/bookmarks/{bookmark_id}")
def delete_bookmark(bookmark_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM public.bookmarks
                WHERE id = %s AND user_id = %s
                RETURNING id
                """,
                (bookmark_id, user_id),
            )
            row = cur.fetchone()
        conn.commit()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bookmark not found")
        return {"deleted": True, "id": str(row[0])}
    finally:
        conn.close()


@app.get("/maps/search")
def search_places(query: str = Query(min_length=2), limit: int = Query(default=5, ge=1, le=10)):
    _check_and_increment_api_limit()
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Missing GOOGLE_MAPS_API_KEY")

    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": google_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.googleMapsUri"
        ),
    }
    body = {"textQuery": query, "maxResultCount": limit}

    response = requests.post(url, headers=headers, json=body, timeout=20)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Places API error: {response.text}",
        )

    raw_places = response.json().get("places", [])
    places = []
    for place in raw_places:
        location = place.get("location") or {}
        display_name = place.get("displayName") or {}
        places.append(
            {
                "place_id": place.get("id"),
                "name": display_name.get("text"),
                "address": place.get("formattedAddress"),
                "lat": location.get("latitude"),
                "lng": location.get("longitude"),
                "google_maps_uri": place.get("googleMapsUri"),
            }
        )

    return {"results": places}


@app.get("/maps/place/{place_id}")
def get_place_details(place_id: str):
    """Proxy Google Places API v1 details — keeps API key server-side."""
    _check_and_increment_api_limit()
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_MAPS_API_KEY")

    fields = (
        "id,displayName,formattedAddress,location,"
        "rating,userRatingCount,websiteUri,nationalPhoneNumber,"
        "regularOpeningHours,currentOpeningHours,photos,types,"
        "googleMapsUri,editorialSummary"
    )
    response = requests.get(
        f"https://places.googleapis.com/v1/places/{place_id}",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": google_key,
            "X-Goog-FieldMask": fields,
        },
        params={"languageCode": "en"},
        timeout=20,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="Place details fetch failed")

    p = response.json()
    oh = p.get("currentOpeningHours") or p.get("regularOpeningHours") or {}
    opening_hours = None
    if oh.get("weekdayDescriptions"):
        opening_hours = "\n".join(oh["weekdayDescriptions"])
    elif oh.get("openNow") is not None:
        opening_hours = "Open now" if oh["openNow"] else "Closed"

    photo_refs = [ph.get("name") for ph in (p.get("photos") or [])[:6] if ph.get("name")]

    return {
        "place_id": p.get("id") or place_id,
        "name": (p.get("displayName") or {}).get("text", ""),
        "address": p.get("formattedAddress", ""),
        "lat": (p.get("location") or {}).get("latitude", 0),
        "lng": (p.get("location") or {}).get("longitude", 0),
        "rating": p.get("rating"),
        "user_ratings_total": p.get("userRatingCount"),
        "website": p.get("websiteUri"),
        "phone": p.get("nationalPhoneNumber"),
        "opening_hours": opening_hours,
        "photo_urls": photo_refs,
        "types": p.get("types"),
        "google_maps_uri": p.get("googleMapsUri"),
        "editorial_summary": (p.get("editorialSummary") or {}).get("text"),
    }


@app.get("/maps/place-photo")
def get_place_photo(ref: str = Query(..., description="Photo resource name from Places API")):
    """Proxy Google Places photo — streams image bytes so API key stays server-side."""
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_MAPS_API_KEY")

    photo_url = f"https://places.googleapis.com/v1/{ref}/media"
    response = requests.get(
        photo_url,
        params={"maxHeightPx": 800, "maxWidthPx": 800, "key": google_key},
        timeout=20,
        stream=True,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="Photo fetch failed")

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        response.iter_content(chunk_size=8192),
        media_type=response.headers.get("content-type", "image/jpeg"),
    )


@app.post("/maps/route")
def compute_route(payload: RouteRequest):
    _check_and_increment_api_limit()
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Missing GOOGLE_MAPS_API_KEY")

    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": google_key,
        "X-Goog-FieldMask": (
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,"
            "routes.legs.localizedValues,routes.routeLabels"
        ),
    }
    body = {
        "origin": {
            "location": {
                "latLng": {"latitude": payload.origin.lat, "longitude": payload.origin.lng}
            }
        },
        "destination": {
            "location": {
                "latLng": {"latitude": payload.destination.lat, "longitude": payload.destination.lng}
            }
        },
        "travelMode": payload.travel_mode,
    }
    if payload.travel_mode in ("DRIVE", "TWO_WHEELER"):
        body["routingPreference"] = "TRAFFIC_UNAWARE"
        body["computeAlternativeRoutes"] = True

    response = requests.post(url, headers=headers, json=body, timeout=25)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Routes API error: {response.text}",
        )

    raw_routes = response.json().get("routes", [])
    if not raw_routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No routes found")

    result_routes = []
    try:
        from risk_cache import score_coordinates
        for route in raw_routes:
            polyline = ((route.get("polyline") or {}).get("encodedPolyline")) or ""
            coordinates = decode_polyline(polyline) if polyline else []
            safety_score = None
            safety_label = "unknown"
            extra = {}
            try:
                safety = score_coordinates(
                    coordinates,
                    sample_every=5,
                    departure_hour=payload.departure_hour,
                    travel_mode=payload.travel_mode,
                )
                safety_score = safety.get("score")
                safety_label = safety.get("label", "unknown")
                extra = {
                    "risk_per_km": safety.get("risk_per_km"),
                    "total_exposure": safety.get("total_exposure"),
                    "route_km": safety.get("route_km"),
                    "n_high_risk": safety.get("n_high_risk", 0),
                    "top_risk_factors": safety.get("top_risk_factors", []),
                    "time_band": safety.get("time_band"),
                    "segment_risks": safety.get("segment_risks", []),
                    "high_risk_coords": safety.get("high_risk_coords", []),
                    "aadt_avg": safety.get("aadt_avg"),
                    "aadt_max": safety.get("aadt_max"),
                }
            except Exception as score_err:
                print(f"[route] score_coordinates failed for route: {score_err}", flush=True)
            result_routes.append({
                "distance_meters": route.get("distanceMeters"),
                "duration": route.get("duration"),
                "polyline": polyline,
                "coordinates": coordinates,
                "safety_score": safety_score,
                "safety_label": safety_label,
                "route_source": "google",
                **extra,
            })
    except Exception as e:
        print(f"[route] safety scoring skipped: {e}")
        for route in raw_routes:
            polyline = ((route.get("polyline") or {}).get("encodedPolyline")) or ""
            coordinates = decode_polyline(polyline) if polyline else []
            result_routes.append({
                "distance_meters": route.get("distanceMeters"),
                "duration": route.get("duration"),
                "polyline": polyline,
                "coordinates": coordinates,
                "safety_score": None,
                "safety_label": "unknown",
                "route_source": "google",
            })

    # ── SafeWay A* safer route ──────────────────────────────────────────
    from astar_route import compute_astar_route
    astar_result = compute_astar_route(
        payload.origin.lat, payload.origin.lng,
        payload.destination.lat, payload.destination.lng,
        departure_hour=payload.departure_hour,
        travel_mode=payload.travel_mode,
    )
    if astar_result:
        result_routes.append(astar_result)

    # Sort: SafeWay route first, then by safety score ascending (safest first)
    result_routes.sort(key=lambda r: (
        0 if r.get("route_source") == "safeway" else 1,
        r.get("safety_score") if r.get("safety_score") is not None else 999,
    ))

    return {"routes": result_routes, "travel_mode": payload.travel_mode}


@app.get("/maps/usage")
def api_usage():
    """Check how many Google API calls remain today."""
    global _api_call_count, _api_call_date
    today = datetime.now(timezone.utc).date()
    if today != _api_call_date:
        _api_call_count = 0
        _api_call_date = today
    return {
        "used": _api_call_count,
        "limit": DAILY_API_LIMIT,
        "remaining": max(0, DAILY_API_LIMIT - _api_call_count),
    }


@app.get("/weather")
def get_weather(lat: float = Query(...), lng: float = Query(...)):
    """Get current weather using Open-Meteo API (free, no API key needed)."""
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lng}"
        f"&current=temperature_2m,weather_code,wind_speed_10m"
        f"&temperature_unit=fahrenheit"
    )
    response = requests.get(url, timeout=10)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="Weather API error")

    data = response.json()
    current = data.get("current", {})

    # Map WMO weather codes to descriptions
    code = current.get("weather_code", 0)
    descriptions = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle",
        55: "Dense drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
        71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Light showers",
        81: "Showers", 82: "Heavy showers", 95: "Thunderstorm",
        96: "Thunderstorm with hail", 99: "Severe thunderstorm",
    }

    return {
        "temperature": current.get("temperature_2m"),
        "unit": "F",
        "description": descriptions.get(code, "Unknown"),
        "weather_code": code,
        "wind_speed": current.get("wind_speed_10m"),
    }


# ---------------------------------------------------------------------------
# Recent Searches
# ---------------------------------------------------------------------------
class RecentSearchCreate(BaseModel):
    query: str = Field(min_length=1, max_length=255)
    place_id: str | None = None
    place_name: str | None = None
    place_address: str | None = None
    lat: float | None = None
    lng: float | None = None


@app.get("/recent-searches")
def list_recent_searches(user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, query, place_id, place_name, place_address, lat, lng, searched_at
                FROM public.recent_searches
                WHERE user_id = %s
                ORDER BY searched_at DESC
                LIMIT 20
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        return [
            {
                "id": str(r[0]), "query": r[1], "place_id": r[2],
                "place_name": r[3], "place_address": r[4],
                "lat": r[5], "lng": r[6],
                "searched_at": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]
    finally:
        conn.close()


@app.post("/recent-searches", status_code=status.HTTP_201_CREATED)
def save_recent_search(payload: RecentSearchCreate, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.recent_searches
                    (user_id, query, place_id, place_name, place_address, lat, lng)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, query, place_id, place_name, place_address, lat, lng, searched_at
                """,
                (user_id, payload.query, payload.place_id, payload.place_name,
                 payload.place_address, payload.lat, payload.lng),
            )
            r = cur.fetchone()
        conn.commit()
        return {
            "id": str(r[0]), "query": r[1], "place_id": r[2],
            "place_name": r[3], "place_address": r[4],
            "lat": r[5], "lng": r[6],
            "searched_at": r[7].isoformat() if r[7] else None,
        }
    finally:
        conn.close()


@app.delete("/recent-searches/{search_id}")
def delete_recent_search(search_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.recent_searches WHERE id = %s AND user_id = %s RETURNING id",
                (search_id, user_id),
            )
            row = cur.fetchone()
        conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Search not found")
        return {"deleted": True}
    finally:
        conn.close()


@app.delete("/recent-searches")
def clear_recent_searches(user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.recent_searches WHERE user_id = %s", (user_id,))
        conn.commit()
        return {"cleared": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Emergency Contacts
# ---------------------------------------------------------------------------
class EmergencyContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=20)
    relationship: str | None = None
    priority: int = 0


@app.get("/emergency-contacts")
def list_emergency_contacts(user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, phone, relationship, priority, created_at
                FROM public.emergency_contacts
                WHERE user_id = %s ORDER BY priority
                """,
                (user_id,),
            )
            rows = cur.fetchall()
        return [
            {"id": str(r[0]), "name": r[1], "phone": r[2], "relationship": r[3],
             "priority": r[4], "created_at": r[5].isoformat() if r[5] else None}
            for r in rows
        ]
    finally:
        conn.close()


@app.post("/emergency-contacts", status_code=status.HTTP_201_CREATED)
def create_emergency_contact(payload: EmergencyContactCreate, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.emergency_contacts (user_id, name, phone, relationship, priority)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, name, phone, relationship, priority, created_at
                """,
                (user_id, payload.name, payload.phone, payload.relationship, payload.priority),
            )
            r = cur.fetchone()
        conn.commit()
        return {"id": str(r[0]), "name": r[1], "phone": r[2], "relationship": r[3],
                "priority": r[4], "created_at": r[5].isoformat() if r[5] else None}
    finally:
        conn.close()


@app.delete("/emergency-contacts/{contact_id}")
def delete_emergency_contact(contact_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.emergency_contacts WHERE id = %s AND user_id = %s RETURNING id",
                (contact_id, user_id),
            )
            row = cur.fetchone()
        conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")
        return {"deleted": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# User Settings (SOS prefs)
# ---------------------------------------------------------------------------
class UserSettingsUpdate(BaseModel):
    sos_direct_911: bool = True
    sos_silent_share: bool = True


@app.get("/user-settings")
def get_user_settings(user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sos_direct_911, sos_silent_share FROM public.user_settings WHERE user_id = %s",
                (user_id,),
            )
            row = cur.fetchone()
        if not row:
            return {"sos_direct_911": True, "sos_silent_share": True}
        return {"sos_direct_911": row[0], "sos_silent_share": row[1]}
    finally:
        conn.close()


@app.put("/user-settings")
def update_user_settings(payload: UserSettingsUpdate, user_id: str = Depends(get_current_user_id)):
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.user_settings (user_id, sos_direct_911, sos_silent_share, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (user_id) DO UPDATE SET
                    sos_direct_911 = EXCLUDED.sos_direct_911,
                    sos_silent_share = EXCLUDED.sos_silent_share,
                    updated_at = now()
                """,
                (user_id, payload.sos_direct_911, payload.sos_silent_share),
            )
        conn.commit()
        return {"sos_direct_911": payload.sos_direct_911, "sos_silent_share": payload.sos_silent_share}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# News (NewsData.io proxy with 15-min cache)
# ---------------------------------------------------------------------------
_news_cache: dict[str, tuple[float, list]] = {}
NEWS_CACHE_TTL = 300  # 5 minutes


@app.get("/news")
def get_news(
    category: str = Query(default="general"),
    location: str | None = Query(default=None),
):
    """Fetch safety/traffic news via NewsData.io. Cached for 15 minutes."""
    location = (location or "").strip()
    cache_key = f"{category}:{location.lower()}"
    if cache_key in _news_cache:
        cached_at, articles = _news_cache[cache_key]
        if time.time() - cached_at < NEWS_CACHE_TTL:
            return {"articles": articles}

    newsdata_key = os.getenv("NEWSDATA_API_KEY", "")
    if not newsdata_key:
        raise HTTPException(status_code=500, detail="Missing NEWSDATA_API_KEY in backend .env")

    keyword_map = {
        "traffic": "traffic accident road safety highway crash",
        "weather": "weather storm warning flood",
        "safety": "pedestrian safety crime public safety",
        "general": "traffic road safety accident public safety",
    }
    base_query = keyword_map.get(category, keyword_map["general"])
    q = f"{location} {base_query}".strip()

    url = "https://newsdata.io/api/1/latest"
    params = {
        "apikey": newsdata_key,
        "q": q,
        "language": "en",
        "size": 10,
        "country": "us",
    }

    try:
        resp = requests.get(url, params=params, timeout=15)
        if resp.status_code >= 400:
            import logging
            logging.warning(f"NewsData API error: {resp.status_code} - {resp.text[:500]}")
            raise HTTPException(status_code=resp.status_code, detail=f"NewsData error: {resp.text[:200]}")
        data = resp.json()
        if data.get("status") == "error":
            raise HTTPException(
                status_code=502,
                detail=f"NewsData error: {data.get('message') or 'Unknown error'}",
            )
        articles = [
            {
                "title": a.get("title"),
                "description": a.get("description"),
                "url": a.get("link"),
                "image": a.get("image_url"),
                "publishedAt": a.get("pubDate"),
                "source": a.get("source_name"),
            }
            for a in data.get("results", [])
        ]
        deduped: list[dict] = []
        seen_urls: set[str] = set()
        for article in sorted(
            articles,
            key=lambda item: item.get("publishedAt") or "",
            reverse=True,
        ):
            url = article.get("url") or ""
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            deduped.append(article)
        final_articles = deduped[:10]
        _news_cache[cache_key] = (time.time(), final_articles)
        return {"articles": final_articles}
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"News fetch failed: {e}")


# ---------------------------------------------------------------------------
# Admin: cache management
# ---------------------------------------------------------------------------
@app.post("/admin/refresh-cache")
def admin_refresh_cache(authorization: str = Header(None)):
    """Force-reload risk/SHAP/time-of-day caches from GCS.

    Called by nightly GitHub Actions after model retraining, or manually.
    Protected by ADMIN_SECRET env var when set.
    """
    admin_secret = os.getenv("ADMIN_SECRET")
    if admin_secret:
        expected = f"Bearer {admin_secret}"
        if not authorization or authorization != expected:
            raise HTTPException(status_code=403, detail="Forbidden")
    from risk_cache import refresh_cache
    result = refresh_cache()
    return result
