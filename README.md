# StepLeague

Compete with friends on daily steps. Create a league, invite people with a
code, and standings lock in every night at 22:00 — in each person's own
timezone.

This is a working scaffold, not a finished app: the screens, auth, database
schema, and step-sync logic are all real and wired together, but you still
need to do the one-time setup below (a free Supabase project, some App
Store/Play Console housekeeping) before it runs on a phone. Read the
**Known limitations** section before you show this to real users — a couple
of the cuts were deliberate trade-offs to keep v1 shippable.

## Stack

- **Expo (React Native) + expo-router** — one codebase, both platforms.
- **Supabase** — Postgres, auth, and a scheduled Edge Function for the
  nightly rollup. `supabase/schema.sql` is the entire database.
- **HealthKit (iOS) / Health Connect (Android)** — read-only step access via
  `react-native-health` and `react-native-health-connect`.
- **RevenueCat** (not yet wired) — see `lib/purchases.ts` for the stub and
  exactly what to change to go live.

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
5. **App identifiers.** Change `com.yourcompany.stepleague` in `app.json`
   (both `ios.bundleIdentifier` and `android.package`) to your own.

## Running it

Because step data requires the native HealthKit / Health Connect modules,
**this app cannot run in plain Expo Go** — you need a development build:

```
npx expo prebuild
npx expo run:ios       # requires a Mac + Xcode
npx expo run:android   # requires Android Studio / an emulator or device
```

Or build a shareable dev client with EAS (`eas build --profile development`)
so you don't need Xcode/Android Studio locally.

## How the nightly update actually works

Every league member's phone syncs steps to Supabase whenever they open the
app (see `lib/use-step-sync.ts` — there's no background sync in v1; see
below). Every 15 minutes, the `nightly-rollup` Edge Function checks which
users just crossed 22:00 in *their own* timezone and, for each league that
has at least one such member, recomputes and snapshots the whole league's
standings. This means a league spanning timezones gets refreshed
asynchronously as each timezone's 22:00 arrives, rather than all at once.

## Known limitations (deliberate v1 cuts)

- **No background step sync.** Steps sync when the app is opened or
  foregrounded, not continuously. True background sync needs
  `expo-task-manager` plus Health Connect's background-read permission
  (Android) and is unreliable-by-design on iOS (the OS throttles background
  fetch timing). Tell users in onboarding to open the app once before bed.
- **No town/country leaderboard.** This was in the original ask but cut on
  purpose — a public geographic leaderboard needs real scale to mean
  anything, plus anti-cheat (HealthKit lets other apps write fabricated step
  data) and moderation that a friends-only league doesn't. Ship friends
  leagues, add this later if you get traction.
- **Timezone is captured once, at sign-up.** A user who moves to a new
  timezone keeps their old one until you add a "refresh timezone" action.
- **RevenueCat isn't actually wired up** — `lib/purchases.ts` flips a
  boolean directly on the Supabase profile so you can build/test the
  paywall UI without first setting up App Store Connect / Play Console
  products. See that file for the exact steps to make it real.

## Monetization as shipped

Free tier: one active league at a time. Pro ($2.99/mo in the stub UI):
unlimited concurrent leagues, streak insurance, full history — see
`app/(app)/paywall.tsx` and the gate in `app/(app)/leagues/create.tsx`.
Deliberately no ads — low eCPM for fitness apps and a bad fit for a screen
whose whole point is checking your rank against a friend.
