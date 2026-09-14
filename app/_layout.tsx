import { useEffect } from 'react';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n';
import '@/lib/push-notifications'; // side effect only: registers the background-sync task early enough to survive a headless launch — see that file's own header comment
import { initSentry, Sentry } from '@/lib/sentry';
import { StepsConsentProvider } from '@/lib/steps-consent';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';

SplashScreen.preventAutoHideAsync().catch(() => {});
initSentry();

// Hardcoded colors, not useThemeColors() — this renders when something in
// the tree below (potentially ThemeProvider itself) has already thrown, so
// it can't depend on that tree's own context being in a working state.
function ErrorFallback({ resetError }: { resetError: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0c0a', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <Text style={{ color: '#f2f4ee', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>{t('app.error.title')}</Text>
      <Text style={{ color: '#8b9084', fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
        {t('app.error.message')}
      </Text>
      <Pressable
        onPress={resetError}
        style={{ backgroundColor: '#ccff33', paddingHorizontal: 28, paddingVertical: 13, borderRadius: 6, marginTop: 8 }}
      >
        <Text style={{ color: '#0b0c0a', fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{t('common.tryAgain')}</Text>
      </Pressable>
    </View>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback resetError={resetError} />}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <I18nProvider>
            <ThemeProvider>
              <ToastProvider>
                <SessionProvider>
                  <StepsConsentProvider>
                    <RootNavigator fontsLoaded={fontsLoaded} />
                  </StepsConsentProvider>
                </SessionProvider>
              </ToastProvider>
            </ThemeProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Sentry.ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { session, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [isLoading, fontsLoaded]);

  if (isLoading || !fontsLoaded) return null; // splash screen is still up

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
    </Stack>
  );
}
