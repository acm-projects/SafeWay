import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Hard fallback — never block app longer than 5s
    const hardTimeout = setTimeout(() => {
      if (isMounted) setIsLoading(false);
    }, 5000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) setSession(data.session ?? null);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(hardTimeout);
        if (isMounted) setIsLoading(false);
      });

    // Listen for auth state changes (handles Google OAuth callback too)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) setSession(nextSession);
    });

    // Handle deep link callback from Google OAuth
    const handleUrl = async (url: string) => {
      if (!url) return;
      // Extract tokens from fragment (#) or query string
      const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1] ?? '';
      const params = new URLSearchParams(fragment);
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }
    };

    // Handle URL if app was opened via deep link
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); }).catch(() => {});
    const linkSub = Linking.addEventListener('url', ({ url }) => { handleUrl(url); });

    return () => {
      isMounted = false;
      clearTimeout(hardTimeout);
      listener.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      async signInWithPassword(email: string, password: string) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUpWithPassword(email: string, password: string) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      },
      async signInWithGoogle() {
        const redirectTo = Linking.createURL('auth/callback');
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) throw error;
        if (!data?.url) throw new Error('Could not initialize Google OAuth flow.');

        // Open browser — onAuthStateChange listener above will pick up the new session
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

        if (result.type === 'success' && result.url) {
          // Parse tokens from the redirect URL and set session manually as a fallback
          const frag = result.url.includes('#')
            ? result.url.split('#')[1]
            : result.url.split('?')[1] ?? '';
          const p = new URLSearchParams(frag);
          const at = p.get('access_token');
          const rt = p.get('refresh_token');
          if (at && rt) {
            const { error: se } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
            if (se) throw se;
          }
          // If no tokens in URL, onAuthStateChange already fired — that's fine
        } else if (result.type === 'cancel') {
          throw new Error('Google sign in was cancelled.');
        }
        // type === 'dismiss' is treated as success (browser may auto-close after redirect)
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [session, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}