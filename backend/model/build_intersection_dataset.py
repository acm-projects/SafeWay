"""
Build intersection-level safety scores: enriched crashes + crimes -> nearest OSM node
-> driver-first composite danger_score, then push to Supabase by default.

Run from repo root:
  python -m backend.model.build_intersection_dataset --crash-limit 5000 --crime-limit 10000

Requires: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY in backend/.env
Migrations: 004_intersection_safety.sql, then 005_intersection_safety_composite.sql (recommended)

First OSMnx run downloads the full Chicago graph (slow). Use small limits to test.
"""
import argparse
import sys
from pathlib import Path

_repo_root = Path(__file__).resolve().parent.parent.parent
if _repo_root.name == "backend":
    _repo_root = _repo_root.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def main():
    parser = argparse.ArgumentParser(
        description="Build intersection safety scores and push to Supabase (optional CSV)."
    )
    parser.add_argument("--start", default="2021-01-01", help="Start date for crashes/crimes")
    parser.add_argument("--end", default="2025-12-31", help="End date for crashes/crimes")
    parser.add_argument("--crash-limit", type=int, default=5000, help="Max enriched crashes (0 = no limit)")
    parser.add_argument("--crime-limit", type=int, default=10000, help="Max crimes (0 = no limit)")
    parser.add_argument("--no-crimes", action="store_true", help="Skip crimes fetch")
    parser.add_argument(
        "--export-csv",
        action="store_true",
        help="Also write backend/model/output/intersection_safety.csv",
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Skip Supabase push (CSV only if --export-csv)",
    )
    args = parser.parse_args()

    crash_limit = None if args.crash_limit == 0 else args.crash_limit
    crime_limit = None if args.crime_limit == 0 else args.crime_limit

    from backend.model.data.crashes import get_enriched_crashes
    from backend.model.data.intersections import (
        get_chicago_intersections,
        build_intersection_safety_scores,
    )

    print("Fetching enriched crashes...")
    crashes = get_enriched_crashes(
        start_date=args.start, end_date=args.end, limit=crash_limit
    )
    if crashes.empty:
        raise SystemExit("No crashes returned; check date range and API.")

    import pandas as pd

    if args.no_crimes:
        crimes = pd.DataFrame()
    else:
        from backend.model.data.crimes import get_crimes
        print("Fetching crimes...")
        crimes = get_crimes(start_date=args.start, end_date=args.end, limit=crime_limit)

    print("Loading Chicago street graph (OSMnx)...")
    intersections, G = get_chicago_intersections()

    print("Building intersection safety scores...")
    scores = build_intersection_safety_scores(crashes, crimes, intersections, G)

    if not args.no_push:
        from backend.model.data.supabase_intersection_safety import (
            push_intersection_safety_to_supabase,
        )
        try:
            n = push_intersection_safety_to_supabase(scores, batch_size=1000)
            print(f"Pushed {n} rows to Supabase table intersection_safety.")
        except Exception as e:
            print(f"Supabase push failed: {e}")
            raise
    else:
        print("Skipped Supabase push (--no-push).")

    if args.export_csv:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_csv = OUTPUT_DIR / "intersection_safety.csv"
        scores.to_csv(out_csv, index=False)
        print(f"Saved {len(scores)} rows to {out_csv}")
    elif args.no_push:
        print("No CSV written; use --export-csv to write intersection_safety.csv locally.")


if __name__ == "__main__":
    main()
