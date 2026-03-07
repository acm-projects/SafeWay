"""
Fetch Chicago Traffic Crashes, Vehicles, and People from Socrata API;
merge on CRASH_RECORD_ID and return enriched crash-level DataFrame.
"""
import pandas as pd
from .socrata_client import fetch_all

# Dataset IDs (Chicago Open Data)
CRASHES_ID = "85ca-t3if"
VEHICLES_ID = "68nd-jvt3"
PEOPLE_ID = "u6pd-qa9d"

CRASH_COLS = [
    "crash_record_id",
    "crash_date",
    "crash_hour",
    "latitude",
    "longitude",
    "posted_speed_limit",
    "traffic_control_device",
    "weather_condition",
    "lighting_condition",
    "first_crash_type",
    "prim_contributory_cause",
    "hit_and_run_i",
    "injuries_fatal",
    "injuries_incapacitating",
    "injuries_non_incapacitating",
    "injuries_reported_not_evident",
    "injuries_no_indication",
]
VEH_COLS = ["crash_record_id", "unit_type"]
PEOPLE_COLS = ["crash_record_id", "injury_classification"]


def get_enriched_crashes(
    start_date: str = "2021-01-01",
    end_date: str = "2025-12-31",
    limit: int | None = 50000,
) -> pd.DataFrame:
    """
    Fetch Crashes, Vehicles, and People; merge on crash_record_id; add has_ped, has_bike, injury cols, is_fsi.
    Drops rows with null latitude/longitude. Optional limit for quick testing (e.g. 5000).
    """
    where_crash = f"crash_date between '{start_date}T00:00:00' and '{end_date}T23:59:59'"
    # When limit set, cap API rows for faster runs (Socrata is throttled without token)
    max_rows = limit if limit else None

    # 1. Crashes
    df_crash = fetch_all(CRASHES_ID, where_crash, CRASH_COLS, max_rows=max_rows)
    if df_crash.empty:
        return df_crash
    if limit:
        df_crash = df_crash.head(limit)
    df_crash["crash_record_id"] = df_crash["crash_record_id"].astype(str)

    # Coerce lat/lon and drop nulls for map
    for col in ("latitude", "longitude"):
        df_crash[col] = pd.to_numeric(df_crash[col], errors="coerce")
    df_crash = df_crash.dropna(subset=["latitude", "longitude"])

    # 2. Vehicles: aggregate unit_type per crash, then join
    veh_max = (limit * 3) if limit else None  # enough to get many joins without full pull
    df_veh = fetch_all(VEHICLES_ID, where_crash, VEH_COLS, max_rows=veh_max)
    if not df_veh.empty:
        df_veh["crash_record_id"] = df_veh["crash_record_id"].astype(str)
        veh_group = df_veh.groupby("crash_record_id")["unit_type"].apply(
            lambda x: list(x.fillna("").astype(str))
        )
        df_crash = df_crash.set_index("crash_record_id").join(veh_group, how="left").reset_index()
        df_crash = df_crash.rename(columns={"unit_type": "unit_types"})
    df_crash["unit_types"] = df_crash.get("unit_types", pd.Series(dtype=object)).apply(
        lambda x: x if isinstance(x, list) else []
    )

    def has_ped(units):
        return any("PEDESTRIAN" in str(u).upper() for u in (units or []))

    def has_bike(units):
        return any(
            any(k in str(u).upper() for k in ("PEDALCYCLE", "BICYCLE", "PEDALCYCLIST"))
            for u in (units or [])
        )

    df_crash["has_ped"] = df_crash["unit_types"].apply(has_ped)
    df_crash["has_bike"] = df_crash["unit_types"].apply(has_bike)

    # 3. People: injury counts per crash, then join
    people_max = (limit * 3) if limit else None
    df_people = fetch_all(PEOPLE_ID, where_crash, PEOPLE_COLS, max_rows=people_max)
    if not df_people.empty:
        df_people["crash_record_id"] = df_people["crash_record_id"].astype(str)
        inj = (
            df_people.groupby(["crash_record_id", "injury_classification"])
            .size()
            .unstack(fill_value=0)
        )
        inj.columns = [f"people_{str(c).lower().replace(' ', '_')}" for c in inj.columns]
        df_crash = df_crash.set_index("crash_record_id").join(inj, how="left").reset_index()
    for col in df_crash.columns:
        if col.startswith("people_"):
            df_crash[col] = df_crash[col].fillna(0).astype(int)

    # is_fsi: fatal or incapacitating injury (from People table)
    pf = df_crash.get("people_fatal")
    pi = df_crash.get("people_incapacitating_injury")
    if pf is None:
        pf = pd.Series(0, index=df_crash.index)
    if pi is None:
        pi = pd.Series(0, index=df_crash.index)
    df_crash["is_fsi"] = (pf.astype(int) > 0) | (pi.astype(int) > 0)

    return df_crash
