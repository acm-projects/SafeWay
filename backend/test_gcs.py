# test_gcs.py
import os

import gcsfs
import pandas as pd


def main() -> None:
    """Tiny GCS write/read test using GCS_CREDENTIALS_PATH (no hardcoded key path)."""
    gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
    if not gcs_key or not os.path.isfile(gcs_key):
        raise SystemExit(
            "Set GCS_CREDENTIALS_PATH to your service account JSON path before running test_gcs.py."
        )

    fs = gcsfs.GCSFileSystem(token=gcs_key)

    # write a tiny test file
    test_df = pd.DataFrame({"test": [1, 2, 3]})
    with fs.open("safeway-data/test.parquet", "wb") as f:
        test_df.to_parquet(f, index=False)
    print("Write OK")

    # read it back
    with fs.open("safeway-data/test.parquet", "rb") as f:
        result = pd.read_parquet(f)
    print(f"Read OK — {len(result)} rows")
    print(result)

    # clean up
    fs.rm("safeway-data/test.parquet")
    print("Cleanup OK — bucket is ready")


if __name__ == "__main__":
    main()