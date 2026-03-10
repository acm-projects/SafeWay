"""
Socrata API client for Chicago Open Data.
Paginated fetch for large datasets (Crashes, Vehicles, People, Crimes).
Uses SOCRATA_APP_TOKEN from backend .env if set (higher rate limits; fewer throttling/500 errors).
"""
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sodapy import Socrata

# Load backend/.env when client is used (e.g. from analysis or build_crash_map)
_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")

_DEFAULT_TIMEOUT = 60
_DEFAULT_CHUNK = 50_000


def get_client(domain: str = "data.cityofchicago.org", timeout: int = _DEFAULT_TIMEOUT) -> Socrata:
    """Return a Socrata client. Uses SOCRATA_APP_TOKEN from env if set for higher rate limits."""
    app_token = os.getenv("SOCRATA_APP_TOKEN") or None
    return Socrata(domain, app_token, timeout=timeout)


def fetch_all(
    dataset_id: str,
    where: str,
    select: list[str],
    chunk_size: int = _DEFAULT_CHUNK,
    domain: str = "data.cityofchicago.org",
    max_rows: int | None = None,
    log_label: str | None = None,
) -> pd.DataFrame:
    """
    Fetch rows from a Socrata dataset matching the where clause.
    Uses limit/offset pagination; returns a single DataFrame.
    If max_rows is set, stop after that many rows (for quick testing).
    """
    client = get_client(domain=domain)
    select_str = ",".join(select)
    offset = 0
    frames = []
    while True:
        limit = chunk_size if (max_rows is None) else min(chunk_size, max_rows - offset)
        if max_rows is not None and limit <= 0:
            break
        rows = client.get(dataset_id, where=where, select=select_str, limit=limit, offset=offset)
        if not rows:
            break
        frames.append(pd.DataFrame.from_records(rows))
        offset += len(rows)
        if log_label:
            print(f"  [{log_label}] {offset} rows...", flush=True)
        if len(rows) < chunk_size or (max_rows is not None and offset >= max_rows):
            break
    if not frames:
        return pd.DataFrame(columns=select)
    return pd.concat(frames, ignore_index=True)
