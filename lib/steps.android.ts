import {
  aggregateRecord,
  getSdkStatus,
  initialize,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import { DAYS_TO_BACKFILL, dateKeyInTimezone, upsertDailySteps } from './steps-shared';

/**
 * Step sync for Android — reads whatever Health Connect already has and
 * upserts it into `daily_steps`. We only ever read Steps; no write
 * permission is requested.
 *
 * LIMITATION: this only runs when the app is opened (see the `useStepSync`
 * hook used by the (app) layout). Health Connect does support a background
 * read permission for always-on sync, but it needs its own Play Console
 * declaration and review — worth adding once this has real users, not
 * needed to ship v1. Tell users in onboarding to open the app once before
 * bed so tonight's steps are synced before the 22:00 rollup.
 */
export async function syncSteps(userId: string, timezone: string): Promise<void> {
  try {
    const status = await getSdkStatus();
    if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      throw new Error('Health Connect is not installed/available on this device.');
    }
    await initialize();
    await requestPermission([{ accessType: 'read', recordType: 'Steps' }]);

    const now = new Date();
    const entries: { date: string; steps: number }[] = [];

    for (let i = 0; i <= DAYS_TO_BACKFILL; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dateKey = dateKeyInTimezone(day, timezone);

      // Whole calendar day for this user, expressed as concrete instants.
      const startOfDay = new Date(`${dateKey}T00:00:00`);
      const endOfDay = new Date(`${dateKey}T23:59:59.999`);

      const aggregate = await aggregateRecord({
        recordType: 'Steps',
        timeRangeFilter: {
          operator: 'between',
          startTime: startOfDay.toISOString(),
          endTime: endOfDay.toISOString(),
        },
      });
      entries.push({ date: dateKey, steps: aggregate.COUNT_TOTAL ?? 0 });
    }

    await upsertDailySteps(userId, entries);
  } catch (err) {
    // Sync failures shouldn't crash the app — just means stale numbers
    // until the next successful sync.
    console.warn('[steps.android] sync failed:', err instanceof Error ? err.message : err);
  }
}
