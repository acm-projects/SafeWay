"""
Lazy-loaded risk map and OSMnx graph for route safety scoring.
Loads predicted_risk from Supabase intersection_safety once, caches in memory.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

_risk_map: Optional[dict[str, float]] = None
_graph = None

PAGE_SIZE = 1000


def get_risk_map() -> dict[str, float]:
    """Return cached dict of node_id -> predicted_risk from Supabase."""
    global _risk_map
    if _risk_map is not None:
        return _risk_map

    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY")
    client = create_client(url, key)

    risk_map: dict[str, float] = {}
    last_id = None
    t0 = time.perf_counter()
    while True:
        q = (
            client.table("intersection_safety")
            .select("node_id,predicted_risk")
            .order("node_id")
            .limit(PAGE_SIZE)
        )
        if last_id is not None:
            q = q.gt("node_id", last_id)
        rows = q.execute().data or []
        if not rows:
            break
        for r in rows:
            nid = str(r["node_id"])
            risk_map[nid] = float(r.get("predicted_risk") or 0)
        last_id = rows[-1]["node_id"]
        if len(rows) < PAGE_SIZE:
            break
    elapsed = time.perf_counter() - t0
    print(f"[risk_cache] loaded {len(risk_map)} nodes in {elapsed:.1f}s", flush=True)
    _risk_map = risk_map
    return _risk_map


def get_graph():
    """Return cached OSMnx graph G (downloaded once, then cached on disk by osmnx)."""
    global _graph
    if _graph is not None:
        return _graph
    import sys
    backend_dir = str(Path(__file__).resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from model.data.intersections import get_chicago_intersections
    _, _graph = get_chicago_intersections()
    return _graph


def score_coordinates(
    coordinates: list[dict],
    sample_every: int = 5,
) -> dict:
    """
    Score a list of route coordinates against the risk map.
    coordinates: list of {"latitude": float, "longitude": float}
    Returns dict with score (0-100), label, risk_sum, n_scored.
    """
    import osmnx as ox

    risk_map = get_risk_map()
    G = get_graph()

    if not coordinates or not risk_map:
        return {"score": None, "label": "unknown", "risk_sum": 0, "n_scored": 0}

    sampled = coordinates[::sample_every] if sample_every > 1 else coordinates
    if not sampled:
        return {"score": None, "label": "unknown", "risk_sum": 0, "n_scored": 0}

    lats = [p["latitude"] for p in sampled]
    lngs = [p["longitude"] for p in sampled]

    try:
        nearest = ox.distance.nearest_nodes(G, X=lngs, Y=lats)
    except Exception:
        return {"score": None, "label": "unknown", "risk_sum": 0, "n_scored": 0}

    risks = []
    for nid in nearest:
        r = risk_map.get(str(nid), 0.0)
        risks.append(r)

    if not risks:
        return {"score": None, "label": "unknown", "risk_sum": 0, "n_scored": 0}

    mean_risk = sum(risks) / len(risks)
    score = round(mean_risk, 2)

    if score < 33:
        label = "low"
    elif score < 66:
        label = "medium"
    else:
        label = "high"

    return {
        "score": score,
        "label": label,
        "risk_sum": round(sum(risks), 2),
        "n_scored": len(risks),
    }
