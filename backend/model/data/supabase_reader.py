"""
Load enriched crashes and crimes from Supabase for training (no Socrata pull).
Paginates at 1000 rows per request (PostgREST default max).

Crashes/crimes are loaded in date chunks (monthly) so each query hits a
small slice of the table and stays under Supabase statement_timeout (57014).
"""
from __future__ import annotations

import time

import pandas as pd

from .supabase_crashes import get_supabase_client
from .crimes import PROPERTY_CRIME_TYPES, VIOLENT_CRIME_TYPES

PAGE_SIZE = 500
MAX_RETRIES = 4
RETRY_SLEEP_SEC = 2.0


# Retry on statement timeout (57014) or gateway/upstream errors (502, 503, 504)
RETRIABLE_CODES = {57014, "57014", 502, 503, 504, "502", "503", "504"}


def _execute_with_retry(q, label: str):
    """Run query.execute(); retry on timeout 57014 or Bad Gateway 502/503/504."""
    from postgrest.exceptions import APIError

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            return q.execute()
        except APIError as e:
            last_err = e
            code = getattr(e, "code", None)
            if code not in RETRIABLE_CODES:
                raise
            if attempt < MAX_RETRIES - 1:
                print(f"  [{label}] error {code}, retry {attempt + 1}/{MAX_RETRIES} in {RETRY_SLEEP_SEC}s...", flush=True)
                time.sleep(RETRY_SLEEP_SEC)
    raise last_err


def _month_ranges(start_date: str, end_date: str):
    """Yield (chunk_start, chunk_end) inclusive per month within [start_date, end_date]."""
    s = pd.Timestamp(start_date)
    e = pd.Timestamp(end_date)
    cur = s
    while cur <= e:
        month_end = cur + pd.offsets.MonthEnd(0)
        seg_end = min(month_end.normalize(), e)
        yield cur.strftime("%Y-%m-%d"), seg_end.strftime("%Y-%m-%d")
        cur = seg_end + pd.Timedelta(days=1)


def _iso_start(d: str) -> str:
    return f"{d}T00:00:00+00:00"


def _iso_end(d: str) -> str:
    return f"{d}T23:59:59.999999+00:00"


def _load_crashes_chunk(client, chunk_start: str, chunk_end: str) -> list[pd.DataFrame]:
    """Keyset-fetch one date chunk; returns list of DataFrames (may be empty)."""
    start_ts = _iso_start(chunk_start)
    end_ts = _iso_end(chunk_end)
    frames = []
    last_id = None
    while True:
        q = (
            client.table("enriched_crashes")
            .select("*")
            .gte("crash_date", start_ts)
            .lte("crash_date", end_ts)
            .order("crash_record_id")
            .limit(PAGE_SIZE)
        )
        if last_id is not None:
            q = q.gt("crash_record_id", last_id)
        r = _execute_with_retry(q, "enriched_crashes")
        rows = r.data or []
        if not rows:
            break
        frames.append(pd.DataFrame(rows))
        last_id = rows[-1]["crash_record_id"]
        if len(rows) < PAGE_SIZE:
            break
    return frames


def load_crashes_from_supabase(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Read enriched_crashes between start_date and end_date (inclusive).
    Loads by monthly chunks + keyset pagination to stay under statement_timeout.
    """
    client = get_supabase_client()
    frames = []
    total = 0
    t0 = time.perf_counter()
    print(f"  [Supabase enriched_crashes] {start_date} .. {end_date} (monthly chunks + keyset)", flush=True)
    for chunk_start, chunk_end in _month_ranges(start_date, end_date):
        chunk_frames = _load_crashes_chunk(client, chunk_start, chunk_end)
        for cf in chunk_frames:
            frames.append(cf)
            total += len(cf)
        if chunk_frames:
            print(f"  [Supabase enriched_crashes] chunk {chunk_start}..{chunk_end} -> total {total}", flush=True)
    if not frames:
        print("  [Supabase enriched_crashes] 0 rows.", flush=True)
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    # Ensure types training_features expects
    if "crash_date" in df.columns:
        df["crash_date"] = pd.to_datetime(df["crash_date"], errors="coerce", utc=True)
    for col in ("has_ped", "has_bike", "is_fsi"):
        if col in df.columns:
            df[col] = df[col].fillna(False).astype(bool)
    # is_fsi from injuries if missing
    if "is_fsi" not in df.columns or not df["is_fsi"].any():
        fatal = pd.to_numeric(df.get("injuries_fatal"), errors="coerce").fillna(0)
        incap = pd.to_numeric(df.get("injuries_incapacitating"), errors="coerce").fillna(0)
        df["is_fsi"] = (fatal > 0) | (incap > 0)
    elapsed = time.perf_counter() - t0
    print(f"  [Supabase enriched_crashes] done {len(df)} rows in {elapsed:.1f}s", flush=True)
    return df


def _load_crimes_chunk(client, chunk_start: str, chunk_end: str) -> list[pd.DataFrame]:
    start_ts = _iso_start(chunk_start)
    end_ts = _iso_end(chunk_end)
    frames = []
    last_id = None
    while True:
        q = (
            client.table("enriched_crimes")
            .select("*")
            .gte("crime_date", start_ts)
            .lte("crime_date", end_ts)
            .order("crime_id")
            .limit(PAGE_SIZE)
        )
        if last_id is not None:
            q = q.gt("crime_id", last_id)
        r = _execute_with_retry(q, "enriched_crimes")
        rows = r.data or []
        if not rows:
            break
        frames.append(pd.DataFrame(rows))
        last_id = rows[-1]["crime_id"]
        if len(rows) < PAGE_SIZE:
            break
    return frames


def load_crimes_from_supabase(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Read enriched_crimes between dates. Monthly chunks + keyset to avoid 57014.
    Maps crime_date -> date for training_features.
    """
    client = get_supabase_client()
    frames = []
    total = 0
    t0 = time.perf_counter()
    print(f"  [Supabase enriched_crimes] {start_date} .. {end_date} (monthly chunks + keyset)", flush=True)
    for chunk_start, chunk_end in _month_ranges(start_date, end_date):
        chunk_frames = _load_crimes_chunk(client, chunk_start, chunk_end)
        for cf in chunk_frames:
            frames.append(cf)
            total += len(cf)
        if chunk_frames:
            print(f"  [Supabase enriched_crimes] chunk {chunk_start}..{chunk_end} -> total {total}", flush=True)
    if not frames:
        print("  [Supabase enriched_crimes] 0 rows.", flush=True)
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    # training_features uses crimes["date"]
    if "crime_date" in df.columns:
        df["date"] = pd.to_datetime(df["crime_date"], errors="coerce", utc=True)
    df["is_violent"] = df["primary_type"].isin(VIOLENT_CRIME_TYPES)
    df["is_property"] = df["primary_type"].isin(PROPERTY_CRIME_TYPES)
    elapsed = time.perf_counter() - t0
    print(f"  [Supabase enriched_crimes] done {len(df)} rows in {elapsed:.1f}s", flush=True)
    return df
