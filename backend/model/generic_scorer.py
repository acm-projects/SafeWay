"""
Generic city safety scorer for cities outside Chicago.
Uses live weather from Open-Meteo to score any location.
No crash data required — works anywhere in the world.
"""
from __future__ import annotations
import math
import requests


# WMO weather code risk multipliers
WEATHER_RISK = {
    0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0,
    45: 1.4, 48: 1.5,
    51: 1.2, 53: 1.3, 55: 1.4,
    61: 1.3, 63: 1.4, 65: 1.6,
    71: 1.5, 73: 1.7, 75: 1.9,
    80: 1.3, 81: 1.4, 82: 1.6,
    95: 1.8, 96: 2.0, 99: 2.0,
}


def get_live_weather_risk(lat: float, lng: float) -> dict:
    """
    Fetch current weather from Open-Meteo and return risk multiplier.
    Free API, no key required, works anywhere in the world.
    """
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lng}"
            f"&current=weather_code,wind_speed_10m,precipitation"
            f"&timezone=auto"
        )
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            return {"multiplier": 1.0, "weather_code": 0}
        current = resp.json().get("current", {})
        weather_code = current.get("weather_code", 0)
        wind_speed = current.get("wind_speed_10m", 0)
        precipitation = current.get("precipitation", 0)
        multiplier = WEATHER_RISK.get(weather_code, 1.0)
        if wind_speed > 50:
            multiplier *= 1.2
        elif wind_speed > 30:
            multiplier *= 1.1
        if precipitation > 10:
            multiplier *= 1.2
        elif precipitation > 5:
            multiplier *= 1.1
        return {
            "multiplier": round(min(multiplier, 2.0), 2),
            "weather_code": weather_code,
            "wind_speed": wind_speed,
            "precipitation": precipitation,
        }
    except Exception:
        return {"multiplier": 1.0, "weather_code": 0}


def score_coordinates_generic(
    coordinates: list[dict],
    sample_every: int = 5,
    travel_mode: str = "DRIVE",
) -> dict:
    """
    Score a route for any city using live weather only.
    Fast fallback — no OSM download needed.
    Works anywhere in the world.
    """
    if not coordinates:
        return {
            "score": None, "label": "unknown", "source": "generic",
            "segment_risks": [], "high_risk_coords": [],
        }

    sampled = coordinates[::sample_every] if sample_every > 1 else coordinates
    if not sampled:
        return {
            "score": None, "label": "unknown", "source": "generic",
            "segment_risks": [], "high_risk_coords": [],
        }

    # Get weather for midpoint of route
    mid = len(sampled) // 2
    mid_lat = sampled[mid]["latitude"]
    mid_lng = sampled[mid]["longitude"]
    weather = get_live_weather_risk(mid_lat, mid_lng)
    weather_mult = weather["multiplier"]

    # Base risk score — moderate by default for unknown cities
    base_score = 35.0

    # Adjust for travel mode
    if travel_mode == "WALK":
        base_score = 45.0
        weather_mult = min(2.0, weather_mult * 1.3)
    elif travel_mode == "BICYCLE":
        base_score = 40.0
        weather_mult = min(2.0, weather_mult * 1.2)

    score = round(min(100.0, base_score * weather_mult), 2)

    if score < 33:
        label = "low"
    elif score < 66:
        label = "medium"
    else:
        label = "high"

    # Distance calculation + per-segment geometry (uniform risk = overall score)
    total_km = 0.0
    segment_risks: list[dict] = []
    for i in range(len(sampled) - 1):
        lat1, lng1 = sampled[i]["latitude"], sampled[i]["longitude"]
        lat2, lng2 = sampled[i + 1]["latitude"], sampled[i + 1]["longitude"]
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = (math.sin(dlat/2)**2 +
             math.cos(math.radians(lat1)) *
             math.cos(math.radians(lat2)) *
             math.sin(dlng/2)**2)
        total_km += 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        segment_risks.append({
            "start": {"latitude": lat1, "longitude": lng1},
            "end": {"latitude": lat2, "longitude": lng2},
            "risk": score,
        })

    high_risk_coords: list[dict] = []
    if score > 66.0 and sampled:
        mid = len(sampled) // 2
        high_risk_coords.append({
            "latitude": sampled[mid]["latitude"],
            "longitude": sampled[mid]["longitude"],
        })

    return {
        "score": score,
        "label": label,
        "risk_per_km": score,
        "total_exposure": round(score * total_km, 2),
        "route_km": round(total_km, 3),
        "n_high_risk": 1 if score > 66.0 else 0,
        "weather_multiplier": weather_mult,
        "weather_code": weather.get("weather_code", 0),
        "top_risk_factors": [],
        "time_band": None,
        "source": "generic",
        "note": "Safety score based on live weather. Enhanced scoring available for Chicago.",
        "segment_risks": segment_risks,
        "high_risk_coords": high_risk_coords,
    }

