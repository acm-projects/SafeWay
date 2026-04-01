FROM python:3.11-slim

WORKDIR /app

# Install system deps needed by osmnx, scipy, spatial libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgdal-dev libspatialindex-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code only (frontend is a separate Expo build)
COPY backend/ ./backend/

# Cloud Run expects port 8080
ENV PORT=8080
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
