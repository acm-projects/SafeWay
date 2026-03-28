"""
Push intersection safety scores DataFrame to Supabase table intersection_safety.
Uses SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from backend .env.

Run migrations first:
  - backend/migrations/004_intersection_safety.sql
  - backend/migrations/005_intersection_safety_composite.sql (for component columns)
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")


def get_supabase_client():
    """Return a Supabase client. Requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY."""
    from supabase import create_client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in backend .env")
    return create_client(url, key)


def _as_int(row, key, default=0):
    v = row.get(key, default)
    if v is None or pd.isna(v):
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _as_float(row, key, default=0.0):
    v = row.get(key, default)
    if v is None or pd.isna(v):
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _row_to_record(row) -> dict:
    """Map one scores DataFrame row to intersection_safety upsert payload."""
    record = {
        "node_id": str(row["node_id"]),
        "latitude": _as_float(row, "latitude"),
        "longitude": _as_float(row, "longitude"),
        "total_crashes": _as_int(row, "total_crashes"),
        "fsi_crashes": _as_int(row, "fsi_crashes"),
        "ped_crashes": _as_int(row, "ped_crashes"),
        "bike_crashes": _as_int(row, "bike_crashes"),
        "total_crimes": _as_int(row, "total_crimes"),
        "danger_score": _as_float(row, "danger_score"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # 005 columns — include when present so one upsert works after migration 005
    for col in (
        "context_crime_score",
        "frequency_component",
        "severity_component",
        "driver_risk_component",
        "vulnerable_component",
        "predicted_risk",
        "future_risk_score",
    ):
        if col in row.index and pd.notna(row.get(col)):
            try:
                record[col] = float(row[col])
            except (TypeError, ValueError):
                record[col] = 0.0
    return record


def push_intersection_safety_to_supabase(
    scores_df: pd.DataFrame, batch_size: int = 1000
) -> int:
    """
    Upsert intersection_safety rows. scores_df from build_intersection_safety_scores().
    Requires table from 004; for full column set run 005 as well.
    """
    if scores_df.empty:
        print("No rows to push to intersection_safety.")
        return 0

    records = []
    for _, row in scores_df.iterrows():
        try:
            records.append(_row_to_record(row))
        except Exception as e:
            nid = row.get("node_id", "?")
            print(f"Warning: skip node {nid}: {e}")
            continue

    if not records:
        print("No valid rows to push.")
        return 0

    client = get_supabase_client()
    total = 0
    for i in range(0, len(records), batch_size):
        chunk = records[i : i + batch_size]
        try:
            client.table("intersection_safety").upsert(
                chunk, on_conflict="node_id"
            ).execute()
            total += len(chunk)
            print(f"Upserted {total}/{len(records)} rows to intersection_safety.")
        except Exception as e:
            print(f"Supabase upsert failed at batch starting {i}: {e}")
            if "column" in str(e).lower() or "schema" in str(e).lower():
                print(
                    "Hint: run 004_intersection_safety.sql; if using composite score columns, run 005_intersection_safety_composite.sql."
                )
            raise
    return total
