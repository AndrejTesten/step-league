import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSession } from './auth-context';
import { syncSteps } from './steps'; // Metro resolves steps.ios.ts / steps.android.ts / steps.web.ts

// While the app is open and in the foreground, re-pull from
// HealthKit/Health Connect this often so the home screen feels live instead
// of only updating the next time you background/reopen the app. Health
// Connect reads are just local on-device queries, cheap enough to poll —
// as long as each poll only touches today (see LIVE_SYNC_DAYS_TO_BACKFILL
// below); a full multi-day backfill on every tick is what was piling up
// native calls and eventually crashing the app.
const LIVE_SYNC_INTERVAL_MS = 15_000;
const LIVE_SYNC_DAYS_TO_BACKFILL = 0; // today only

/**
 * Syncs steps (full backfill) once on mount and again every time the app
 * comes to the foreground, then does a cheap today-only sync repeatedly on
 * LIVE_SYNC_INTERVAL_MS while it stays in the foreground. Call this once,
 * near the root of the authenticated part of the app (see
 * app/(app)/_layout.tsx) — not per-screen.
 */
export function useStepSync() {
  const { session, profile } = useSession();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Read the *current* session/profile from refs inside the timers instead
  // of closing over them directly. Supabase fires session-changed events
  // (token refresh, etc.) periodically even when nothing meaningful
  // changed, which gives `session`/`profile` new object identities on every
  // render — if the effect below depended on those objects directly, it
  // would tear down and rebuild the interval each time, and if that happens
  // more often than LIVE_SYNC_INTERVAL_MS the interval would never survive
  // long enough to actually fire on its own (syncs once on mount, then
  // never again — exactly the bug this fixes).
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const userId = session?.user.id;
  const timezone = profile?.timezone;

  useEffect(() => {
    if (!userId || !timezone) return;

    // Guards against overlapping syncs: if one call is slow (a flaky Health
    // Connect response, a slow network for the Supabase upsert, etc.) the
    // next timer tick used to fire anyway, stacking up concurrent native
    // calls indefinitely. Two syncs racing could also finish out of order —
    // an older, smaller count finishing last and overwriting a newer one in
    // daily_steps, which is what made the counter look inaccurate.
    let syncing = false;
    const doSync = async (daysToBackfill?: number) => {
      if (syncing) return;
      syncing = true;
      try {
        const s = sessionRef.current;
        const p = profileRef.current;
        if (s && p) await syncSteps(p.timezone, daysToBackfill);
      } finally {
        syncing = false;
      }
    };

    doSync();

    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        doSync();
      }
      appState.current = next;
    });

    const interval = setInterval(() => {
      if (appState.current === 'active') doSync(LIVE_SYNC_DAYS_TO_BACKFILL);
    }, LIVE_SYNC_INTERVAL_MS);

    return () => {
      sub.remove();
      clearInterval(interval);
    };
    // Only userId/timezone (stable primitives) — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, timezone]);
}
