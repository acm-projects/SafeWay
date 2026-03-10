"""
Push enriched crash DataFrame to Supabase table enriched_crashes.
Uses SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from backend .env.
"""
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Load backend/.env when run from repo root (e.g. python -m backend.model.analysis)
_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")


def get_supabase_client():
    """Return a Supabase client for the model pipeline. Requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."""
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in backend .env")
    return create_client(url, key)


def _row_to_record(row, people_cols):
    """Convert a single DataFrame row to a dict for enriched_crashes table."""
    crash_date = row.get("crash_date")
    if hasattr(crash_date, "isoformat"):
        crash_date = crash_date.isoformat()
    elif crash_date is not None and hasattr(crash_date, "strftime"):
        crash_date = crash_date.strftime("%Y-%m-%dT%H:%M:%S")
    elif crash_date is not None:
        crash_date = str(crash_date)

    try:
        ch = row.get("crash_hour")
        crash_hour = int(ch) if ch is not None and pd.notna(ch) and str(ch).strip() != "" else None
    except (TypeError, ValueError):
        crash_hour = None

    record = {
        "crash_record_id": str(row.get("crash_record_id", "")),
        "crash_date": crash_date,
        "crash_hour": crash_hour,
        "latitude": float(row["latitude"]),
        "longitude": float(row["longitude"]),
        "posted_speed_limit": float(row["posted_speed_limit"]) if pd.notna(row.get("posted_speed_limit")) else None,
        "traffic_control_device": str(row["traffic_control_device"]) if pd.notna(row.get("traffic_control_device")) else None,
        "weather_condition": str(row["weather_condition"]) if pd.notna(row.get("weather_condition")) else None,
        "lighting_condition": str(row["lighting_condition"]) if pd.notna(row.get("lighting_condition")) else None,
        "first_crash_type": str(row["first_crash_type"]) if pd.notna(row.get("first_crash_type")) else None,
        "prim_contributory_cause": str(row["prim_contributory_cause"]) if pd.notna(row.get("prim_contributory_cause")) else None,
        "hit_and_run_i": str(row["hit_and_run_i"]) if pd.notna(row.get("hit_and_run_i")) else None,
        "injuries_fatal": int(row["injuries_fatal"]) if pd.notna(row.get("injuries_fatal")) else None,
        "injuries_incapacitating": int(row["injuries_incapacitating"]) if pd.notna(row.get("injuries_incapacitating")) else None,
        "injuries_non_incapacitating": int(row["injuries_non_incapacitating"]) if pd.notna(row.get("injuries_non_incapacitating")) else None,
        "injuries_reported_not_evident": int(row["injuries_reported_not_evident"]) if pd.notna(row.get("injuries_reported_not_evident")) else None,
        "injuries_no_indication": int(row["injuries_no_indication"]) if pd.notna(row.get("injuries_no_indication")) else None,
        "has_ped": bool(row.get("has_ped", False)),
        "has_bike": bool(row.get("has_bike", False)),
        "is_fsi": bool(row.get("is_fsi", False)),
    }
    # Optional columns (migration 007) — only sent if present in row
    optional_str = (
        "device_condition", "crash_type", "trafficway_type", "lane_cnt",
        "alignment", "roadway_surface_cond", "road_defect",
        "intersection_related_i", "work_zone_i",
    )
    for col in optional_str:
        if col in row.index and pd.notna(row.get(col)):
            record[col] = str(row[col])
    if "num_units" in row.index and pd.notna(row.get("num_units")):
        try:
            record["num_units"] = int(row["num_units"])
        except (TypeError, ValueError):
            pass
    if "crash_day_of_week" in row.index and pd.notna(row.get("crash_day_of_week")):
        try:
            record["crash_day_of_week"] = int(row["crash_day_of_week"])
        except (TypeError, ValueError):
            pass
    if people_cols:
        people_injuries = {}
        for c in people_cols:
            if c in row.index and pd.notna(row.get(c)):
                try:
                    people_injuries[c] = int(row[c])
                except (TypeError, ValueError):
                    pass
        if people_injuries:
            record["people_injuries"] = people_injuries
    return record


def push_enriched_crashes_to_supabase(df, batch_size: int = 1000):
    """
    Upsert enriched crash rows into Supabase table enriched_crashes.
    df: DataFrame from get_enriched_crashes(). Must have crash_record_id, latitude, longitude.
    batch_size: rows per upsert request.
    """
    people_cols = [c for c in df.columns if c.startswith("people_")]
    records = []
    for _, row in df.iterrows():
        try:
            records.append(_row_to_record(row, people_cols))
        except Exception as e:
            # Skip bad rows but log
            rid = row.get("crash_record_id", "?")
            print(f"Warning: skip row {rid}: {e}")
            continue

    if not records:
        print("No rows to push to Supabase.")
        return 0

    client = get_supabase_client()
    total = 0
    for i in range(0, len(records), batch_size):
        chunk = records[i : i + batch_size]
        try:
            client.table("enriched_crashes").upsert(chunk, on_conflict="crash_record_id").execute()
            total += len(chunk)
            print(f"Upserted {total}/{len(records)} rows to Supabase.")
        except Exception as e:
            print(f"Supabase upsert failed at batch {i}: {e}")
            raise
    return total
