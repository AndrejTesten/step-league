/**
 * Step data doesn't exist on the web — there's no browser equivalent of
 * HealthKit / Health Connect. This app's whole premise depends on the
 * phone's built-in pedometer, so web was never a real target platform;
 * this stub exists only so `expo start --web` doesn't crash on import
 * resolution while you're poking at UI in a browser during development.
 */
export async function syncSteps(_timezone: string, _daysToBackfill?: number): Promise<void> {
  console.warn('[steps.web] Step sync is not available on web.');
}
