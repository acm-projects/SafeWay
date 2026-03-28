"""
Build enriched crash data and generate crash_map.html for browser visualization.
Run from repo root: python -m backend.model.build_crash_map
Or: cd backend && python -m model.build_crash_map
"""
import sys
from pathlib import Path

# Ensure repo root on path for backend.model imports
_repo_root = Path(__file__).resolve().parent.parent.parent
if _repo_root.name == "backend":
    _repo_root = _repo_root.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

import folium
import pandas as pd

from backend.model.data.crashes import get_enriched_crashes

# Chicago center
CHICAGO_CENTER = (41.88, -87.63)
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_HTML = OUTPUT_DIR / "crash_map.html"


def build_map(
    start_date: str = "2023-01-01",
    end_date: str = "2023-12-31",
    limit: int | None = 5000,
) -> Path:
    """
    Fetch merged crashes, create Folium map, save to backend/model/output/crash_map.html.
    Use limit for quick runs (e.g. 5000); set limit=None for full dataset.
    """
    df = get_enriched_crashes(start_date=start_date, end_date=end_date, limit=limit)
    if df.empty:
        raise SystemExit("No crash data returned. Check date range and API.")

    m = folium.Map(location=CHICAGO_CENTER, zoom_start=10, tiles="CartoDB positron")

    # Color: red = FSI, orange = ped/bike, blue = other
    for _, row in df.iterrows():
        lat, lon = row["latitude"], row["longitude"]
        if pd.isna(lat) or pd.isna(lon):
            continue
        if row.get("is_fsi", False):
            color = "red"
        elif row.get("has_ped", False) or row.get("has_bike", False):
            color = "orange"
        else:
            color = "blue"
        popup = (
            f"<b>ID:</b> {row.get('crash_record_id', '')}<br>"
            f"<b>Date:</b> {row.get('crash_date', '')}<br>"
            f"<b>FSI:</b> {row.get('is_fsi', False)}<br>"
            f"<b>Ped:</b> {row.get('has_ped', False)} <b>Bike:</b> {row.get('has_bike', False)}"
        )
        folium.CircleMarker(
            location=(float(lat), float(lon)),
            radius=4,
            color=color,
            fill=True,
            fillColor=color,
            fillOpacity=0.7,
            popup=folium.Popup(popup, max_width=200),
        ).add_to(m)

    # Legend
    legend_html = """
    <div style="position:fixed; bottom:24px; left:24px; z-index:9999; background:white; padding:8px 12px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2); font-size:12px;">
    <b>Crash map</b><br>
    <span style="color:red;">●</span> Fatal/serious injury<br>
    <span style="color:orange;">●</span> Ped/bike involved<br>
    <span style="color:blue;">●</span> Other
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    m.save(str(OUTPUT_HTML))
    print(f"Saved {len(df)} crashes to {OUTPUT_HTML}")
    return OUTPUT_HTML


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Build crash map HTML")
    parser.add_argument("--start", default="2023-01-01", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", default="2023-12-31", help="End date (YYYY-MM-DD)")
    parser.add_argument("--limit", type=int, default=5000, help="Max crashes to plot (0 = no limit)")
    args = parser.parse_args()
    build_map(
        start_date=args.start,
        end_date=args.end,
        limit=args.limit if args.limit else None,
    )
    print("Open backend/model/output/crash_map.html in a browser to view.")
