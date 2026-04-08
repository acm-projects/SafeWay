import os
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal


import psycopg2
import requests
import math 
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

# TomTom daily rate limiter
TOMTOM_DAILY_LIMIT = 200  # keep well under 2500 free tier limit
_tomtom_call_count = 0
_tomtom_call_date = datetime.now(timezone.utc).date()


def _check_and_increment_tomtom_limit():
    """Increment TomTom daily counter. Raises HTTP 429 if limit hit."""
    global _tomtom_call_count, _tomtom_call_date
    today = datetime.now(timezone.utc).date()
    if today != _tomtom_call_date:
        _tomtom_call_count = 0
        _tomtom_call_date = today
    if _tomtom_call_count >= TOMTOM_DAILY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily TomTom API limit reached ({TOMTOM_DAILY_LIMIT} calls). Resets at midnight UTC.",
        )
    _tomtom_call_count += 1


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
        from model.generic_scorer import score_coordinates_generic

        # Check if route is within Chicago bounds
        CHICAGO_BOUNDS = {
            "min_lat": 41.63, "max_lat": 42.05,
            "min_lng": -87.94, "max_lng": -87.52,
        }

        def is_in_chicago(lat: float, lng: float) -> bool:
            return (
                CHICAGO_BOUNDS["min_lat"] <= lat <= CHICAGO_BOUNDS["max_lat"] and
                CHICAGO_BOUNDS["min_lng"] <= lng <= CHICAGO_BOUNDS["max_lng"]
            )

        use_chicago_model = is_in_chicago(payload.origin.lat, payload.origin.lng)

        for route in raw_routes:
            polyline = ((route.get("polyline") or {}).get("encodedPolyline")) or ""
            coordinates = decode_polyline(polyline) if polyline else []
            safety_score = None
            safety_label = "unknown"
            extra = {}
            try:
                if use_chicago_model:
                    safety = score_coordinates(
                        coordinates,
                        sample_every=5,
                        departure_hour=payload.departure_hour,
                        travel_mode=payload.travel_mode,
                    )
                else:
                    safety = score_coordinates_generic(
                        coordinates,
                        sample_every=5,
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
                }
            except Exception as scoring_err:
                print(f"[route] scoring error: {scoring_err}")

            result_routes.append({
                "distance_meters": route.get("distanceMeters"),
                "duration": route.get("duration"),
                "polyline": polyline,
                "coordinates": coordinates,
                "safety_score": safety_score,
                "safety_label": safety_label,
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
            })
    return {"routes": result_routes, "travel_mode": payload.travel_mode}


@app.get("/maps/usage")
@app.get("/traffic/usage")
def tomtom_usage():
    """Check how many TomTom API calls remain today."""
    global _tomtom_call_count, _tomtom_call_date
    today = datetime.now(timezone.utc).date()
    if today != _tomtom_call_date:
        _tomtom_call_count = 0
        _tomtom_call_date = today
    return {
        "used": _tomtom_call_count,
        "limit": TOMTOM_DAILY_LIMIT,
        "remaining": max(0, TOMTOM_DAILY_LIMIT - _tomtom_call_count),
    }

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
# Safe Route — returns Google fastest route + OSM safer alternative
# ---------------------------------------------------------------------------
class SafeRouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    travel_mode: Literal["DRIVE", "WALK", "BICYCLE", "TWO_WHEELER"] = "DRIVE"
    departure_hour: int | None = None
    beta: float = 0.5  # safety weight: higher = prioritize safety more


