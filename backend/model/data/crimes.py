"""
Fetch Chicago Crimes from Socrata API.
Filters for violent and property crimes relevant to SafeWay safety scoring.
Run from repo root: python -m backend.model.data.crimes
"""
import pandas as pd
from .socrata_client import fetch_all

# Dataset ID (Chicago Open Data - Crimes 2001 to Present)
CRIMES_ID = "ijzp-q8t2"

CRIME_COLS = [
    "id",
    "date",
    "primary_type",
    "description",
    "latitude",
    "longitude",
    "arrest",
    "domestic",
    "beat",
    "district",
]

# Crime types most relevant to pedestrian/cyclist safety
RELEVANT_CRIME_TYPES = [
    "ASSAULT",
    "BATTERY",
    "ROBBERY",
    "HOMICIDE",
    "CRIM SEXUAL ASSAULT",
    "KIDNAPPING",
    "STALKING",
    "WEAPONS VIOLATION",
]


def get_crimes(
    start_date: str = "2021-01-01",
    end_date: str = "2025-12-31",
    limit: int | None = 50000,
) -> pd.DataFrame:
    """
    Fetch crimes from Chicago Open Data, filter for safety-relevant types,
    drop rows without coordinates.
    """
    where = f"date between '{start_date}T00:00:00' and '{end_date}T23:59:59'"

    df = fetch_all(CRIMES_ID, where, CRIME_COLS, max_rows=limit)

    if df.empty:
        return df

    # Coerce lat/lon and drop nulls
    for col in ("latitude", "longitude"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude"])

    # Filter for relevant crime types only
    df = df[df["primary_type"].isin(RELEVANT_CRIME_TYPES)].copy()

    # Clean up
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["arrest"] = df["arrest"].astype(str).str.upper() == "TRUE"
    df["domestic"] = df["domestic"].astype(str).str.upper() == "TRUE"
    df = df.reset_index(drop=True)

    print(f"Fetched {len(df)} relevant crimes.")
    return df

