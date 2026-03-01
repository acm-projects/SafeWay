# SafeWay Frontend

## Environment

Copy `.env.example` to `.env` and fill values:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL` (FastAPI backend URL)

## Supabase Google OAuth

In Supabase Auth provider settings, add redirect URL:

- `safeway://auth/callback`

For local Expo development, also include the redirect URI you get from `Linking.createURL('auth/callback')`.

## Run

```bash
npm install
npx expo start
```

Open the app, sign in (email or Google), search a place, draw route, bookmark locations, then launch navigation in Google Maps.
