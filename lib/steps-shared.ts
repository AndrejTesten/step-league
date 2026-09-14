import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

// Safety-net default for when we don't yet know how long it's actually
// been (first sync ever, or the last-full-sync marker failed to read) —
// see getDaysToBackfill() below for the real, dynamic answer.
export const DAYS_TO_BACKFILL = 7;

// Upper bound on a single sync's backfill regardless of how long the real
// gap was — each day is its own native HealthKit/Health Connect call (see
// lib/steps.android.ts), so this caps the work one sync can trigger even
// for someone who hasn't opened the app in months. A month is generous
// enough to make "didn't open the app for a week or two" a non-issue while
// still bounding the worst case.
const MAX_DAYS_TO_BACKFILL = 30;

const LAST_FULL_SYNC_KEY = 'stepleague:last-full-sync-date';

/**
 * How many past days a "full" sync (on mount or foreground-return — as
 * opposed to the cheap today-only live poll while the app stays open, see
 * lib/use-step-sync.ts) should backfill, based on how long it's actually
 * been since the last one. There's no background sync (see README's Known
 * limitations) — real steps still accumulate in HealthKit/Health Connect
 * the whole time either way, so this is what makes "didn't open the app
 * for a week" a non-issue: the next open backfills exactly the gap, not
 * just a fixed 7 days, without also making the common case (opened
 * yesterday) pull a full week of native calls on every single launch.
 */
export async function getDaysToBackfill(): Promise<number> {
  try {
    const lastKey = await AsyncStorage.getItem(LAST_FULL_SYNC_KEY);
    if (!lastKey) return DAYS_TO_BACKFILL;
    const last = new Date(`${lastKey}T00:00:00Z`);
    if (Number.isNaN(last.getTime())) return DAYS_TO_BACKFILL;
    const gapDays = Math.floor((Date.now() - last.getTime()) / 86_400_000);
    return Math.min(MAX_DAYS_TO_BACKFILL, Math.max(1, gapDays + 1));
  } catch {
    return DAYS_TO_BACKFILL;
  }
}

/** Marks "now" as the last full sync — call after a full sync completes, not the today-only live poll. */
export async function recordFullSyncNow(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await AsyncStorage.setItem(LAST_FULL_SYNC_KEY, today).catch(() => {});
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  // en-CA gives YYYY-MM-DD directly, matching Postgres `date` text form.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

export async function upsertDailySteps(entries: { date: string; steps: number }[]): Promise<void> {
  if (entries.length === 0) return;
  // Goes through upsert_daily_steps_monotonic (see supabase/schema.sql)
  // instead of a plain upsert — HealthKit/Health Connect can revise a day's
  // total downward (a corrected overcount, a narrower sync window), and a
  // plain overwrite would make the displayed step count visibly drop. The
  // DB takes greatest(existing, incoming) atomically, under auth.uid(), so
  // it can only go up.
  const { error } = await supabase.rpc('upsert_daily_steps_monotonic', {
    p_entries: entries.map((e) => ({ date: e.date, steps: e.steps })),
  });
  // Supabase's PostgrestError is a plain object, not an Error instance —
  // `throw error` here made every caller's `err instanceof Error` check
  // fail and fall back to String(err), which stringifies it as
  // "[object Object]" instead of the actual message.
  if (error) throw new Error(error.message);
}
