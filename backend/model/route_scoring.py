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
    For each edge: travel_time from length/speed_kph; edge_risk = avg endpoint risk;
    safe_cost = alpha * travel_time_sec + beta * edge_risk.
    """
    for u, v, d in G.edges(data=True):
        length_m = d.get("length") or 0
        speed_kph = d.get("speed_kph") or 40
        if speed_kph <= 0:
            speed_kph = 40
        travel_time = length_m / (speed_kph / 3.6)  # seconds approx
        d["travel_time"] = travel_time
        # Edge risk = average of endpoint node risks
        ru = G.nodes[u].get("risk", 0.0)
        rv = G.nodes[v].get("risk", 0.0)
        er = (float(ru) + float(rv)) / 2
        d["edge_risk"] = er
        d["safe_cost"] = alpha * travel_time + beta * er


def _get_edge_data(G, u, v):
    """Get edge data from a MultiDiGraph, handling the nested dict structure."""
    ed = G[u][v]
    if isinstance(ed, dict) and 0 in ed:
        return ed[0]
    return ed


def find_safer_route(G, origin, dest, beta: float = 0.5):
    """
    A* on safe_cost; compare to shortest travel_time path.
    origin, dest: OSM node ids (int or str).
    Returns safe_path, fast_path, and comparison metrics.
    """
    o = int(origin) if str(origin).isdigit() else origin
    dnode = int(dest) if str(dest).isdigit() else dest

    # Ensure safe_cost is computed with desired beta
    for u, v, d in G.edges(data=True):
        tt = d.get("travel_time", 0)
        er = d.get("edge_risk", 0)
        d["safe_cost"] = tt + beta * er

    def heuristic(u, v):
        y1, x1 = G.nodes[u].get("y"), G.nodes[u].get("x")
        y2, x2 = G.nodes[v].get("y"), G.nodes[v].get("x")
        if None in (y1, x1, y2, x2):
            return 0.0
        return haversine_m(y1, x1, y2, x2) / 10.0  # scale to comparable cost

    safe_path = nx.astar_path(G, o, dnode, weight="safe_cost", heuristic=lambda u, v: heuristic(u, dnode))
    fast_path = nx.shortest_path(G, o, dnode, weight="travel_time")

    def path_time(path):
        t = 0.0
        for i in range(len(path) - 1):
            d = _get_edge_data(G, path[i], path[i + 1])
            t += d.get("travel_time", 0) if isinstance(d, dict) else 0
        return t

    def path_distance_m(path):
        dist = 0.0
        for i in range(len(path) - 1):
            d = _get_edge_data(G, path[i], path[i + 1])
            dist += d.get("length", 0) if isinstance(d, dict) else 0
        return dist

    def path_risk(path):
        return sum(G.nodes[n].get("risk", 0) for n in path)

    st = path_time(safe_path)
    ft = path_time(fast_path)
    sr = path_risk(safe_path)
    fr = path_risk(fast_path)
    time_penalty_pct = round(100 * (st - ft) / ft, 1) if ft > 0 else 0
    risk_reduction_pct = round(100 * (fr - sr) / fr, 1) if fr > 0 else 0
    return {
        "safe_path": safe_path,
        "fast_path": fast_path,
        "safe_time_secs": round(st),
        "fast_time_secs": round(ft),
        "safe_distance_m": round(path_distance_m(safe_path)),
        "fast_distance_m": round(path_distance_m(fast_path)),
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
        ed = _get_edge_data(G, path[i], path[i + 1])
        if not isinstance(ed, dict):
            continue
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
