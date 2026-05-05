"""
Temporal split training dataset: past features (2020–Jan 2025) vs future labels (Feb 2025–Jan 2026).
One row per OSM intersection node. See docs/Safe Route Model Training Guide.pdf.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .intersections import assign_to_nearest_intersection


# ---------------------------------------------------------------------------
# OSMnx edge-attribute helpers
# ---------------------------------------------------------------------------

HIGHWAY_RANK = {
    "residential": 1, "living_street": 1, "unclassified": 1, "service": 1,
    "tertiary": 2, "tertiary_link": 2,
    "secondary": 3, "secondary_link": 3,
    "primary": 4, "primary_link": 4,
    "trunk": 5, "trunk_link": 5,
    "motorway": 6, "motorway_link": 6,
}

# Phase C: AADT proxy based on road classification (vehicles/day estimate)
EXPOSURE_PROXY = {1: 1000, 2: 5000, 3: 15000, 4: 25000, 5: 40000, 6: 60000}


def _parse_osm_list(val):
    """OSM tags can be a string or list of strings; normalize to list."""
    if isinstance(val, list):
        return val
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return []
    return [str(val)]


def _parse_speed(val) -> float:
    """Parse OSM maxspeed like '30 mph' or '30' to float. Returns NaN on failure."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return float("nan")
    s = str(val).strip().lower().replace("mph", "").strip()
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _aggregate_edge_features(G, node_id) -> dict:
    """Extract + aggregate attributes from all edges connected to a node."""
    try:
        nid = int(node_id)
    except (ValueError, TypeError):
        nid = node_id

    # Collect edge data (both directions for directed graph)
    seen = set()
    edges = []
    try:
        for u, v, k, data in G.edges(nid, keys=True, data=True):
            key = (u, v, k)
            if key not in seen:
                seen.add(key)
                edges.append(data)
        if G.is_directed():
            for u, v, k, data in G.in_edges(nid, keys=True, data=True):
                key = (u, v, k)
                if key not in seen:
                    seen.add(key)
                    edges.append(data)
    except Exception:
        pass

    defaults = {
        "max_highway_rank": 1, "n_highway_types": 0,
        "max_lanes": 2, "total_lanes": 2,
        "prop_oneway": 0.0, "prop_lit": -1.0, "max_speed_osm": 30.0,
    }
    if not edges:
        return defaults

    # highway
    highway_ranks = []
    highway_types = set()
    for e in edges:
        for hw in _parse_osm_list(e.get("highway")):
            highway_ranks.append(HIGHWAY_RANK.get(hw, 1))
            highway_types.add(hw)

    # lanes
    lane_vals = []
    for e in edges:
        for lv in _parse_osm_list(e.get("lanes")):
            try:
                lane_vals.append(int(lv))
            except (ValueError, TypeError):
                pass

    # oneway
    n_oneway = 0
    for e in edges:
        ow = e.get("oneway")
        if ow is True or str(ow).lower() in ("yes", "true", "1"):
            n_oneway += 1

    # lit
    lit_known = 0
    lit_yes = 0
    for e in edges:
        lit = e.get("lit")
        if lit is not None and not (isinstance(lit, float) and pd.isna(lit)):
            lit_known += 1
            if str(lit).lower() in ("yes", "true", "1"):
                lit_yes += 1

    # maxspeed
    speed_vals = []
    for e in edges:
        for sv in _parse_osm_list(e.get("maxspeed")):
            parsed = _parse_speed(sv)
            if not np.isnan(parsed):
                speed_vals.append(parsed)

    n_edges = len(edges)
    return {
        "max_highway_rank": max(highway_ranks) if highway_ranks else 1,
        "n_highway_types": len(highway_types),
        "max_lanes": max(lane_vals) if lane_vals else 2,
        "total_lanes": sum(lane_vals) if lane_vals else 2,
        "prop_oneway": n_oneway / n_edges if n_edges else 0.0,
        "prop_lit": (lit_yes / lit_known) if lit_known > 0 else -1.0,
        "max_speed_osm": max(speed_vals) if speed_vals else 30.0,
    }


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

        # Officer-reported weather features
        weather = sub["weather_condition"].map(_u) if "weather_condition" in sub.columns else pd.Series(dtype=str)
        lighting = sub["lighting_condition"].map(_u) if "lighting_condition" in sub.columns else pd.Series(dtype=str)
        surface = sub["roadway_surface_cond"].map(_u) if "roadway_surface_cond" in sub.columns else pd.Series(dtype=str)
        prop_poor_weather = _type_prop(weather, lambda s: any(k in s for k in ("RAIN", "SNOW", "SLEET", "FOG", "WIND", "BLOWING")))
        prop_poor_lighting = _type_prop(lighting, lambda s: any(k in s for k in ("DARK", "DUSK", "DAWN")))
        prop_poor_surface = _type_prop(surface, lambda s: any(k in s for k in ("WET", "SNOW", "ICE", "SLUSH", "SAND")))

        # Open-Meteo weather features (mean values at crash time)
        def _safe_col(col_name):
            """Return numeric Series if col exists in sub, else empty Series."""
            if col_name in sub.columns:
                return pd.to_numeric(sub[col_name], errors="coerce")
            return pd.Series(dtype=float)

        omw_temp = _safe_col("omw_temperature_2m")
        omw_precip = _safe_col("omw_precipitation")
        omw_snow = _safe_col("omw_snowfall")
        omw_wind = _safe_col("omw_wind_speed_10m")
        omw_vis = _safe_col("omw_visibility")
        omw_cloud = _safe_col("omw_cloud_cover")

        def _safe_mean(s):
            return float(s.mean()) if len(s) and s.notna().any() else 0.0

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
            f"{prefix}mean_temp": _safe_mean(omw_temp),
            f"{prefix}mean_precip": _safe_mean(omw_precip),
            f"{prefix}mean_snowfall": _safe_mean(omw_snow),
            f"{prefix}mean_wind_speed": _safe_mean(omw_wind),
            f"{prefix}mean_visibility": _safe_mean(omw_vis),
            f"{prefix}mean_cloud_cover": _safe_mean(omw_cloud),
            "speed_limit_mean": float(speed.mean()) if speed.notna().any() else 0.0,
            "speed_limit_max": float(speed.max()) if speed.notna().any() else 0.0,
        })
    return pd.DataFrame(rows)


