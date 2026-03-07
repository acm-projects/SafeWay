"""
Socrata API client for Chicago Open Data.
Paginated fetch for large datasets (Crashes, Vehicles, People, Crimes).
"""
from sodapy import Socrata
import pandas as pd

_DEFAULT_TIMEOUT = 60
_DEFAULT_CHUNK = 50_000


def get_client(domain: str = "data.cityofchicago.org", timeout: int = _DEFAULT_TIMEOUT) -> Socrata:
    """Return a Socrata client (no token required for public data)."""
    return Socrata(domain, None, timeout=timeout)


def fetch_all(
    dataset_id: str,
    where: str,
    select: list[str],
    chunk_size: int = _DEFAULT_CHUNK,
    domain: str = "data.cityofchicago.org",
    max_rows: int | None = None,
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
        if len(rows) < chunk_size or (max_rows is not None and offset >= max_rows):
            break
    if not frames:
        return pd.DataFrame(columns=select)
    return pd.concat(frames, ignore_index=True)
