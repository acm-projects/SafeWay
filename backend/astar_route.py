"""
SafeWay A* safer route computation.
Separated from main.py so the logic is self-contained and testable.
"""
from __future__ import annotations
import sys
from pathlib import Path

# Ensure the backend directory is on sys.path for sibling imports
_backend_dir = str(Path(__file__).resolve().parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)


def compute_astar_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    departure_hour: int | None = None,
    travel_mode: str = "DRIVE",
) -> dict | None:
    """
    Compute a safety-optimized A* route between two lat/lng points.

    Returns a route dict with the same shape as Google route entries, or None
    if the route cannot be computed (e.g. graph not loaded, same origin/dest).
    """
    try:
        import osmnx as ox
        from risk_cache import get_prepared_graph, score_coordinates
        from model.route_scoring import (
            find_safer_route,
            path_to_coordinates,
            encode_polyline,
            estimate_route_aadt,
        )

        G = get_prepared_graph()
        orig_node = ox.distance.nearest_nodes(G, X=origin_lng, Y=origin_lat)
        dest_node = ox.distance.nearest_nodes(G, X=dest_lng, Y=dest_lat)
        if orig_node == dest_node:
            return None

        astar = find_safer_route(G, orig_node, dest_node, risk_weight=3.0)
        safe_coords = path_to_coordinates(G, astar["safe_path"])
        if len(safe_coords) < 2:
            return None

        safe_polyline = encode_polyline(safe_coords)
        safety = score_coordinates(safe_coords, sample_every=3, departure_hour=departure_hour, travel_mode=travel_mode)
        aadt = estimate_route_aadt(G, astar["safe_path"])

        return {
            "distance_meters": astar["safe_distance_m"],
            "duration": f"{astar['safe_time_secs']}s",
            "polyline": safe_polyline,
            "coordinates": safe_coords,
            "safety_score": safety.get("score"),
            "safety_label": safety.get("label", "unknown"),
            "route_source": "safeway",
            "risk_per_km": safety.get("risk_per_km"),
            "total_exposure": safety.get("total_exposure"),
            "route_km": safety.get("route_km"),
            "n_high_risk": safety.get("n_high_risk", 0),
            "top_risk_factors": safety.get("top_risk_factors", []),
            "time_band": safety.get("time_band"),
            "segment_risks": safety.get("segment_risks", []),
            "high_risk_coords": safety.get("high_risk_coords", []),
            "aadt_avg": aadt.get("aadt_avg"),
            "aadt_max": aadt.get("aadt_max"),
            "time_penalty_pct": astar["time_penalty_pct"],
            "risk_reduction_pct": astar["risk_reduction_pct"],
        }
    except Exception as e:
        print(f"[astar] route computation failed: {e}", flush=True)
        return None
