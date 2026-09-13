import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';
import { getDeviceTimezone } from './timezone';
import type { Profile } from './types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (params: {
    email: string;
    password: string;
    username: string;
    displayName: string;
  }) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      isLoading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signUp({ email, password, username, displayName }) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { error: error.message };
        const userId = data.user?.id;
        if (!userId) return { error: 'Sign up succeeded but no user id was returned.' };

        // Create the profile row. If email confirmation is required, this
        // still succeeds because Supabase issues a user id immediately;
        // the session just won't be active until the user confirms.
        const { error: profileError } = await supabase.from('profiles').insert({
          id: userId,
          username,
          display_name: displayName,
          timezone: getDeviceTimezone(),
        });
        if (profileError) return { error: profileError.message };

        // auth.signUp() above already fired onAuthStateChange (SIGNED_IN),
        // which raced this very function to call loadProfile() *before*
        // the insert just above had run — finding no row yet and leaving
        // `profile` stuck at null. With `profile` never populated, the
        // (app) layout's onboarding-location/onboarding-health redirects
        // (both gated on `profile && ...`) never fired, dropping a brand
        // new signup straight onto the home screen with no location and no
        // steps-access consent — invisible until sign-out/sign-in reloaded
        // the profile correctly. Loading it again here, now that the row
        // genuinely exists, closes that race.
        await loadProfile(userId);
        return { error: null };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async refreshProfile() {
        if (session) await loadProfile(session.user.id);
      },
    }),
    [session, profile, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
