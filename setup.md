# SafeWay – Setup & Run

Instructions to run SafeWay from scratch (backend + frontend) on Android emulator or physical device.

---

## Prerequisites

- **Node.js** and **npm** (for frontend)
- **Python 3.11+** (for backend)
- **Android**: Android Studio (emulator) or a physical device with USB debugging
- **Supabase** project (for auth and DB)
- **Google Cloud** project with:
  - Maps SDK for Android enabled
  - Geocoding API enabled (for backend)
  - API keys created (one for Android app, one optional for server)

---

## 1. Backend setup

### 1.1 Dependencies

From the **repo root** (where `requirements.txt` lives):

```bash
pip install -r requirements.txt
```

Optional: use a virtual environment:

```bash
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

### 1.2 Environment

In `backend/`:

```bash
cp .env.example .env
```

Edit `backend/.env` and set:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. from Supabase: `postgresql://postgres:PASSWORD@PROJECT.supabase.co:5432/postgres`) |
| `SUPABASE_URL` | `https://PROJECT.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `GOOGLE_MAPS_API_KEY` | Server-side Google API key (Geocoding, etc.) |

---

## 2. Frontend setup

### 2.1 Dependencies

```bash
cd frontend
npm install
```

### 2.2 Environment

In `frontend/`:

```bash
cp .env.example .env
```

Edit `frontend/.env` and set:

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Same as backend `SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same as backend `SUPABASE_PUBLISHABLE_KEY` |
| `EXPO_PUBLIC_API_BASE_URL` | Backend URL the app will call (see table below) |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key for the Android app (required for maps) |

**Important:** Expo only loads variables prefixed with `EXPO_PUBLIC_`. The Maps key must be `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` so it is available in `app.config.ts` and the map works.

#### Backend URL by device

| Setup | `EXPO_PUBLIC_API_BASE_URL` |
|-------|-----------------------------|
| **Android Emulator** | `http://10.0.2.2:8000` |
| **Physical device (same Wi‑Fi as PC)** | `http://YOUR_PC_IP:8000` (e.g. `http://192.168.1.105:8000` — get IP from `ipconfig`) |
| **Physical device (USB + adb reverse)** | `http://localhost:8000` (after running `adb reverse tcp:8000 tcp:8000`) |

---

## 3. Supabase Google OAuth (optional, for sign-in)

In Supabase Dashboard → Authentication → Providers → Google:

- Enable Google and set OAuth client ID/secret.
- Add redirect URL: `safeway://auth/callback`
- For local Expo, add the redirect URI from `Linking.createURL('auth/callback')` if needed.

---

## 4. Running the app

You need **two** processes: backend and frontend.

### 4.1 Start the backend

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Leave this running. The API will be at `http://localhost:8000` (and on your LAN at `http://0.0.0.0:8000` when using a physical device).

### 4.2 Start the frontend

In a **second terminal**:

```bash
cd frontend
npx expo start
```

### 4.3 Open on device

- **Android emulator:** Press **`a`** in the Expo terminal (or ensure the emulator is running and Expo will offer to open on it).
- **Physical device:** Scan the QR code with Expo Go, or press **`a`** if the device is connected via USB and detected.
- **Web:** Press **`w`** (if supported).

---

## 5. Physical device over USB only

If the phone is connected by cable and you want the app to use the backend without Wi‑Fi:

1. Connect the phone via USB and enable USB debugging.
2. Run once per session:
   ```bash
   adb reverse tcp:8000 tcp:8000
   ```
3. In `frontend/.env` set `EXPO_PUBLIC_API_BASE_URL=http://localhost:8000`.
4. Restart Expo and open the app on the device.

---

## 6. Google Maps “No API key” on Android

If you see a “no API key” or “api=your api key” error:

1. In `frontend/.env` use **`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`** (not `GOOGLE_MAPS_API_KEY`) and set it to your real key.
2. Restart Expo (`npx expo start`).
3. Rebuild the Android app so the key is baked in:
   ```bash
   cd frontend
   npx expo run:android
   ```
   Or: `npx expo prebuild --clean` then `npx expo run:android`.

---

## Quick checklist

| Step | Where | Action |
|------|--------|--------|
| 1 | Repo root | `pip install -r requirements.txt` |
| 2 | `backend/` | Copy `.env.example` → `.env`, fill Supabase + Google key |
| 3 | `frontend/` | `npm install` |
| 4 | `frontend/` | Copy `.env.example` → `.env`, set all `EXPO_PUBLIC_*` and API base URL |
| 5 | Terminal 1 | `cd backend` → `uvicorn main:app --reload --host 0.0.0.0 --port 8000` |
| 6 | Terminal 2 | `cd frontend` → `npx expo start` → press **`a`** for Android |

Both backend and frontend must be running at the same time.
