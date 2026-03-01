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

function parseUrlParams(url: string): Record<string, string> {
  const [baseAndQuery, fragment = ''] = url.split('#');
  const queryString = baseAndQuery.includes('?') ? baseAndQuery.split('?')[1] : '';
  const combined = [queryString, fragment].filter(Boolean).join('&');
  const params = new URLSearchParams(combined);
  return Object.fromEntries(params.entries());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data.session ?? null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession(nextSession);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
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
          options: {
            redirectTo,
            skipBrowserRedirect: true,
          },
        });
        if (error) throw error;
        if (!data?.url) throw new Error('Could not initialize Google OAuth flow.');

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== 'success' || !result.url) {
          throw new Error('Google sign in was cancelled.');
        }

        const params = parseUrlParams(result.url);
        const accessToken = params.access_token;
        const refreshToken = params.refresh_token;
        if (!accessToken || !refreshToken) {
          throw new Error('OAuth redirect did not include session tokens.');
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
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
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
