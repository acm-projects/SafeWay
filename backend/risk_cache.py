"""
Risk map, SHAP factors, and time-of-day multipliers for route safety scoring.
Loads from GCS (preferred, nightly-updated) or local files (fallback).
Phase E: Distance-weighted route scoring (risk-per-km, not mean).
Phase F: Per-node SHAP top-3 risk factors, aggregated to route level.
Phase G: Time-of-day multipliers applied at query time.
"""
from __future__ import annotations

import math
import os
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

OUTPUT_DIR = Path(__file__).resolve().parent / "model" / "output"

_risk_map: Optional[dict[str, float]] = None
_shap_map: Optional[dict[str, list[dict]]] = None
_tod_map: Optional[dict[str, dict[str, float]]] = None
_graph = None
_prepared_graph = None  # Graph with risk scores + edge costs attached
_cache_loaded_at: float = 0.0


def _get_gcs_fs():
    """Create a GCSFileSystem using local key file or Cloud Run default credentials."""
    import gcsfs
    gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
    if gcs_key and os.path.isfile(gcs_key):
        return gcsfs.GCSFileSystem(token=gcs_key)
    try:
        return gcsfs.GCSFileSystem(token="cloud")
    except Exception:
        return gcsfs.GCSFileSystem()


def startup_load():
    """Eagerly load all caches at API startup so scores are ready before first request."""
    t0 = time.perf_counter()
    print("[startup] loading risk caches...", flush=True)
    rm = get_risk_map()
    sm = get_shap_map()
    tm = get_tod_map()
    try:
        pg = get_prepared_graph()
        print(f"[startup] graph ready: {pg.number_of_nodes()} nodes, {pg.number_of_edges()} edges", flush=True)
    except Exception as e:
        print(f"[startup] graph load failed (A* routes unavailable): {e}", flush=True)
    elapsed = time.perf_counter() - t0
    print(f"[startup] caches loaded in {elapsed:.1f}s — risk_map={len(rm)}, shap={len(sm)}, tod={len(tm)}", flush=True)


