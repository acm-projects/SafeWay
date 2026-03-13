"""
Merge Open-Meteo hourly weather data with Chicago crash records.
Matches each crash to weather conditions at that exact date and hour.
Run from repo root: python -m backend.model.data.merge_weather
"""
import pandas as pd
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

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


def load_weather() -> pd.DataFrame:
    """Load and combine all weather CSV files into one DataFrame."""
    print("Loading weather data...")
    
    historical = pd.read_csv(OUTPUT_DIR / "chicago_weather_historical.csv")
    present = pd.read_csv(OUTPUT_DIR / "chicago_weather_present.csv")
    current = pd.read_csv(OUTPUT_DIR / "chicago_weather_2026.csv")
    
    weather = pd.concat([historical, present, current], ignore_index=True)
    weather["datetime"] = pd.to_datetime(weather["datetime"])
    weather["date"] = weather["datetime"].dt.date.astype(str)
    weather["hour"] = weather["datetime"].dt.hour
    
    # Drop duplicates just in case
    weather = weather.drop_duplicates(subset=["date", "hour"])
    
    print(f"Loaded {len(weather)} hourly weather records.")
    return weather


def merge_crashes_with_weather(crashes: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """
    Merge crash records with weather data by date and hour.
    Each crash gets the weather conditions at the time it happened.
    """
    print(f"Merging {len(crashes)} crashes with weather data...")
    
    # Prepare crash date and hour columns
    crashes = crashes.copy()
    crashes["crash_date"] = pd.to_datetime(crashes["crash_date"], errors="coerce", utc=True)
    crashes["_date"] = crashes["crash_date"].dt.tz_convert("America/Chicago").dt.date.astype(str)
    crashes["_hour"] = crashes["crash_date"].dt.tz_convert("America/Chicago").dt.hour
    
    # Prepare weather merge keys
    weather_merge = weather[["date", "hour"] + WEATHER_COLS].copy()
    weather_merge = weather_merge.rename(columns={"date": "_date", "hour": "_hour"})
    # Rename weather cols to avoid conflicts with crash weather columns
    rename_map = {col: f"omw_{col}" for col in WEATHER_COLS}
    weather_merge = weather_merge.rename(columns=rename_map)
    
    # Merge
    merged = crashes.merge(weather_merge, on=["_date", "_hour"], how="left")
    merged = merged.drop(columns=["_date", "_hour"])
    
    matched = merged["omw_temperature_2m"].notna().sum()
    print(f"Matched {matched}/{len(crashes)} crashes to weather records ({matched/len(crashes)*100:.1f}%)")
    
    return merged


if __name__ == "__main__":
    # Load crashes from cache
    crashes = pd.read_csv(OUTPUT_DIR / "crashes_cache.csv")
    print(f"Loaded {len(crashes)} crashes from cache.")
    
    # Load weather
    weather = load_weather()
    
    # Merge
    merged = merge_crashes_with_weather(crashes, weather)
    
    # Save
    output_path = OUTPUT_DIR / "crashes_with_weather.csv"
    merged.to_csv(output_path, index=False)
    print(f"Saved merged data to {output_path}")
    print(f"Shape: {merged.shape}")
    print(f"New weather columns: {[c for c in merged.columns if c.startswith('omw_')]}")

    