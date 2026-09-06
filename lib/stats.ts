import { dateKeyInTimezone } from './steps-shared';
import { supabase } from './supabase';
import type { StepStats } from './types';

function addDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Today / this month / this year / all-time totals (home screen) plus the
 * best single day, current daily streak, and total days logged (feeds
 * lib/achievements.ts). One daily_steps fetch for all of it — simplest
 * option and plenty fast at friend-app scale (a few thousand rows per user
 * even after years of daily use).
 */
export async function getStepStats(userId: string, timezone: string): Promise<StepStats> {
  const { data, error } = await supabase.from('daily_steps').select('date, steps').eq('user_id', userId);
  if (error) throw error;

  const rows = (data ?? []) as { date: string; steps: number }[];
  const today = dateKeyInTimezone(new Date(), timezone);
  const monthPrefix = today.slice(0, 7); // YYYY-MM
  const yearPrefix = today.slice(0, 4); // YYYY

  const stepsByDate = new Map(rows.map((r) => [r.date, r.steps]));
  let todaySteps = 0;
  let monthSteps = 0;
  let yearSteps = 0;
  let allTime = 0;
  let bestDay = 0;
  let daysLogged = 0;

  for (const row of rows) {
    allTime += row.steps;
    if (row.steps > bestDay) bestDay = row.steps;
    if (row.steps > 0) daysLogged += 1;
    if (row.date.startsWith(yearPrefix)) yearSteps += row.steps;
    if (row.date.startsWith(monthPrefix)) monthSteps += row.steps;
    if (row.date === today) todaySteps += row.steps;
  }

  // Current streak: consecutive days with steps > 0, counting back from
  // today. A rest day today doesn't break yesterday's streak — it just
  // means today isn't part of it yet, so start from today if it already has
  // steps, otherwise from yesterday.
  let streak = 0;
  let cursor = (stepsByDate.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  while ((stepsByDate.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    today: todaySteps,
    month: monthSteps,
    year: yearSteps,
    allTime,
    bestDay,
    daysLogged,
    streak,
  };
}

/** date (YYYY-MM-DD) -> steps, for the profile screen's contribution heatmap. */
export async function getDailyStepsMap(userId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('daily_steps').select('date, steps').eq('user_id', userId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [(r as { date: string }).date, (r as { steps: number }).steps]));
}
