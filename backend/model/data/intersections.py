"""
Download Chicago street network using OSMnx and extract intersections.
Assigns each crash/crime to its nearest intersection for safety scoring.

Driver-first composite danger_score (see docs/chicago-intersection-safety-plan.md):
  0.35 * frequency + 0.40 * severity + 0.20 * driver_risk + 0.05 * vulnerable_user_conflict
Crime counts are kept as total_crimes / context_crime_score only — not inside danger_score.

Run from repo root: python -m backend.model.data.intersections
"""
import pandas as pd
import numpy as np
import osmnx as ox
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
CHICAGO_PLACE = "Chicago, Illinois, USA"

# Composite weights (driver-first; ped/bike light)
W_FREQUENCY = 0.35
W_SEVERITY = 0.40
W_DRIVER_RISK = 0.20
W_VULNERABLE = 0.05

# High-speed threshold (posted limit)
HIGH_SPEED_LIMIT = 35

# Keywords for conflict-type crashes (first_crash_type / crash_type)
_ANGLE_TURN_KEYWORDS = ("ANGLE", "TURN", "LEFT TURN", "RIGHT TURN", "REAR TO")


def _s(s) -> str:
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return ""
    return str(s).strip().upper()


def _crash_driver_risk_flags(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add boolean columns per crash for aggregation at intersection level.
    Uses columns from enriched crashes when present.
    """
    df = df.copy()

    speed = pd.to_numeric(df.get("posted_speed_limit"), errors="coerce")
    df["_high_speed"] = (speed >= HIGH_SPEED_LIMIT).fillna(False)

    def _conflict_type(row):
        t = _s(row.get("first_crash_type")) + " " + _s(row.get("crash_type"))
        return any(k in t for k in _ANGLE_TURN_KEYWORDS)

    df["_angle_turn"] = df.apply(_conflict_type, axis=1)

    lighting = df.get("lighting_condition", pd.Series("", index=df.index)).map(_s)
    # Treat non-daylight as poorer for drivers
    df["_poor_lighting"] = ~lighting.str.contains("DAYLIGHT", na=False) & (lighting != "")

    surface = df.get("roadway_surface_cond", pd.Series("", index=df.index)).map(_s)
    # Poor if present and not clearly normal/dry (Chicago uses e.g. WET, ICE, SNOW)
    df["_poor_surface"] = (surface != "") & ~surface.str.contains("NORMAL", na=False, regex=False)

    device = df.get("device_condition", pd.Series("", index=df.index)).map(_s)
    df["_bad_device"] = device.str.contains("FUNCTIONING IMPROPERLY|NOT FUNCTIONING|NO CONTROLS|MISSING", na=False)

    road_def = df.get("road_defect", pd.Series("", index=df.index)).map(_s)
    df["_road_defect"] = ~road_def.str.contains("NO DEFECTS", na=False) & (road_def != "")

    inter = df.get("intersection_related_i", pd.Series("", index=df.index)).map(_s)
    df["_intersection_related"] = inter.str.startswith("Y", na=False)

    num_units = pd.to_numeric(df.get("num_units"), errors="coerce")
    if isinstance(num_units, pd.Series):
        df["_multi_unit"] = num_units.ge(3).fillna(False)
    else:
        df["_multi_unit"] = False

    work = df.get("work_zone_i", pd.Series("", index=df.index)).map(_s)
    df["_work_zone"] = work.str.startswith("Y", na=False)

    # One row = one crash; driver_risk count = sum of flags (cap per crash to avoid double-count explosion)
    risk_cols = [
        "_high_speed", "_angle_turn", "_poor_lighting", "_poor_surface",
        "_bad_device", "_road_defect", "_intersection_related", "_multi_unit", "_work_zone",
    ]
    for c in risk_cols:
        if c not in df.columns:
            df[c] = False
    df["_driver_risk_count"] = df[risk_cols].sum(axis=1).clip(upper=5).astype(float)
    return df


def _crash_severity_weight(row) -> float:
    """Weighted severity per crash for aggregation."""
    try:
        fatal = int(row.get("injuries_fatal") or 0)
    except (TypeError, ValueError):
        fatal = 0
    try:
        incap = int(row.get("injuries_incapacitating") or 0)
    except (TypeError, ValueError):
        incap = 0
    try:
        non_incap = int(row.get("injuries_non_incapacitating") or 0)
    except (TypeError, ValueError):
        non_incap = 0
    try:
        not_evident = int(row.get("injuries_reported_not_evident") or 0)
    except (TypeError, ValueError):
        not_evident = 0
    return 4.0 * fatal + 4.0 * incap + 2.0 * non_incap + 1.0 * not_evident


def get_chicago_intersections() -> pd.DataFrame:
    """
    Download Chicago drive network, extract intersection nodes,
    return DataFrame with node_id, latitude, longitude.
    """
    print("Downloading Chicago street network from OpenStreetMap...")
    G = ox.graph_from_place(CHICAGO_PLACE, network_type="drive", retain_all=False)
    print(f"Network loaded: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # Convert nodes to DataFrame
    nodes, _ = ox.convert.graph_to_gdfs(G)
    nodes = nodes.reset_index()

    intersections = pd.DataFrame({
        "node_id": nodes["osmid"].astype(str),
        "latitude": nodes["y"],
        "longitude": nodes["x"],
    })

    print(f"Extracted {len(intersections)} intersections.")
    return intersections, G


def assign_to_nearest_intersection(
    df: pd.DataFrame,
    G,
    lat_col: str = "latitude",
    lon_col: str = "longitude",
) -> pd.DataFrame:
    """
    For each row in df, find the nearest OSM intersection node.
    Adds 'nearest_node_id' column to df.
    """
    print(f"Assigning {len(df)} points to nearest intersections...")
    nearest_nodes = ox.distance.nearest_nodes(
        G,
        X=df[lon_col].tolist(),
        Y=df[lat_col].tolist(),
    )
    df = df.copy()
    df["nearest_node_id"] = [str(n) for n in nearest_nodes]
    print("Done assigning nearest intersections.")
    return df


def build_intersection_safety_scores(
    crashes: pd.DataFrame,
    crimes: pd.DataFrame,
    intersections: pd.DataFrame,
    G,
) -> pd.DataFrame:
    """
    Assign crashes and crimes to nearest intersections,
    aggregate driver-first composite danger_score (crimes excluded from score).
    """
    if crashes.empty:
        scores = intersections.copy()
        scores["total_crashes"] = 0
        scores["fsi_crashes"] = 0
        scores["ped_crashes"] = 0
        scores["bike_crashes"] = 0
        scores["total_crimes"] = 0
        scores["context_crime_score"] = 0.0
        scores["danger_score"] = 0.0
        scores["frequency_component"] = 0.0
        scores["severity_component"] = 0.0
        scores["driver_risk_component"] = 0.0
        scores["vulnerable_component"] = 0.0
        return scores

    crashes_assigned = assign_to_nearest_intersection(crashes, G)
    crashes_assigned = _crash_driver_risk_flags(crashes_assigned)
    crashes_assigned["_severity_weight"] = crashes_assigned.apply(_crash_severity_weight, axis=1)

    # Only assign crimes if we have some (crimes use Socrata column "id")
    if not crimes.empty and len(crimes) > 0:
        crimes_assigned = assign_to_nearest_intersection(crimes, G)
    else:
        crimes_assigned = pd.DataFrame(columns=["id", "nearest_node_id"])

    # Crash aggregates per intersection
    crash_counts = crashes_assigned.groupby("nearest_node_id").agg(
        total_crashes=("crash_record_id", "count"),
        fsi_crashes=("is_fsi", "sum"),
        ped_crashes=("has_ped", "sum"),
        bike_crashes=("has_bike", "sum"),
        severity_sum=("_severity_weight", "sum"),
        driver_risk_sum=("_driver_risk_count", "sum"),
    ).reset_index().rename(columns={"nearest_node_id": "node_id"})

    # Crime counts (not mixed into danger_score)
    if not crimes_assigned.empty and "nearest_node_id" in crimes_assigned.columns:
        crime_counts = (
            crimes_assigned.groupby("nearest_node_id")["id"]
            .count()
            .reset_index(name="total_crimes")
            .rename(columns={"nearest_node_id": "node_id"})
        )
    else:
        crime_counts = pd.DataFrame(columns=["node_id", "total_crimes"])

    scores = intersections.merge(crash_counts, on="node_id", how="left")
    if not crime_counts.empty:
        scores = scores.merge(crime_counts, on="node_id", how="left")
    else:
        scores["total_crimes"] = 0

    for col in ["total_crashes", "fsi_crashes", "ped_crashes", "bike_crashes", "total_crimes"]:
        scores[col] = scores[col].fillna(0).astype(int)
    scores["severity_sum"] = scores["severity_sum"].fillna(0.0)
    scores["driver_risk_sum"] = scores["driver_risk_sum"].fillna(0.0)

    # --- Composite components (normalize to 0..100 within this run for stable weighting) ---
    n = len(scores)
    total = scores["total_crashes"].astype(float)
    freq_raw = np.log1p(total)
    sev_raw = scores["severity_sum"].astype(float)
    drv_raw = scores["driver_risk_sum"].astype(float)
    vul_raw = (scores["ped_crashes"] + scores["bike_crashes"]).astype(float)

    def _norm01(x):
        xmax = float(np.nanmax(x)) if n else 0.0
        if xmax <= 0:
            return np.zeros_like(x, dtype=float)
        return (x / xmax * 100.0).clip(0, 100)

    scores["frequency_component"] = _norm01(freq_raw)
    scores["severity_component"] = _norm01(sev_raw)
    scores["driver_risk_component"] = _norm01(drv_raw)
    scores["vulnerable_component"] = _norm01(np.log1p(vul_raw))

    scores["danger_score"] = (
        W_FREQUENCY * scores["frequency_component"]
        + W_SEVERITY * scores["severity_component"]
        + W_DRIVER_RISK * scores["driver_risk_component"]
        + W_VULNERABLE * scores["vulnerable_component"]
    )

    # Crime as separate context score only (log-scaled, same 0..100 style for optional UI blend)
    crime_raw = scores["total_crimes"].astype(float)
    scores["context_crime_score"] = _norm01(np.log1p(crime_raw))

    # Drop intermediate sums from main export if desired; keep for debugging — keep severity_sum/driver_risk_sum optional
    scores = scores.drop(columns=["severity_sum", "driver_risk_sum"], errors="ignore")

    print(f"Built safety scores for {len(scores)} intersections.")
    print(f"Max danger_score (driver-first composite): {scores['danger_score'].max():.4f}")
    print(f"Intersections with any crash: {(scores['total_crashes'] > 0).sum()}")
    return scores


if __name__ == "__main__":
    intersections, G = get_chicago_intersections()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    intersections.to_csv(OUTPUT_DIR / "intersections.csv", index=False)
    print(f"Saved intersections to {OUTPUT_DIR / 'intersections.csv'}")
