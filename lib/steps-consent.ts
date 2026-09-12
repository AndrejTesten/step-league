import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, createElement, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

// Whether the user has been through the in-app "why we want your steps"
// consent screen (app/(app)/onboarding-health.tsx) — shown once, before the
// OS's own Health Connect / HealthKit permission dialog ever appears, so
// people see a plain-language explanation before the native prompt rather
// than a bare system dialog with no context.
//
// Stored locally (not in the profiles table) on purpose: the underlying OS
// permission itself is per-device, not per-account, so a fresh install or a
// second device correctly sees this screen again — that's the right
// behavior, not a bug to sync away.
//
// This lives behind a Context (like ThemeProvider/SessionProvider below)
// rather than a plain hook, because both app/(app)/_layout.tsx (the redirect
// guard) and onboarding-health.tsx (the screen that grants it) need to see
// the *same* value the instant it changes — two independent useState copies
// each reading AsyncStorage on their own mount go stale relative to each
// other, which is exactly what caused a redirect loop between this screen
// and the layout guard when they disagreed about whether consent was given.
const CONSENT_KEY = 'stepleague:steps-consent-v1';
const NOTIFY_KEY = 'stepleague:steps-consent-notify-v1';

type StepsConsentContextValue = {
  /** `undefined` while the AsyncStorage read is in flight — treat as "don't know yet" and avoid redirecting either way until it resolves. */
  consentGiven: boolean | undefined;
  setConsentGiven: (granted: boolean, notifyOptIn: boolean) => void;
};

const StepsConsentContext = createContext<StepsConsentContextValue | null>(null);

export function StepsConsentProvider({ children }: PropsWithChildren) {
  const [consentGiven, setConsentGivenState] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY).then((value) => {
      setConsentGivenState(value === 'granted');
    });
  }, []);

  function setConsentGiven(granted: boolean, notifyOptIn: boolean) {
    setConsentGivenState(granted);
    AsyncStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'declined').catch(() => {});
    AsyncStorage.setItem(NOTIFY_KEY, notifyOptIn ? 'true' : 'false').catch(() => {});
  }

  const value = useMemo(() => ({ consentGiven, setConsentGiven }), [consentGiven]);

  return createElement(StepsConsentContext.Provider, { value }, children);
}

export function useStepsConsent(): StepsConsentContextValue {
  const ctx = useContext(StepsConsentContext);
  if (!ctx) throw new Error('useStepsConsent must be used within a StepsConsentProvider');
  return ctx;
}
