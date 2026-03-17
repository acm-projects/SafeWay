import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import gcsfs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.model.data.supabase_reader import (  # noqa: E402
    load_crashes_from_supabase,
    load_crimes_from_supabase,
)


def main() -> None:
    """One-time export from Supabase to GCS using env-based GCS_CREDENTIALS_PATH."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    backend_dir = repo_root / "backend"
    load_dotenv(backend_dir / ".env")

    gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
    if not gcs_key or not os.path.isfile(gcs_key):
        raise SystemExit(
            "GCS_CREDENTIALS_PATH is not set or does not point to a readable service account key file."
        )

    fs = gcsfs.GCSFileSystem(token=gcs_key)

    print("Exporting crashes from Supabase...")
    crashes = load_crashes_from_supabase("2020-01-01", "2026-01-31")
    print(f"  Got {len(crashes)} rows")
    with fs.open("safeway-data/crashes.parquet", "wb") as f:
        crashes.to_parquet(f, index=False)
    print("  crashes.parquet → GCS ✓")

    print("Exporting crimes from Supabase...")
    crimes = load_crimes_from_supabase("2020-01-01", "2026-01-31")
    print(f"  Got {len(crimes)} rows")
    with fs.open("safeway-data/crimes.parquet", "wb") as f:
        crimes.to_parquet(f, index=False)
    print("  crimes.parquet → GCS ✓")

    print("\nDone. Check gs://safeway-data/ in your GCS console.")


if __name__ == "__main__":
    main()