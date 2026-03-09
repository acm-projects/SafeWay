"""
Download Chicago street network using OSMnx and extract intersections.
Assigns each crash/crime to its nearest intersection for safety scoring.
Run from repo root: python -m backend.model.data.intersections
"""
import pandas as pd
import numpy as np
import osmnx as ox
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
CHICAGO_PLACE = "Chicago, Illinois, USA"


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
    count incidents per intersection, return safety score DataFrame.
    """
    # Assign crashes to nearest intersection
    crashes_assigned = assign_to_nearest_intersection(crashes, G)

    # Only assign crimes if we have some
    if not crimes.empty and len(crimes) > 0:
        crimes_assigned = assign_to_nearest_intersection(crimes, G)
    else:
        crimes_assigned = pd.DataFrame(columns=["crime_id", "nearest_node_id"])

    # Count crashes per intersection
    crash_counts = crashes_assigned.groupby("nearest_node_id").agg(
        total_crashes=("crash_record_id", "count"),
        fsi_crashes=("is_fsi", "sum"),
        ped_crashes=("has_ped", "sum"),
        bike_crashes=("has_bike", "sum"),
    ).reset_index().rename(columns={"nearest_node_id": "node_id"})

    # Count crimes per intersection
    crime_counts = crimes_assigned.groupby("nearest_node_id").agg(
        total_crimes=("crime_id", "count"),
    ).reset_index().rename(columns={"nearest_node_id": "node_id"})

    # Merge everything with intersections
    scores = intersections.merge(crash_counts, on="node_id", how="left")
    scores = scores.merge(crime_counts, on="node_id", how="left")

    # Fill NaN with 0 for intersections with no incidents
    for col in ["total_crashes", "fsi_crashes", "ped_crashes", "bike_crashes", "total_crimes"]:
        scores[col] = scores[col].fillna(0).astype(int)

    # Calculate danger score (weighted sum)
    scores["danger_score"] = (
        scores["total_crashes"] * 1.0 +
        scores["fsi_crashes"] * 3.0 +
        scores["ped_crashes"] * 2.0 +
        scores["bike_crashes"] * 2.0 +
        scores["total_crimes"] * 1.5
    )

    print(f"Built safety scores for {len(scores)} intersections.")
    print(f"Max danger score: {scores['danger_score'].max()}")
    print(f"Intersections with any incident: {(scores['danger_score'] > 0).sum()}")
    return scores


if __name__ == "__main__":
    intersections, G = get_chicago_intersections()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    intersections.to_csv(OUTPUT_DIR / "intersections.csv", index=False)
    print(f"Saved intersections to {OUTPUT_DIR / 'intersections.csv'}")

    