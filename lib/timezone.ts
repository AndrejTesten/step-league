import * as Localization from 'expo-localization';

import { supabase } from './supabase';

/**
 * Best-effort IANA timezone for this device (e.g. "Europe/Ljubljana").
 * Captured at sign-up and stored on the profile so the nightly rollup
 * function (which runs server-side, with no concept of "local time" on its
 * own) knows when 22:00 actually is for this specific user. Also what
 * refreshTimezone() below compares the stored value against.
 */
export function getDeviceTimezone(): string {
  const calendars = Localization.getCalendars();
  return calendars[0]?.timeZone ?? 'UTC';
}

/**
 * Updates the signed-in user's stored timezone to whatever the device
 * currently reports — for the Profile screen's "your timezone looks like
 * it changed" prompt (someone who's traveled). Goes through the
 * refresh_my_timezone() RPC (see supabase/schema.sql) rather than a plain
 * profiles update: timezone drives league day-boundaries and isn't a
 * client-writable column for that reason, and the RPC also rate-limits how
 * often this can happen. Existing daily_steps rows are never touched —
 * only which zone future syncs/rollups use for this person changes.
 */
export async function refreshTimezone(timezone: string): Promise<void> {
  const { error } = await supabase.rpc('refresh_my_timezone', { p_timezone: timezone });
  if (error) throw new Error(error.message);
}

/**
 * Milliseconds until the next 22:00 in the given IANA timezone — i.e. until
 * the nightly rollup Edge Function next locks in standings for someone on
 * this timezone (see supabase/functions/nightly-rollup). Builds two Date
 * objects from the *same* wall-clock string parsed in the browser/device's
 * own local timezone; the absolute offset error that introduces cancels out
 * when we only take the difference between them, so this stays accurate
 * without pulling in a full timezone-math library.
 */
export function msUntilNextRollup(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const localNow = new Date(`${y}-${mo}-${d}T${get('hour')}:${get('minute')}:${get('second')}`);

  const target = new Date(`${y}-${mo}-${d}T22:00:00`);
  if (target.getTime() <= localNow.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - localNow.getTime();
}

/**
 * UTC instant for local midnight (00:00:00) on `dateKey` (YYYY-MM-DD) in the
 * given IANA timezone. `new Date(\`${dateKey}T00:00:00\`)` parses as the
 * *device's* local timezone, not the timezone passed in — fine as long as
 * they match (true for most users, since profile.timezone is captured from
 * the device at signup) but wrong the moment they diverge (travel, a
 * manually-edited profile timezone), which would query HealthKit/Health
 * Connect for the wrong day window and could look like steps appearing,
 * disappearing, or landing on the wrong day.
 *
 * Two-pass convergence: guess UTC midnight, check what wall-clock time that
 * instant actually renders as in the target timezone, then correct by the
 * difference — one correction is exact except for the vanishingly rare case
 * of a DST transition landing exactly at local midnight.
 */
export function startOfDayInTimezone(dateKey: string, timezone: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const targetUtcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(targetUtcMidnight));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const renderedAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  return new Date(targetUtcMidnight - (renderedAsUtc - targetUtcMidnight));
}

// Local calendar date, not UTC — toISOString() shifts to UTC first, which
// can silently roll a date picked in a <DatePickerField> back or forward a
// day depending on the device's timezone offset.
export function toDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'updating…';
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** "3:41:08" — the design's hero countdown-to-22:00 clock, ticking every second. */
export function formatCountdownClock(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
