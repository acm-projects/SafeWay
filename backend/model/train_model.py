"""
Train XGBoost regressor on temporal split intersection dataset; spatial GroupKFold CV.
Use python -u or PYTHONUNBUFFERED=1 for live logs when not in a TTY.
Outputs: intersection_risk_model.pkl, model_info.json, dataset_metadata.json, feature_importance.png
Optional: push predicted_risk to intersection_safety (run migration 008 first).

Run from repo root:
  # Default: load crashes/crimes from Supabase (fast)
  python -u -m backend.model.train_model --export-csv
  # Force Socrata re-pull (slow)
  python -u -m backend.model.train_model --from-socrata --crash-limit 0 --crime-limit 0
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_repo_root = Path(__file__).resolve().parent.parent.parent
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

OUTPUT_DIR = Path(__file__).resolve().parent / "output"

FEATURE_COLS = [
    "past_n_crash_total",
    "past_n_crash_fsi",
    "past_n_crash_ped",
    "past_n_crash_bike",
    "past_n_crash_night",
    "past_n_crash_weekend",
    "past_prop_fsi",
    "past_prop_ped",
    "past_prop_bike",
    "past_prop_night",
    "past_prop_angle",
    "past_prop_rear_end",
    "past_prop_turning",
    "past_prop_cause_speed",
    "past_prop_cause_yield",
    "past_n_crime_total",
    "past_n_crime_violent",
    "past_n_crime_property",
    "past_prop_violent",
    "past_n_crime_night",
    "speed_limit_mean",
    "speed_limit_max",
    "n_arms",
]


def top_k_recall(y_true: np.ndarray, y_pred: np.ndarray, k: int) -> float:
    if len(y_true) <= k:
        return 0.0
    true_idx = np.argsort(y_true)[-k:]
    pred_idx = np.argsort(y_pred)[-k:]
    return float(len(set(true_idx) & set(pred_idx))) / k


def main():
    parser = argparse.ArgumentParser(description="Train intersection risk XGBoost model")
    parser.add_argument("--past-start", default="2020-01-01")
    parser.add_argument("--past-end", default="2025-01-31")
    parser.add_argument("--future-start", default="2025-02-01")
    parser.add_argument("--future-end", default="2026-01-31")
    parser.add_argument(
        "--from-socrata",
        action="store_true",
        help="Fetch crashes/crimes from Socrata instead of Supabase (slow)",
    )
    parser.add_argument(
        "--crash-limit",
        type=int,
        default=0,
        help="0 = no limit (Socrata only; ignored when loading from Supabase)",
    )
    parser.add_argument(
        "--crime-limit",
        type=int,
        default=0,
        help="0 = no limit (Socrata only; ignored when loading from Supabase)",
    )
    parser.add_argument("--export-csv", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    parser.add_argument(
        "--refresh-cache",
        action="store_true",
        help="Force re-load crashes/crimes from Supabase and overwrite local CSV cache",
    )
    args = parser.parse_args()

    crash_limit = None if args.crash_limit == 0 else args.crash_limit
    crime_limit = None if args.crime_limit == 0 else args.crime_limit

    from backend.model.data.intersections import get_chicago_intersections
    from backend.model.data.training_features import build_training_dataset

    if args.from_socrata:
        from backend.model.data.crashes import get_enriched_crashes
        from backend.model.data.crimes import get_crimes

        print("Fetching crashes from Socrata (full range)...", flush=True)
        print("  (Next logs: Crashes -> Vehicles -> People pagination; then merge done.)", flush=True)
        crashes = get_enriched_crashes(
            start_date=args.past_start,
            end_date=args.future_end,
            limit=crash_limit,
        )
        if crashes.empty:
            raise SystemExit("No crashes returned")

        print("Fetching crimes from Socrata...", flush=True)
        crimes = get_crimes(
            start_date=args.past_start,
            end_date=args.future_end,
            limit=crime_limit,
        )
    else:
        from backend.model.data.supabase_reader import (
            load_crashes_from_supabase,
            load_crimes_from_supabase,
        )

        cache_crashes = OUTPUT_DIR / "crashes_cache.csv"
        cache_crimes = OUTPUT_DIR / "crimes_cache.csv"
        cache_meta = OUTPUT_DIR / "cache_meta.json"
        loaded_from_cache = False
        if not args.refresh_cache and cache_meta.exists() and cache_crashes.exists() and cache_crimes.exists():
            try:
                with open(cache_meta) as f:
                    meta = json.load(f)
                if meta.get("start") == args.past_start and meta.get("end") == args.future_end:
                    print("Loading crashes from local cache...", flush=True)
                    crashes = pd.read_csv(cache_crashes)
                    crashes["crash_date"] = pd.to_datetime(crashes["crash_date"], errors="coerce", utc=True)
                    for col in ("has_ped", "has_bike", "is_fsi"):
                        if col in crashes.columns:
                            crashes[col] = crashes[col].fillna(False).astype(bool)
                    print(f"  Loaded {len(crashes)} crashes.", flush=True)
                    print("Loading crimes from local cache...", flush=True)
                    crimes = pd.read_csv(cache_crimes)
                    crimes["crime_date"] = pd.to_datetime(crimes["crime_date"], errors="coerce", utc=True)
                    crimes["date"] = crimes["crime_date"]
                    from backend.model.data.crimes import VIOLENT_CRIME_TYPES, PROPERTY_CRIME_TYPES
                    crimes["is_violent"] = crimes["primary_type"].isin(VIOLENT_CRIME_TYPES)
                    crimes["is_property"] = crimes["primary_type"].isin(PROPERTY_CRIME_TYPES)
                    print(f"  Loaded {len(crimes)} crimes.", flush=True)
                    loaded_from_cache = True
            except Exception as e:
                print(f"  Cache read failed: {e}, falling back to Supabase.", flush=True)
        if not loaded_from_cache:
            print("Loading crashes from Supabase...", flush=True)
            crashes = load_crashes_from_supabase(args.past_start, args.future_end)
            if crashes.empty:
                raise SystemExit(
                    "No crashes from Supabase. Run analysis push first, or use --from-socrata."
                )
            print("Loading crimes from Supabase...", flush=True)
            crimes = load_crimes_from_supabase(args.past_start, args.future_end)
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            crashes.to_csv(cache_crashes, index=False)
            crimes.to_csv(cache_crimes, index=False)
            with open(cache_meta, "w") as f:
                json.dump({"start": args.past_start, "end": args.future_end}, f, indent=2)
            print(f"  Cached to {cache_crashes.name} and {cache_crimes.name}.", flush=True)

    print("Loading OSM graph...")
    intersections, G = get_chicago_intersections()

    print("Building training dataset (temporal split)...")
    df = build_training_dataset(
        crashes,
        crimes,
        intersections,
        G,
        past_start=args.past_start,
        past_end=args.past_end,
        future_start=args.future_start,
        future_end=args.future_end,
    )

    # Only rows with any past signal or any future label (optional: keep all for zeros)
    y = df["future_risk_score"].astype(float)
    X = df.copy()
    for c in FEATURE_COLS:
        if c not in X.columns:
            X[c] = 0.0
    X_feat = X[FEATURE_COLS].fillna(0)
    groups = X["spatial_group"].values

    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
    from xgboost import XGBRegressor
    from scipy.stats import spearmanr

    gkf = GroupKFold(n_splits=5)
    cv_scores = []
    for fold, (tr, va) in enumerate(gkf.split(X_feat, y, groups=groups)):
        model = XGBRegressor(
            max_depth=4,
            n_estimators=300,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_feat.iloc[tr], y.iloc[tr])
        pred = model.predict(X_feat.iloc[va])
        cv_scores.append(r2_score(y.iloc[va], pred))
        print(f"Fold {fold+1} R2: {cv_scores[-1]:.3f}")

    print(f"Mean R2: {np.mean(cv_scores):.3f} +/- {np.std(cv_scores):.3f}")

    final_model = XGBRegressor(
        max_depth=4,
        n_estimators=300,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
    )
    final_model.fit(X_feat, y)
    y_pred = final_model.predict(X_feat)
    df["predicted_risk"] = y_pred

    rho, _ = spearmanr(y, y_pred)
    print(f"Spearman rho (fit set): {rho:.3f}")
    recall = top_k_recall(y.values, y_pred, k=max(1, int(0.1 * len(y))))
    print(f"Top-10pct recall: {recall:.2%}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(final_model, OUTPUT_DIR / "intersection_risk_model.pkl")
    model_info = {
        "feature_cols": FEATURE_COLS,
        "target_mean": float(y.mean()),
        "target_std": float(y.std()),
        "mean_cv_r2": float(np.mean(cv_scores)),
        "std_cv_r2": float(np.std(cv_scores)),
        "spearman_rho_fit": float(rho) if not np.isnan(rho) else None,
    }
    with open(OUTPUT_DIR / "model_info.json", "w") as f:
        json.dump(model_info, f, indent=2)

    metadata = {
        "n_intersections": len(df),
        "feature_window": f"{args.past_start} to {args.past_end}",
        "label_window": f"{args.future_start} to {args.future_end}",
        "target_variable": "future_risk_score",
        "model_type": "XGBRegressor",
        "spatial_cv_folds": 5,
    }
    with open(OUTPUT_DIR / "dataset_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    try:
        import matplotlib.pyplot as plt

        imp = pd.DataFrame({"feature": FEATURE_COLS, "importance": final_model.feature_importances_})
        imp = imp.sort_values("importance", ascending=True).tail(15)
        plt.figure(figsize=(10, 8))
        plt.barh(imp["feature"], imp["importance"])
        plt.xlabel("Importance")
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / "feature_importance.png", dpi=150)
        plt.close()
    except Exception as e:
        print(f"Feature plot skipped: {e}")

    if args.export_csv:
        df.to_csv(OUTPUT_DIR / "chicago_intersection_training_dataset.csv", index=False)
        print(f"Saved dataset to {OUTPUT_DIR / 'chicago_intersection_training_dataset.csv'}")

    if not args.no_push:
        from backend.model.data.intersections import build_intersection_safety_scores
        from backend.model.data.supabase_intersection_safety import push_intersection_safety_to_supabase

        pred_map = df.set_index("node_id")[["predicted_risk", "future_risk_score"]]
        scores = build_intersection_safety_scores(crashes, crimes, intersections, G)
        scores = scores.merge(pred_map.reset_index(), on="node_id", how="left")
        scores["predicted_risk"] = scores["predicted_risk"].fillna(float(y.median()))
        scores["future_risk_score"] = scores["future_risk_score"].fillna(0)
        try:
            push_intersection_safety_to_supabase(scores, batch_size=1000)
            print("Pushed intersection_safety including predicted_risk (run migration 008 if failed).")
        except Exception as e:
            print(f"Supabase push skipped: {e}")

    print("Done.")


if __name__ == "__main__":
    main()
