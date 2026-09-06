import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import { DAYS_TO_BACKFILL, dateKeyInTimezone, upsertDailySteps } from './steps-shared';
import { reportSyncFailure, reportSyncSuccess } from './sync-status';
import { startOfDayInTimezone } from './timezone';

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
 *
 * `daysToBackfill` defaults to a full week, but the frequent "live" poll
 * (see useStepSync) passes 0 to only touch today — each day here is a
 * separate native aggregateRecord() call, so backfilling 7 days on every
 * 15-second tick was 8 native Health Connect calls a poll, indefinitely,
 * which is what was piling up and eventually crashing the app.
 */
export async function syncSteps(timezone: string, daysToBackfill: number = DAYS_TO_BACKFILL): Promise<void> {
  try {
    const status = await getSdkStatus();
    if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      throw new Error('Health Connect is not installed on this device — install it from the Play Store.');
    }
    await initialize();
    const isStepsGrant = (p: { recordType?: string; accessType?: string }) =>
      p.recordType === 'Steps' && p.accessType === 'read';

    // requestPermission unconditionally launches Health Connect's own
    // permission-request Activity every time it's called — even when the
    // permission is already granted — which briefly backgrounds/foregrounds
    // our app. Doing that on every 15s sync tick was disruptive enough to
    // be worth avoiding outright: only request when genuinely not yet
    // granted.
    let hasStepsAccess = (await getGrantedPermissions()).some(isStepsGrant);
    if (!hasStepsAccess) {
      // requestPermission resolves with whatever was actually granted — it
      // does NOT reject just because the user denied it, so skipping this
      // check meant a denied/dismissed permission prompt silently produced
      // "0 steps forever" with no indication why.
      const requested = await requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
      hasStepsAccess = requested.some(isStepsGrant);
    }
    if (!hasStepsAccess) {
      throw new Error('Steps permission was denied — open Health Connect > App permissions > StepLeague and allow Steps.');
    }

    const now = new Date();
    const entries: { date: string; steps: number }[] = [];

    for (let i = 0; i <= daysToBackfill; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dateKey = dateKeyInTimezone(day, timezone);

      // Whole calendar day for this user, expressed as concrete instants —
      // in the user's own timezone, not the device's (see
      // startOfDayInTimezone's doc comment).
      const startOfDay = startOfDayInTimezone(dateKey, timezone);
      const nextDateKey = dateKeyInTimezone(new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000), timezone);
      const endOfDay = new Date(startOfDayInTimezone(nextDateKey, timezone).getTime() - 1);

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

    await upsertDailySteps(entries);
    reportSyncSuccess();
  } catch (err) {
    // Sync failures shouldn't crash the app — just means stale numbers
    // until the next successful sync. reportSyncFailure surfaces *why* on
    // the home screen instead of only in a console.warn nobody sees.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[steps.android] sync failed:', message);
    reportSyncFailure(message);
  }
}
