import os
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
DAILY_API_LIMIT = 40  # hard cap — keeps us well under 50

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
    # routingPreference is only valid for DRIVE and TWO_WHEELER modes.
    # Google Routes API rejects it for WALK and BICYCLE.
    if payload.travel_mode in ("DRIVE", "TWO_WHEELER"):
        body["routingPreference"] = "TRAFFIC_UNAWARE"

    response = requests.post(url, headers=headers, json=body, timeout=20)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Routes API error: {response.text}",
        )

    routes = response.json().get("routes", [])
    if not routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No routes found")

    route = routes[0]
    polyline = ((route.get("polyline") or {}).get("encodedPolyline")) or ""
    coordinates = decode_polyline(polyline) if polyline else []

    return {
        "distance_meters": route.get("distanceMeters"),
        "duration": route.get("duration"),
        "travel_mode": payload.travel_mode,
        "polyline": polyline,
        "coordinates": coordinates,
    }


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

@app.get("/crashes/hex")
def get_crash_hexes(resolution: int = Query(default=8, ge=5, le=12)):
    """Fetch crash coordinates, bin into H3 hexagons, return hex data."""
    import h3
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
    """
    SELECT latitude, longitude
    FROM public.enriched_crashes
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """
)
            rows = cur.fetchall()
    finally:
        conn.close()

    # Count crashes per H3 hex
    hex_counts: dict[str, int] = {}
    for lat, lng in rows:
        hex_id = h3.latlng_to_cell(lat, lng, resolution)
        hex_counts[hex_id] = hex_counts.get(hex_id, 0) + 1

    # Build response with hex boundaries and counts
    result = []
    for hex_id, count in hex_counts.items():
        boundary = h3.cell_to_boundary(hex_id)
        corners = [{"latitude": lat, "longitude": lng} for lat, lng in boundary]
        result.append({"hexId": hex_id, "count": count, "corners": corners})

    return {"hexes": result, "total": len(result)}

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
