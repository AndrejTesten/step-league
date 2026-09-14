-- Schedules the nightly-rollup Edge Function to run every 15 minutes.
-- Run this in the Supabase SQL editor AFTER deploying the function
-- (`supabase functions deploy nightly-rollup`) and setting its
-- CRON_SECRET secret (`supabase secrets set CRON_SECRET=<random-string>`).
--
-- Why every 15 minutes instead of once a day: each league resets on its
-- own fixed 24-hour cycle timestamped from when it was created
-- (leagues.next_reset_at), not at some single shared instant — the
-- function itself checks, on every run, which leagues' next_reset_at has
-- just passed (see index.ts). Deliberately not tied to any wall-clock
-- time or member's timezone, so leagues created at different moments
-- naturally reset at different times instead of clustering.

-- Note: whatever you paste into the command below (service-role key,
-- cron secret) is stored in plaintext in cron.job.command — visible to
-- anyone with SQL-editor/database access to this Supabase project, same as
-- any other value pasted into the SQL editor. Fine for a solo project,
-- worth knowing if this project ever gets other admins.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'step-league-nightly-rollup',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/nightly-rollup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR-SERVICE-ROLE-KEY>',
      'x-cron-secret', '<THE-SAME-CRON_SECRET-YOU-SET-AS-A-FUNCTION-SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check on it later:
--   select * from cron.job;                          -- see the schedule
--   select * from cron.job_run_details order by start_time desc limit 20;  -- see recent runs
-- To remove it:
--   select cron.unschedule('step-league-nightly-rollup');
