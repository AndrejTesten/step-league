import { useSyncExternalStore } from 'react';

import { Sentry } from './sentry';

// The small set of known, actionable sync failures a user should actually
// read and can do something about — install Health Connect, grant the
// permission. Anything else is an internal failure (a network hiccup, a
// backend bug — a raw Postgres/PostgREST error string like "DELETE requires
// a where clause", which is a real bug this app hit) that isn't meaningful
// to show verbatim on someone's phone; those collapse to 'unknown' and get
// a generic, translated message at the display layer instead. The real
// detail still goes to Sentry/console, where a developer would actually
// see it — see reportSyncFailure below.
export type SyncErrorCode = 'health_connect_missing' | 'permission_denied' | 'unknown';

export class UserFacingSyncError extends Error {
  code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type SyncStatus = { errorCode: SyncErrorCode | null; lastSyncAt: number | null };

let status: SyncStatus = { errorCode: null, lastSyncAt: null };
const listeners = new Set<() => void>();

function setSyncStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export function reportSyncSuccess() {
  setSyncStatus({ errorCode: null, lastSyncAt: Date.now() });
}

// Step sync failures used to be swallowed into a console.warn that nobody
// but a developer staring at a Metro terminal would ever see — on a real
// phone, "steps stuck at 0" gave zero clue why. This makes the last sync
// outcome visible to the UI (as a code, not raw text — see SyncErrorCode
// above) so the home screen can actually explain itself, and — since this
// is the one place every platform's step-sync failure already funnels
// through (see lib/steps.*.ts) — also the one place that needs to report
// the real detail to Sentry, rather than adding that call to all three
// files separately.
export function reportSyncFailure(error: unknown) {
  const code: SyncErrorCode = error instanceof UserFacingSyncError ? error.code : 'unknown';
  const detail = error instanceof Error ? error.message : String(error);
  setSyncStatus({ errorCode: code, lastSyncAt: Date.now() });
  Sentry.captureMessage(`Step sync failed: ${detail}`, 'warning');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot);
}
