import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

# Load .env from backend directory
load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI()


# ========== Testing FastAPI ==========
# Routes below are for verifying the FastAPI server runs correctly.


@app.get("/")
def read_root():
    return {"Hello": "World"}


@app.get("/items/{item_id}")
def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}


# ========== Testing Supabase (database connection) ==========
# Route below verifies we can connect to the Supabase PostgreSQL database.


@app.get("/db-check")
def check_supabase_db():
    """Verify Supabase PostgreSQL database connection."""
    import psycopg2

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return {"ok": False, "error": "Missing DATABASE_URL in .env"}
    try:
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        return {"ok": True, "message": "Supabase database connection OK"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
