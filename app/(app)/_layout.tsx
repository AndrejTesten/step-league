import { Redirect, Stack, useSegments } from 'expo-router';

import { useSession } from '@/lib/auth-context';
import { useStepSync } from '@/lib/use-step-sync';

// A plain Stack keeps this to two real screens (leagues list, league detail)
// plus modals for create/join/profile — simpler than a tab bar for an app
// this small, and it's easy to add tabs later if the app grows.
export default function AppLayout() {
  useStepSync();
  const { profile } = useSession();
  const segments = useSegments();
  const onOnboarding = segments[segments.length - 1] === 'onboarding-location';

  // First sign-in (or any account created before city/country existed)
  // gets routed straight to onboarding-location until it's filled in — the
  // City/Country leaderboard tabs need it and there's no good default.
  if (profile && (!profile.city || !profile.country) && !onOnboarding) {
    return <Redirect href="/onboarding-location" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="onboarding-location"
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="leagues/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen
        name="leagues/create"
        options={{ presentation: 'modal', headerShown: true, title: 'New league' }}
      />
      <Stack.Screen
        name="leagues/join"
        options={{ presentation: 'modal', headerShown: true, title: 'Join a league' }}
      />
      <Stack.Screen
        name="profile"
        options={{ presentation: 'modal', headerShown: true, title: 'Profile' }}
      />
    </Stack>
  );
}
