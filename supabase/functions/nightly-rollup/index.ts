// Supabase Edge Function: nightly-rollup
//
// Deploy: supabase functions deploy nightly-rollup
// Schedule: every 15 minutes via pg_cron + pg_net (see
// supabase/schema-cron.sql). Despite the name (kept as-is so an existing
// deployment/cron job doesn't need reconfiguring), this no longer runs
// "nightly" at all — each league now resets on its own fixed 24-hour
// cycle timestamped from when it was created (leagues.next_reset_at),
// instead of every member's local 22:00.
//
// Why: clustering every reset around member-timezone-local-22:00 meant
// leagues full of people in similar timezones could all come due in the
// same few minutes — a "thundering herd" that gets worse as the app
// grows. Spreading resets across each league's own creation moment
// instead means the load is naturally spread out from day one, and league
// scoring no longer reads profiles.timezone at all (still used for a
// member's *personal* day boundaries — the step counter, streaks — just
// not for this).
//
// What it does each run:
//   1. Send a silent "sync now" push to every member of a league whose
//      next_reset_at is 0-30 minutes away (get_leagues_due_for_presync) —
//      the fix for "my league-mates should see my steps at reset time
//      even if I never open the app that day." See
//      lib/push-notifications.ts for the client side that handles this
//      push.
//   2. Ask Postgres (get_leagues_due_for_reset) which leagues are
//      actually due (next_reset_at has passed) and still active, then
//      call process_league_reset() once per league — it does the actual
//      recompute-and-snapshot in SQL (mirrors recompute_snapshot_for_date's
//      logic) and advances that league's next_reset_at by another 24
//      hours.
//   3. Send a visible "results are in" push, naming the league, to
//      members of a just-processed league who opted into
//      profiles.notify_results.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { chunk, sendExpoPushMessages, type PushMessage } from '../_shared/push.ts';

Deno.serve(async (req) => {
  // Cheap shared-secret check so this endpoint can't be triggered by
  // randoms hammering the public URL. Set CRON_SECRET as a function secret
  // and pass the same value as a header from pg_net (see schema-cron.sql).
  // Fails closed, not open: a misconfigured/missing secret must not leave
  // this service-role-backed endpoint publicly triggerable.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    return new Response('CRON_SECRET is not configured', { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // bypasses RLS — server-only key, never ship this to the app
  );

  const now = new Date();

  // Step 1: wake-and-sync push for every member of a league resetting in
  // the next 0-30 minutes — see get_leagues_due_for_presync's own comment
  // for why. Runs unconditionally, independent of whether any league is
  // actually *due* this tick, so a failure here never blocks step 2 below.
  let presyncPushesSent = 0;
  const { data: presyncLeagues, error: presyncError } = await supabase.rpc('get_leagues_due_for_presync', {
    p_now: now.toISOString(),
  });
  if (presyncError) {
    console.error(`get_leagues_due_for_presync: ${presyncError.message}`);
  } else {
    const presyncLeagueIds = ((presyncLeagues ?? []) as { id: string }[]).map((r) => r.id);
    if (presyncLeagueIds.length > 0) {
      const memberIds = new Set<string>();
      for (const idChunk of chunk(presyncLeagueIds, 200)) {
        const { data: memberRows, error: memberError } = await supabase
          .from('league_members')
          .select('user_id')
          .in('league_id', idChunk);
        if (memberError) {
          console.error(`league_members (presync): ${memberError.message}`);
          continue;
        }
        for (const row of (memberRows ?? []) as { user_id: string }[]) memberIds.add(row.user_id);
      }
      for (const idChunk of chunk(Array.from(memberIds), 500)) {
        const { data: tokenRows, error: tokenError } = await supabase
          .from('push_tokens')
          .select('token')
          .in('user_id', idChunk);
        if (tokenError) {
          console.error(`push_tokens (presync): ${tokenError.message}`);
          continue;
        }
        const messages: PushMessage[] = ((tokenRows ?? []) as { token: string }[]).map((r) => ({
          to: r.token,
          data: { type: 'background-sync' },
          priority: 'high',
          _contentAvailable: true,
          // No title/body/sound — a silent, data-only push. It should
          // never show anything; it exists purely to wake the app's
          // background handler (see lib/push-notifications.ts) so it can
          // sync steps.
        }));
        await sendExpoPushMessages(messages);
        presyncPushesSent += messages.length;
      }
    }
  }

  // Step 2: process every league that's actually due.
  const { data: dueLeagues, error: dueError } = await supabase.rpc('get_leagues_due_for_reset', {
    p_now: now.toISOString(),
  });
  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message, presyncPushesSent }), { status: 500 });
  }

  const dueLeagueIds = ((dueLeagues ?? []) as { id: string }[]).map((r) => r.id);
  const processedLeagueIds: string[] = [];
  for (const leagueId of dueLeagueIds) {
    const { error: resetError } = await supabase.rpc('process_league_reset', { p_league_id: leagueId });
    if (resetError) {
      console.error(`process_league_reset(${leagueId}): ${resetError.message}`);
      continue;
    }
    processedLeagueIds.push(leagueId);
  }

  if (processedLeagueIds.length === 0) {
    return new Response(
      JSON.stringify({ presyncPushesSent, leaguesDue: dueLeagueIds.length, processedLeagues: 0, resultsPushesSent: 0 }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  // Step 3: the optional visible "results are in" push, per league just
  // processed, for members who turned it on (profiles.notify_results —
  // set client-side right after granting notification permission, see
  // app/(app)/onboarding-health.tsx).
  let resultsPushesSent = 0;
  const { data: leagueRows, error: leagueNameError } = await supabase
    .from('leagues')
    .select('id, name')
    .in('id', processedLeagueIds);
  if (leagueNameError) console.error(`leagues (results push): ${leagueNameError.message}`);
  const nameById = new Map(((leagueRows ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  for (const leagueId of processedLeagueIds) {
    const { data: memberRows, error: memberError } = await supabase
      .from('league_members')
      .select('user_id, profiles!inner(notify_results)')
      .eq('league_id', leagueId)
      .eq('profiles.notify_results', true);
    if (memberError) {
      console.error(`league_members (results push, ${leagueId}): ${memberError.message}`);
      continue;
    }
    const optedInIds = ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (optedInIds.length === 0) continue;

    const { data: tokenRows, error: tokenError } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', optedInIds);
    if (tokenError) {
      console.error(`push_tokens (results, ${leagueId}): ${tokenError.message}`);
      continue;
    }
    const leagueName = nameById.get(leagueId) ?? 'your league';
    const messages: PushMessage[] = ((tokenRows ?? []) as { token: string }[]).map((r) => ({
      to: r.token,
      title: 'Results are in',
      body: `${leagueName}'s standings just updated — open Step League to see where you land.`,
      sound: 'default',
      priority: 'high',
      data: { type: 'results-ready' },
    }));
    await sendExpoPushMessages(messages);
    resultsPushesSent += messages.length;
  }

  return new Response(
    JSON.stringify({
      presyncPushesSent,
      leaguesDue: dueLeagueIds.length,
      processedLeagues: processedLeagueIds.length,
      resultsPushesSent,
    }),
    { headers: { 'content-type': 'application/json' } }
  );
});
