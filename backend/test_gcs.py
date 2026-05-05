"""
Standalone GCS connectivity test — no app, no project imports.
Reads all 3 data files from GCS and prints what it finds.
Run with: python backend/test_gcs.py
"""
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

import gcsfs
import pandas as pd
import joblib

gcs_key = os.getenv("GCS_CREDENTIALS_PATH")
fs = gcsfs.GCSFileSystem(token=gcs_key if gcs_key and Path(gcs_key).exists() else "cloud")

print("Testing GCS connectivity...\n")

print("1. intersection_scores.parquet")
with fs.open("safeway-data/intersection_scores.parquet", "rb") as f:
    df = pd.read_parquet(f)
print(f"   {len(df)} rows, columns: {list(df.columns)}")
print(df.head(3).to_string())
print()

print("2. shap_top3.pkl")
with fs.open("safeway-data/shap_top3.pkl", "rb") as f:
    shap = joblib.load(f)
first_key = next(iter(shap))
print(f"   {len(shap)} entries")
print(f"   Sample key={first_key}: {shap[first_key]}")
print()

print("3. hourly_risk_factors.parquet")
with fs.open("safeway-data/hourly_risk_factors.parquet", "rb") as f:
    tod = pd.read_parquet(f)
print(f"   {len(tod)} rows, columns: {list(tod.columns)}")
print(tod.head(3).to_string())
print()

print("All GCS files OK.")
