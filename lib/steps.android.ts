import {
  aggregateGroupByDuration,
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';

import { DAYS_TO_BACKFILL, dateKeyInTimezone, upsertDailySteps } from './steps-shared';
import { reportSyncFailure, reportSyncSuccess, UserFacingSyncError } from './sync-status';
import { startOfDayInTimezone } from './timezone';

/**
 * Step sync for Android — reads whatever Health Connect already has and
 * upserts it into `daily_steps`. We only ever read Steps; no write
 * permission is requested.
 *
 * LIMITATION: this only runs when the app is opened in the foreground, or
 * woken headlessly by a silent push (see lib/push-notifications.ts) —
 * there's no continuous background poll. Health Connect does support a
 * background read permission for always-on sync, but it needs its own Play
 * Console declaration and review — worth adding once this has real users,
 * not needed to ship v1. The silent-push mechanism covers the common case
 * today: nightly-rollup wakes the app ~30 minutes before a league resets,
 * so steps are usually synced before it locks in without the user having
 * to do anything.
 *
 * `daysToBackfill` defaults to a full week, but the frequent "live" poll
 * (see useStepSync) passes 0 to only touch today — each day here is a
 * separate native aggregateRecord() call, so backfilling 7 days on every
 * 15-second tick was 8 native Health Connect calls a poll, indefinitely,
 * which is what was piling up and eventually crashing the app.
 */
async function ensureStepsAccess(): Promise<void> {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new UserFacingSyncError('health_connect_missing', 'Health Connect is not installed on this device.');
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
    throw new UserFacingSyncError('permission_denied', 'Steps permission was denied.');
  }
}

export async function syncSteps(timezone: string, daysToBackfill: number = DAYS_TO_BACKFILL): Promise<void> {
  try {
    await ensureStepsAccess();

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
    // the home screen (as a code, not this raw message — see sync-status.ts)
    // instead of only in a console.warn nobody sees.
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[steps.android] sync failed:', message);
    reportSyncFailure(err);
  }
}

/**
 * Steps bucketed by local hour-of-day (24 entries, index 0 = midnight) for
 * one calendar day — powers the stats screen's Day view. Health Connect's
 * aggregateGroupByDuration does the hourly bucketing natively in one call,
 * unlike iOS where we bucket raw samples ourselves. Returns null if Health
 * Connect access fails for any reason so the caller can show an empty state
 * instead of a misleading all-zero chart.
 */
export async function getHourlySteps(dateKey: string, timezone: string): Promise<number[] | null> {
  try {
    await ensureStepsAccess();

    const startOfDay = startOfDayInTimezone(dateKey, timezone);
    const nextDateKey = dateKeyInTimezone(new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000), timezone);
    const endOfDay = startOfDayInTimezone(nextDateKey, timezone);

    const groups = await aggregateGroupByDuration({
      recordType: 'Steps',
      timeRangeFilter: {
        operator: 'between',
        startTime: startOfDay.toISOString(),
        endTime: endOfDay.toISOString(),
      },
      timeRangeSlicer: { duration: 'HOURS', length: 1 },
    });

    const hours = new Array(24).fill(0);
    for (const group of groups) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).format(
          new Date(group.startTime)
        )
      ) % 24;
      hours[hour] += group.result.COUNT_TOTAL ?? 0;
    }
    return hours;
  } catch (err) {
    console.warn('[steps.android] getHourlySteps failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
