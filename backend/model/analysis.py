"""
Chicago crash analysis: merged Crashes + Vehicles + People, visualizations and maps.
Run from repo root: python -m backend.model.analysis
Default date range: 2021-2025; default limit 50_000 rows for faster runs. Use --no-limit for full dataset.

Tip: run with python -u or PYTHONUNBUFFERED=1 so logs appear immediately in files/CI.
"""
import sys
from pathlib import Path

# Line-buffer stdout when not a TTY (background jobs otherwise show nothing until exit)
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

# Ensure repo root on path for backend.model imports
_repo_root = Path(__file__).resolve().parent.parent.parent
if _repo_root.name == "backend":
    _repo_root = _repo_root.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

import argparse
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import folium
from folium import plugins

from backend.model.data.crashes import get_enriched_crashes
from backend.model.data.supabase_crashes import push_enriched_crashes_to_supabase

# Defaults: 5 years 2021-2025, cap for normal runs (use --no-limit for full)
DEFAULT_START = "2021-01-01"
DEFAULT_END = "2025-12-31"
DEFAULT_LIMIT = 50_000
CHICAGO_CENTER = (41.8781, -87.6798)
OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def run(
    start_date: str = DEFAULT_START,
    end_date: str = DEFAULT_END,
    limit: int | None = DEFAULT_LIMIT,
    export_csv: bool = False,
) -> None:
    # ── Step 1: Fetch merged data ──
    print("Fetching merged Crashes + Vehicles + People...")
    df = get_enriched_crashes(start_date=start_date, end_date=end_date, limit=limit)
    if df.empty:
        raise SystemExit("No crash data returned. Check date range and API.")
    print(f"Loaded {len(df)} crashes.\n")

    # ── Push to Supabase (primary storage) ──
    try:
        push_enriched_crashes_to_supabase(df, batch_size=1000)
    except Exception as e:
        print(f"Supabase push failed: {e}")
        raise

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if export_csv:
        df.to_csv(OUTPUT_DIR / "enriched_crashes.csv", index=False)
        print(f"Saved CSV to {OUTPUT_DIR / 'enriched_crashes.csv'}\n")

    # ── Step 2: Prepare data ──
    df["crash_date"] = pd.to_datetime(df["crash_date"], errors="coerce")
    df = df.dropna(subset=["crash_date"])
    df["hour"] = df["crash_date"].dt.hour

    # ── Plot 1: Crashes by hour ──
    plt.figure(figsize=(15, 8))
    sns.set_theme(style="darkgrid")
    hourly = df.groupby("hour")["crash_record_id"].nunique().reset_index()
    sns.barplot(data=hourly, x="hour", y="crash_record_id", palette="GnBu_r", linewidth=0)
    plt.title("Hourly Number of Reported Crashes in Chicago (Merged Data)", y=1.02, fontsize=14)
    plt.xlabel("Hour of Day", fontsize=13, labelpad=15)
    plt.ylabel("Number of Crashes", fontsize=13, labelpad=15)
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "hourly_crashes.png", dpi=120, bbox_inches="tight")
    plt.close()
    print("Saved hourly_crashes.png")

    # ── Plot 2: Primary contributing causes ──
    plt.figure(figsize=(15, 15))
    order = df["prim_contributory_cause"].value_counts().index
    sns.countplot(data=df, y="prim_contributory_cause", order=order)
    plt.title("Primary Contributing Cause of Crashes (Merged Data)", y=1.01, fontsize=14)
    plt.xlabel("Number of Crashes", fontsize=13, labelpad=15)
    plt.ylabel("Primary Contributing Cause", fontsize=13, labelpad=15)
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "contributory_cause.png", dpi=120, bbox_inches="tight")
    plt.close()
    print("Saved contributory_cause.png")

    # ── Plot 3: Lighting conditions ──
    plt.figure(figsize=(12, 6))
    order_light = df["lighting_condition"].value_counts().index
    sns.countplot(data=df, y="lighting_condition", order=order_light)
    plt.title("Crashes by Lighting Condition (Merged Data)", y=1.01, fontsize=14)
    plt.xlabel("Number of Crashes", fontsize=13, labelpad=15)
    plt.ylabel("Lighting Condition", fontsize=13, labelpad=15)
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "lighting_condition.png", dpi=120, bbox_inches="tight")
    plt.close()
    print("Saved lighting_condition.png")

    # ── Map 1: Hit-and-run cluster map ──
    hit_run_col = "hit_and_run_i"
    if hit_run_col in df.columns:
        df_hitrun = df[df[hit_run_col].astype(str).str.upper() == "Y"].copy()
        df_hitrun = df_hitrun[df_hitrun["longitude"].notna() & df_hitrun["latitude"].notna()]
        if not df_hitrun.empty:
            m_hr = folium.Map(location=CHICAGO_CENTER, zoom_start=12, tiles="CartoDB positron")
            cluster = plugins.MarkerCluster().add_to(m_hr)
            for _, row in df_hitrun.iterrows():
                folium.Marker(location=[row["latitude"], row["longitude"]]).add_to(cluster)
            m_hr.save(str(OUTPUT_DIR / "hitrun_map.html"))
            print(f"Saved hitrun_map.html ({len(df_hitrun)} hit-and-run crashes)")
        else:
            print("No hit-and-run records with lat/lon; skipped hitrun_map.html")
    else:
        print("Column hit_and_run_i not found; skipped hitrun_map.html")

    # ── Map 2: Severity map (FSI / ped-bike / other) ──
    m_sev = folium.Map(location=CHICAGO_CENTER, zoom_start=10, tiles="CartoDB positron")
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
        ).add_to(m_sev)
    legend_html = """
    <div style="position:fixed; bottom:24px; left:24px; z-index:9999; background:white; padding:8px 12px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2); font-size:12px;">
    <b>Crash map</b><br>
    <span style="color:red;">●</span> Fatal/serious injury<br>
    <span style="color:orange;">●</span> Ped/bike involved<br>
    <span style="color:blue;">●</span> Other
    </div>
    """
    m_sev.get_root().html.add_child(folium.Element(legend_html))
    m_sev.save(str(OUTPUT_DIR / "crash_map.html"))
    print(f"Saved crash_map.html ({len(df)} crashes)")

    print(f"\nAll outputs in {OUTPUT_DIR}. Open the HTML files in a browser to view maps.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Chicago crash analysis: merged data, charts, and maps (default 2021-2025, 50k rows)."
    )
    parser.add_argument("--start", default=DEFAULT_START, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", default=DEFAULT_END, help="End date (YYYY-MM-DD)")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max rows (0 = no limit)")
    parser.add_argument("--no-limit", action="store_true", help="No row limit (full date range)")
    parser.add_argument("--export-csv", action="store_true", help="Also write enriched_crashes.csv for debugging")
    args = parser.parse_args()
    limit = None if args.no_limit or (args.limit == 0) else args.limit
    run(start_date=args.start, end_date=args.end, limit=limit, export_csv=args.export_csv)
