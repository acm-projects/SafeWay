"""
Pull latest crashes and crimes from Chicago Data Portal (Socrata) and write to GCS.
Use this in the nightly pipeline so train_model always trains on up-to-date data.

Run from repo root:
  python -u -m backend.model.refresh_gcs_from_socrata
  python -u -m backend.model.refresh_gcs_from_socrata --end 2026-02-28

Requires: SOCRATA_APP_TOKEN in env (optional but recommended for rate limits),
          GCS key at GCS_CREDENTIALS_PATH or backend/safeway-*.json.
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
    parser = argparse.ArgumentParser(description="Refresh GCS parquet from Socrata (Chicago Data Portal)")
    parser.add_argument("--start", default="2020-01-01", help="Start date for crashes/crimes")
    parser.add_argument(
        "--end",
        default=None,
        help="End date (default: first of last month, so we have complete data)",
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
        print("GCS_CREDENTIALS_PATH is not set or file not found; cannot refresh crashes/crimes to GCS.", flush=True)
        sys.exit(1)

    print(f"Fetching from Socrata: {args.start} .. {end}", flush=True)
    print("Fetching crashes (Crashes + Vehicles + People)...", flush=True)
    crashes = get_enriched_crashes(
        start_date=args.start,
        end_date=end,
        limit=crash_limit,
    )
    if crashes.empty:
        print("No crashes returned; aborting.", flush=True)
        sys.exit(1)
    print(f"  Got {len(crashes)} crashes.", flush=True)

    print("Fetching crimes...", flush=True)
    crimes = get_crimes(
        start_date=args.start,
        end_date=end,
        limit=crime_limit,
    )
    if crimes.empty:
        print("No crimes returned; aborting.", flush=True)
        sys.exit(1)
    # train_model expects crime_date when reading from GCS
    if "crime_date" not in crimes.columns and "date" in crimes.columns:
        crimes["crime_date"] = crimes["date"]
    print(f"  Got {len(crimes)} crimes.", flush=True)

    fs = gcsfs.GCSFileSystem(token=gcs_key)
    print("Writing to GCS...", flush=True)
    with fs.open("safeway-data/crashes.parquet", "wb") as f:
        crashes.to_parquet(f, index=False)
    print("  crashes.parquet -> gs://safeway-data/ OK", flush=True)
    with fs.open("safeway-data/crimes.parquet", "wb") as f:
        crimes.to_parquet(f, index=False)
    print("  crimes.parquet -> gs://safeway-data/ OK", flush=True)
    print("Done. Nightly train_model will use this data when loading from GCS.", flush=True)


if __name__ == "__main__":
    main()
