"""
Push crimes DataFrame to Supabase table enriched_crimes.
Uses SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from backend .env.
"""
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Load backend/.env
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


def _row_to_record(row):
    """Convert a single DataFrame row to a dict for enriched_crimes table."""
    crime_date = row.get("date")
    if hasattr(crime_date, "isoformat"):
        crime_date = crime_date.isoformat()
    elif crime_date is not None:
        crime_date = str(crime_date)

    return {
        "crime_id": str(row.get("id", "")),
        "crime_date": crime_date,
        "primary_type": str(row["primary_type"]) if pd.notna(row.get("primary_type")) else None,
        "description": str(row["description"]) if pd.notna(row.get("description")) else None,
        "latitude": float(row["latitude"]),
        "longitude": float(row["longitude"]),
        "arrest": bool(row.get("arrest", False)),
        "domestic": bool(row.get("domestic", False)),
        "beat": str(row["beat"]) if pd.notna(row.get("beat")) else None,
        "district": str(row["district"]) if pd.notna(row.get("district")) else None,
    }


def push_crimes_to_supabase(df: pd.DataFrame, batch_size: int = 1000) -> int:
    """
    Upsert crime rows into Supabase table enriched_crimes.
    df: DataFrame from get_crimes().
    batch_size: rows per upsert request.
    """
    records = []
    for _, row in df.iterrows():
        try:
            records.append(_row_to_record(row))
        except Exception as e:
            cid = row.get("id", "?")
            print(f"Warning: skip row {cid}: {e}")
            continue

    if not records:
        print("No rows to push to Supabase.")
        return 0

    client = get_supabase_client()
    total = 0
    for i in range(0, len(records), batch_size):
        chunk = records[i: i + batch_size]
        try:
            client.table("enriched_crimes").upsert(chunk, on_conflict="crime_id").execute()
            total += len(chunk)
            print(f"Upserted {total}/{len(records)} rows to Supabase.")
        except Exception as e:
            print(f"Supabase upsert failed at batch {i}: {e}")
            raise
    return total

