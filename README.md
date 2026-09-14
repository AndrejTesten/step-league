# StepLeague

Compete with friends on daily steps. Create a league, invite people with a
code, and standings lock in on a fixed 24-hour cycle from the moment the
league was created — the same instant for every member, wherever they are.
There's also a World/Country/City leaderboard (`get_leaderboard` in
`supabase/schema.sql`, `components/home/LeaderboardsPage.tsx`) ranking
everyone by lifetime steps, no league required.

This is a working scaffold, not a finished app: the screens, auth, database
schema, and step-sync logic are all real and wired together, but you still
need to do the one-time setup below (a free Supabase project, some App
Store/Play Console housekeeping) before it runs on a phone. Read the
**Known limitations** section before you show this to real users.

## Stack

- **Expo (React Native) + expo-router** — one codebase, both platforms.
- **Supabase** — Postgres, auth, and two Edge Functions: `nightly-rollup`
  (scheduled every 15 minutes — despite the name, it resets each league on
  its own 24h cycle, not nightly; see below) and `peek-live-sync` (called
  on demand when someone opens Peek). `supabase/schema.sql` is the entire
  database.
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
3. **Edge Functions.** Install the Supabase CLI, then from this folder:
   ```
   supabase link --project-ref <your-project-ref>
   supabase functions deploy nightly-rollup
   supabase functions deploy peek-live-sync
   supabase secrets set CRON_SECRET=<pick-a-random-string>
   ```
   Use that same `CRON_SECRET` value in `schema-cron.sql`. `peek-live-sync`
   needs no extra secret — it uses Supabase's auto-provided project
   credentials.
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

## How the reset actually works

Every league gets its own `next_reset_at` timestamp (`supabase/schema.sql`),
set to `created_at + 24 hours` when the league is created and advanced by
another 24 hours every time it fires. Every 15 minutes, `nightly-rollup`
asks Postgres which leagues are actually due (`get_leagues_due_for_reset`)
and, for each one, calls `process_league_reset()` — it recomputes and
snapshots that league's whole standings in one SQL statement, mirroring
`recompute_snapshot_for_date()`'s own member/total/rank logic.

This is deliberately different from a shared wall-clock instant (e.g.
"everyone's league locks in at 22:00 UTC," or the earlier per-member-local-
22:00 design this replaced): a fixed reset time means every league created
around the same time of day would come due in the same few minutes,
regardless of scale — a "thundering herd" that gets worse the more leagues
exist. Anchoring each league's cycle to its own creation moment spreads
that load out naturally from day one, and — as a side effect — removes
timezone from league scoring entirely; `profiles.timezone` is still used,
just only for a member's *own* day boundaries (their step counter, streaks),
never for when any league resets.

About 30 minutes before a league resets, `nightly-rollup` also sends a
silent push to every member of that league (`get_leagues_due_for_presync`)
to wake the app just long enough to sync — see "Push notifications are
required" below. The same silent push is sent on demand, to every *other*
member of a league, the instant someone opens Peek (the `peek-live-sync`
Edge Function, invoked directly from `app/(app)/leagues/peek.tsx`) — so a
live peek reflects steps as of right now, not whatever last happened to
sync on its own. A member whose phone doesn't wake in time still shows
their last-known count in Peek, just flagged as not fresh instead of
silently looking authoritative.

## Known limitations

- **Push notifications are required, not optional.** Background sync in
  this app works entirely through silent pushes waking the app to sync
  (see above) — there is no other mechanism. Onboarding
  (`app/(app)/onboarding-health.tsx`) requires granting notification
  permission to continue, and the home screen / Profile show a warning
  banner with a link to Settings if permission is later revoked
  (`getNotificationStatus()` in `lib/push-notifications.ts`). Even with
  permission granted, iOS can still suspend all background execution
  (silent push delivery included) if the app is force-quit from the app
  switcher — only reopening the app, or leaving Background App Refresh on,
  fixes that; Profile links to both the relevant Settings screen and, on
  Android, the battery-optimization exemption list some OEMs need. None of
  this means missed days are lost, though: HealthKit/Health Connect keep
  recording steps on the device regardless of whether the app or its
  background task ran, and the next time the app *is* opened,
  `getDaysToBackfill()` (`lib/steps-shared.ts`) backfills exactly however
  many days it's actually been (capped at 30) instead of a fixed window. If
  that backfill lands on a day whose league standings were already locked
  in, `recompute_snapshot_for_date()` (`supabase/schema.sql`) corrects that
  snapshot too, so late-arriving real steps are never silently lost from a
  league's history.
- **A member's join-date bucketing in `process_league_reset()` uses plain
  UTC, not their own timezone** (unlike `recompute_snapshot_for_date()` and
  the client's live-total queries, which still use each member's own
  timezone for this). A brand-new member's very first snapshot can be off
  by at most one calendar day of steps as a result — a one-time cosmetic
  difference, not an ongoing correctness issue, and a deliberate simplification
  to keep league scoring's scheduling free of any per-member timezone at all.
- **RevenueCat isn't actually wired up.** `profiles.is_pro` can only be
  flipped server-side (`update profiles set is_pro = true where id =
  '<uuid>'` in the Supabase SQL editor) until real billing exists — see the
  comment at the top of `app/(app)/premium.tsx` for exactly what's missing
  (App Store Connect / Play Console products, a RevenueCat or raw
  StoreKit2/Play Billing integration).

## Monetization as shipped

Free tier: friends leagues, plus the World/Country/City leaderboards.
Premium (€1.99/mo in the paywall UI, see `app/(app)/premium.tsx`): Peek
(a few timed looks at live standings before the league's next reset,
without waiting for it), full Stat History, and the 5 extra accent color
themes.
Deliberately no ads — low eCPM for fitness apps and a bad fit for a screen
whose whole point is checking your rank against a friend.
