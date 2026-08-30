import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSession } from './auth-context';
import { syncSteps } from './steps'; // Metro resolves steps.ios.ts / steps.android.ts / steps.web.ts

/**
 * Syncs steps once on mount and again every time the app comes to the
 * foreground. Call this once, near the root of the authenticated part of
 * the app (see app/(app)/_layout.tsx) — not per-screen.
 */
export function useStepSync() {
  const { session, profile } = useSession();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!session || !profile) return;

    syncSteps(session.user.id, profile.timezone);

    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        syncSteps(session.user.id, profile.timezone);
      }
      appState.current = next;
    });

    return () => sub.remove();
  }, [session, profile]);
}
