"""
Fetch Chicago red light and speed camera violation data from Socrata API.
Joins violations with camera locations to get GPS coordinates.
Run from repo root: python -m backend.model.data.cameras
"""
import pandas as pd
from pathlib import Path
from .socrata_client import fetch_all

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"

# Dataset IDs
SPEED_VIOLATIONS_ID = "hhkd-xvj4"
SPEED_LOCATIONS_ID = "4i42-qv3h"
REDLIGHT_VIOLATIONS_ID = "spqx-js37"
REDLIGHT_LOCATIONS_ID = "thvf-6diy"


def get_speed_camera_violations(
    start_date: str = "2020-01-01",
    end_date: str = "2025-12-31",
    limit: int | None = None,
) -> pd.DataFrame:
    """
    Fetch speed camera violations and join with camera locations to get GPS coords.
    """
    print("Fetching speed camera violations...")
    where = f"violation_date >= '{start_date}T00:00:00' AND violation_date <= '{end_date}T23:59:59'"
    violations = fetch_all(SPEED_VIOLATIONS_ID, where, ["address", "camera_id", "violation_date", "violations"], max_rows=limit)
    if violations.empty:
        print("No speed camera violations found.")
        return violations

    print(f"Fetched {len(violations)} speed violation records.")

    # Fetch camera locations
    print("Fetching speed camera locations...")
    locations = fetch_all(SPEED_LOCATIONS_ID, "", ["location_id", "address", "latitude", "longitude"])
    locations = locations.rename(columns={"location_id": "camera_id"})
    locations["latitude"] = pd.to_numeric(locations["latitude"], errors="coerce")
    locations["longitude"] = pd.to_numeric(locations["longitude"], errors="coerce")
    locations = locations.dropna(subset=["latitude", "longitude"])

    # Join violations with locations
    merged = violations.merge(locations[["camera_id", "latitude", "longitude"]], on="camera_id", how="left")
    merged = merged.dropna(subset=["latitude", "longitude"])
    merged["violations"] = pd.to_numeric(merged["violations"], errors="coerce").fillna(0)
    merged["violation_date"] = pd.to_datetime(merged["violation_date"], errors="coerce")
    merged["camera_type"] = "speed"

    print(f"Matched {len(merged)} speed violation records with GPS coordinates.")
    return merged


def get_redlight_camera_violations(
    start_date: str = "2020-01-01",
    end_date: str = "2025-12-31",
    limit: int | None = None,
) -> pd.DataFrame:
    """
    Fetch red light camera violations and join with camera locations via intersection name.
    """
    print("Fetching red light camera violations...")
    where = f"violation_date >= '{start_date}T00:00:00' AND violation_date <= '{end_date}T23:59:59'"
    violations = fetch_all(REDLIGHT_VIOLATIONS_ID, where, ["intersection", "camera_id", "address", "violation_date", "violations"], max_rows=limit)
    if violations.empty:
        print("No red light violations found.")
        return violations

    print(f"Fetched {len(violations)} red light violation records.")

    # Fetch camera locations — join on intersection name
    print("Fetching red light camera locations...")
    locations = fetch_all(REDLIGHT_LOCATIONS_ID, "", ["intersection", "latitude", "longitude"])
    locations["latitude"] = pd.to_numeric(locations["latitude"], errors="coerce")
    locations["longitude"] = pd.to_numeric(locations["longitude"], errors="coerce")
    locations = locations.dropna(subset=["latitude", "longitude"])

    # Normalize intersection names for joining
    violations["_intersection"] = violations["intersection"].str.strip().str.upper()
    locations["_intersection"] = locations["intersection"].str.strip().str.upper()

    # Join on intersection name
    merged = violations.merge(
        locations[["_intersection", "latitude", "longitude"]],
        on="_intersection",
        how="left"
    )
    merged = merged.drop(columns=["_intersection"])
    matched = merged["latitude"].notna().sum()
    print(f"Matched {matched}/{len(violations)} red light violations via intersection name.")

    merged = merged.dropna(subset=["latitude", "longitude"])
    merged["violations"] = pd.to_numeric(merged["violations"], errors="coerce").fillna(0)
    merged["violation_date"] = pd.to_datetime(merged["violation_date"], errors="coerce")
    merged["camera_type"] = "red_light"

    return merged


def get_all_camera_violations(
    start_date: str = "2020-01-01",
    end_date: str = "2025-12-31",
) -> pd.DataFrame:
    """
    Fetch both speed and red light camera violations and combine.
    """
    speed = get_speed_camera_violations(start_date, end_date)
    redlight = get_redlight_camera_violations(start_date, end_date)

    frames = []
    if not speed.empty and "latitude" in speed.columns:
        frames.append(speed)
    if not redlight.empty and "latitude" in redlight.columns:
        frames.append(redlight)

    if not frames:
        print("No camera data with GPS coordinates found.")
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    print(f"Total camera violations with GPS: {len(combined)}")
    return combined


if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df = get_all_camera_violations("2020-01-01", "2025-12-31")
    if not df.empty:
        output_path = OUTPUT_DIR / "camera_violations.csv"
        df.to_csv(output_path, index=False)
        print(f"Saved to {output_path}")
        print(f"Shape: {df.shape}")
        print(df["camera_type"].value_counts())
<<<<<<< HEAD
=======


        
        
>>>>>>> hamza/generic-city-scoring
