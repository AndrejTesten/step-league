import AppleHealthKit, { type HealthValue } from 'react-native-health';

import { DAYS_TO_BACKFILL, dateKeyInTimezone, upsertDailySteps } from './steps-shared';
import { reportSyncFailure, reportSyncSuccess } from './sync-status';
import { startOfDayInTimezone } from './timezone';

function initStepCountRead(): Promise<void> {
  return new Promise((resolve, reject) => {
    AppleHealthKit.initHealthKit(
      { permissions: { read: [AppleHealthKit.Constants.Permissions.StepCount], write: [] } },
      (err) => (err ? reject(new Error(err)) : resolve())
    );
  });
}

/**
 * Step sync for iOS — reads whatever HealthKit already has and upserts it
 * into `daily_steps`. We only ever read StepCount; no write permission is
 * requested.
 *
 * LIMITATION: this only runs when the app is opened (see the `useStepSync`
 * hook used by the (app) layout). True background sync would need iOS
 * background fetch, which the OS throttles unreliably and won't run at a
 * guaranteed time — not worth the complexity for a v1. Tell users in
 * onboarding to open the app once before bed so tonight's steps are synced
 * before the 22:00 rollup.
 *
 * `daysToBackfill` defaults to a full week; the frequent "live" poll (see
 * useStepSync) passes 0 to only re-fetch today, keeping the frequent path
 * cheap even though HealthKit itself returns a whole range in one call.
 */
export async function syncSteps(timezone: string, daysToBackfill: number = DAYS_TO_BACKFILL): Promise<void> {
  try {
    await initStepCountRead();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToBackfill);

    const samples = await new Promise<HealthValue[]>((resolve, reject) => {
      AppleHealthKit.getDailyStepCountSamples(
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        (err, results) => (err ? reject(new Error(err)) : resolve(results ?? []))
      );
    });

    // HealthKit can return multiple samples per day (one per source app);
    // collapse into one total per calendar day in the user's own timezone.
    const totals = new Map<string, number>();
    for (const sample of samples) {
      const key = dateKeyInTimezone(new Date(sample.startDate), timezone);
      totals.set(key, (totals.get(key) ?? 0) + sample.value);
    }

    await upsertDailySteps(Array.from(totals, ([date, steps]) => ({ date, steps: Math.round(steps) })));
    reportSyncSuccess();
  } catch (err) {
    // Sync failures shouldn't crash the app — just means stale numbers
    // until the next successful sync. reportSyncFailure surfaces *why* on
    // the home screen (as a code, not this raw message — see sync-status.ts)
    // instead of only in a console.warn nobody sees.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[steps.ios] sync failed:', message);
    reportSyncFailure(err);
  }
}

/**
 * Steps bucketed by local hour-of-day (24 entries, index 0 = midnight) for
 * one calendar day — powers the stats screen's Day view. Uses the raw
 * HealthKit samples (getSamples), not getDailyStepCountSamples — HealthKit
 * itself records step counts as many short intervals throughout the day
 * (roughly every 10-20 minutes from the motion coprocessor), so bucketing
 * those by the hour their interval starts in gives a real hourly
 * distribution. Returns null if HealthKit access fails for any reason (no
 * permission, not available) so the caller can show an empty state instead
 * of a misleading all-zero chart.
 */
export async function getHourlySteps(dateKey: string, timezone: string): Promise<number[] | null> {
  try {
    await initStepCountRead();

    const start = startOfDayInTimezone(dateKey, timezone);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    // react-native-health types getSamples' `type` field as HealthObserver
    // (an internal enum for the change-observer API) even though the same
    // string constants from Constants.Permissions are what every other
    // getXSamples call in this library actually accepts here — the library's
    // own d.ts is just imprecise on this one field.
    const samples = await new Promise<HealthValue[]>((resolve, reject) => {
      AppleHealthKit.getSamples(
        { type: 'StepCount' as never, startDate: start.toISOString(), endDate: end.toISOString() },
        (err, results) => (err ? reject(new Error(err)) : resolve(results ?? []))
      );
    });

    const hours = new Array(24).fill(0);
    for (const sample of samples) {
      const hourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(new Date(sample.startDate));
      const hour = Number(hourStr) % 24;
      hours[hour] += sample.value;
    }
    return hours.map((h) => Math.round(h));
  } catch (err) {
    console.warn('[steps.ios] getHourlySteps failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
