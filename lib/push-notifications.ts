import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getDaysToBackfill, recordFullSyncNow } from './steps-shared';
import { syncSteps } from './steps'; // Metro resolves steps.ios.ts / steps.android.ts / steps.web.ts
import { supabase } from './supabase';

const BACKGROUND_SYNC_TASK = 'step-league-background-sync';

// Set only once requestAndRegisterPushNotifications() (or the silent retry
// below) has actually saved a push_tokens row — separate from the OS
// permission itself, since permission can be "granted" while the token
// upload still failed (offline at the time, Expo's push service briefly
// unreachable). The home-screen status banner only alarms the user over
// something they need to *act* on (denied/undetermined permission); this
// flag instead drives a silent best-effort retry for the "said yes, but
// registration hasn't actually landed yet" gap.
const REGISTERED_KEY = 'stepleague:push-registered';

// While the app IS in the foreground, a "results are in" push should still
// show as a normal alert; the silent background-sync push has no title/
// body, so there's nothing to show for it either way.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// This is the actual fix for "my league-mates should see my steps at
// 22:00 even if I never open the app that day": nightly-rollup sends a
// silent push ~30 minutes before this device's local 22:00 (see
// get_presync_due_profile_ids in supabase/schema.sql), and this task is
// what runs in response — a full backfill sync, the same one a normal app
// open would trigger, just running headlessly instead.
//
// Defined at module scope, not inside a component, so it's registered the
// instant this file is imported — including on a cold, headless launch
// triggered by the push itself when the app isn't running at all. See
// app/_layout.tsx, which imports this file for that side effect alone.
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[push] background task error:', error.message);
    return;
  }
  if (!isBackgroundSyncPayload(data)) return; // the visible results-ready push doesn't need this
  try {
    await performBackgroundSync();
  } catch (err) {
    console.warn('[push] background sync failed:', err instanceof Error ? err.message : String(err));
  }
});

// expo-notifications wraps the raw FCM/APNs payload inconsistently across
// platforms — sometimes the data we sent lands directly on `data`,
// sometimes JSON-encoded in `data.dataString`. Check both rather than
// assuming one shape.
function isBackgroundSyncPayload(data: unknown): boolean {
  const raw = data as { data?: { type?: unknown; dataString?: string } } | undefined;
  if (raw?.data?.type === 'background-sync') return true;
  if (typeof raw?.data?.dataString === 'string') {
    try {
      return JSON.parse(raw.data.dataString)?.type === 'background-sync';
    } catch {
      return false;
    }
  }
  return false;
}

async function performBackgroundSync(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;

  const { data: profileRow } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  const timezone = (profileRow as { timezone?: string } | null)?.timezone;
  if (!timezone) return;

  const days = await getDaysToBackfill();
  await syncSteps(timezone, days);
  await recordFullSyncNow();
}

// Registered once real permission is granted (see requestAndRegister
// below) — also attempted eagerly here so a background launch has the
// task wired up even if requestAndRegister() itself hasn't run yet this
// process lifetime. Harmless to call more than once; no-ops on web.
Notifications.registerTaskAsync(BACKGROUND_SYNC_TASK).catch(() => {});

export type NotificationStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Current OS notification permission — for the Profile/home "this needs fixing" banner. */
export async function getNotificationStatus(): Promise<NotificationStatus> {
  if (Platform.OS === 'web') return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/** Saves this device's Expo push token and flips on the results push — the part shared by a fresh grant and a silent retry. */
async function registerToken(userId: string): Promise<boolean> {
  if (!Device.isDevice) return false; // simulators/emulators have no real push token

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return false;

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return false; // offline, or Expo's push service unreachable right now — retried on a later app open
  }

  const { error: tokenError } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() }, { onConflict: 'token' });
  if (tokenError) return false;

  await Notifications.registerTaskAsync(BACKGROUND_SYNC_TASK).catch(() => {});

  const { error: profileError } = await supabase.from('profiles').update({ notify_results: true }).eq('id', userId);
  if (profileError) return false;

  await AsyncStorage.setItem(REGISTERED_KEY, 'true').catch(() => {});
  return true;
}

/**
 * Requests notification permission and registers this device's push
 * token. Called once from onboarding-health.tsx right after the
 * steps-access consent is granted — notifications aren't a separate
 * optional add-on here, they're what makes background sync (and
 * therefore accurate league standings for anyone who doesn't open the app
 * that day) work at all.
 *
 * Returns false if permission was denied or a token couldn't be obtained
 * — the caller decides how to react, this never throws for an expected
 * "user said no" outcome.
 */
export async function requestAndRegisterPushNotifications(userId: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Step League',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== Notifications.PermissionStatus.GRANTED) return false;

  return registerToken(userId);
}

/**
 * Best-effort, silent retry for "permission was already granted, but the
 * token never actually made it to push_tokens" (a network blip during
 * onboarding, Expo's push service being briefly unreachable). Safe to call
 * on every app open — a no-op once REGISTERED_KEY is set, and never
 * prompts for permission itself (that only ever happens once, in
 * onboarding-health.tsx). Call this from useStepSync's full-sync path.
 */
export async function ensurePushRegistration(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const alreadyRegistered = await AsyncStorage.getItem(REGISTERED_KEY).catch(() => null);
  if (alreadyRegistered === 'true') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== Notifications.PermissionStatus.GRANTED) return;
  await registerToken(userId).catch(() => {});
}
