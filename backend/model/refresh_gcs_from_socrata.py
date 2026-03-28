"""
Pull latest crashes and crimes from Chicago Data Portal (Socrata) and write to GCS.
Incremental: loads existing parquet from GCS, finds the last date, fetches only new rows,
appends, deduplicates, and writes back. Use --full-refresh to re-fetch everything.

Run from repo root:
  python -u -m backend.model.refresh_gcs_from_socrata
  python -u -m backend.model.refresh_gcs_from_socrata --full-refresh

Requires: SOCRATA_APP_TOKEN in env (optional but recommended for rate limits),
          GCS key at GCS_CREDENTIALS_PATH.
"""
from __future__ import annotations

import argparse
import os
import sys
from calendar import monthrange
from datetime import datetime, timedelta, timezone
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


def _last_date_in_parquet(fs, gcs_path: str, date_col: str) -> str | None:
    """Load parquet from GCS and return the max date string, or None if not found."""
    import pandas as pd
    try:
        with fs.open(gcs_path, "rb") as f:
            raw = f.read()
        if len(raw) == 0:
            return None  # empty/corrupt file
        import io
        df = pd.read_parquet(io.BytesIO(raw), columns=[date_col])
        ts = pd.to_datetime(df[date_col], errors="coerce").dropna()
        if ts.empty:
            return None
        return ts.max().strftime("%Y-%m-%d")
    except (FileNotFoundError, KeyError, Exception):
        return None