def refresh_cache() -> dict:
    """Force-reload all caches from GCS. Called by /admin/refresh-cache after nightly retrain."""
    global _risk_map, _shap_map, _tod_map, _prepared_graph, _cache_loaded_at
    _risk_map = None
    _shap_map = None
    _tod_map = None
    _prepared_graph = None
    rm = get_risk_map()
    sm = get_shap_map()
    tm = get_tod_map()
    _cache_loaded_at = time.time()
    return {
        "risk_map_nodes": len(rm),
        "shap_map_nodes": len(sm),
        "tod_map_nodes": len(tm),
        "refreshed_at": _cache_loaded_at,
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in km between two (lat, lon) points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Loaders: GCS first → local fallback
# ---------------------------------------------------------------------------

def get_risk_map() -> dict[str, float]:
    """Return dict of node_id -> predicted_risk (0-100). GCS first, local fallback."""
    global _risk_map, _cache_loaded_at
    if _risk_map is not None:
        return _risk_map

    # Try GCS first (freshest data from nightly pipeline)
    try:
        import pandas as pd
        fs = _get_gcs_fs()
        with fs.open("safeway-data/intersection_scores.parquet", "rb") as f:
            scores = pd.read_parquet(f)
        _risk_map = dict(zip(scores["node_id"].astype(str), scores["predicted_risk"].fillna(0).astype(float)))
        _cache_loaded_at = time.time()
        print(f"[risk_cache] loaded {len(_risk_map)} nodes from GCS", flush=True)
        return _risk_map
    except Exception as e:
        print(f"[risk_cache] GCS risk_map load failed ({e}), trying local file", flush=True)

    # Fallback: local file (bundled in Docker image)
    local_path = OUTPUT_DIR / "intersection_scores.parquet"
    if local_path.exists():
        try:
            import pandas as pd
            scores = pd.read_parquet(local_path)
            _risk_map = dict(zip(scores["node_id"].astype(str), scores["predicted_risk"].fillna(0).astype(float)))
            _cache_loaded_at = time.time()
            print(f"[risk_cache] loaded {len(_risk_map)} nodes from local file", flush=True)
            return _risk_map
        except Exception as e:
            print(f"[risk_cache] local risk_map load failed ({e})", flush=True)

    print("[risk_cache] WARNING: no risk data loaded from any source", flush=True)
    _risk_map = {}
    return _risk_map


def get_shap_map() -> dict[str, list[dict]]:
    """Return SHAP top-3 factors per node_id. GCS first, local fallback."""
    global _shap_map
    if _shap_map is not None:
        return _shap_map

    # Try GCS first
    try:
        import joblib
        fs = _get_gcs_fs()
        with fs.open("safeway-data/shap_top3.pkl", "rb") as f:
            _shap_map = joblib.load(f)
        print(f"[risk_cache] loaded SHAP factors for {len(_shap_map)} nodes (GCS)", flush=True)
        return _shap_map
    except Exception as e:
        print(f"[risk_cache] GCS shap_map load failed ({e}), trying local file", flush=True)

    # Fallback: local file
    local_path = OUTPUT_DIR / "shap_top3.pkl"
    if local_path.exists():
        try:
            import joblib
            _shap_map = joblib.load(local_path)
            print(f"[risk_cache] loaded SHAP factors for {len(_shap_map)} nodes (local)", flush=True)
            return _shap_map
        except Exception as e:
            print(f"[risk_cache] local shap_map load failed ({e})", flush=True)

    _shap_map = {}
    return _shap_map


def get_tod_map() -> dict[str, dict[str, float]]:
    """Return time-of-day multipliers per node_id. GCS first, local fallback."""
    global _tod_map
    if _tod_map is not None:
        return _tod_map

    def _parse_tod_df(tod_df):
        result = {}
        for _, row in tod_df.iterrows():
            result[str(row["node_id"])] = {
                "night": float(row.get("night_multiplier", 1.0)),
                "morning": float(row.get("morning_multiplier", 1.0)),
                "midday": float(row.get("midday_multiplier", 1.0)),
                "evening": float(row.get("evening_multiplier", 1.0)),
            }
        return result

    # Try GCS first
    try:
        import pandas as pd
        fs = _get_gcs_fs()
        with fs.open("safeway-data/hourly_risk_factors.parquet", "rb") as f:
            tod_df = pd.read_parquet(f)
        _tod_map = _parse_tod_df(tod_df)
        print(f"[risk_cache] loaded time-of-day multipliers for {len(_tod_map)} nodes (GCS)", flush=True)
        return _tod_map
    except Exception as e:
        print(f"[risk_cache] GCS tod_map load failed ({e}), trying local file", flush=True)

    # Fallback: local file
    local_path = OUTPUT_DIR / "hourly_risk_factors.parquet"
    if local_path.exists():
        try:
            import pandas as pd
            tod_df = pd.read_parquet(local_path)
            _tod_map = _parse_tod_df(tod_df)
            print(f"[risk_cache] loaded time-of-day multipliers for {len(_tod_map)} nodes (local)", flush=True)
            return _tod_map
        except Exception as e:
            print(f"[risk_cache] local tod_map load failed ({e})", flush=True)

    _tod_map = {}
    return _tod_map


def _hour_to_band(hour: int) -> str:
    if hour >= 22 or hour < 6:
        return "night"
    if hour < 10:
        return "morning"
    if hour < 16:
        return "midday"
    return "evening"


# ---------------------------------------------------------------------------
# Graph loading: OSMnx directly
# ---------------------------------------------------------------------------

def get_graph():
    """Return cached OSMnx graph G (downloaded from OSM on first call)."""
    global _graph
    if _graph is not None:
        return _graph
    import sys
    backend_dir = str(Path(__file__).resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    print("[risk_cache] downloading Chicago street network from OSM...", flush=True)
    from model.data.intersections import get_chicago_intersections
    _, _graph = get_chicago_intersections()
    return _graph


def get_prepared_graph():
    """Return cached OSMnx graph with risk scores and edge costs pre-computed."""
    global _prepared_graph
    if _prepared_graph is not None:
        return _prepared_graph

    import sys
    backend_dir = str(Path(__file__).resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)

    from model.route_scoring import attach_risk_to_graph, compute_edge_costs

    G = get_graph()
    risk_map = get_risk_map()
    attach_risk_to_graph(G, risk_map)
    compute_edge_costs(G, alpha=1.0, beta=0.5)
    _prepared_graph = G
    print(f"[risk_cache] prepared graph with {G.number_of_nodes()} nodes, {G.number_of_edges()} edges", flush=True)
    return _prepared_graph


# ---------------------------------------------------------------------------
# Route scoring
# ---------------------------------------------------------------------------

def score_coordinates(
    coordinates: list[dict],
    sample_every: int = 5,
    departure_hour: int | None = None,
) -> dict:
    """
    Phase E: Distance-weighted route scoring.
    Phase F: Aggregate SHAP risk factors across route.
    Phase G: Apply time-of-day multipliers.

    Returns:
      score: risk-per-km (0-100, percentile-normalized), comparable across routes
      total_exposure: absolute cumulative risk x distance
      route_km: total route distance
      n_high_risk: count of nodes with risk > 66th percentile
      top_risk_factors: aggregated SHAP factors across route (Phase F)
      time_band: which time band was applied (Phase G)
    """
    import osmnx as ox
    from datetime import datetime, timezone

    risk_map = get_risk_map()
    shap_map = get_shap_map()
    tod_map = get_tod_map()
    G = get_graph()

    empty = {
        "score": None, "label": "unknown", "risk_sum": 0, "n_scored": 0,
        "total_exposure": 0, "route_km": 0, "n_high_risk": 0,
        "risk_per_km": None, "top_risk_factors": [], "time_band": None,
    }

    if not coordinates or not risk_map:
        return empty

    sampled = coordinates[::sample_every] if sample_every > 1 else coordinates
    if not sampled:
        return empty

    lats = [p["latitude"] for p in sampled]
    lngs = [p["longitude"] for p in sampled]

    try:
        nearest = ox.distance.nearest_nodes(G, X=lngs, Y=lats)
    except Exception:
        return empty

    # Determine time band
    if departure_hour is None:
        departure_hour = datetime.now(timezone.utc).hour
    time_band = _hour_to_band(departure_hour)

    # Apply time-of-day multiplier to each node's risk
    risks = []
    for nid in nearest:
        nid_str = str(nid)
        base_risk = risk_map.get(nid_str, 0.0)
        tod_mult = tod_map.get(nid_str, {}).get(time_band, 1.0)
        risks.append(min(100.0, base_risk * tod_mult))

    if not risks:
        return empty

    # Phase E: Distance-weighted scoring
    total_risk_km = 0.0
    total_km = 0.0
    for i in range(len(sampled) - 1):
        seg_km = _haversine_km(lats[i], lngs[i], lats[i + 1], lngs[i + 1])
        seg_risk = (risks[i] + risks[i + 1]) / 2.0
        total_risk_km += seg_risk * seg_km
        total_km += seg_km

    # Handle single-point edge case
    if total_km < 0.001:
        total_km = 0.001
        total_risk_km = risks[0] * total_km

    risk_per_km = total_risk_km / total_km
    score = round(min(100.0, risk_per_km), 2)
    n_high_risk = sum(1 for r in risks if r > 66)

    if score < 33:
        label = "low"
    elif score < 66:
        label = "medium"
    else:
        label = "high"

    # Phase F: Aggregate SHAP factors across route nodes
    factor_counts: dict[str, dict] = {}
    for nid in nearest:
        factors = shap_map.get(str(nid), [])
        for f in factors:
            key = f["label"]
            if key not in factor_counts:
                factor_counts[key] = {"label": key, "feature": f["feature"], "count": 0, "total_shap": 0.0}
            factor_counts[key]["count"] += 1
            factor_counts[key]["total_shap"] += abs(f.get("shap", 0))

    top_factors = sorted(factor_counts.values(), key=lambda x: x["count"], reverse=True)[:5]
    top_risk_factors = [{"label": f["label"], "count": f["count"], "pct": round(100 * f["count"] / len(nearest), 1)} for f in top_factors]

    # Segment-level risk data for polyline coloring
    segment_risks = []
    for i in range(len(sampled) - 1):
        seg_risk = (risks[i] + risks[i + 1]) / 2.0
        segment_risks.append({
            "start": {"latitude": lats[i], "longitude": lngs[i]},
            "end": {"latitude": lats[i + 1], "longitude": lngs[i + 1]},
            "risk": round(seg_risk, 1),
        })

    return {
        "score": score,
        "label": label,
        "risk_sum": round(sum(risks), 2),
        "n_scored": len(risks),
        "total_exposure": round(total_risk_km, 2),
        "route_km": round(total_km, 2),
        "risk_per_km": round(risk_per_km, 2),
        "n_high_risk": n_high_risk,
        "top_risk_factors": top_risk_factors,
        "time_band": time_band,
        "segment_risks": segment_risks,
    }
