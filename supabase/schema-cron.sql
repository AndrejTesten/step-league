-- Schedules the nightly-rollup Edge Function to run every 15 minutes.
-- Run this in the Supabase SQL editor AFTER deploying the function
-- (`supabase functions deploy nightly-rollup`) and setting its
-- CRON_SECRET secret (`supabase secrets set CRON_SECRET=<random-string>`).
--
-- Why every 15 minutes instead of once a day: league members can be in
-- different timezones, so "22:00" is a different UTC instant for each of
-- them — the function itself checks, on every run, which users just
-- crossed into their local 22:00-22:14 window (see index.ts).

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
