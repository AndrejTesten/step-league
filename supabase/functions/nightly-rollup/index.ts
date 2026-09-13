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
//   1. Ask Postgres (get_due_profile_ids) which profiles are currently in
//      the 22:00-22:14 local-time window ("due" users). This runs as SQL
//      so only the due rows cross the wire, not every profile in the app.
//   2. Find just the still-active leagues (deadline >= today) that have at
//      least one due member, then fetch every member of *those* leagues
//      (not every membership in the app) plus one batched daily_steps
//      query covering all of them, and recompute each league's standings
//      fresh, writing a new snapshot row per member.
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

// Supabase's PostgREST .in() filter and the upsert payload both have
// practical size limits; chunk large id/row lists instead of sending one
// giant request that could time out or get rejected outright.
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
  const todayUtcKey = now.toISOString().slice(0, 10);

  const { data: dueProfiles, error: dueError } = await supabase.rpc('get_due_profile_ids', {
    p_now: now.toISOString(),
  });
  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  const dueUserIds = ((dueProfiles ?? []) as { id: string }[]).map((r) => r.id);
  if (dueUserIds.length === 0) {
    return new Response(JSON.stringify({ dueUsers: 0, processedLeagues: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // Which still-active leagues have at least one due member? Scope every
  // later query to just these leagues instead of the whole app's
  // league_members table.
  const leaguesToProcess = new Set<string>();
  for (const idChunk of chunk(dueUserIds, 500)) {
    const { data: dueMemberships, error: dueMembershipsError } = await supabase
      .from('league_members')
      .select('league_id, leagues!inner(deadline)')
      .in('user_id', idChunk)
      .gte('leagues.deadline', todayUtcKey);
    if (dueMembershipsError) {
      return new Response(JSON.stringify({ error: dueMembershipsError.message }), { status: 500 });
    }
    for (const row of (dueMemberships ?? []) as { league_id: string }[]) {
      leaguesToProcess.add(row.league_id);
    }
  }

  if (leaguesToProcess.size === 0) {
    return new Response(JSON.stringify({ dueUsers: dueUserIds.length, processedLeagues: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  type MemberRow = {
    league_id: string;
    user_id: string;
    joined_at: string;
    profiles: { timezone: string };
  };

  // Every member of every league that needs recomputing — not just the due
  // ones, since a league's whole leaderboard is refreshed together.
  const membersByLeague = new Map<string, MemberRow[]>();
  for (const leagueIdChunk of chunk(Array.from(leaguesToProcess), 200)) {
    const { data: memberRows, error: memberError } = await supabase
      .from('league_members')
      .select('league_id, user_id, joined_at, profiles!inner(timezone)')
      .in('league_id', leagueIdChunk);
    if (memberError) {
      return new Response(JSON.stringify({ error: memberError.message }), { status: 500 });
    }
    for (const row of (memberRows ?? []) as unknown as MemberRow[]) {
      if (!membersByLeague.has(row.league_id)) membersByLeague.set(row.league_id, []);
      membersByLeague.get(row.league_id)!.push(row);
    }
  }

  // One batched daily_steps fetch covering every member of every league in
  // scope, instead of a separate query per league.
  const allMemberUserIds = Array.from(new Set(Array.from(membersByLeague.values()).flat().map((m) => m.user_id)));
  const stepsByUser = new Map<string, { date: string; steps: number }[]>();
  for (const idChunk of chunk(allMemberUserIds, 500)) {
    const { data: stepsRows, error: stepsError } = await supabase
      .from('daily_steps')
      .select('user_id, date, steps')
      .in('user_id', idChunk);
    if (stepsError) {
      return new Response(JSON.stringify({ error: stepsError.message }), { status: 500 });
    }
    for (const row of (stepsRows ?? []) as { user_id: string; date: string; steps: number }[]) {
      if (!stepsByUser.has(row.user_id)) stepsByUser.set(row.user_id, []);
      stepsByUser.get(row.user_id)!.push({ date: row.date, steps: row.steps });
    }
  }

  type SnapshotRow = { league_id: string; user_id: string; snapshot_date: string; total_steps: number; rank: number };
  const rowsByLeague = new Map<string, SnapshotRow[]>();

  for (const [leagueId, members] of membersByLeague) {
    const joinDateByUser = new Map(
      members.map((m) => [m.user_id, dateKeyInTimezone(new Date(m.joined_at), m.profiles.timezone)])
    );

    const totals = new Map<string, number>();
    for (const m of members) {
      const joinDate = joinDateByUser.get(m.user_id);
      const rows = stepsByUser.get(m.user_id) ?? [];
      let total = 0;
      for (const r of rows) {
        if (joinDate && r.date < joinDate) continue; // before they joined
        total += r.steps;
      }
      totals.set(m.user_id, total);
    }

    const ranked = members
      .map((m) => ({ user_id: m.user_id, total_steps: totals.get(m.user_id) ?? 0 }))
      .sort((a, b) => b.total_steps - a.total_steps)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    rowsByLeague.set(
      leagueId,
      ranked.map((r) => ({
        league_id: leagueId,
        user_id: r.user_id,
        snapshot_date: todayUtcKey,
        total_steps: r.total_steps,
        rank: r.rank,
      }))
    );
  }

  // Pack whole leagues into ~500-row upsert batches — never split one
  // league's rows across two batches, so a batch failure can't leave a
  // league's ranks half old / half new.
  const batches: SnapshotRow[][] = [];
  let current: SnapshotRow[] = [];
  for (const rows of rowsByLeague.values()) {
    if (current.length > 0 && current.length + rows.length > 500) {
      batches.push(current);
      current = [];
    }
    current.push(...rows);
  }
  if (current.length > 0) batches.push(current);

  const processedLeagueIds = new Set<string>();
  for (const rowChunk of batches) {
    const { error: upsertError } = await supabase
      .from('leaderboard_snapshots')
      .upsert(rowChunk, { onConflict: 'league_id,user_id,snapshot_date' });
    if (upsertError) {
      console.error(`snapshot upsert: ${upsertError.message}`);
      continue;
    }
    for (const r of rowChunk) processedLeagueIds.add(r.league_id);
  }

  return new Response(
    JSON.stringify({
      dueUsers: dueUserIds.length,
      leaguesConsidered: leaguesToProcess.size,
      processedLeagues: processedLeagueIds.size,
    }),
    { headers: { 'content-type': 'application/json' } }
  );
});
