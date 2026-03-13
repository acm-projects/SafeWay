"""
Temporal split training dataset: past features (2020–Jan 2025) vs future labels (Feb 2025–Jan 2026).
One row per OSM intersection node. See docs/Safe Route Model Training Guide.pdf.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .intersections import assign_to_nearest_intersection


def _u(s) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    return str(s).strip().upper()


def _crash_date_series(df: pd.DataFrame) -> pd.Series:
    if "crash_date" not in df.columns:
        return pd.Series(pd.NaT, index=df.index)
    return pd.to_datetime(df["crash_date"], errors="coerce")


def _in_window(ts: pd.Series, start: str, end: str) -> pd.Series:
    tz = getattr(ts.dtype, "tz", None)
    if tz is not None:
        ts = ts.dt.tz_convert("UTC")
        s = pd.Timestamp(start, tz="UTC")
        e = pd.Timestamp(end, tz="UTC").replace(hour=23, minute=59, second=59)
    else:
        s = pd.Timestamp(start)
        e = pd.Timestamp(end).replace(hour=23, minute=59, second=59)
    return (ts >= s) & (ts <= e)


def _is_weekend_row(row) -> bool:
    if "crash_day_of_week" in row.index and pd.notna(row.get("crash_day_of_week")):
        try:
            d = int(row["crash_day_of_week"])
            if d in (6, 7):
                return True
            if d in (0, 1) and d == 0:
                return True
        except (TypeError, ValueError):
            pass
    dt = row.get("crash_date")
    if hasattr(dt, "dayofweek"):
        return dt.dayofweek >= 5
    return False


def _is_night_row(row) -> bool:
    h = row.get("crash_hour")
    if h is not None and pd.notna(h):
        try:
            hour = int(h)
            return hour >= 18 or hour <= 6
        except (TypeError, ValueError):
            pass
    dt = row.get("crash_date")
    if hasattr(dt, "hour"):
        hour = dt.hour
        return hour >= 18 or hour <= 6
    return False


def _type_prop(series: pd.Series, predicate) -> float:
    if series.empty:
        return 0.0
    n = len(series)
    return float(series.map(predicate).sum()) / n if n else 0.0


def aggregate_crash_features(crashes_assigned: pd.DataFrame, prefix: str = "past_") -> pd.DataFrame:
    """Group by nearest_node_id -> one row per node with count/proportion features."""
    if crashes_assigned.empty or "nearest_node_id" not in crashes_assigned.columns:
        return pd.DataFrame()

    g = crashes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n = len(sub)
        n_fsi = int(sub["is_fsi"].sum()) if "is_fsi" in sub.columns else 0
        n_ped = int(sub["has_ped"].sum()) if "has_ped" in sub.columns else 0
        n_bike = int(sub["has_bike"].sum()) if "has_bike" in sub.columns else 0
        weekend = sum(1 for _, r in sub.iterrows() if _is_weekend_row(r))
        night = sum(1 for _, r in sub.iterrows() if _is_night_row(r))
        ft = sub["first_crash_type"].map(_u) if "first_crash_type" in sub.columns else pd.Series(dtype=str)
        angle = _type_prop(ft, lambda s: "ANGLE" in s)
        rear = _type_prop(ft, lambda s: "REAR" in s or "REAR END" in s)
        turn = _type_prop(ft, lambda s: "TURN" in s)
        cause = sub["prim_contributory_cause"].map(_u) if "prim_contributory_cause" in sub.columns else pd.Series(dtype=str)
        cause_speed = _type_prop(cause, lambda s: "SPEED" in s)
        cause_yield = _type_prop(cause, lambda s: "YIELD" in s or "FAILED TO" in s)
        speed = pd.to_numeric(sub.get("posted_speed_limit"), errors="coerce")

        # Weather features
        weather = sub["weather_condition"].map(_u) if "weather_condition" in sub.columns else pd.Series(dtype=str)
        lighting = sub["lighting_condition"].map(_u) if "lighting_condition" in sub.columns else pd.Series(dtype=str)
        surface = sub["roadway_surface_cond"].map(_u) if "roadway_surface_cond" in sub.columns else pd.Series(dtype=str)
        prop_poor_weather = _type_prop(weather, lambda s: any(k in s for k in ("RAIN", "SNOW", "SLEET", "FOG", "WIND", "BLOWING")))
        prop_poor_lighting = _type_prop(lighting, lambda s: any(k in s for k in ("DARK", "DUSK", "DAWN")))
        prop_poor_surface = _type_prop(surface, lambda s: any(k in s for k in ("WET", "SNOW", "ICE", "SLUSH", "SAND")))

        rows.append({
            "node_id": str(node_id),
            f"{prefix}n_crash_total": n,
            f"{prefix}n_crash_fsi": n_fsi,
            f"{prefix}n_crash_ped": n_ped,
            f"{prefix}n_crash_bike": n_bike,
            f"{prefix}n_crash_weekend": weekend,
            f"{prefix}n_crash_night": night,
            f"{prefix}prop_fsi": n_fsi / n if n else 0.0,
            f"{prefix}prop_ped": n_ped / n if n else 0.0,
            f"{prefix}prop_bike": n_bike / n if n else 0.0,
            f"{prefix}prop_night": night / n if n else 0.0,
            f"{prefix}prop_angle": angle,
            f"{prefix}prop_rear_end": rear,
            f"{prefix}prop_turning": turn,
            f"{prefix}prop_cause_speed": cause_speed,
            f"{prefix}prop_cause_yield": cause_yield,
            f"{prefix}prop_poor_weather": prop_poor_weather,
            f"{prefix}prop_poor_lighting": prop_poor_lighting,
            f"{prefix}prop_poor_surface": prop_poor_surface,
            "speed_limit_mean": float(speed.mean()) if speed.notna().any() else 0.0,
            "speed_limit_max": float(speed.max()) if speed.notna().any() else 0.0,
        })
    return pd.DataFrame(rows)


def aggregate_crime_features(crimes_assigned: pd.DataFrame, prefix: str = "past_") -> pd.DataFrame:
    if crimes_assigned.empty or "nearest_node_id" not in crimes_assigned.columns:
        return pd.DataFrame()

    def night_crime(row):
        d = row.get("date")
        if hasattr(d, "hour"):
            h = d.hour
            return h >= 18 or h <= 6
        return False

    g = crimes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n = len(sub)
        n_v = int(sub["is_violent"].sum()) if "is_violent" in sub.columns else 0
        n_p = int(sub["is_property"].sum()) if "is_property" in sub.columns else 0
        night = sum(1 for _, r in sub.iterrows() if night_crime(r))
        rows.append({
            "node_id": str(node_id),
            f"{prefix}n_crime_total": n,
            f"{prefix}n_crime_violent": n_v,
            f"{prefix}n_crime_property": n_p,
            f"{prefix}prop_violent": n_v / n if n else 0.0,
            f"{prefix}n_crime_night": night,
        })
    return pd.DataFrame(rows)


def aggregate_future_crash_labels(crashes_assigned: pd.DataFrame) -> pd.DataFrame:
    if crashes_assigned.empty or "nearest_node_id" not in crashes_assigned.columns:
        return pd.DataFrame(columns=["node_id", "future_n_crash_fsi", "future_n_crash_pb"])
    g = crashes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n_fsi = int(sub["is_fsi"].sum()) if "is_fsi" in sub.columns else 0
        n_ped = int(sub["has_ped"].sum()) if "has_ped" in sub.columns else 0
        n_bike = int(sub["has_bike"].sum()) if "has_bike" in sub.columns else 0
        rows.append({
            "node_id": str(node_id),
            "future_n_crash_fsi": n_fsi,
            "future_n_crash_pb": n_ped + n_bike,
        })
    return pd.DataFrame(rows)


def aggregate_future_crime_labels(crimes_assigned: pd.DataFrame) -> pd.DataFrame:
    if crimes_assigned.empty or "nearest_node_id" not in crimes_assigned.columns:
        return pd.DataFrame(columns=["node_id", "future_n_crime_violent"])
    g = crimes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n_v = int(sub["is_violent"].sum()) if "is_violent" in sub.columns else 0
        rows.append({"node_id": str(node_id), "future_n_crime_violent": n_v})
    return pd.DataFrame(rows)


def add_spatial_groups(df: pd.DataFrame, grid_size: float = 0.05) -> pd.DataFrame:
    df = df.copy()
    lat = df["latitude"].astype(float)
    lon = df["longitude"].astype(float)
    df["spatial_group"] = (lat // grid_size).astype(int) * 1000 + (lon // grid_size).astype(int)
    return df


def build_training_dataset(
    crashes: pd.DataFrame,
    crimes: pd.DataFrame,
    intersections: pd.DataFrame,
    G,
    past_start: str = "2020-01-01",
    past_end: str = "2025-01-31",
    future_start: str = "2025-02-01",
    future_end: str = "2026-01-31",
) -> pd.DataFrame:
    """
    Merge past feature aggregates + future labels on intersection_id (node_id).
    intersections must have node_id, latitude, longitude.
    """
    crashes = crashes.copy()
    crashes["_ts"] = _crash_date_series(crashes)
    past_mask = _in_window(crashes["_ts"], past_start, past_end)
    future_mask = _in_window(crashes["_ts"], future_start, future_end)
    past_crashes = crashes[past_mask].drop(columns=["_ts"], errors="ignore")
    future_crashes = crashes[future_mask].drop(columns=["_ts"], errors="ignore")

    crimes = crimes.copy()
    if "date" in crimes.columns:
        crimes["_ts"] = pd.to_datetime(crimes["date"], errors="coerce")
        past_crimes = crimes[_in_window(crimes["_ts"], past_start, past_end)].drop(columns=["_ts"], errors="ignore")
        future_crimes = crimes[_in_window(crimes["_ts"], future_start, future_end)].drop(columns=["_ts"], errors="ignore")
    else:
        past_crimes = crimes.iloc[0:0]
        future_crimes = crimes.iloc[0:0]

    if not past_crashes.empty:
        past_crashes = assign_to_nearest_intersection(past_crashes, G)
    if not future_crashes.empty:
        future_crashes = assign_to_nearest_intersection(future_crashes, G)
    if not past_crimes.empty:
        past_crimes = assign_to_nearest_intersection(past_crimes, G)
    if not future_crimes.empty:
        future_crimes = assign_to_nearest_intersection(future_crimes, G)

    df = intersections[["node_id", "latitude", "longitude"]].copy()
    df = df.rename(columns={"latitude": "lat", "longitude": "lon"})

    def _deg(nid):
        try:
            return int(G.degree(int(nid)))
        except (TypeError, ValueError, KeyError):
            try:
                return int(G.degree(nid))
            except Exception:
                return 0

    df["n_arms"] = df["node_id"].apply(_deg)

    past_crash_feat = aggregate_crash_features(past_crashes, "past_")
    if not past_crash_feat.empty:
        df = df.merge(past_crash_feat, on="node_id", how="left")
    past_crime_feat = aggregate_crime_features(past_crimes, "past_")
    if not past_crime_feat.empty:
        df = df.merge(past_crime_feat, on="node_id", how="left")

    fut_c = aggregate_future_crash_labels(future_crashes)
    if not fut_c.empty:
        df = df.merge(fut_c, on="node_id", how="left")
    fut_cr = aggregate_future_crime_labels(future_crimes)
    if not fut_cr.empty:
        df = df.merge(fut_cr, on="node_id", how="left")

    label_cols = ["future_n_crash_fsi", "future_n_crash_pb", "future_n_crime_violent"]
    for c in label_cols:
        if c not in df.columns:
            df[c] = 0
        else:
            df[c] = df[c].fillna(0).astype(float)

    raw = 10 * df["future_n_crash_fsi"] + 5 * df["future_n_crash_pb"] + 1 * df["future_n_crime_violent"]
    if raw.max() > 0:
        df["future_risk_score"] = (raw.rank(pct=True) * 100).values
    else:
        df["future_risk_score"] = 0.0

    df["future_risk_class"] = pd.cut(
        df["future_risk_score"],
        bins=[-0.1, 60, 90, 100],
        labels=["low", "medium", "high"],
    ).astype(str)

    feat_prefixes = [c for c in df.columns if c.startswith("past_")]
    for c in feat_prefixes:
        if df[c].dtype in (np.float64, np.float32, np.int64):
            df[c] = df[c].fillna(0)
    for c in ["speed_limit_mean", "speed_limit_max"]:
        if c in df.columns:
            df[c] = df[c].fillna(0)

    grid = 0.05
    df["spatial_group"] = (
        (df["lat"].astype(float) // grid).astype(int) * 1000
        + (df["lon"].astype(float) // grid).astype(int)
    )

    return df

