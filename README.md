# StepLeague

Compete with friends on daily steps. Create a league, invite people with a
code, and standings lock in every night at 22:00 — in each person's own
timezone. There's also a World/Country/City leaderboard (`get_leaderboard`
in `supabase/schema.sql`, `components/home/LeaderboardsPage.tsx`) ranking
everyone by lifetime steps, no league required.

This is a working scaffold, not a finished app: the screens, auth, database
schema, and step-sync logic are all real and wired together, but you still
need to do the one-time setup below (a free Supabase project, some App
Store/Play Console housekeeping) before it runs on a phone. Read the
**Known limitations** section before you show this to real users.

## Stack

- **Expo (React Native) + expo-router** — one codebase, both platforms.
- **Supabase** — Postgres, auth, and a scheduled Edge Function for the
  nightly rollup. `supabase/schema.sql` is the entire database.
- **HealthKit (iOS) / Health Connect (Android)** — read-only step access via
  `react-native-health` and `react-native-health-connect`.
- **i18next** — English, German, Italian, Spanish, French. `locales/*.json`,
  language picker in Profile.
- **RevenueCat** (not yet wired) — see the comment at the top of
  `app/(app)/premium.tsx` for exactly what's missing to go live.

## One-time setup

1. **Supabase project.** Create one free at supabase.com. In the SQL editor,
   run `supabase/schema.sql`, then `supabase/schema-cron.sql` (fill in your
   project ref and service role key inside it first).
2. **Environment.** `cp .env.example .env` and fill in your project's URL
   and anon key (Project Settings → API).
3. **Edge Function.** Install the Supabase CLI, then from this folder:
   ```
   supabase link --project-ref <your-project-ref>
   supabase functions deploy nightly-rollup
   supabase secrets set CRON_SECRET=<pick-a-random-string>
   ```
   Use that same `CRON_SECRET` value in `schema-cron.sql`.
4. **Install dependencies.** `npm install` (this repo already has the right
   versions pinned, so plain `npm install` — not `npx expo install` — is the
   safest way to reproduce it exactly).
5. **App identifiers.** `ios.bundleIdentifier` and `android.package` in
   `app.json` — already set to a real identifier here, change both to your
   own if you fork this.

## Running it

Because step data requires the native HealthKit / Health Connect modules,
**this app cannot run in plain Expo Go** — you need a development build:

```
npx expo prebuild
npx expo run:ios       # requires a Mac + Xcode
npx expo run:android   # requires Android Studio / an emulator or device
```

To test on a phone without a local Mac/Android Studio setup, there are two
options:

- **EAS Build** — `eas build --profile preview --platform android` (or
  `ios`) builds in the cloud and gives you an install link. Free tier has a
  monthly build-count limit per platform.
- **GitHub Actions** (`.github/workflows/build-android.yml`) — builds a
  debug-signed Android APK on a plain GitHub-hosted runner (no EAS account
  needed) and uploads it as a downloadable workflow artifact. Runs on every
  push to `main`, or manually via the Actions tab's "Run workflow" button.
  Needs two repo secrets set once (Settings → Secrets and variables →
  Actions): `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
  same values as your local `.env`.

## How the nightly update actually works

Every league member's phone syncs steps to Supabase whenever they open the
app (see `lib/use-step-sync.ts` — there's no background sync; see below). Every 15 minutes, the `nightly-rollup` Edge Function checks which
users just crossed 22:00 in *their own* timezone and, for each league that
has at least one such member, recomputes and snapshots the whole league's
standings. This means a league spanning timezones gets refreshed
asynchronously as each timezone's 22:00 arrives, rather than all at once.

## Known limitations

- **No true background step sync.** Steps sync when the app is opened or
  foregrounded, not continuously — real background sync needs
  `expo-task-manager` plus Health Connect's background-read permission
  (Android) and is unreliable-by-design on iOS (the OS throttles background
  fetch timing). This doesn't mean missed days are lost, though: HealthKit/
  Health Connect keep recording steps on the device the whole time
  regardless of whether the app is open, and the next time it *is* opened,
  `getDaysToBackfill()` (`lib/steps-shared.ts`) backfills exactly however
  many days it's actually been (capped at 30) instead of a fixed window —
  so someone who skips a week still gets fully caught up on their next
  open, not just the last 7 days. If that backfill lands on a day whose
  league standings were already locked in by the nightly rollup,
  `recompute_snapshot_for_date()` (`supabase/schema.sql`) corrects that
  day's snapshot too, so late-arriving real steps don't get silently lost
  from a league's history. There's still no way to *push* fresh steps to
  the server while the app is closed — someone who wants same-day accuracy
  still has to open the app at some point that day.
- **Timezone changes need an explicit refresh.** Captured at sign-up and
  stored on the profile; a user who travels can update it from Profile
  (`refreshTimezone()` in `lib/timezone.ts`, backed by the
  `refresh_my_timezone()` RPC — rate-limited, since this drives league
  day-boundaries). It only affects days going forward: existing
  `daily_steps` rows stay attributed to whatever date they were recorded
  under, same as everything else in this schema. Leagues spanning multiple
  timezones already work regardless of any of this — `nightly-rollup`
  recomputes a whole league's standings whenever *any* one member's local
  22:00 passes, using each member's own timezone for their own total (see
  "How the nightly update actually works" above).
- **RevenueCat isn't actually wired up.** `profiles.is_pro` can only be
  flipped server-side (`update profiles set is_pro = true where id =
  '<uuid>'` in the Supabase SQL editor) until real billing exists — see the
  comment at the top of `app/(app)/premium.tsx` for exactly what's missing
  (App Store Connect / Play Console products, a RevenueCat or raw
  StoreKit2/Play Billing integration).

## Monetization as shipped

Free tier: friends leagues, plus the World/Country/City leaderboards.
Premium (€1.99/mo in the paywall UI, see `app/(app)/premium.tsx`): Peek
(a few free timed looks at live standings before 22:00 without waiting for
the reveal), full Stat History, and the 5 extra accent color themes.
Deliberately no ads — low eCPM for fitness apps and a bad fit for a screen
whose whole point is checking your rank against a friend.