@app.post("/maps/safe-route")
def compute_safe_route(payload: SafeRouteRequest):
    """
    Returns two routes:
    1. Google fastest route (scored for safety)
    2. Safer OSM alternative (uses danger scores to avoid risky intersections)
    """
    _check_and_increment_api_limit()
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_MAPS_API_KEY")

    # Step 1: Get Google fastest route
    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": google_key,
        "X-Goog-FieldMask": (
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
        ),
    }
    body = {
        "origin": {"location": {"latLng": {"latitude": payload.origin.lat, "longitude": payload.origin.lng}}},
        "destination": {"location": {"latLng": {"latitude": payload.destination.lat, "longitude": payload.destination.lng}}},
        "travelMode": payload.travel_mode,
    }

    response = requests.post(url, headers=headers, json=body, timeout=25)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=f"Routes API error: {response.text}")

    raw_routes = response.json().get("routes", [])
    if not raw_routes:
        raise HTTPException(status_code=404, detail="No routes found")

    # Score Google route
    google_route = raw_routes[0]
    polyline = (google_route.get("polyline") or {}).get("encodedPolyline", "")
    google_coords = decode_polyline(polyline) if polyline else []
    google_safety = {}
    try:
        from risk_cache import score_coordinates
        google_safety = score_coordinates(google_coords, sample_every=5, departure_hour=payload.departure_hour, travel_mode=payload.travel_mode)
    except Exception as e:
        print(f"[safe-route] Google scoring failed: {e}")

    # Step 2: Find safer OSM alternative
    safer_route = None
    try:
        import osmnx as ox
        from risk_cache import get_graph, get_risk_map
        from model.route_scoring import attach_risk_to_graph, find_safer_route

        G = get_graph()
        risk_map = get_risk_map()
        attach_risk_to_graph(G, risk_map)

        # Find nearest OSM nodes to origin and destination
        origin_node = ox.distance.nearest_nodes(G, X=payload.origin.lng, Y=payload.origin.lat)
        dest_node = ox.distance.nearest_nodes(G, X=payload.destination.lng, Y=payload.destination.lat)

        result = find_safer_route(G, origin_node, dest_node, beta=payload.beta)

        # Convert safe path nodes to coordinates
        safe_coords = [
            {"latitude": G.nodes[n]["y"], "longitude": G.nodes[n]["x"]}
            for n in result["safe_path"]
            if "y" in G.nodes[n] and "x" in G.nodes[n]
        ]

        # Score the safer route
        safer_safety = {}
        try:
            safer_safety = score_coordinates(safe_coords, sample_every=5, departure_hour=payload.departure_hour, travel_mode=payload.travel_mode)
        except Exception:
            pass

        safer_route = {
            "coordinates": safe_coords,
            "polyline": None,
            "distance_meters": None,
            "duration": None,
            "safety_score": safer_safety.get("score"),
            "safety_label": safer_safety.get("label", "unknown"),
            "risk_per_km": safer_safety.get("risk_per_km"),
            "total_exposure": safer_safety.get("total_exposure"),
            "route_km": safer_safety.get("route_km"),
            "n_high_risk": safer_safety.get("n_high_risk", 0),
            "top_risk_factors": safer_safety.get("top_risk_factors", []),
            "time_band": safer_safety.get("time_band"),
            "time_penalty_pct": round(result.get("time_penalty_pct", 0), 1),
            "risk_reduction_pct": round(result.get("risk_reduction_pct", 0), 1),
        }

    except Exception as e:
        print(f"[safe-route] OSM safer route failed: {e}")

    return {
        "google_fastest": {
            "coordinates": google_coords,
            "polyline": polyline,
            "distance_meters": google_route.get("distanceMeters"),
            "duration": google_route.get("duration"),
            "safety_score": google_safety.get("score"),
            "safety_label": google_safety.get("label", "unknown"),
            "risk_per_km": google_safety.get("risk_per_km"),
            "total_exposure": google_safety.get("total_exposure"),
            "route_km": google_safety.get("route_km"),
            "n_high_risk": google_safety.get("n_high_risk", 0),
            "top_risk_factors": google_safety.get("top_risk_factors", []),
            "time_band": google_safety.get("time_band"),
        },
        "safer_alternative": safer_route,
        "comparison": {
            "time_penalty_pct": safer_route.get("time_penalty_pct") if safer_route else None,
            "risk_reduction_pct": safer_route.get("risk_reduction_pct") if safer_route else None,
            "recommendation": (
                f"{abs(safer_route['risk_reduction_pct'])}% less total risk exposure"
                if safer_route and safer_route.get("risk_reduction_pct") is not None
                else "Safer alternative unavailable"
            ),
        },
    }


# ---------------------------------------------------------------------------
# Live Traffic Incidents (TomTom API)
# ---------------------------------------------------------------------------

# TomTom incident category mapping
INCIDENT_CATEGORIES = {
    0: "Unknown",
    1: "Accident",
    2: "Fog",
    3: "Dangerous Conditions",
    4: "Rain",
    5: "Ice",
    6: "Jam",
    7: "Lane Closed",
    8: "Road Closed",
    9: "Road Works",
    10: "Wind",
    11: "Flooding",
    14: "Broken Down Vehicle",
}

_traffic_cache: dict = {}
TRAFFIC_CACHE_TTL = 120  # 2 minutes


