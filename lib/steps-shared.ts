import { supabase } from './supabase';

// How many past days to backfill on sync — covers "I didn't open the app
// in a few days" without pulling someone's entire multi-year HealthKit
// history every time.
export const DAYS_TO_BACKFILL = 7;

export function dateKeyInTimezone(date: Date, timezone: string): string {
  // en-CA gives YYYY-MM-DD directly, matching Postgres `date` text form.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

export async function upsertDailySteps(
  userId: string,
  entries: { date: string; steps: number }[]
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase.from('daily_steps').upsert(
    entries.map((e) => ({
      user_id: userId,
      date: e.date,
      steps: e.steps,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,date' }
  );
  if (error) throw error;
}
