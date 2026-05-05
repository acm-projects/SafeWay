"""
Fetch hourly weather data for a 5x5 spatial grid across Chicago from Open-Meteo.
Pure functions — no file I/O. Used by refresh_gcs_weather.py to build weather.parquet.

Grid covers Chicago bounding box: lat 41.66–42.00, lon -87.90 to -87.54 (25 points).
Each crash is later matched to its nearest grid point for a spatial-temporal weather join.
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
import requests

# Chicago 5x5 grid
_LAT_TICKS = np.linspace(41.66, 42.00, 5)
_LON_TICKS = np.linspace(-87.90, -87.54, 5)
CHICAGO_GRID: list[tuple[float, float]] = [
    (round(float(lat), 4), round(float(lon), 4))
    for lat in _LAT_TICKS
    for lon in _LON_TICKS
]  # 25 grid points

HOURLY_VARS = [
    "temperature_2m",
    "precipitation",
    "rain",
    "snowfall",
    "snow_depth",
    "wind_speed_10m",
    "visibility",
    "weather_code",
    "cloud_cover",
]


def fetch_weather_for_point(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    *,
    use_forecast_api: bool = False,
    max_retries: int = 5,
) -> pd.DataFrame:
    """Fetch hourly weather for a single point from Open-Meteo. Returns DataFrame."""
    if use_forecast_api:
        url = "https://api.open-meteo.com/v1/forecast"
    else:
        url = "https://archive-api.open-meteo.com/v1/archive"

    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "America/Chicago",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }

    for attempt in range(max_retries):
        resp = requests.get(url, params=params, timeout=120)
        if resp.status_code == 429:
            wait = min(2 ** (attempt + 1), 60)  # exponential backoff: 2, 4, 8, 16, 32s
            print(f"    Rate limited, waiting {wait}s (attempt {attempt + 1}/{max_retries})...", flush=True)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        raise RuntimeError(f"Open-Meteo rate limit persisted after {max_retries} retries for ({lat}, {lon})")

    data = resp.json()
    df = pd.DataFrame(data["hourly"])
    df = df.rename(columns={"time": "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"])
    df["date"] = df["datetime"].dt.date.astype(str)
    df["hour"] = df["datetime"].dt.hour
    df["grid_lat"] = lat
    df["grid_lon"] = lon
    df = df.drop(columns=["datetime"])
    return df


def fetch_grid_weather(
    start_date: str,
    end_date: str,
    *,
    use_forecast_api: bool = False,
    delay_between_points: float = 2.0,
) -> pd.DataFrame:
    """Fetch hourly weather for all 25 Chicago grid points. Returns combined DataFrame."""
    api_label = "forecast" if use_forecast_api else "archive"
    print(f"Fetching grid weather ({api_label}) for {len(CHICAGO_GRID)} points: {start_date} to {end_date}...", flush=True)

    frames = []
    for i, (lat, lon) in enumerate(CHICAGO_GRID):
        print(f"  Grid point {i + 1}/{len(CHICAGO_GRID)}: ({lat}, {lon})", flush=True)
        df = fetch_weather_for_point(lat, lon, start_date, end_date, use_forecast_api=use_forecast_api)
        frames.append(df)
        if i < len(CHICAGO_GRID) - 1:
            time.sleep(delay_between_points)

    combined = pd.concat(frames, ignore_index=True)
    print(f"  Total weather records: {len(combined)}", flush=True)
    return combined
