// Supabase (PostgrestError, AuthError, StorageError, etc.) throws plain
// objects with a `.message` string — not `Error` instances — so
// `e instanceof Error` is false for essentially every error this app
// actually throws, and falls through to a useless generic fallback. This
// checks for a `.message` string on anything, not just real Errors.
export function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  return fallback;
}
