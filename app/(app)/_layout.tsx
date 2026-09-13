import { Redirect, Stack, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/lib/auth-context';
import { useStepsConsent } from '@/lib/steps-consent';
import { theme, useThemeColors } from '@/lib/theme';
import { useStepSync } from '@/lib/use-step-sync';

// A plain Stack keeps this to two real screens (leagues list, league detail)
// plus modals for create/join/profile — simpler than a tab bar for an app
// this small, and it's easy to add tabs later if the app grows.
export default function AppLayout() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { consentGiven } = useStepsConsent();
  useStepSync(consentGiven === true);
  const colors = useThemeColors();
  const segments = useSegments();
  const lastSegment = segments[segments.length - 1];
  const onOnboardingLocation = lastSegment === 'onboarding-location';
  const onOnboardingHealth = lastSegment === 'onboarding-health';

  // First sign-in (or any account created before city/country existed)
  // gets routed straight to onboarding-location until it's filled in — the
  // City/Country leaderboard tabs need it and there's no good default.
  if (profile && (!profile.city || !profile.country) && !onOnboardingLocation && !onOnboardingHealth) {
    return <Redirect href="/onboarding-location" />;
  }

  // Steps consent comes after location, before anything that could trigger
  // the native Health Connect/HealthKit permission dialog (see
  // useStepSync above). consentGiven is undefined while AsyncStorage is
  // still loading — wait rather than flash this redirect.
  if (
    profile &&
    profile.city &&
    profile.country &&
    consentGiven === false &&
    !onOnboardingLocation &&
    !onOnboardingHealth
  ) {
    return <Redirect href="/onboarding-health" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Native-stack headers default to the OS light chrome regardless of
        // our own theme — without this every modal (Profile, league detail,
        // create/join/share, stats) showed a plain white bar with black text
        // on top of the app's dark screens.
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontFamily: theme.fontFamily.bodySemiBold, fontSize: 16 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="onboarding-location"
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen
        name="onboarding-health"
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="leagues/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen
        name="leagues/create"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.newLeague') }}
      />
      <Stack.Screen
        name="leagues/join"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.joinLeague') }}
      />
      <Stack.Screen
        name="leagues/results"
        options={{ presentation: 'modal', headerShown: false, gestureEnabled: true }}
      />
      <Stack.Screen
        name="leagues/share"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.shareResults') }}
      />
      <Stack.Screen name="stats" options={{ headerShown: true, title: t('nav.yourStats') }} />
      <Stack.Screen name="stats-history" options={{ headerShown: false }} />
      <Stack.Screen
        name="profile"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.profile') }}
      />
      <Stack.Screen
        name="theme-picker"
        options={{ presentation: 'modal', headerShown: true, title: t('nav.appearance') }}
      />
      <Stack.Screen
        name="premium"
        options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade' }}
      />
      <Stack.Screen
        name="leagues/peek"
        options={{ presentation: 'modal', headerShown: false, gestureEnabled: true }}
      />
    </Stack>
  );
}
