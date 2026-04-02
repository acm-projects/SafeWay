"""
Attach ML risk to OSM graph; hybrid edge costs; A* safer route vs fastest.
Phase 1: score route by summing node risks.
Phase 2: nx.astar_path with haversine heuristic on safe_cost.
Phase 3: Full API integration — polyline encoding, path coordinates, duration estimates.
"""
from __future__ import annotations

import math
import networkx as nx

# Earth radius meters
_R = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * _R * math.asin(min(1.0, math.sqrt(a)))


def attach_risk_to_graph(G, node_id_to_risk: dict, median_risk: float = 0.0) -> None:
    """Set G.nodes[n]['risk'] for each node; unmatched get median_risk."""
    for n in G.nodes:
        key = str(n)
        r = node_id_to_risk.get(key, node_id_to_risk.get(n, median_risk))
        G.nodes[n]["risk"] = float(r)


def compute_edge_costs(G, alpha: float = 1.0, beta: float = 0.5) -> None:
    """
    For each edge: travel_time from length/speed_kph; edge_risk = avg endpoint risk.
    (safe_cost is no longer set here — it is computed on demand in find_safer_route.)
    """
    for u, v, d in G.edges(data=True):
        length_m = d.get("length") or 0
        speed_kph = d.get("speed_kph") or 40
        if speed_kph <= 0:
            speed_kph = 40
        travel_time = length_m / (speed_kph / 3.6)  # seconds approx
        d["travel_time"] = travel_time
        ru = G.nodes[u].get("risk", 0.0)
        rv = G.nodes[v].get("risk", 0.0)
        d["edge_risk"] = (float(ru) + float(rv)) / 2


def find_safer_route(G, origin, dest, risk_weight: float = 3.0):
    """
    A* safety-optimized routing.

    Cost model: safe_cost = travel_time * (1 + risk_weight * avg_node_risk / 100)

    risk_weight=0  -> pure fastest route (identical to Dijkstra on travel_time)
    risk_weight=3  -> a risk-100 intersection costs 4x a risk-0 intersection of the
                      same length. A* will accept detours up to 3x slower to avoid
                      high-risk intersections.

    Multiplicative penalty: exposure time at a dangerous intersection scales the
    cost proportionally, so a 60-second segment on a risk-80 road is penalised far
    more than a 10-second segment at the same risk level.
    """
    o, d = int(origin), int(dest)

    # Stamp safe_cost onto every edge in the cached graph
    for u, v, edge_data in G.edges(data=True):
        tt = edge_data.get("travel_time", 60.0)
        risk_u = float(G.nodes[u].get("risk", 0.0))
        risk_v = float(G.nodes[v].get("risk", 0.0))
        avg_risk = (risk_u + risk_v) / 2.0
        edge_data["safe_cost"] = tt * (1.0 + risk_weight * avg_risk / 100.0)

    def heuristic(u, _v_ignored):
        # Admissible lower bound: straight-line distance at max network speed (80 kph)
        y1 = G.nodes[u].get("y", 0)
        x1 = G.nodes[u].get("x", 0)
        y2 = G.nodes[d].get("y", 0)
        x2 = G.nodes[d].get("x", 0)
        return haversine_m(y1, x1, y2, x2) / (80.0 / 3.6)  # m / (m/s) = seconds

    safe_path = nx.astar_path(G, o, d, weight="safe_cost", heuristic=heuristic)
    fast_path = nx.shortest_path(G, o, d, weight="travel_time")

    def path_stats(path):
        total_time = total_dist = 0.0
        for i in range(len(path) - 1):
            edges_uv = G[path[i]][path[i + 1]]  # MultiDiGraph: {edge_key: edge_data}
            key = min(edges_uv)                  # lowest key = primary parallel edge
            e = edges_uv[key]
            total_time += e.get("travel_time", 0.0)
            total_dist += e.get("length", 0.0)
        return total_time, total_dist

    safe_time, safe_dist = path_stats(safe_path)
    fast_time, fast_dist = path_stats(fast_path)

    safe_risk = sum(G.nodes[n].get("risk", 0.0) for n in safe_path)
    fast_risk = sum(G.nodes[n].get("risk", 0.0) for n in fast_path)

    time_penalty_pct = round(100 * (safe_time - fast_time) / fast_time, 1) if fast_time > 0 else 0.0
    risk_reduction_pct = round(100 * (fast_risk - safe_risk) / fast_risk, 1) if fast_risk > 0 else 0.0

    return {
        "safe_path": safe_path,
        "fast_path": fast_path,
        "safe_time_secs": round(safe_time),
        "fast_time_secs": round(fast_time),
        "safe_distance_m": round(safe_dist),
        "fast_distance_m": round(fast_dist),
        "time_penalty_pct": time_penalty_pct,
        "risk_reduction_pct": risk_reduction_pct,
    }


def path_to_coordinates(G, path: list) -> list[dict]:
    """Convert a list of OSM node IDs to [{latitude, longitude}] dicts."""
    coords = []
    for n in path:
        nd = G.nodes[n]
        y, x = nd.get("y"), nd.get("x")
        if y is not None and x is not None:
            coords.append({"latitude": float(y), "longitude": float(x)})
    return coords


def encode_polyline(coordinates: list[dict], precision: int = 5) -> str:
    """
    Encode [{latitude, longitude}] to a Google-compatible encoded polyline string.
    Standard algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    """
    result = []
    prev_lat = 0
    prev_lng = 0

    for point in coordinates:
        lat = round(point["latitude"] * (10 ** precision))
        lng = round(point["longitude"] * (10 ** precision))

        d_lat = lat - prev_lat
        d_lng = lng - prev_lng

        for v in [d_lat, d_lng]:
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                result.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            result.append(chr(v + 63))

        prev_lat = lat
        prev_lng = lng

    return "".join(result)


def score_route_by_nodes(node_ids, G):
    risk_sum = sum(G.nodes[n].get("risk", 0) for n in node_ids)
    return {"risk_sum": risk_sum, "n_nodes": len(node_ids)}


# ── AADT estimation ──────────────────────────────────────────────────────────
# Road class → estimated AADT (vehicles/day), same mapping as training
_ROAD_CLASS = {
    "residential": 1, "living_street": 1, "unclassified": 1,
    "tertiary": 2, "tertiary_link": 2,
    "secondary": 3, "secondary_link": 3,
    "primary": 4, "primary_link": 4,
    "trunk": 5, "trunk_link": 5,
    "motorway": 6, "motorway_link": 6,
}
_AADT_PROXY = {1: 1000, 2: 5000, 3: 15000, 4: 25000, 5: 40000, 6: 60000}


def estimate_route_aadt(G, path: list) -> dict:
    """Estimate AADT along a route using the highway tag → AADT proxy mapping."""
    if not path or len(path) < 2:
        return {"aadt_avg": None, "aadt_max": None}
    aadt_values = []
    for i in range(len(path) - 1):
        edges_uv = G[path[i]][path[i + 1]]
        key = min(edges_uv)
        ed = edges_uv[key]
        hw = ed.get("highway", "residential")
        if isinstance(hw, list):
            hw = hw[0] if hw else "residential"
        rc = _ROAD_CLASS.get(hw, 1)
        aadt_values.append(_AADT_PROXY.get(rc, 1000))
    if not aadt_values:
        return {"aadt_avg": None, "aadt_max": None}
    return {
        "aadt_avg": round(sum(aadt_values) / len(aadt_values)),
        "aadt_max": max(aadt_values),
    }