def aggregate_crime_features(crimes_assigned: pd.DataFrame, prefix: str = "past_") -> pd.DataFrame:
    """Smart crime re-integration: 3 groups with different weights.

    Group 1 (traffic-direct, full weight): DUI, reckless driving, hit-and-run
    Group 2 (disorder, ×0.3 weight): narcotics, weapons, assault/battery (non-domestic)
    Group 3 (excluded): theft, burglary, fraud — not included as features
    """
    if crimes_assigned.empty or "nearest_node_id" not in crimes_assigned.columns:
        return pd.DataFrame()

    # Ensure group flags exist (backward compat with older parquets)
    if "is_traffic_direct" not in crimes_assigned.columns:
        crimes_assigned["is_traffic_direct"] = False
    if "is_disorder" not in crimes_assigned.columns:
        crimes_assigned["is_disorder"] = crimes_assigned.get("is_violent", pd.Series(False, index=crimes_assigned.index)).fillna(False)

    def _night(d):
        return hasattr(d, "hour") and (d.hour >= 18 or d.hour <= 6)

    g = crimes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n_traffic = int(sub["is_traffic_direct"].sum())
        n_disorder = int(sub["is_disorder"].sum())
        # Weighted total: traffic at full weight, disorder at 0.3
        n_filtered_weighted = n_traffic + 0.3 * n_disorder

        # Legacy counts (kept for backward compat, but model uses filtered ones)
        n_v = int(sub["is_violent"].sum()) if "is_violent" in sub.columns else 0
        n_p = int(sub["is_property"].sum()) if "is_property" in sub.columns else 0
        n = len(sub)
        night = sum(1 for d in sub.get("date", []) if _night(d))

        rows.append({
            "node_id": str(node_id),
            # New Phase B features
            f"{prefix}n_crime_traffic_direct": n_traffic,
            f"{prefix}n_crime_disorder_weighted": round(0.3 * n_disorder, 1),
            f"{prefix}n_crime_total_filtered": round(n_filtered_weighted, 1),
            # Legacy (kept for backward compat)
            f"{prefix}n_crime_total": n,
            f"{prefix}n_crime_violent": n_v,
            f"{prefix}n_crime_property": n_p,
            f"{prefix}prop_violent": n_v / n if n else 0.0,
            f"{prefix}n_crime_night": night,
        })
    return pd.DataFrame(rows)