@app.get("/traffic/incidents")
def get_traffic_incidents(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_km: float = Query(default=5.0, ge=0.5, le=50.0),
):
    """
    Get live traffic incidents near a location using TomTom API.
    Results are cached for 2 minutes to avoid excessive API calls.
    """
    cache_key = f"{round(lat, 2)}:{round(lng, 2)}:{radius_km}"
    if cache_key in _traffic_cache:
        cached_at, data = _traffic_cache[cache_key]
        if time.time() - cached_at < TRAFFIC_CACHE_TTL:
            return data
        
    _check_and_increment_tomtom_limit()
    tomtom_key = os.getenv("TOMTOM_API_KEY")
    if not tomtom_key:
        raise HTTPException(status_code=500, detail="Missing TOMTOM_API_KEY in backend .env")

    # Calculate bounding box from center + radius
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * abs(math.cos(math.radians(lat))))
    bbox = f"{lng - lng_delta},{lat - lat_delta},{lng + lng_delta},{lat + lat_delta}"

    url = f"https://api.tomtom.com/traffic/services/5/incidentDetails"
    params = {
        "key": tomtom_key,
        "bbox": bbox,
        "language": "en-GB",
        "timeValidityFilter": "present",
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=f"TomTom API error: {response.text}")

        raw_incidents = response.json().get("incidents", [])

        incidents = []
        for incident in raw_incidents:
            props = incident.get("properties", {})
            geometry = incident.get("geometry", {})
            coords = geometry.get("coordinates", [])
            category = props.get("iconCategory", 0)

            # Get center point of incident
            if coords:
                if geometry.get("type") == "Point":
                    inc_lng, inc_lat = coords[0], coords[1]
                else:
                    # For LineString take midpoint
                    mid = len(coords) // 2
                    inc_lng, inc_lat = coords[mid][0], coords[mid][1]
            else:
                continue

            incidents.append({
                "id": props.get("id", ""),
                "category": category,
                "type": INCIDENT_CATEGORIES.get(category, "Unknown"),
                "latitude": inc_lat,
                "longitude": inc_lng,
                "description": props.get("events", [{}])[0].get("description", "") if props.get("events") else "",
                "delay_seconds": props.get("delay", 0),
                "road": props.get("roadNumbers", []),
            })

        result = {
            "incidents": incidents,
            "total": len(incidents),
            "bbox": bbox,
            "cached": False,
        }
        _traffic_cache[cache_key] = (time.time(), {**result, "cached": False})

        # Store incidents in Supabase asynchronously
    
        try:
            gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
            if gcs_key and os.path.isfile(gcs_key):
                import gcsfs
                import json as json_lib
                fs = gcsfs.GCSFileSystem(token=gcs_key)
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                gcs_path = f"safeway-data/traffic_incidents/incidents_{timestamp}.json"
                with fs.open(gcs_path, "w") as f:
                    json_lib.dump({
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                        "bbox": bbox,
                        "incidents": incidents,
                    }, f)
                print(f"[traffic] Stored {len(incidents)} incidents to GCS: {gcs_path}")
        except Exception as e:
            print(f"[traffic] GCS store failed: {e}")
        return result

    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Traffic fetch failed: {e}")


# ---------------------------------------------------------------------------
# Safety POIs — Nearby police stations, hospitals, fire stations
# ---------------------------------------------------------------------------

SAFETY_POI_TYPES = {
    "police": "police",
    "hospital": "hospital",
    "fire_station": "fire_station",
    "pharmacy": "pharmacy",
}


@app.get("/safety/nearby")
def get_nearby_safety_pois(
    lat: float = Query(...),
    lng: float = Query(...),
    poi_type: str = Query(default="police", description="Type: police, hospital, fire_station, pharmacy"),
    limit: int = Query(default=5, ge=1, le=10),
):
    """
    Find nearby safety POIs (police stations, hospitals, fire stations).
    Uses Google Places API.
    """
    _check_and_increment_api_limit()
    google_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not google_key:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_MAPS_API_KEY")

    place_type = SAFETY_POI_TYPES.get(poi_type, "police")

    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": google_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.googleMapsUri,places.regularOpeningHours,"
            "places.nationalPhoneNumber,places.rating"
        ),
    }
    body = {
        "includedTypes": [place_type],
        "maxResultCount": limit,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 5000.0,
            }
        },
    }

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
        opening_hours = place.get("regularOpeningHours") or {}
        places.append({
            "place_id": place.get("id"),
            "name": display_name.get("text"),
            "address": place.get("formattedAddress"),
            "lat": location.get("latitude"),
            "lng": location.get("longitude"),
            "phone": place.get("nationalPhoneNumber"),
            "rating": place.get("rating"),
            "google_maps_uri": place.get("googleMapsUri"),
            "open_now": opening_hours.get("openNow"),
            "type": poi_type,
        })

    return {
        "results": places,
        "total": len(places),
        "poi_type": poi_type,
        "search_location": {"lat": lat, "lng": lng},
    }
