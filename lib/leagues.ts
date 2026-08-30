import { supabase } from './supabase';
import type { LeaderboardRow, League } from './types';

export async function listMyLeagues(): Promise<League[]> {
  const { data, error } = await supabase
    .from('league_members')
    .select('leagues(*)')
    .order('joined_at', { ascending: false });
  if (error) throw error;
  // Supabase returns the joined row nested under the relation name.
  return (data ?? []).map((row) => (row as unknown as { leagues: League }).leagues).filter(Boolean);
}

export async function createLeague(name: string, deadline: string): Promise<League> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('leagues')
    .insert({ name, deadline, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data as League;
}

export async function previewLeague(inviteCode: string) {
  const { data, error } = await supabase
    .rpc('get_league_preview', { p_invite_code: inviteCode })
    .single();
  if (error) throw error;
  return data as { id: string; name: string; deadline: string; member_count: number };
}

export async function joinLeague(inviteCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_league', { p_invite_code: inviteCode });
  if (error) throw error;
  return data as string;
}

function dateKeyInTimezone(date: Date, timezone: string): string {
  // en-CA gives YYYY-MM-DD directly, which matches Postgres `date` text form.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function todayInTimezone(timezone: string): string {
  return dateKeyInTimezone(new Date(), timezone);
}

/**
 * The leaderboard for a league right now.
 *
 * Official rank comes from last night's 22:00 snapshot (see
 * supabase/functions/nightly-rollup). Until the first snapshot exists — a
 * league is at most a few hours old — we fall back to summing daily_steps
 * directly so the screen isn't empty on day one. Either way we also show
 * each member's steps so far today, which haven't been counted yet.
 */
export async function getLeaderboard(leagueId: string): Promise<{
  rows: LeaderboardRow[];
  officialAsOf: string | null;
}> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const { data: members, error: membersError } = await supabase
    .from('league_members')
    .select('user_id, joined_at, profiles(display_name, timezone)')
    .eq('league_id', leagueId);
  if (membersError) throw membersError;

  const memberList = (members ?? []) as unknown as {
    user_id: string;
    joined_at: string;
    profiles: { display_name: string; timezone: string };
  }[];

  const { data: latestSnapshotRow } = await supabase
    .from('leaderboard_snapshots')
    .select('snapshot_date')
    .eq('league_id', leagueId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const officialAsOf = (latestSnapshotRow as { snapshot_date: string } | null)?.snapshot_date ?? null;

  let totals = new Map<string, number>();

  if (officialAsOf) {
    const { data: snapshots, error: snapshotError } = await supabase
      .from('leaderboard_snapshots')
      .select('user_id, total_steps')
      .eq('league_id', leagueId)
      .eq('snapshot_date', officialAsOf);
    if (snapshotError) throw snapshotError;
    for (const row of snapshots ?? []) {
      totals.set((row as { user_id: string }).user_id, (row as { total_steps: number }).total_steps);
    }
  } else {
    // No snapshot yet — sum every day recorded so far per member. Steps are
    // only counted from each member's own join date onward (in their own
    // timezone), so someone who's used the app for months elsewhere doesn't
    // walk into a brand-new friend league with a lifetime head start.
    const { data: steps, error: stepsError } = await supabase
      .from('daily_steps')
      .select('user_id, date, steps')
      .in(
        'user_id',
        memberList.map((m) => m.user_id)
      );
    if (stepsError) throw stepsError;
    const joinDateByUser = new Map(
      memberList.map((m) => [m.user_id, dateKeyInTimezone(new Date(m.joined_at), m.profiles?.timezone ?? 'UTC')])
    );
    for (const row of steps ?? []) {
      const r = row as { user_id: string; date: string; steps: number };
      const joinDate = joinDateByUser.get(r.user_id);
      if (joinDate && r.date < joinDate) continue; // before they joined this league
      totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + r.steps);
    }
  }

  // Today's live count per member (their own local "today", not yet in the
  // total above). One query per member — fine for friend-sized leagues
  // (tens of people); worth batching into a single `.in()` query keyed by
  // (user_id, date) pairs if you ever expect leagues in the hundreds.
  const todayByUser = new Map<string, number>();
  for (const m of memberList) {
    const today = todayInTimezone(m.profiles?.timezone ?? 'UTC');
    const { data: todayRow } = await supabase
      .from('daily_steps')
      .select('steps')
      .eq('user_id', m.user_id)
      .eq('date', today)
      .maybeSingle();
    todayByUser.set(m.user_id, (todayRow as { steps: number } | null)?.steps ?? 0);
  }

  const ranked = memberList
    .map((m) => {
      const localToday = todayInTimezone(m.profiles?.timezone ?? 'UTC');
      // The snapshot already includes everything through 22:00 on
      // officialAsOf. Only fold in "today" on top of it when today is a
      // later calendar day for this member — otherwise we'd double-count.
      const liveExtra =
        officialAsOf && localToday > officialAsOf ? todayByUser.get(m.user_id) ?? 0 : 0;
      return {
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? 'Unknown',
        total_steps: (totals.get(m.user_id) ?? 0) + liveExtra,
        is_me: m.user_id === myId,
      };
    })
    .sort((a, b) => b.total_steps - a.total_steps)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { rows: ranked, officialAsOf };
}
