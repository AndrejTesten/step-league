/**
 * Pro entitlement — stub wiring point for RevenueCat.
 *
 * Why RevenueCat and not raw StoreKit/Play Billing: it gives you one API
 * for both App Store and Play Store subscriptions/IAP, handles receipt
 * validation server-side, and syncs entitlement state across devices —
 * doing that yourself is a real multi-week project on its own.
 *
 * To wire this up for real:
 *   1. npm install react-native-purchases
 *   2. Create a RevenueCat project, add your App Store Connect + Play
 *      Console app-specific shared secrets, and define a "pro" entitlement
 *      tied to a subscription or non-consumable product.
 *   3. Call Purchases.configure({ apiKey }) once, early (e.g. in the root
 *      layout, right after sign-in) using your platform-specific RevenueCat
 *      public SDK key.
 *   4. Replace purchasePro() below with:
 *        const offerings = await Purchases.getOfferings();
 *        const pkg = offerings.current?.availablePackages[0];
 *        if (pkg) await Purchases.purchasePackage(pkg);
 *   5. Replace isPro() below with a check against
 *      `customerInfo.entitlements.active['pro']`.
 *   6. Mirror the entitlement into `profiles.is_pro` (e.g. via a RevenueCat
 *      webhook -> Supabase Edge Function) so the rest of the app — which
 *      already reads profile.is_pro everywhere — doesn't need to change.
 *
 * Until then, this stub just flips a boolean on the Supabase profile
 * directly, which is enough to build and test the paywall UI and the
 * free-tier gate (see app/(app)/leagues/create.tsx) without spending a
 * cent on App Store / Play Console setup first.
 */
import { supabase } from './supabase';

export async function purchasePro(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ is_pro: true }).eq('id', userId);
  if (error) throw error;
}

export const FREE_TIER_LEAGUE_LIMIT = 1;
