"""
Attach ML risk to OSM graph; hybrid edge costs; A* safer route vs fastest.
Phase 1: score route by summing node risks.
Phase 2: nx.astar_path with haversine heuristic on safe_cost.
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
    median_risk = 0.0
    for _, _, d in G.edges(data=True):
        length_m = d.get("length") or 0
        speed_kph = d.get("speed_kph") or 40
        if speed_kph <= 0:
            speed_kph = 40
        travel_time = length_m / (speed_kph / 3.6)  # seconds approx
        d["travel_time"] = travel_time


def _edge_risk(G, u, v, default=0.0):
    ru = G.nodes[u].get("risk", default)
    rv = G.nodes[v].get("risk", default)
    return (float(ru) + float(rv)) / 2


def _set_safe_cost(G, beta: float):
    for u, v, d in G.edges(data=True):
        tt = d.get("travel_time", 0)
        er = _edge_risk(G, u, v)
        d["edge_risk"] = er
        d["safe_cost"] = tt + beta * er


def find_safer_route(G, origin, dest, beta: float = 0.5):
    """
    A* on safe_cost; compare to shortest travel_time path.
    origin, dest: OSM node ids (int or str).
    """
    o = int(origin) if str(origin).isdigit() else origin
    dnode = int(dest) if str(dest).isdigit() else dest

    _set_safe_cost(G, beta)

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
            ed = G[path[i]][path[i + 1]]
            if isinstance(ed, dict):
                t += ed.get("travel_time", 0)
            else:
                t += ed[0].get("travel_time", 0) if ed else 0
        return t

    def path_risk(path):
        return sum(G.nodes[n].get("risk", 0) for n in path)

    st = path_time(safe_path)
    ft = path_time(fast_path)
    sr = path_risk(safe_path)
    fr = path_risk(fast_path)
    time_penalty_pct = 100 * (st - ft) / ft if ft > 0 else 0
    risk_reduction_pct = 100 * (fr - sr) / fr if fr > 0 else 0
    return {
        "safe_path": safe_path,
        "fast_path": fast_path,
        "time_penalty_pct": time_penalty_pct,
        "risk_reduction_pct": risk_reduction_pct,
    }


def score_route_by_nodes(node_ids, G):
    risk_sum = sum(G.nodes[n].get("risk", 0) for n in node_ids)
    return {"risk_sum": risk_sum, "n_nodes": len(node_ids)}
