import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Without this, a crash on a real phone is just "the app closed" with
// nothing you can act on — no stack trace, no idea which screen, no idea
// how many people hit it. Called once at module load (see app/_layout.tsx),
// same pattern as SplashScreen.preventAutoHideAsync() below it.
//
// No-ops entirely if EXPO_PUBLIC_SENTRY_DSN isn't set, so this is safe to
// ship even before you've created a Sentry project — see .env.example.
export function initSentry() {
  if (!dsn) {
    if (__DEV__) console.warn('[sentry] EXPO_PUBLIC_SENTRY_DSN not set — crash reporting is off.');
    return;
  }
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    // Session Replay / tracing cost quota on Sentry's free tier fast at any
    // real scale — starting conservative rather than the SDK's own default
    // of "capture everything" is the safer default to ship with.
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    sendDefaultPii: false,
  });
}

export { Sentry };
