import { Redirect } from 'expo-router';

/**
 * OAuth callback handler.
 *
 * When Google OAuth completes, the browser redirects back to
 * safeway://auth/callback. Expo Router intercepts this deep link
 * and renders this screen. We immediately redirect to the home
 * tab — the AuthProvider's onAuthStateChange listener will pick
 * up the new session automatically.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
