"""
Two-stage hurdle model for intersection risk prediction.
Stage 1: CatBoost binary classifier — P(any future crash)
Stage 2: XGBoost regressor — E[severity | crash > 0]
Combined: risk = P(crash) × E[severity|crash] → percentile-rank to 0–100.

Run from repo root:
  python -u -m backend.model.train_model --export-csv
  python -u -m backend.model.train_model --optuna-tune 50 --export-csv
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
    "past_prop_poor_weather",
    "past_prop_poor_lighting",
    "past_prop_poor_surface",
    "past_mean_temp",
    "past_mean_precip",
    "past_mean_snowfall",
    "past_mean_wind_speed",
    "past_mean_visibility",
    "past_mean_cloud_cover",
    "past_n_crime_traffic_direct",
    "past_n_crime_disorder_weighted",
    "past_n_crime_total_filtered",
    "past_n_crime_night",
    "speed_limit_mean",
    "speed_limit_max",
    "n_arms",
    # OSMnx edge features (road infrastructure)
    "max_highway_rank",
    "n_highway_types",
    "max_lanes",
    "total_lanes",
    "prop_oneway",
    "prop_lit",
    "max_speed_osm",
    # Camera violations
    "total_red_light_violations",
    "has_red_light_camera",
    "total_speed_violations",
    "has_speed_camera",
    # Streetlight outages
    "n_streetlight_outages",
    "has_light_outage",
    # Camera location proximity (deterrence gradient)
    "nearest_camera_dist_m",
    # Phase C: Exposure-normalized rates
    "crash_rate_per_exposure",
    "fsi_rate_per_exposure",
    "severity_rate_per_exposure",
    # Phase D: Interaction + severity features
    "past_severity_sum",
    "speed_x_poor_lighting",
    "arterial_x_no_signal",
]


def top_k_recall(y_true: np.ndarray, y_pred: np.ndarray, k: int) -> float:
    if len(y_true) <= k:
        return 0.0
    true_idx = np.argsort(y_true)[-k:]
    pred_idx = np.argsort(y_pred)[-k:]
    return float(len(set(true_idx) & set(pred_idx))) / k


def _optuna_objective(trial, X_feat, y, groups):
    """Optuna objective: 5-fold spatial GroupKFold CV, return mean R²."""
    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import r2_score
    from xgboost import XGBRegressor

    params = {
        "max_depth": trial.suggest_int("max_depth", 3, 7),
        "n_estimators": trial.suggest_int("n_estimators", 200, 600, step=50),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.15, log=True),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
    }

    gkf = GroupKFold(n_splits=5)
    scores = []
    for tr, va in gkf.split(X_feat, y, groups=groups):
        model = XGBRegressor(
            **params,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_feat.iloc[tr], y.iloc[tr], verbose=False)
        pred = model.predict(X_feat.iloc[va])
        scores.append(r2_score(y.iloc[va], pred))
    return float(np.mean(scores))


def _rolling_date_windows() -> tuple[str, str, str, str]:
    """Compute rolling temporal split: past 4 years for features, latest 2 years for labels.

    Example when run on 2026-03-17:
      past_start  = 2020-04-01  (6 years before end)
      past_end    = 2024-02-28  (2 years before end of last complete month)
      future_start= 2024-03-01  (label window starts right after past_end)
      future_end  = 2026-02-28  (last complete month)
    """
    from calendar import monthrange
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()
    # End = last day of previous complete month
    y, m = today.year, today.month
    if m == 1:
        y -= 1
        m = 12
    else:
        m -= 1
    future_end = f"{y}-{m:02d}-{monthrange(y, m)[1]}"

    # Label window = 2 years; feature window = everything before that back to start
    label_months = 24
    fy, fm = y, m
    for _ in range(label_months):
        if fm == 1:
            fy -= 1
            fm = 12
        else:
            fm -= 1
    future_start = f"{fy}-{fm + 1:02d}-01" if fm < 12 else f"{fy + 1}-01-01"
    # Recompute cleanly
    fs_y, fs_m = fy, fm + 1
    if fs_m > 12:
        fs_y += 1
        fs_m = 1
    future_start = f"{fs_y}-{fs_m:02d}-01"
    past_end_m = fs_m - 1
    past_end_y = fs_y
    if past_end_m < 1:
        past_end_y -= 1
        past_end_m = 12
    past_end = f"{past_end_y}-{past_end_m:02d}-{monthrange(past_end_y, past_end_m)[1]}"
    past_start = "2020-01-01"  # Always start from 2020 (Chicago data available from here)
    return past_start, past_end, future_start, future_end


def main():
    _ps, _pe, _fs, _fe = _rolling_date_windows()
    parser = argparse.ArgumentParser(description="Train intersection risk XGBoost model")
    parser.add_argument("--past-start", default=_ps)
    parser.add_argument("--past-end", default=_pe)
    parser.add_argument("--future-start", default=_fs)
    parser.add_argument("--future-end", default=_fe)
    source_group = parser.add_mutually_exclusive_group()
    source_group.add_argument(
        "--from-socrata",
        action="store_true",
        help="Fetch crashes/crimes live from Socrata API (slow)",
    )
    source_group.add_argument(
        "--from-supabase",
        action="store_true",
        help="Fetch crashes/crimes from Supabase (legacy)",
    )
    # Default: load from GCS (the nightly pipeline writes parquets there)
    parser.add_argument(
        "--crash-limit",
        type=int,
        default=0,
        help="Cap crash rows (0 = no limit); Socrata only",
    )
    parser.add_argument(
        "--crime-limit",
        type=int,
        default=0,
        help="Cap crime rows (0 = no limit); Socrata only",
    )
    parser.add_argument("--export-csv", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    parser.add_argument(
        "--optuna-tune",
        type=int,
        default=0,
        metavar="N",
        help="Run Optuna HPO with N trials (e.g. 50). Best params used for final model.",
    )
    args = parser.parse_args()

    crash_limit = None if args.crash_limit == 0 else args.crash_limit
    crime_limit = None if args.crime_limit == 0 else args.crime_limit

    from backend.model.data.intersections import get_chicago_intersections
    from backend.model.data.training_features import build_training_dataset
    import os as _os
    from dotenv import load_dotenv as _load_dotenv
    import gcsfs as _gcsfs

    _load_dotenv(_repo_root / "backend" / ".env")
    _gcs_key = _os.getenv("GCS_CREDENTIALS_PATH")
    _has_gcs = _gcs_key and _os.path.isfile(_gcs_key)
    _fs = _gcsfs.GCSFileSystem(token=_gcs_key) if _has_gcs else None

    # --- Determine data source: GCS (default) > Socrata > Supabase ---
    if args.from_socrata:
        from backend.model.data.crashes import get_enriched_crashes
        from backend.model.data.crimes import get_crimes

        print("Fetching crashes from Socrata (full range)...", flush=True)
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
    elif args.from_supabase:
        from backend.model.data.supabase_reader import (
            load_crashes_from_supabase,
            load_crimes_from_supabase,
        )

        print("Loading crashes from Supabase...", flush=True)
        crashes = load_crashes_from_supabase(args.past_start, args.future_end)
        if crashes.empty:
            raise SystemExit("No crashes from Supabase.")
        print("Loading crimes from Supabase...", flush=True)
        crimes = load_crimes_from_supabase(args.past_start, args.future_end)
    else:
        # Default: load from GCS parquets (written by refresh_gcs_from_socrata)
        if not _has_gcs:
            raise SystemExit(
                "GCS key not found. Either set GCS_CREDENTIALS_PATH or use --from-socrata / --from-supabase."
            )
        print("Loading crashes from GCS (gs://safeway-data/crashes.parquet)...", flush=True)
        try:
            with _fs.open("safeway-data/crashes.parquet", "rb") as f:
                crashes = pd.read_parquet(f)
        except FileNotFoundError:
            raise SystemExit("crashes.parquet not found on GCS. Run refresh_gcs_from_socrata first.")
        crashes["crash_date"] = pd.to_datetime(crashes["crash_date"], errors="coerce", utc=True)
        for col in ("has_ped", "has_bike", "is_fsi"):
            if col in crashes.columns:
                crashes[col] = crashes[col].fillna(False).astype(bool)
        print(f"  Loaded {len(crashes)} crashes.", flush=True)

        print("Loading crimes from GCS (gs://safeway-data/crimes.parquet)...", flush=True)
        try:
            with _fs.open("safeway-data/crimes.parquet", "rb") as f:
                crimes = pd.read_parquet(f)
        except FileNotFoundError:
            raise SystemExit("crimes.parquet not found on GCS. Run refresh_gcs_from_socrata first.")
        if "crime_date" in crimes.columns:
            crimes["date"] = pd.to_datetime(crimes["crime_date"], errors="coerce", utc=True)
        elif "date" in crimes.columns:
            crimes["date"] = pd.to_datetime(crimes["date"], errors="coerce", utc=True)
        from backend.model.data.crimes import (
            VIOLENT_CRIME_TYPES, PROPERTY_CRIME_TYPES,
            TRAFFIC_DIRECT_TYPES, TRAFFIC_DIRECT_DESCRIPTIONS, DISORDER_TYPES,
        )
        if "primary_type" in crimes.columns:
            crimes["is_violent"] = crimes["primary_type"].isin(VIOLENT_CRIME_TYPES)
            crimes["is_property"] = crimes["primary_type"].isin(PROPERTY_CRIME_TYPES)
            # Phase B: smart crime groups
            desc_upper = crimes["description"].fillna("").str.upper() if "description" in crimes.columns else pd.Series("", index=crimes.index)
            crimes["is_traffic_direct"] = (
                crimes["primary_type"].isin(TRAFFIC_DIRECT_TYPES)
                | desc_upper.str.contains("|".join(TRAFFIC_DIRECT_DESCRIPTIONS), regex=True, na=False)
            )
            crimes["is_disorder"] = (
                crimes["primary_type"].isin(DISORDER_TYPES)
                & ~crimes["is_traffic_direct"]
                & ~(crimes["domestic"].astype(str).str.upper() == "TRUE" if "domestic" in crimes.columns else False)
            )
        n_td = crimes["is_traffic_direct"].sum() if "is_traffic_direct" in crimes.columns else 0
        n_dis = crimes["is_disorder"].sum() if "is_disorder" in crimes.columns else 0
        print(f"  Loaded {len(crimes)} crimes ({n_td} traffic-direct, {n_dis} disorder).", flush=True)

    # --- Load weather from GCS and merge with crashes ---
    if _has_gcs:
        try:
            with _fs.open("safeway-data/weather.parquet", "rb") as f:
                weather = pd.read_parquet(f)
            print(f"Loading weather from GCS ({len(weather)} records)...", flush=True)
            from backend.model.data.merge_weather import merge_crashes_with_weather
            crashes = merge_crashes_with_weather(crashes, weather)
        except FileNotFoundError:
            print("  weather.parquet not found on GCS; training without weather features.", flush=True)
        except Exception as e:
            print(f"  Weather merge failed ({e}); training without weather features.", flush=True)

    print(f"  Total: {len(crashes)} crashes, {len(crimes)} crimes.", flush=True)

    # --- Load camera + streetlight data from GCS ---
    red_light_violations = pd.DataFrame()
    speed_violations = pd.DataFrame()
    streetlights_out = pd.DataFrame()
    if _has_gcs:
        for _name in ["red_light_violations", "speed_violations", "streetlights_out"]:
            try:
                with _fs.open(f"safeway-data/{_name}.parquet", "rb") as f:
                    _loaded = pd.read_parquet(f)
                print(f"  Loaded {len(_loaded)} {_name} records from GCS.", flush=True)
                if _name == "red_light_violations":
                    red_light_violations = _loaded
                elif _name == "speed_violations":
                    speed_violations = _loaded
                else:
                    streetlights_out = _loaded
            except FileNotFoundError:
                print(f"  {_name}.parquet not found on GCS; skipping.", flush=True)
            except Exception as e:
                print(f"  {_name} load failed ({e}); skipping.", flush=True)
    else:
        print("  GCS key not available; training without camera/streetlight features.", flush=True)

    # --- Load camera LOCATION data from GCS ---
    red_light_camera_locations = pd.DataFrame()
    speed_camera_locations = pd.DataFrame()
    if _has_gcs:
        for _name, _var_name in [
            ("red_light_camera_locations", "red_light_camera_locations"),
            ("speed_camera_locations", "speed_camera_locations"),
        ]:
            try:
                with _fs.open(f"safeway-data/{_name}.parquet", "rb") as f:
                    _loaded = pd.read_parquet(f)
                print(f"  Loaded {len(_loaded)} {_name} records from GCS.", flush=True)
                if _var_name == "red_light_camera_locations":
                    red_light_camera_locations = _loaded
                else:
                    speed_camera_locations = _loaded
            except FileNotFoundError:
                print(f"  {_name}.parquet not found on GCS; skipping.", flush=True)
            except Exception as e:
                print(f"  {_name} load failed ({e}); skipping.", flush=True)

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
        red_light_violations=red_light_violations,
        speed_violations=speed_violations,
        streetlights_out=streetlights_out,
        red_light_camera_locations=red_light_camera_locations,
        speed_camera_locations=speed_camera_locations,
    )

    # --- Prepare features ---
    X = df.copy()
    for c in FEATURE_COLS:
        if c not in X.columns:
            X[c] = 0.0
    X_feat = X[FEATURE_COLS].fillna(0)
    groups = X["spatial_group"].values

    # Two-stage targets
    y_binary = df["has_future_crash"].astype(int)
    y_severity = df["future_severity_score"].astype(float)

    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import r2_score, roc_auc_score, f1_score
    from xgboost import XGBRegressor
    from catboost import CatBoostClassifier
    from scipy.stats import spearmanr
    import joblib

    neg_pos_ratio = float((y_binary == 0).sum()) / max(float((y_binary == 1).sum()), 1)
    print(f"\n  Stage 1 class balance: {(y_binary==1).sum()} positive / {(y_binary==0).sum()} negative (ratio {neg_pos_ratio:.1f})", flush=True)

    # =====================================================================
    #  STAGE 1: CatBoost binary classifier — P(any future crash)
    # =====================================================================
    print(f"\n{'='*60}", flush=True)
    print(f"  STAGE 1: CatBoost Binary Classifier", flush=True)
    print(f"{'='*60}", flush=True)

    gkf = GroupKFold(n_splits=5)
    s1_aucs, s1_f1s = [], []
    s1_oof_proba = np.zeros(len(X_feat))

    for fold, (tr, va) in enumerate(gkf.split(X_feat, y_binary, groups=groups)):
        s1 = CatBoostClassifier(
            iterations=500,
            depth=5,
            learning_rate=0.05,
            scale_pos_weight=neg_pos_ratio,
            verbose=0,
            random_seed=42,
        )
        s1.fit(X_feat.iloc[tr], y_binary.iloc[tr])
        proba_va = s1.predict_proba(X_feat.iloc[va])[:, 1]
        s1_oof_proba[va] = proba_va
        auc = roc_auc_score(y_binary.iloc[va], proba_va)
        f1 = f1_score(y_binary.iloc[va], (proba_va >= 0.5).astype(int))
        s1_aucs.append(auc)
        s1_f1s.append(f1)
        print(f"  Fold {fold+1} AUC: {auc:.3f}  F1: {f1:.3f}", flush=True)

    print(f"  Mean AUC: {np.mean(s1_aucs):.3f} +/- {np.std(s1_aucs):.3f}", flush=True)
    print(f"  Mean F1:  {np.mean(s1_f1s):.3f} +/- {np.std(s1_f1s):.3f}", flush=True)

    # Train final Stage 1 on all data
    stage1_model = CatBoostClassifier(
        iterations=500,
        depth=5,
        learning_rate=0.05,
        scale_pos_weight=neg_pos_ratio,
        verbose=0,
        random_seed=42,
    )
    stage1_model.fit(X_feat, y_binary)
    stage1_proba = stage1_model.predict_proba(X_feat)[:, 1]

    # =====================================================================
    #  STAGE 2: XGBoost regressor — E[severity | crash > 0]
    # =====================================================================
    print(f"\n{'='*60}", flush=True)
    print(f"  STAGE 2: XGBoost Severity Regressor (non-zero subset)", flush=True)
    print(f"{'='*60}", flush=True)

    # Filter to at-risk intersections (Stage 1 probability >= 0.35 for training)
    STAGE2_THRESHOLD = 0.35
    severity_mask = stage1_proba >= STAGE2_THRESHOLD
    n_stage2 = severity_mask.sum()
    print(f"  Stage 2 training subset: {n_stage2} / {len(X_feat)} intersections (threshold={STAGE2_THRESHOLD})", flush=True)

    X_s2 = X_feat[severity_mask].reset_index(drop=True)
    y_s2 = y_severity[severity_mask].reset_index(drop=True)
    groups_s2 = groups[severity_mask]

    # Optuna tuning on Stage 2 subset
    best_params = {
        "max_depth": 4,
        "n_estimators": 300,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
    }

    if args.optuna_tune > 0:
        import optuna
        optuna.logging.set_verbosity(optuna.logging.WARNING)

        print(f"\n  Optuna HPO (Stage 2): {args.optuna_tune} trials...", flush=True)
        study = optuna.create_study(direction="maximize", study_name="safeway-stage2")
        study.optimize(
            lambda trial: _optuna_objective(trial, X_s2, y_s2, groups_s2),
            n_trials=args.optuna_tune,
            show_progress_bar=True,
        )
        best_params = study.best_params
        print(f"  Optuna best R2: {study.best_value:.4f}", flush=True)
        print(f"  Best params: {json.dumps(best_params, indent=2)}", flush=True)

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_DIR / "optuna_best_params.json", "w") as f:
            json.dump({"best_r2": study.best_value, **best_params}, f, indent=2)

    # Stage 2 CV
    gkf2 = GroupKFold(n_splits=5)
    s2_scores = []
    for fold, (tr, va) in enumerate(gkf2.split(X_s2, y_s2, groups=groups_s2)):
        s2 = XGBRegressor(
            **best_params,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
        )
        s2.fit(X_s2.iloc[tr], y_s2.iloc[tr])
        pred = s2.predict(X_s2.iloc[va])
        s2_scores.append(r2_score(y_s2.iloc[va], pred))
        print(f"  Fold {fold+1} R2: {s2_scores[-1]:.3f}", flush=True)

    print(f"  Mean R2 (Stage 2 only): {np.mean(s2_scores):.3f} +/- {np.std(s2_scores):.3f}", flush=True)

    # Train final Stage 2 on all at-risk data
    stage2_model = XGBRegressor(
        **best_params,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
    )
    stage2_model.fit(X_s2, y_s2)

    # =====================================================================
    #  COMBINED SCORE: P(crash) × E[severity | crash]
    # =====================================================================
    print(f"\n{'='*60}", flush=True)
    print(f"  COMBINED: P(crash) x E[severity|crash]", flush=True)
    print(f"{'='*60}", flush=True)

    stage2_severity = stage2_model.predict(X_feat)
    stage2_severity = np.clip(stage2_severity, 0, None)

    combined_raw = stage1_proba * stage2_severity
    df["predicted_risk"] = (pd.Series(combined_raw).rank(pct=True) * 100).values

    # Evaluate combined score against the original target
    y_combined_target = df["future_risk_score"].astype(float)
    rho, _ = spearmanr(y_combined_target, df["predicted_risk"])
    combined_r2 = r2_score(y_combined_target, df["predicted_risk"])
    recall = top_k_recall(y_combined_target.values, df["predicted_risk"].values, k=max(1, int(0.1 * len(df))))
    print(f"  Combined R2 (vs percentile-rank target): {combined_r2:.3f}", flush=True)
    print(f"  Spearman rho: {rho:.3f}", flush=True)
    print(f"  Top-10pct recall: {recall:.2%}", flush=True)

    # Also report metrics on the raw combined score vs actual severity
    actual_severity = df["future_severity_score"].values
    rho_sev, _ = spearmanr(actual_severity, combined_raw)
    print(f"  Spearman vs actual severity: {rho_sev:.3f}", flush=True)

    # =====================================================================
    #  SAVE MODELS + METADATA
    # =====================================================================
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    joblib.dump(stage1_model, OUTPUT_DIR / "stage1_classifier.pkl")
    joblib.dump(stage2_model, OUTPUT_DIR / "stage2_regressor.pkl")
    # Keep backward-compatible name for risk_cache.py
    joblib.dump(stage2_model, OUTPUT_DIR / "intersection_risk_model.pkl")

    model_info = {
        "architecture": "two-stage hurdle (CatBoost classifier + XGBoost regressor)",
        "feature_cols": FEATURE_COLS,
        "stage1_mean_auc": float(np.mean(s1_aucs)),
        "stage1_mean_f1": float(np.mean(s1_f1s)),
        "stage2_hyperparams": best_params,
        "stage2_mean_r2": float(np.mean(s2_scores)),
        "stage2_subset_size": int(n_stage2),
        "stage2_threshold": STAGE2_THRESHOLD,
        "combined_spearman": float(rho) if not np.isnan(rho) else None,
        "combined_spearman_vs_severity": float(rho_sev) if not np.isnan(rho_sev) else None,
        "combined_top10_recall": float(recall),
    }
    with open(OUTPUT_DIR / "model_info.json", "w") as f:
        json.dump(model_info, f, indent=2)

    metadata = {
        "n_intersections": len(df),
        "feature_window": f"{args.past_start} to {args.past_end}",
        "label_window": f"{args.future_start} to {args.future_end}",
        "target_variable": "two-stage hurdle: P(crash>0) × E[severity|crash>0]",
        "stage1": "CatBoostClassifier (binary: has_future_crash)",
        "stage2": "XGBRegressor (continuous: future_severity_score, non-zero subset)",
        "spatial_cv_folds": 5,
    }
    with open(OUTPUT_DIR / "dataset_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    # Feature importance plot (Stage 2 regressor)
    try:
        import matplotlib.pyplot as plt

        imp = pd.DataFrame({"feature": FEATURE_COLS, "importance": stage2_model.feature_importances_})
        imp = imp.sort_values("importance", ascending=True).tail(20)
        plt.figure(figsize=(10, 8))
        plt.barh(imp["feature"], imp["importance"])
        plt.xlabel("Importance (Stage 2 — Severity Regressor)")
        plt.tight_layout()
        plt.savefig(OUTPUT_DIR / "feature_importance.png", dpi=150)
        plt.close()
        print(f"  Feature importance plot saved.", flush=True)
    except Exception as e:
        print(f"  Feature plot skipped: {e}", flush=True)

    # =====================================================================
    #  PHASE F: SHAP explainability — top-3 risk factors per intersection
    # =====================================================================
    FEATURE_LABELS = {
        "past_n_crash_total": "High crash history",
        "past_n_crash_fsi": "Fatal/serious crashes",
        "past_n_crash_ped": "Pedestrian crashes",
        "past_n_crash_bike": "Bicycle crashes",
        "past_n_crash_night": "Nighttime crashes",
        "past_n_crash_weekend": "Weekend crashes",
        "past_severity_sum": "High injury severity",
        "max_speed_osm": "High speed zone",
        "max_highway_rank": "Major road type",
        "max_lanes": "Multi-lane road",
        "total_lanes": "High lane count",
        "prop_lit": "Poor lighting coverage",
        "prop_oneway": "One-way streets",
        "past_prop_poor_lighting": "Dark conditions",
        "past_prop_poor_weather": "Bad weather crashes",
        "past_prop_poor_surface": "Poor road surface",
        "past_prop_cause_speed": "Speed-related causes",
        "past_prop_cause_yield": "Yield/signal violations",
        "past_n_crime_traffic_direct": "Traffic-related crime",
        "past_n_crime_disorder_weighted": "Area disorder",
        "past_n_crime_total_filtered": "Crime activity",
        "total_red_light_violations": "Red light violations",
        "total_speed_violations": "Speed camera violations",
        "n_streetlight_outages": "Streetlight outages",
        "crash_rate_per_exposure": "High crash rate",
        "fsi_rate_per_exposure": "High injury rate",
        "severity_rate_per_exposure": "High severity rate",
        "speed_x_poor_lighting": "Speed + poor lighting",
        "arterial_x_no_signal": "Major road, no signal",
        "speed_limit_mean": "High speed limit",
        "n_arms": "Complex intersection",
        "nearest_camera_dist_m": "Camera proximity",
    }

    shap_top3 = {}
    try:
        import shap
        print(f"\n  Computing SHAP values (TreeExplainer)...", flush=True)
        explainer = shap.TreeExplainer(stage2_model)
        shap_values = explainer.shap_values(X_feat)

        for i, node_id in enumerate(df["node_id"].values):
            sv = shap_values[i]
            top_idx = np.argsort(np.abs(sv))[-3:][::-1]
            factors = []
            for idx in top_idx:
                feat = FEATURE_COLS[idx]
                label = FEATURE_LABELS.get(feat, feat.replace("_", " ").title())
                factors.append({"feature": feat, "label": label, "shap": round(float(sv[idx]), 4)})
            shap_top3[str(node_id)] = factors
        print(f"  SHAP: computed top-3 factors for {len(shap_top3)} intersections.", flush=True)

        # Save SHAP factors
        joblib.dump(shap_top3, OUTPUT_DIR / "shap_top3.pkl")
    except Exception as e:
        print(f"  SHAP skipped: {e}", flush=True)

    # =====================================================================
    #  PHASE G: Save time-of-day multipliers
    # =====================================================================
    tod_cols = ["node_id", "night_multiplier", "morning_multiplier", "midday_multiplier", "evening_multiplier"]
    tod_df = df[[c for c in tod_cols if c in df.columns]].copy()
    tod_df.to_parquet(OUTPUT_DIR / "hourly_risk_factors.parquet", index=False)
    print(f"  Saved hourly_risk_factors.parquet ({len(tod_df)} rows).", flush=True)

    if args.export_csv:
        df.to_csv(OUTPUT_DIR / "chicago_intersection_training_dataset.csv", index=False)
        print(f"  Saved dataset CSV.", flush=True)

    if not args.no_push:
        from backend.model.data.intersections import build_intersection_safety_scores

        pred_map = df.set_index("node_id")[["predicted_risk", "future_risk_score"]]
        scores = build_intersection_safety_scores(crashes, crimes, intersections, G)
        scores = scores.merge(pred_map.reset_index(), on="node_id", how="left")
        scores["predicted_risk"] = scores["predicted_risk"].fillna(float(df["predicted_risk"].median()))
        scores["future_risk_score"] = scores["future_risk_score"].fillna(0)

        import os
        from dotenv import load_dotenv
        load_dotenv(_repo_root / "backend" / ".env")
        import gcsfs
        gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
        if not gcs_key or not os.path.isfile(gcs_key):
            print("  GCS key not found; skipping GCS writes.", flush=True)
        else:
            try:
                fs = gcsfs.GCSFileSystem(token=gcs_key)
                with fs.open("safeway-data/intersection_scores.parquet", "wb") as f:
                    scores.to_parquet(f, index=False)
                print("  intersection_scores.parquet -> GCS OK.", flush=True)
                # Upload SHAP + time-of-day to GCS too
                with fs.open("safeway-data/shap_top3.pkl", "wb") as f:
                    joblib.dump(shap_top3, f)
                with fs.open("safeway-data/hourly_risk_factors.parquet", "wb") as f:
                    tod_df.to_parquet(f, index=False)
                print("  shap_top3.pkl + hourly_risk_factors.parquet -> GCS OK.", flush=True)
            except Exception as e:
                print(f"  GCS write skipped: {e}", flush=True)

    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()

    