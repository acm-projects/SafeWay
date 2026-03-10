"""
Run after analysis completes (or in parallel if token allows).
Crimes push full 2020-2026, then train_model no-limit + export + Supabase push.

Run with: python -u backend/model/run_full_pipeline.py  (or set PYTHONUNBUFFERED=1)
"""
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
repo = Path(__file__).resolve().parent.parent.parent
if str(repo) not in sys.path:
    sys.path.insert(0, str(repo))

def main():
    from backend.model.data.crimes import get_crimes
    from backend.model.data.supabase_crimes import push_crimes_to_supabase

    print("=== Full crimes fetch + push ===")
    df = get_crimes(start_date="2020-01-01", end_date="2026-01-31", limit=None)
    if df.empty:
        print("No crimes; skipping push.")
    else:
        n = push_crimes_to_supabase(df, batch_size=1000)
        print(f"Pushed {n} crimes to enriched_crimes.")

    print("=== train_model full (no limit) ===", flush=True)
    import subprocess
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    # Default train_model reads from Supabase (no Socrata re-pull)
    subprocess.check_call([
        sys.executable, "-u", "-m", "backend.model.train_model",
        "--export-csv",
    ], cwd=str(repo), env=env)

if __name__ == "__main__":
    main()
