"""
Fetch Chicago Crimes from Socrata API.
Violent + property types for training (past_n_crime_violent / past_n_crime_property).
Run from repo root: python -m backend.model.data.crimes
"""
import pandas as pd
from .socrata_client import fetch_all

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

VIOLENT_CRIME_TYPES = [
    "ASSAULT",
    "BATTERY",
    "ROBBERY",
    "HOMICIDE",
    "CRIM SEXUAL ASSAULT",
    "KIDNAPPING",
    "STALKING",
    "WEAPONS VIOLATION",
]

PROPERTY_CRIME_TYPES = [
    "THEFT",
    "BURGLARY",
    "MOTOR VEHICLE THEFT",
    "ARSON",
    "CRIMINAL DAMAGE",
    "CRIMINAL DAMAGE TO PROPERTY",
]

# Union for API fetch + filter
RELEVANT_CRIME_TYPES = list(dict.fromkeys(VIOLENT_CRIME_TYPES + PROPERTY_CRIME_TYPES))


def get_crimes(
    start_date: str = "2021-01-01",
    end_date: str = "2025-12-31",
    limit: int | None = 50000,
) -> pd.DataFrame:
    """
    Fetch crimes; filter for violent + property types; drop null lat/lon.
    Adds is_violent, is_property for aggregation.
    """
    types_sql = ", ".join(f"'{t}'" for t in RELEVANT_CRIME_TYPES)
    where = (
        f"date between '{start_date}T00:00:00' and '{end_date}T23:59:59' "
        f"and primary_type in ({types_sql})"
    )

    df = fetch_all(CRIMES_ID, where, CRIME_COLS, max_rows=limit)

    if df.empty:
        return df

    for col in ("latitude", "longitude"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude"])
    df = df[df["primary_type"].isin(RELEVANT_CRIME_TYPES)].copy()

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["arrest"] = df["arrest"].astype(str).str.upper() == "TRUE"
    df["domestic"] = df["domestic"].astype(str).str.upper() == "TRUE"
    df["is_violent"] = df["primary_type"].isin(VIOLENT_CRIME_TYPES)
    df["is_property"] = df["primary_type"].isin(PROPERTY_CRIME_TYPES)
    df = df.reset_index(drop=True)

    print(f"Fetched {len(df)} relevant crimes (violent + property).")
    return df