def _crash_severity(row) -> float:
    """KABCO-inspired per-crash injury severity score.

    Weights reflect the relative societal cost of each injury level:
      fatal (K)              = 5  (irreversible)
      incapacitating (A)     = 3  (hospitalization)
      non-incapacitating (B) = 1  (minor injury)
      reported-not-evident(C)= 0.5 (possible injury)
      no injury / PDO        = 0  (property damage only — implicit)
    """
    def _int(col):
        try:
            return int(row.get(col) or 0)
        except (TypeError, ValueError):
            return 0

    return (5.0 * _int("injuries_fatal")
            + 3.0 * _int("injuries_incapacitating")
            + 1.0 * _int("injuries_non_incapacitating")
            + 0.5 * _int("injuries_reported_not_evident"))


def aggregate_future_crash_labels(crashes_assigned: pd.DataFrame) -> pd.DataFrame:
    if crashes_assigned.empty or "nearest_node_id" not in crashes_assigned.columns:
        return pd.DataFrame(columns=["node_id", "future_n_crash_total", "future_severity_sum"])
    g = crashes_assigned.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        severity_sum = float(sub.apply(_crash_severity, axis=1).sum())
        rows.append({
            "node_id": str(node_id),
            "future_n_crash_total": len(sub),
            "future_severity_sum": severity_sum,
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


def _compute_time_of_day_multipliers(crashes: pd.DataFrame, min_crashes: int = 5) -> pd.DataFrame:
    """Phase G: Per-intersection time-band crash proportion multipliers.

    Bands: night 22-06, morning 06-10, midday 10-16, evening 16-22.
    multiplier = (proportion in band) / 0.25.  Capped [0.5, 3.0].
    Uses citywide averages for intersections with < min_crashes crashes.
    """
    if crashes.empty or "nearest_node_id" not in crashes.columns:
        return pd.DataFrame()

    df = crashes.copy()
    # Extract hour
    h = None
    if "crash_hour" in df.columns:
        h = pd.to_numeric(df["crash_hour"], errors="coerce")
    if h is None or h.isna().all():
        ts = _crash_date_series(df)
        h = ts.dt.hour

    def _band(hour):
        if pd.isna(hour):
            return None
        hour = int(hour)
        if hour >= 22 or hour < 6:
            return "night"
        if hour < 10:
            return "morning"
        if hour < 16:
            return "midday"
        return "evening"

    df["_band"] = h.map(_band)
    df = df.dropna(subset=["_band"])

    # Citywide averages (fallback)
    city_total = len(df)
    city_props = {}
    for b in ["night", "morning", "midday", "evening"]:
        city_props[b] = (df["_band"] == b).sum() / city_total if city_total > 0 else 0.25

    g = df.groupby("nearest_node_id")
    rows = []
    for node_id, sub in g:
        n = len(sub)
        out = {"node_id": str(node_id)}
        for b in ["night", "morning", "midday", "evening"]:
            if n >= min_crashes:
                prop = (sub["_band"] == b).sum() / n
            else:
                prop = city_props[b]
            mult = max(0.5, min(3.0, prop / 0.25))
            out[f"{b}_multiplier"] = round(mult, 3)
        rows.append(out)
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
    red_light_violations: pd.DataFrame | None = None,
    speed_violations: pd.DataFrame | None = None,
    streetlights_out: pd.DataFrame | None = None,
    red_light_camera_locations: pd.DataFrame | None = None,
    speed_camera_locations: pd.DataFrame | None = None,
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

    # --- OSMnx edge features (road type, lanes, oneway, lit, speed) ---
    print("  Computing OSMnx edge features...", flush=True)
    edge_feats = df["node_id"].apply(lambda nid: _aggregate_edge_features(G, nid))
    edge_df = pd.DataFrame(edge_feats.tolist())
    for col in edge_df.columns:
        df[col] = edge_df[col].values
    print(f"  Added {len(edge_df.columns)} edge features: {list(edge_df.columns)}", flush=True)

    # --- Red light camera violations ---
    if red_light_violations is not None and not red_light_violations.empty:
        print(f"  Joining {len(red_light_violations)} red light camera violations...", flush=True)
        rlc = assign_to_nearest_intersection(red_light_violations, G)
        rlc["violations"] = pd.to_numeric(rlc["violations"], errors="coerce").fillna(0)
        rlc_agg = rlc.groupby("nearest_node_id").agg(
            total_red_light_violations=("violations", "sum"),
        ).reset_index()
        rlc_agg["has_red_light_camera"] = 1
        rlc_agg = rlc_agg.rename(columns={"nearest_node_id": "node_id"})
        rlc_agg["node_id"] = rlc_agg["node_id"].astype(str)
        df = df.merge(rlc_agg, on="node_id", how="left")
    for c in ["total_red_light_violations", "has_red_light_camera"]:
        if c not in df.columns:
            df[c] = 0
        df[c] = df[c].fillna(0)

    # --- Speed camera violations ---
    if speed_violations is not None and not speed_violations.empty:
        print(f"  Joining {len(speed_violations)} speed camera violations...", flush=True)
        spd = assign_to_nearest_intersection(speed_violations, G)
        spd["violations"] = pd.to_numeric(spd["violations"], errors="coerce").fillna(0)
        spd_agg = spd.groupby("nearest_node_id").agg(
            total_speed_violations=("violations", "sum"),
        ).reset_index()
        spd_agg["has_speed_camera"] = 1
        spd_agg = spd_agg.rename(columns={"nearest_node_id": "node_id"})
        spd_agg["node_id"] = spd_agg["node_id"].astype(str)
        df = df.merge(spd_agg, on="node_id", how="left")
    for c in ["total_speed_violations", "has_speed_camera"]:
        if c not in df.columns:
            df[c] = 0
        df[c] = df[c].fillna(0)

    # --- Street light outages ---
    if streetlights_out is not None and not streetlights_out.empty:
        print(f"  Joining {len(streetlights_out)} streetlight outage reports...", flush=True)
        sl = assign_to_nearest_intersection(streetlights_out, G)
        sl_agg = sl.groupby("nearest_node_id").size().reset_index(name="n_streetlight_outages")
        sl_agg["has_light_outage"] = 1
        sl_agg = sl_agg.rename(columns={"nearest_node_id": "node_id"})
        sl_agg["node_id"] = sl_agg["node_id"].astype(str)
        df = df.merge(sl_agg, on="node_id", how="left")
    for c in ["n_streetlight_outages", "has_light_outage"]:
        if c not in df.columns:
            df[c] = 0
        df[c] = df[c].fillna(0)

    # --- Camera location proximity (deterrence gradient) ---
    # Combines red light + speed camera physical locations to compute
    # distance to nearest camera for each intersection.
    _all_camera_locs = []
    for cam_df in [red_light_camera_locations, speed_camera_locations]:
        if cam_df is not None and not cam_df.empty:
            _valid = cam_df.dropna(subset=["latitude", "longitude"])
            if not _valid.empty:
                _all_camera_locs.append(_valid[["latitude", "longitude"]].values)
    if _all_camera_locs:
        cam_coords = np.vstack(_all_camera_locs)
        print(f"  Computing nearest camera distance for {len(df)} intersections from {len(cam_coords)} cameras...", flush=True)
        int_lats = df["lat"].values
        int_lngs = df["lon"].values
        # Vectorized haversine: for each intersection find min distance to any camera
        cam_lat_r = np.radians(cam_coords[:, 0])
        cam_lng_r = np.radians(cam_coords[:, 1])
        min_dists = np.full(len(df), 99999.0)
        for i in range(len(cam_coords)):
            dlat = np.radians(int_lats) - cam_lat_r[i]
            dlng = np.radians(int_lngs) - cam_lng_r[i]
            a = np.sin(dlat / 2) ** 2 + np.cos(np.radians(int_lats)) * np.cos(cam_lat_r[i]) * np.sin(dlng / 2) ** 2
            d = 6371000.0 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
            min_dists = np.minimum(min_dists, d)
        df["nearest_camera_dist_m"] = min_dists
        print(f"  Camera proximity: median={np.median(min_dists):.0f}m, min={min_dists.min():.0f}m", flush=True)
    else:
        df["nearest_camera_dist_m"] = 99999.0

    past_crash_feat = aggregate_crash_features(past_crashes, "past_")
    if not past_crash_feat.empty:
        df = df.merge(past_crash_feat, on="node_id", how="left")
    past_crime_feat = aggregate_crime_features(past_crimes, "past_")
    if not past_crime_feat.empty:
        df = df.merge(past_crime_feat, on="node_id", how="left")

    # --- Phase C: Exposure normalization ---
    df["exposure_proxy"] = df["max_highway_rank"].map(EXPOSURE_PROXY).fillna(1000).astype(float)
    for col in ["past_n_crash_total", "past_n_crash_fsi"]:
        if col not in df.columns:
            df[col] = 0
    df["crash_rate_per_exposure"] = df["past_n_crash_total"] / df["exposure_proxy"]
    df["fsi_rate_per_exposure"] = df["past_n_crash_fsi"] / df["exposure_proxy"]

    # --- Phase D: Past severity sum (reuse _crash_severity on past window) ---
    if not past_crashes.empty and "nearest_node_id" in past_crashes.columns:
        _past_sev = past_crashes.copy()
        _past_sev["_sev"] = _past_sev.apply(_crash_severity, axis=1)
        _psev_agg = _past_sev.groupby("nearest_node_id")["_sev"].sum().reset_index()
        _psev_agg.columns = ["node_id", "past_severity_sum"]
        _psev_agg["node_id"] = _psev_agg["node_id"].astype(str)
        df = df.merge(_psev_agg, on="node_id", how="left")
    if "past_severity_sum" not in df.columns:
        df["past_severity_sum"] = 0.0
    df["past_severity_sum"] = df["past_severity_sum"].fillna(0.0)
    df["severity_rate_per_exposure"] = df["past_severity_sum"] / df["exposure_proxy"]

    # --- Phase D: Interaction features ---
    _ppl = df.get("past_prop_poor_lighting", pd.Series(0.0, index=df.index)).fillna(0.0)
    _mso = df.get("max_speed_osm", pd.Series(30.0, index=df.index)).fillna(30.0)
    df["speed_x_poor_lighting"] = _mso * _ppl
    _hwr = df.get("max_highway_rank", pd.Series(1, index=df.index)).fillna(1)
    _hts = df.get("has_red_light_camera", pd.Series(0, index=df.index)).fillna(0)
    df["arterial_x_no_signal"] = ((_hwr >= 4).astype(int) * (1 - _hts.clip(0, 1))).astype(float)

    # --- Phase G: Time-of-day risk multipliers ---
    print("  Computing time-of-day multipliers...", flush=True)
    _hourly = _compute_time_of_day_multipliers(past_crashes)
    if not _hourly.empty:
        df = df.merge(_hourly, on="node_id", how="left")
    for band in ["night_multiplier", "morning_multiplier", "midday_multiplier", "evening_multiplier"]:
        if band not in df.columns:
            df[band] = 1.0
        df[band] = df[band].fillna(1.0)

    fut_c = aggregate_future_crash_labels(future_crashes)
    if not fut_c.empty:
        df = df.merge(fut_c, on="node_id", how="left")
    fut_cr = aggregate_future_crime_labels(future_crimes)
    if not fut_cr.empty:
        df = df.merge(fut_cr, on="node_id", how="left")

    # --- Two-stage hurdle targets (crime excluded from y) ---
    label_cols = ["future_n_crash_total", "future_severity_sum"]
    for c in label_cols:
        if c not in df.columns:
            df[c] = 0
        else:
            df[c] = df[c].fillna(0).astype(float)
    # Keep crime label in DataFrame for reference, but NOT in target
    if "future_n_crime_violent" not in df.columns:
        df["future_n_crime_violent"] = 0
    else:
        df["future_n_crime_violent"] = df["future_n_crime_violent"].fillna(0).astype(float)

    # Stage 1 target: binary — does this intersection have ANY future crash?
    df["has_future_crash"] = (df["future_n_crash_total"] > 0).astype(int)

    # Stage 2 target: continuous severity (log-scaled, blends count + severity)
    df["future_severity_score"] = np.log1p(
        df["future_severity_sum"] + 0.5 * df["future_n_crash_total"]
    )

    # Combined fallback target (overwritten by train_model.py two-stage logic)
    raw = df["future_severity_score"]
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

