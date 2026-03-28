"""
Spatial-temporal join: match each crash to the nearest weather grid point + date + hour.
Uses scipy KD-tree for fast nearest-neighbor lookup across the 25-point Chicago grid.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WEATHER_COLS = [
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


def merge_crashes_with_weather(crashes: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """
    Merge crash records with weather data by nearest grid point + date + hour.
    Each crash gets the weather conditions at its closest grid point at that time.
    """
    from scipy.spatial import cKDTree

    crashes = crashes.copy()

    # Parse crash timestamps
    crashes["crash_date"] = pd.to_datetime(crashes["crash_date"], errors="coerce", utc=True)
    crashes["_date"] = crashes["crash_date"].dt.tz_convert("America/Chicago").dt.date.astype(str)
    crashes["_hour"] = crashes["crash_date"].dt.tz_convert("America/Chicago").dt.hour

    # Ensure crash lat/lon are numeric
    crash_lats = pd.to_numeric(crashes.get("latitude"), errors="coerce")
    crash_lons = pd.to_numeric(crashes.get("longitude"), errors="coerce")
    valid_mask = crash_lats.notna() & crash_lons.notna()

    # Build KD-tree of unique weather grid points
    grid_points = weather[["grid_lat", "grid_lon"]].drop_duplicates().reset_index(drop=True)
    tree = cKDTree(grid_points[["grid_lat", "grid_lon"]].values)

    # Find nearest grid point for each crash with valid coordinates
    crashes["_grid_lat"] = np.nan
    crashes["_grid_lon"] = np.nan
    if valid_mask.any():
        coords = np.column_stack([crash_lats[valid_mask].values, crash_lons[valid_mask].values])
        _, indices = tree.query(coords)
        crashes.loc[valid_mask, "_grid_lat"] = grid_points.iloc[indices]["grid_lat"].values
        crashes.loc[valid_mask, "_grid_lon"] = grid_points.iloc[indices]["grid_lon"].values

    # Prepare weather merge keys
    weather_merge = weather[["grid_lat", "grid_lon", "date", "hour"] + WEATHER_COLS].copy()
    weather_merge = weather_merge.rename(columns={
        "grid_lat": "_grid_lat",
        "grid_lon": "_grid_lon",
        "date": "_date",
        "hour": "_hour",
    })
    # Prefix weather columns to avoid conflicts
    rename_map = {col: f"omw_{col}" for col in WEATHER_COLS}
    weather_merge = weather_merge.rename(columns=rename_map)

    # Spatial-temporal merge: nearest grid point + date + hour
    merged = crashes.merge(weather_merge, on=["_grid_lat", "_grid_lon", "_date", "_hour"], how="left")
    merged = merged.drop(columns=["_date", "_hour", "_grid_lat", "_grid_lon"])

    matched = merged["omw_temperature_2m"].notna().sum()
    total = len(crashes)
    print(f"  Weather match: {matched}/{total} crashes ({matched / total * 100:.1f}%)", flush=True)

    return merged
