# Model pipeline (Part A: merge + visualize)

- **Data:** Chicago Traffic Crashes, Vehicles, People from Socrata API; merged on `CRASH_RECORD_ID`. Default date range **2021–2025** (5 years); default cap **50,000** rows for faster runs.
- **Storage:** Merged data is pushed to Supabase table **`enriched_crashes`** (primary). CSV export is optional (`--export-csv` for debugging).
- **Main script:** `analysis.py` — fetches merged data, upserts to Supabase, then generates charts (hourly, contributory cause, lighting) and two HTML maps (hit-and-run cluster, severity FSI/ped-bike/other).

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
