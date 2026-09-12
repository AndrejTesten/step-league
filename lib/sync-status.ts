import { useSyncExternalStore } from 'react';

import { Sentry } from './sentry';

// Step sync failures used to be swallowed into a console.warn that nobody
// but a developer staring at a Metro terminal would ever see — on a real
// phone, "steps stuck at 0" gave zero clue why. This makes the last sync
// outcome (Health Connect not installed, permission denied, etc.) visible
// to the UI so the home screen can actually explain itself, and — since
// this is the one place every platform's step-sync failure already funnels
// through (see lib/steps.*.ts) — also the one place that needs to report it
// to Sentry, rather than adding that call to all three files separately.
type SyncStatus = { error: string | null; lastSyncAt: number | null };

let status: SyncStatus = { error: null, lastSyncAt: null };
const listeners = new Set<() => void>();

function setSyncStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l());
}

export function reportSyncSuccess() {
  setSyncStatus({ error: null, lastSyncAt: Date.now() });
}

export function reportSyncFailure(message: string) {
  setSyncStatus({ error: message, lastSyncAt: Date.now() });
  Sentry.captureMessage(`Step sync failed: ${message}`, 'warning');
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
