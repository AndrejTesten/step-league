// Supabase Edge Function: nightly-rollup
//
// Deploy: supabase functions deploy nightly-rollup
// Schedule: run this every 15 minutes via pg_cron + pg_net (see
// supabase/schema-cron.sql), NOT once a day at a single fixed UTC time —
// "22:00" means a different UTC instant for every member depending on
// their own timezone, so this function has to check, every 15 minutes,
// which users just hit 22:00 local time and only act on those.
//
// What it does each run:
//   1. Find every profile whose local time is currently in the 22:00-22:14
//      window ("due" users).
//   2. For every still-active league (deadline >= today) that has at least
//      one due member, recompute the WHOLE league's standings fresh from
//      daily_steps and write a new snapshot row for every member.
//
// Recomputing the whole league (not just the due member) on every trigger
// keeps ranks consistent even when a league's members span timezones —
// whoever's 22:00 fires most recently effectively refreshes everyone's
// rank using the best data available for each person at that moment.
//
// Each member's total only counts steps from their own join date onward
// (in their own timezone) — matching the client-side fallback in
// lib/leagues.ts — so joining an established league doesn't hand anyone a
// lifetime step-count head start.

import { createClient } from 'jsr:@supabase/supabase-js@2';

function dateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function localHourMinute(date: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour: hour === 24 ? 0 : hour, minute };
}

Deno.serve(async (req) => {
  // Cheap shared-secret check so this endpoint can't be triggered by
  // randoms hammering the public URL. Set CRON_SECRET as a function secret
  // and pass the same value as a header from pg_net (see schema-cron.sql).
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // bypasses RLS — server-only key, never ship this to the app
  );

  const now = new Date();

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, timezone');
  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  const dueUserIds = new Set<string>();
  for (const p of profiles ?? []) {
    const { hour, minute } = localHourMinute(now, p.timezone ?? 'UTC');
    if (hour === 22 && minute < 15) dueUserIds.add(p.id as string);
  }

  if (dueUserIds.size === 0) {
    return new Response(JSON.stringify({ dueUsers: 0, processedLeagues: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: memberRows, error: memberError } = await supabase
    .from('league_members')
    .select('league_id, user_id, joined_at, leagues!inner(deadline), profiles!inner(timezone)');
  if (memberError) {
    return new Response(JSON.stringify({ error: memberError.message }), { status: 500 });
  }

  type MemberRow = {
    league_id: string;
    user_id: string;
    joined_at: string;
    leagues: { deadline: string };
    profiles: { timezone: string };
  };

  const todayUtcKey = now.toISOString().slice(0, 10);
  const membersByLeague = new Map<string, MemberRow[]>();
  const leaguesToProcess = new Set<string>();

  for (const row of (memberRows ?? []) as unknown as MemberRow[]) {
    if (new Date(row.leagues.deadline) < new Date(todayUtcKey)) continue; // league already ended
    if (!membersByLeague.has(row.league_id)) membersByLeague.set(row.league_id, []);
    membersByLeague.get(row.league_id)!.push(row);
    if (dueUserIds.has(row.user_id)) leaguesToProcess.add(row.league_id);
  }

  let processedLeagues = 0;

  for (const leagueId of leaguesToProcess) {
    const members = membersByLeague.get(leagueId) ?? [];
    if (members.length === 0) continue;

    const { data: stepsRows, error: stepsError } = await supabase
      .from('daily_steps')
      .select('user_id, date, steps')
      .in(
        'user_id',
        members.map((m) => m.user_id)
      );
    if (stepsError) {
      console.error(`league ${leagueId}: ${stepsError.message}`);
      continue;
    }

    const joinDateByUser = new Map(
      members.map((m) => [m.user_id, dateKeyInTimezone(new Date(m.joined_at), m.profiles.timezone)])
    );

    const totals = new Map<string, number>();
    for (const m of members) totals.set(m.user_id, 0);
    for (const row of stepsRows ?? []) {
      const joinDate = joinDateByUser.get(row.user_id as string);
      if (joinDate && (row.date as string) < joinDate) continue; // before they joined
      totals.set(row.user_id as string, (totals.get(row.user_id as string) ?? 0) + (row.steps as number));
    }

    const ranked = members
      .map((m) => ({ user_id: m.user_id, total_steps: totals.get(m.user_id) ?? 0 }))
      .sort((a, b) => b.total_steps - a.total_steps)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const { error: upsertError } = await supabase.from('leaderboard_snapshots').upsert(
      ranked.map((r) => ({
        league_id: leagueId,
        user_id: r.user_id,
        snapshot_date: todayUtcKey,
        total_steps: r.total_steps,
        rank: r.rank,
      })),
      { onConflict: 'league_id,user_id,snapshot_date' }
    );
    if (upsertError) {
      console.error(`league ${leagueId} upsert: ${upsertError.message}`);
      continue;
    }
    processedLeagues++;
  }

  return new Response(
    JSON.stringify({ dueUsers: dueUserIds.size, leaguesConsidered: leaguesToProcess.size, processedLeagues }),
    { headers: { 'content-type': 'application/json' } }
  );
});
