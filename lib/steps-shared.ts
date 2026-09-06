import { supabase } from './supabase';

// How many past days to backfill on sync — covers "I didn't open the app
// in a few days" without pulling someone's entire multi-year HealthKit
// history every time.
export const DAYS_TO_BACKFILL = 7;

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
