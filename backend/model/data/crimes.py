"""
Fetch Chicago Crimes from Socrata API.
Three crime groups for smart re-integration:
  Group 1 (traffic-direct): DUI, reckless driving, hit-and-run — full weight
  Group 2 (disorder):       drugs, weapons, assault/battery — 0.3 weight
  Group 3 (exclude):        theft, burglary, fraud, property — not fetched
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

# --- Group 1: Directly traffic-related (full weight) ---
# Causal link to driving safety: DUI, reckless driving, vehicular offenses
TRAFFIC_DIRECT_TYPES = [
    "LIQUOR LAW VIOLATION",
    "OTHER NARCOTIC VIOLATION",
]
# These are matched via `description` column (sub-types within primary_type)
TRAFFIC_DIRECT_DESCRIPTIONS = [
    "DRIVING UNDER THE INFLUENCE",
    "DUI",
    "RECKLESS DRIVING",
    "HIT AND RUN",
    "VEHICULAR HIJACKING",
    "AGGRAVATED VEHICULAR HIJACKING",
    "VEHICULAR INVASION",
]

# --- Group 2: Environment/disorder signal (0.3 weight) ---
# Indirect: drug activity → impaired drivers, weapons/assault → aggressive driving culture
DISORDER_TYPES = [
    "NARCOTICS",
    "WEAPONS VIOLATION",
    "ASSAULT",
    "BATTERY",
]

# --- Group 3: EXCLUDED (no causal link to driving risk) ---
# Kept here only for backward compatibility of is_violent / is_property flags
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

# Fetch all types we need for any group (union)
RELEVANT_CRIME_TYPES = list(dict.fromkeys(
    VIOLENT_CRIME_TYPES + PROPERTY_CRIME_TYPES
    + TRAFFIC_DIRECT_TYPES + DISORDER_TYPES
))


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
    # Legacy flags (backward compat)
    df["is_violent"] = df["primary_type"].isin(VIOLENT_CRIME_TYPES)
    df["is_property"] = df["primary_type"].isin(PROPERTY_CRIME_TYPES)

    # Smart crime groups for Phase B
    desc_upper = df["description"].fillna("").str.upper()
    df["is_traffic_direct"] = (
        df["primary_type"].isin(TRAFFIC_DIRECT_TYPES)
        | desc_upper.str.contains("|".join(TRAFFIC_DIRECT_DESCRIPTIONS), regex=True, na=False)
    )
    df["is_disorder"] = (
        df["primary_type"].isin(DISORDER_TYPES)
        & ~df["is_traffic_direct"]  # don't double-count
        & ~df["domestic"]           # exclude domestic incidents per plan
    )
    df = df.reset_index(drop=True)

    n_td = df["is_traffic_direct"].sum()
    n_dis = df["is_disorder"].sum()
    print(f"Fetched {len(df)} crimes: {n_td} traffic-direct, {n_dis} disorder, {len(df)-n_td-n_dis} excluded.")
    return df