def _append_and_write(fs, gcs_path: str, new_df, dedup_col: str | None, date_col: str | None, full_refresh: bool):
    """Load existing parquet, append new rows, deduplicate, write back."""
    import pandas as pd
    if full_refresh:
        combined = new_df
    else:
        try:
            with fs.open(gcs_path, "rb") as f:
                existing = pd.read_parquet(f)
            # Align dtypes: cast new_df columns to match existing parquet schema
            for col in new_df.columns:
                if col in existing.columns:
                    try:
                        new_df[col] = new_df[col].astype(existing[col].dtype)
                    except (ValueError, TypeError):
                        # If cast fails, convert both to string to avoid Arrow errors
                        existing[col] = existing[col].astype(str)
                        new_df[col] = new_df[col].astype(str)
            combined = pd.concat([existing, new_df], ignore_index=True)
            if dedup_col and dedup_col in combined.columns:
                combined = combined.drop_duplicates(subset=[dedup_col], keep="last")
            elif date_col and date_col in combined.columns:
                combined = combined.drop_duplicates(keep="last")
            print(f"    {len(existing)} existing + {len(new_df)} new = {len(combined)} total", flush=True)
        except FileNotFoundError:
            combined = new_df
    with fs.open(gcs_path, "wb") as f:
        combined.to_parquet(f, index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh GCS parquet from Socrata (Chicago Data Portal)")
    parser.add_argument("--start", default="2020-01-01", help="Start date (only used on first run or --full-refresh)")
    parser.add_argument(
        "--end",
        default=None,
        help="End date (default: last day of previous month)",
    )
    parser.add_argument(
        "--full-refresh",
        action="store_true",
        help="Ignore existing GCS data and re-fetch everything from --start",
    )
    parser.add_argument(
        "--crash-limit",
        type=int,
        default=0,
        help="Cap crash rows (0 = no limit); use for testing",
    )
    parser.add_argument(
        "--crime-limit",
        type=int,
        default=0,
        help="Cap crime rows (0 = no limit); use for testing",
    )
    args = parser.parse_args()

    end = args.end or _default_end_date()
    crash_limit = None if args.crash_limit == 0 else args.crash_limit
    crime_limit = None if args.crime_limit == 0 else args.crime_limit

    from backend.model.data.crashes import get_enriched_crashes
    from backend.model.data.crimes import get_crimes
    from dotenv import load_dotenv
    import gcsfs
    import pandas as pd

    load_dotenv(_repo_root / "backend" / ".env")
    gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
    if not gcs_key or not os.path.isfile(gcs_key):
        print("GCS_CREDENTIALS_PATH is not set or file not found; cannot refresh to GCS.", flush=True)
        sys.exit(1)

    fs = gcsfs.GCSFileSystem(token=gcs_key)

    # --- Crashes (incremental by crash_date) ---
    crash_start = args.start
    if not args.full_refresh:
        last_crash = _last_date_in_parquet(fs, "safeway-data/crashes.parquet", "crash_date")
        if last_crash:
            # Fetch from 1 day before last date (overlap to catch late-arriving records)
            overlap = (pd.Timestamp(last_crash) - timedelta(days=1)).strftime("%Y-%m-%d")
            crash_start = overlap
            print(f"Crashes: existing data up to {last_crash}, fetching from {crash_start}", flush=True)
        else:
            print(f"Crashes: no existing data on GCS, full fetch from {crash_start}", flush=True)
    else:
        print(f"Crashes: full refresh from {crash_start}", flush=True)

    print(f"Fetching crashes (Crashes + Vehicles + People): {crash_start} .. {end}", flush=True)
    crashes = get_enriched_crashes(
        start_date=crash_start,
        end_date=end,
        limit=crash_limit,
    )
    if crashes.empty:
        print("No crashes returned; aborting.", flush=True)
        sys.exit(1)
    print(f"  Got {len(crashes)} new/updated crashes.", flush=True)
    _append_and_write(fs, "safeway-data/crashes.parquet", crashes, "crash_record_id", "crash_date", args.full_refresh)
    print("  crashes.parquet -> gs://safeway-data/ OK", flush=True)

    # --- Crimes (incremental by crime_date) ---
    crime_start = args.start
    if not args.full_refresh:
        last_crime = _last_date_in_parquet(fs, "safeway-data/crimes.parquet", "crime_date")
        if not last_crime:
            last_crime = _last_date_in_parquet(fs, "safeway-data/crimes.parquet", "date")
        if last_crime:
            overlap = (pd.Timestamp(last_crime) - timedelta(days=1)).strftime("%Y-%m-%d")
            crime_start = overlap
            print(f"Crimes: existing data up to {last_crime}, fetching from {crime_start}", flush=True)
        else:
            print(f"Crimes: no existing data on GCS, full fetch from {crime_start}", flush=True)
    else:
        print(f"Crimes: full refresh from {crime_start}", flush=True)

    print(f"Fetching crimes: {crime_start} .. {end}", flush=True)
    crimes = get_crimes(
        start_date=crime_start,
        end_date=end,
        limit=crime_limit,
    )
    if crimes.empty:
        print("No crimes returned; aborting.", flush=True)
        sys.exit(1)
    if "crime_date" not in crimes.columns and "date" in crimes.columns:
        crimes["crime_date"] = crimes["date"]
    print(f"  Got {len(crimes)} new/updated crimes.", flush=True)
    _append_and_write(fs, "safeway-data/crimes.parquet", crimes, "id", "crime_date", args.full_refresh)
    print("  crimes.parquet -> gs://safeway-data/ OK", flush=True)

    # --- Red Light Camera Violations (spqx-js37) ---
    from backend.model.data.socrata_client import fetch_all
    print("Fetching red light camera violations...", flush=True)
    try:
        rlc_start = args.start
        if not args.full_refresh:
            last_rlc = _last_date_in_parquet(fs, "safeway-data/red_light_violations.parquet", "violation_date")
            if last_rlc:
                rlc_start = (pd.Timestamp(last_rlc) - timedelta(days=1)).strftime("%Y-%m-%d")
                print(f"  Red light cameras: existing data up to {last_rlc}, fetching from {rlc_start}", flush=True)
        rlc = fetch_all(
            "spqx-js37",
            where=f"violation_date between '{rlc_start}T00:00:00' and '{end}T23:59:59'",
            select=["intersection", "latitude", "longitude", "violation_date", "violations"],
            log_label="RedLightCameras",
        )
        if not rlc.empty:
            for col in ("latitude", "longitude", "violations"):
                rlc[col] = pd.to_numeric(rlc[col], errors="coerce")
            rlc = rlc.dropna(subset=["latitude", "longitude"])
            _append_and_write(fs, "safeway-data/red_light_violations.parquet", rlc, None, "violation_date", args.full_refresh)
            print(f"  red_light_violations.parquet -> gs://safeway-data/ OK", flush=True)
        else:
            print("  No red light camera data returned; skipping.", flush=True)
    except Exception as e:
        print(f"  Red light camera fetch failed: {e}; skipping.", flush=True)

    # --- Speed Camera Violations (hhkd-xvj4) ---
    print("Fetching speed camera violations...", flush=True)
    try:
        spd_start = args.start
        if not args.full_refresh:
            last_spd = _last_date_in_parquet(fs, "safeway-data/speed_violations.parquet", "violation_date")
            if last_spd:
                spd_start = (pd.Timestamp(last_spd) - timedelta(days=1)).strftime("%Y-%m-%d")
                print(f"  Speed cameras: existing data up to {last_spd}, fetching from {spd_start}", flush=True)
        spd = fetch_all(
            "hhkd-xvj4",
            where=f"violation_date between '{spd_start}T00:00:00' and '{end}T23:59:59'",
            select=["address", "latitude", "longitude", "violation_date", "violations"],
            log_label="SpeedCameras",
        )
        if not spd.empty:
            for col in ("latitude", "longitude", "violations"):
                spd[col] = pd.to_numeric(spd[col], errors="coerce")
            spd = spd.dropna(subset=["latitude", "longitude"])
            _append_and_write(fs, "safeway-data/speed_violations.parquet", spd, None, "violation_date", args.full_refresh)
            print(f"  speed_violations.parquet -> gs://safeway-data/ OK", flush=True)
        else:
            print("  No speed camera data returned; skipping.", flush=True)
    except Exception as e:
        print(f"  Speed camera fetch failed: {e}; skipping.", flush=True)

    # --- Street Lights Out (zuxi-7xem) ---
    # Streetlights are a point-in-time snapshot, not date-ranged.
    # Only re-fetch if no existing data or --full-refresh.
    print("Fetching streetlight outage reports...", flush=True)
    try:
        has_existing_lights = False
        if not args.full_refresh:
            try:
                with fs.open("safeway-data/streetlights_out.parquet", "rb") as f:
                    existing_lights = pd.read_parquet(f)
                if len(existing_lights) > 0:
                    has_existing_lights = True
                    print(f"  Streetlights: {len(existing_lights)} existing rows on GCS, re-fetching to update.", flush=True)
            except FileNotFoundError:
                pass
        lights = fetch_all(
            "zuxi-7xem",
            where="latitude IS NOT NULL",
            select=["creation_date", "status", "latitude", "longitude"],
            log_label="StreetlightsOut",
        )
        if not lights.empty:
            for col in ("latitude", "longitude"):
                lights[col] = pd.to_numeric(lights[col], errors="coerce")
            lights = lights.dropna(subset=["latitude", "longitude"])
            with fs.open("safeway-data/streetlights_out.parquet", "wb") as f:
                lights.to_parquet(f, index=False)
            print(f"  streetlights_out.parquet -> gs://safeway-data/ ({len(lights)} rows)", flush=True)
        else:
            print("  No streetlight data returned; skipping.", flush=True)
    except Exception as e:
        print(f"  Streetlight fetch failed: {e}; skipping.", flush=True)

    # --- Red Light Camera LOCATIONS (7mgr-iety) ---
    # Static dataset: where cameras are physically installed (~150 locations).
    # Different from violations — this is for deterrence proximity features.
    print("Fetching red light camera locations...", flush=True)
    try:
        rlc_locs = fetch_all(
            "7mgr-iety",
            where="latitude IS NOT NULL",
            select=["intersection", "latitude", "longitude", "first_approach", "second_approach"],
            log_label="RedLightCameraLocations",
        )
        if not rlc_locs.empty:
            for col in ("latitude", "longitude"):
                rlc_locs[col] = pd.to_numeric(rlc_locs[col], errors="coerce")
            rlc_locs = rlc_locs.dropna(subset=["latitude", "longitude"])
            with fs.open("safeway-data/red_light_camera_locations.parquet", "wb") as f:
                rlc_locs.to_parquet(f, index=False)
            print(f"  red_light_camera_locations.parquet -> gs://safeway-data/ ({len(rlc_locs)} rows)", flush=True)
        else:
            print("  No red light camera location data returned; skipping.", flush=True)
    except Exception as e:
        print(f"  Red light camera locations fetch failed: {e}; skipping.", flush=True)

    # --- Speed Camera LOCATIONS (4i42-qv3h) ---
    # Static dataset: where speed cameras are physically installed (~150 locations).
    print("Fetching speed camera locations...", flush=True)
    try:
        spd_locs = fetch_all(
            "4i42-qv3h",
            where="latitude IS NOT NULL",
            select=["address", "latitude", "longitude"],
            log_label="SpeedCameraLocations",
        )
        if not spd_locs.empty:
            for col in ("latitude", "longitude"):
                spd_locs[col] = pd.to_numeric(spd_locs[col], errors="coerce")
            spd_locs = spd_locs.dropna(subset=["latitude", "longitude"])
            with fs.open("safeway-data/speed_camera_locations.parquet", "wb") as f:
                spd_locs.to_parquet(f, index=False)
            print(f"  speed_camera_locations.parquet -> gs://safeway-data/ ({len(spd_locs)} rows)", flush=True)
        else:
            print("  No speed camera location data returned; skipping.", flush=True)
    except Exception as e:
        print(f"  Speed camera locations fetch failed: {e}; skipping.", flush=True)

    print("Done.", flush=True)


if __name__ == "__main__":
    main()
