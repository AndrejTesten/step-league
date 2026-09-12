import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Set these in app.json under "expo.extra", or via EAS secrets / .env at build
// time. Never commit real keys — the anon key is safe to ship in the app,
// row-level security (see supabase/schema.sql) is what actually protects data.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const supabaseUrl = extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
  extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in a .env file (see .env.example) before running the app.'
  );
}

// The session this stores includes the refresh token — long-lived
// credentials that let anyone holding them act as the signed-in user
// indefinitely. Plain AsyncStorage is unencrypted (readable via `adb backup`
// or on a rooted device), so on iOS/Android this goes through
// expo-secure-store instead, which is backed by the platform Keystore /
// Keychain. SecureStore has no web implementation, so web keeps using
// AsyncStorage (the browser preview isn't a real device to protect).
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? AsyncStorage : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
