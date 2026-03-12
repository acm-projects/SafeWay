"""
Fetch hourly historical and present weather data for Chicago from Open-Meteo.
Saves to CSV files for later use in ML model training.
Run from repo root: python -m backend.model.data.weather
"""
import requests
import pandas as pd
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

# Chicago coordinates
CHICAGO_LAT = 41.8781
CHICAGO_LON = -87.6298

# Open-Meteo variables we want
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


def fetch_weather(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch hourly weather data from Open-Meteo for Chicago.
    start_date and end_date format: YYYY-MM-DD
    """
    print(f"Fetching weather data from {start_date} to {end_date}...")
    
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": CHICAGO_LAT,
        "longitude": CHICAGO_LON,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "America/Chicago",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }
    
    response = requests.get(url, params=params, timeout=60)
    response.raise_for_status()
    data = response.json()
    
    df = pd.DataFrame(data["hourly"])
    df = df.rename(columns={"time": "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"])
    df["date"] = df["datetime"].dt.date
    df["hour"] = df["datetime"].dt.hour
    
    print(f"Fetched {len(df)} hourly records.")
    return df


def fetch_present_weather(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch recent/present weather data from Open-Meteo forecast archive.
    """
    print(f"Fetching present weather data from {start_date} to {end_date}...")
    
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": CHICAGO_LAT,
        "longitude": CHICAGO_LON,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "America/Chicago",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
    }
    
    response = requests.get(url, params=params, timeout=60)
    response.raise_for_status()
    data = response.json()
    
    df = pd.DataFrame(data["hourly"])
    df = df.rename(columns={"time": "datetime"})
    df["datetime"] = pd.to_datetime(df["datetime"])
    df["date"] = df["datetime"].dt.date
    df["hour"] = df["datetime"].dt.hour
    
    print(f"Fetched {len(df)} hourly records.")
    return df


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Historical data: 2020-2024
    df_historical = fetch_weather("2020-01-01", "2024-12-31")
    historical_path = OUTPUT_DIR / "chicago_weather_historical.csv"
    df_historical.to_csv(historical_path, index=False)
    print(f"Saved historical weather to {historical_path}")
    print(f"Shape: {df_historical.shape}")
    print(df_historical.head())
    
    print()
    
    # Present data: 2025-2026
    df_present = fetch_weather("2025-01-01", "2025-12-31")
    present_path = OUTPUT_DIR / "chicago_weather_present.csv"
    df_present.to_csv(present_path, index=False)
    print(f"Saved present weather to {present_path}")
    print(f"Shape: {df_present.shape}")
    print(df_present.head())

    