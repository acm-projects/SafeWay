# Model pipeline (Part A: merge + visualize)

- **Data:** Chicago Traffic Crashes, Vehicles, People from Socrata API; merged on `CRASH_RECORD_ID`. Default date range **2021–2025** (5 years); default cap **50,000** rows for faster runs.
- **Storage:** Merged data is pushed to Supabase table **`enriched_crashes`** (primary). CSV export is optional (`--export-csv` for debugging).
- **Main script:** `analysis.py` — fetches merged data, upserts to Supabase, then generates charts (hourly, contributory cause, lighting) and two HTML maps (hit-and-run cluster, severity FSI/ped-bike/other).

**Logs not showing?** When running in background or redirected output, Python buffers stdout. Use **`python -u -m backend.model.analysis ...`** or **`$env:PYTHONUNBUFFERED=1`** in PowerShell so prints appear immediately.

## Run analysis (from repo root)

Requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `backend/.env`. Run the migration `backend/migrations/002_enriched_crashes.sql` in the Supabase SQL editor once to create the table.

```bash
# Default: 2021-2025, 50k rows — push to Supabase + charts + hitrun_map.html + crash_map.html
python -m backend.model.analysis

# Smaller/faster
python -m backend.model.analysis --limit 5000

# Custom date range
python -m backend.model.analysis --start 2022-01-01 --end 2023-12-31 --limit 25000

# Full dataset (no row limit; can be slow without Socrata app token)
python -m backend.model.analysis --no-limit

# Also write enriched_crashes.csv for debugging
python -m backend.model.analysis --export-csv
```

Outputs: **Supabase** table `enriched_crashes`; local files in `backend/model/output/`: `hourly_crashes.png`, `contributory_cause.png`, `lighting_condition.png`, `hitrun_map.html`, `crash_map.html` (and optionally `enriched_crashes.csv` with `--export-csv`). Open the HTML files in a browser to view the maps.

## Map-only script (optional)

```bash
# Quick map only (same defaults 2021-2025, 50k)
python -m backend.model.build_crash_map --start 2021-01-01 --end 2025-12-31 --limit 50000
```

## Files

- `data/socrata_client.py` — Socrata `fetch_all` helper
- `data/crashes.py` — `get_enriched_crashes()` (Crashes + Vehicles + People merge)
- `data/supabase_crashes.py` — Supabase client helper and `push_enriched_crashes_to_supabase()`
- `analysis.py` — full pipeline: merge, push to Supabase, charts, hit-run map, severity map
- `build_crash_map.py` — severity map only (same data)
- `migrations/002_enriched_crashes.sql` — table schema for Supabase (run once in SQL editor)

## Part B: Intersection safety scores (crimes + OSMnx)

Requires `osmnx` (see `requirements.txt`). First run downloads the Chicago drive network from OpenStreetMap (slow).

**Default behavior:** builds scores and **pushes to Supabase** table `intersection_safety` (run `004_intersection_safety.sql` then `005_intersection_safety_composite.sql` once). Use `--export-csv` for a local CSV; `--no-push` to skip Supabase (e.g. offline).

```bash
# Test with small limits (recommended first run) — pushes to Supabase
python -m backend.model.build_intersection_dataset --crash-limit 3000 --crime-limit 5000

# Also write intersection_safety.csv locally
python -m backend.model.build_intersection_dataset --crash-limit 3000 --export-csv

# No Supabase (CSV only if --export-csv)
python -m backend.model.build_intersection_dataset --no-push --export-csv --crash-limit 5000

# Crash-only (no crimes fetch)
python -m backend.model.build_intersection_dataset --no-crimes --crash-limit 5000
```

Crimes push to Supabase: run `003_enriched_crimes.sql`, then:

```bash
python -c "from backend.model.data.crimes import get_crimes; from backend.model.data.supabase_crimes import push_crimes_to_supabase; df=get_crimes(limit=20000); push_crimes_to_supabase(df)"
```

Intersection table: run `migrations/004_intersection_safety.sql` then `005_intersection_safety_composite.sql`; `build_intersection_dataset` upserts via `supabase_intersection_safety.py` by default.

- `data/crimes.py` — fetch filtered crimes from Socrata
- `data/supabase_crimes.py` — push to `enriched_crimes`
- `data/supabase_intersection_safety.py` — batch upsert to `intersection_safety`
- `data/intersections.py` — OSMnx graph + `build_intersection_safety_scores()` (driver-first composite score; crimes as `context_crime_score` only)
- `build_intersection_dataset.py` — end-to-end build + Supabase push (optional `--export-csv` / `--no-push`)
- `migrations/003_enriched_crimes.sql`, `004_intersection_safety.sql`, `005_intersection_safety_composite.sql`, `006_intersection_safety_rls_optional.sql`, `007_enriched_crashes_add_cols.sql`, `008_intersection_predicted_risk.sql`

## Part B.5: Route-ready model training (XGBoost + A\*)

Uses temporal split: **past features** 2020-01-01 through 2025-01-31, **future labels** 2025-02-01 through 2026-01-01 (override with CLI). See `docs/Safe Route Model Training Guide.pdf`.

**Default data source:** `train_model` loads crashes and crimes from **Supabase** (`enriched_crashes`, `enriched_crimes`) for the requested date range—no repeated Socrata pagination. Use `--from-socrata` only when you need a fresh API pull.

```bash
# Default: read from Supabase (fast; ensure analysis + crimes push already ran)
python -u -m backend.model.train_model --export-csv

# Force Socrata re-pull (slow; e.g. after fresh ingest)
python -u -m backend.model.train_model --from-socrata --crash-limit 0 --crime-limit 0 --export-csv

# Small Socrata-only test (limits avoid long pulls)
python -m backend.model.train_model --from-socrata --crash-limit 8000 --crime-limit 8000 --no-push
```

Outputs in `backend/model/output/`:

- `intersection_risk_model.pkl` — joblib XGBRegressor
- `model_info.json`, `dataset_metadata.json`
- `feature_importance.png`

**Quality targets (guide):** spatial CV mean R² > 0.65, Spearman ρ > 0.75, top-10% hotspot recall > 70%.

**Route scoring:** `route_scoring.py` — `attach_risk_to_graph`, `compute_edge_costs`, `find_safer_route` (A* on hybrid `safe_cost`).

- `data/supabase_reader.py` — paginated load from `enriched_crashes` / `enriched_crimes` (train_model default)
- `data/training_features.py` — temporal split + past/future aggregates
- `train_model.py` — GroupKFold CV + XGBoost + optional Supabase upsert (Supabase-first; `--from-socrata` fallback)
- `route_scoring.py` — graph risk + A* safer route
