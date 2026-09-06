import AppleHealthKit, { type HealthValue } from 'react-native-health';

import { DAYS_TO_BACKFILL, dateKeyInTimezone, upsertDailySteps } from './steps-shared';
import { reportSyncFailure, reportSyncSuccess } from './sync-status';

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
    await new Promise<void>((resolve, reject) => {
      AppleHealthKit.initHealthKit(
        { permissions: { read: [AppleHealthKit.Constants.Permissions.StepCount], write: [] } },
        (err) => (err ? reject(new Error(err)) : resolve())
      );
    });

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
    // the home screen instead of only in a console.warn nobody sees.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[steps.ios] sync failed:', message);
    reportSyncFailure(message);
  }
}
