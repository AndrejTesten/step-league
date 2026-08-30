import * as Localization from 'expo-localization';

/**
 * Best-effort IANA timezone for this device (e.g. "Europe/Ljubljana").
 * Captured once at sign-up and stored on the profile so the nightly rollup
 * function (which runs server-side, with no concept of "local time" on its
 * own) knows when 22:00 actually is for this specific user.
 *
 * Users who travel won't get this re-detected automatically in v1 — that's
 * a reasonable cut for a first release. Add a "refresh timezone" action in
 * Settings later if it matters to your users.
 */
export function getDeviceTimezone(): string {
  const calendars = Localization.getCalendars();
  return calendars[0]?.timeZone ?? 'UTC';
}
