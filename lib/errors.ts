import { Sentry } from './sentry';

// Supabase (PostgrestError, AuthError, StorageError, etc.) throws plain
// objects with a `.message` string — not `Error` instances — so
// `e instanceof Error` is false for essentially every error this app
// actually throws, and falls through to a useless generic fallback. This
// checks for a `.message` string on anything, not just real Errors.
//
// Nearly every catch block in the app already calls this to turn a caught
// error into what the user sees — which makes it the one place that can
// report basically every real failure to Sentry (sign-in, league create/
// join, profile saves, avatar upload, ...) without adding a Sentry call to
// each of those call sites individually. `fallback` doubles as a label so
// reports are distinguishable in Sentry without re-deriving it there.
export function getErrorMessage(e: unknown, fallback: string): string {
  Sentry.captureException(e, { tags: { context: fallback } });
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  return fallback;
}
