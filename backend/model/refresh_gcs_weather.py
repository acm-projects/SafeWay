"""
Fetch Chicago grid weather from Open-Meteo and write to GCS as weather.parquet.
Uses a 5x5 spatial grid (25 points) across Chicago's bounding box.

Run from repo root:
  python -u -m backend.model.refresh_gcs_weather
  python -u -m backend.model.refresh_gcs_weather --start 2024-01-01 --end 2024-12-31

Requires: GCS key at GCS_CREDENTIALS_PATH or backend/safeway-*.json.
"""
from __future__ import annotations

import argparse
import os
import sys
from calendar import monthrange
from datetime import datetime, timezone
from pathlib import Path

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass


def _default_end_date() -> str:
    """Last day of previous month (we have complete data)."""
    today = datetime.now(timezone.utc).date()
    year = today.year
    month = today.month
    if month == 1:
        year -= 1
        month = 12
    else:
        month -= 1
    last_day = monthrange(year, month)[1]
    return f"{year}-{month:02d}-{last_day}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch Chicago grid weather from Open-Meteo and push to GCS"
    )
    parser.add_argument("--start", default="2020-01-01", help="Start date (YYYY-MM-DD)")
    parser.add_argument(
        "--end",
        default=None,
        help="End date (default: last day of previous month)",
    )
    parser.add_argument(
        "--full-refresh",
        action="store_true",
        help="Ignore existing parquet and re-fetch everything from --start",
    )
    args = parser.parse_args()

    end = args.end or _default_end_date()

    import pandas as pd
    from backend.model.data.weather import fetch_grid_weather
    from dotenv import load_dotenv
    import gcsfs

    load_dotenv(_repo_root / "backend" / ".env")
    gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
    if not gcs_key or not os.path.isfile(gcs_key):
        print("GCS_CREDENTIALS_PATH is not set or file not found; cannot refresh weather to GCS.", flush=True)
        sys.exit(1)

    fs = gcsfs.GCSFileSystem(token=gcs_key)

    # Try to load existing parquet from GCS to append on top
    existing = None
    fetch_start = args.start
    if not args.full_refresh:
        try:
            with fs.open("safeway-data/weather.parquet", "rb") as f:
                existing = pd.read_parquet(f)
            last_date = existing["date"].max()
            print(f"Found existing weather.parquet on GCS (last date: {last_date}, {len(existing)} rows)", flush=True)
            # Start fetching from the day after the last date in existing data
            from datetime import timedelta
            next_day = (pd.Timestamp(last_date) + timedelta(days=1)).strftime("%Y-%m-%d")
            if next_day > end:
                print("Already up to date — nothing to fetch.", flush=True)
                return
            fetch_start = next_day
        except FileNotFoundError:
            print("No existing weather.parquet on GCS — doing full fetch.", flush=True)

    print(f"Fetching grid weather: {fetch_start} .. {end}", flush=True)

    # Open-Meteo archive API only covers up to ~5 days ago; use forecast API
    # for recent dates. Split at a safe boundary.
    boundary = datetime.now(timezone.utc).date().replace(day=1).isoformat()
    end_dt = end

    # Historical portion (archive API)
    new_weather = fetch_grid_weather(fetch_start, min(end_dt, boundary), use_forecast_api=False)

    # Recent portion (forecast API) if end is past the boundary
    if end_dt > boundary:
        recent = fetch_grid_weather(boundary, end_dt, use_forecast_api=True)
        new_weather = pd.concat([new_weather, recent], ignore_index=True)
        new_weather = new_weather.drop_duplicates(subset=["grid_lat", "grid_lon", "date", "hour"])

    # Combine with existing data
    if existing is not None:
        weather = pd.concat([existing, new_weather], ignore_index=True)
        weather = weather.drop_duplicates(subset=["grid_lat", "grid_lon", "date", "hour"], keep="last")
        print(f"Combined: {len(existing)} existing + {len(new_weather)} new = {len(weather)} total records", flush=True)
    else:
        weather = new_weather
        print(f"Total weather records: {len(weather)}", flush=True)

    print("Writing to GCS...", flush=True)
    with fs.open("safeway-data/weather.parquet", "wb") as f:
        weather.to_parquet(f, index=False)
    print("  weather.parquet -> gs://safeway-data/ OK", flush=True)
    print("Done.", flush=True)


if __name__ == "__main__":
    main()
