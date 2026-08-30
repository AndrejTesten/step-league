import { Stack } from 'expo-router';

import { useStepSync } from '@/lib/use-step-sync';

// A plain Stack keeps this to two real screens (leagues list, league detail)
// plus modals for create/join/profile — simpler than a tab bar for an app
// this small, and it's easy to add tabs later if the app grows.
export default function AppLayout() {
  useStepSync();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
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
      <Stack.Screen
        name="paywall"
        options={{ presentation: 'modal', headerShown: true, title: 'Upgrade' }}
      />
    </Stack>
  );
}
