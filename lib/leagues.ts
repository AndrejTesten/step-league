import { supabase } from './supabase';
import type { LeagueAward, LeaderboardRow, League, LeagueRoundResult } from './types';

export async function listMyLeagues(): Promise<League[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('league_members')
    .select('leagues(*)')
    // league_members' RLS lets a member read every row in a league they
    // belong to (needed for the leaderboard), not just their own — so
    // without this filter, a league with N members returns N duplicate
    // copies of that same league here (one per member's row).
    .eq('user_id', userId)
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

/** Only the creator can call this, and only after the current round ended — enforced server-side too. */
export async function restartLeague(leagueId: string, newDeadline: string): Promise<void> {
  const { error } = await supabase.rpc('restart_league', { p_league_id: leagueId, p_new_deadline: newDeadline });
  if (error) throw error;
}

function dateKeyInTimezone(date: Date, timezone: string): string {
  // en-CA gives YYYY-MM-DD directly, which matches Postgres `date` text form.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function todayInTimezone(timezone: string): string {
  return dateKeyInTimezone(new Date(), timezone);
}

function addDaysToKey(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Reactions are a lightweight, fun extra — not worth per-member timezone
// precision, so "today" for reaction purposes is just the device's own UTC
// calendar day, shared by everyone reacting around the same time.
function reactionDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type MemberRow = {
  user_id: string;
  joined_at: string;
  profiles: { display_name: string; avatar_url: string | null; timezone: string };
};

type LeagueRoundRow = { deadline: string; current_round_start: string | null; created_at: string };

async function getCurrentRoundStart(leagueId: string): Promise<{ roundStart: string; deadline: string }> {
  const { data, error } = await supabase
    .from('leagues')
    .select('deadline, current_round_start, created_at')
    .eq('id', leagueId)
    .single();
  if (error) throw error;
  const league = data as LeagueRoundRow;
  return { roundStart: league.current_round_start ?? league.created_at.slice(0, 10), deadline: league.deadline };
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

  const { roundStart } = await getCurrentRoundStart(leagueId);

  const { data: members, error: membersError } = await supabase
    .from('league_members')
    .select('user_id, joined_at, profiles(display_name, avatar_url, timezone)')
    .eq('league_id', leagueId);
  if (membersError) throw membersError;

  const memberList = (members ?? []) as unknown as MemberRow[];

  const { data: latestSnapshotRow } = await supabase
    .from('leaderboard_snapshots')
    .select('snapshot_date')
    .eq('league_id', leagueId)
    .gte('snapshot_date', roundStart) // don't let a previous round's snapshot leak into this one
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const officialAsOf = (latestSnapshotRow as { snapshot_date: string } | null)?.snapshot_date ?? null;

  let totals = new Map<string, number>();

  // Steps only count from whichever is later: the member's own join date, or
  // the current round's start (so restarting a league doesn't hand everyone
  // a lifetime head start, and a fresh joiner doesn't get credit for days
  // before they joined).
  const effectiveStartByUser = new Map(
    memberList.map((m) => {
      const joinDate = dateKeyInTimezone(new Date(m.joined_at), m.profiles?.timezone ?? 'UTC');
      return [m.user_id, joinDate > roundStart ? joinDate : roundStart];
    })
  );

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
    // No snapshot yet — sum every day recorded so far per member.
    const { data: steps, error: stepsError } = await supabase
      .from('daily_steps')
      .select('user_id, date, steps')
      .in(
        'user_id',
        memberList.map((m) => m.user_id)
      );
    if (stepsError) throw stepsError;
    for (const row of ((steps ?? []) as { user_id: string; date: string; steps: number }[])) {
      const effectiveStart = effectiveStartByUser.get(row.user_id);
      if (effectiveStart && row.date < effectiveStart) continue;
      totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + row.steps);
    }
  }

  // Today's + yesterday's count per member (their own local calendar days).
  // One query per member — fine for friend-sized leagues (tens of people);
  // worth batching into a single `.in()` query keyed by (user_id, date)
  // pairs if you ever expect leagues in the hundreds.
  const todayByUser = new Map<string, number>();
  const yesterdayByUser = new Map<string, number>();
  for (const m of memberList) {
    const today = todayInTimezone(m.profiles?.timezone ?? 'UTC');
    const yesterday = addDaysToKey(today, -1);
    const { data: recentRows } = await supabase
      .from('daily_steps')
      .select('date, steps')
      .eq('user_id', m.user_id)
      .in('date', [today, yesterday]);
    for (const row of (recentRows ?? []) as { date: string; steps: number }[]) {
      if (row.date === today) todayByUser.set(m.user_id, row.steps);
      if (row.date === yesterday) yesterdayByUser.set(m.user_id, row.steps);
    }
  }

  const { data: reactionRows } = await supabase
    .from('reactions')
    .select('to_user_id, emoji')
    .eq('league_id', leagueId)
    .eq('date', reactionDayKey());
  const reactionsByUser = new Map<string, Map<string, number>>();
  for (const r of (reactionRows ?? []) as { to_user_id: string; emoji: string }[]) {
    const forUser = reactionsByUser.get(r.to_user_id) ?? new Map<string, number>();
    forUser.set(r.emoji, (forUser.get(r.emoji) ?? 0) + 1);
    reactionsByUser.set(r.to_user_id, forUser);
  }

  const ranked = memberList
    .map((m) => {
      const localToday = todayInTimezone(m.profiles?.timezone ?? 'UTC');
      const todaySteps = todayByUser.get(m.user_id) ?? 0;
      const yesterdaySteps = yesterdayByUser.get(m.user_id) ?? 0;
      // The snapshot already includes everything through 22:00 on
      // officialAsOf. Only fold in "today" on top of it when today is a
      // later calendar day for this member — otherwise we'd double-count.
      const liveExtra = officialAsOf && localToday > officialAsOf ? todaySteps : 0;
      const reactionMap = reactionsByUser.get(m.user_id);
      return {
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? 'Unknown',
        avatar_url: m.profiles?.avatar_url ?? null,
        total_steps: (totals.get(m.user_id) ?? 0) + liveExtra,
        is_me: m.user_id === myId,
        todaySteps,
        deltaSinceYesterday: todaySteps - yesterdaySteps,
        reactions: reactionMap
          ? Array.from(reactionMap.entries()).map(([emoji, count]) => ({ emoji, count }))
          : [],
      };
    })
    .sort((a, b) => b.total_steps - a.total_steps)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { rows: ranked, officialAsOf };
}

const REACTION_EMOJIS = ['🔥', '💪', '👏', '😅', '🐌'];

export function getReactionEmojis(): string[] {
  return REACTION_EMOJIS;
}

/** Upserts — reacting again the same day just changes your emoji. */
export async function reactToMember(leagueId: string, toUserId: string, emoji: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const fromUserId = userData.user?.id;
  if (!fromUserId) throw new Error('Not signed in.');

  const { error } = await supabase.from('reactions').upsert(
    {
      league_id: leagueId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      date: reactionDayKey(),
      emoji,
    },
    { onConflict: 'league_id,from_user_id,to_user_id,date' }
  );
  if (error) throw error;
}

export async function getMyNemesis(leagueId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('league_nemeses')
    .select('nemesis_user_id')
    .eq('league_id', leagueId)
    .maybeSingle();
  if (error) throw error;
  return (data as { nemesis_user_id: string } | null)?.nemesis_user_id ?? null;
}

export async function setMyNemesis(leagueId: string, nemesisUserId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const { error } = await supabase
    .from('league_nemeses')
    .upsert({ league_id: leagueId, user_id: userId, nemesis_user_id: nemesisUserId }, { onConflict: 'league_id,user_id' });
  if (error) throw error;
}

const AWARD_DEFS: { title: string; emoji: string; description: string }[] = [
  { title: 'The Iron Legs', emoji: '🦵', description: 'Best single day' },
  { title: 'Most Consistent', emoji: '📅', description: 'Most days logged' },
  { title: 'Biggest Comeback', emoji: '📈', description: 'Best second-half improvement' },
];

/** Fetches members + every relevant daily_steps row once, shared by awards and history. */
async function getMembersWithSteps(leagueId: string): Promise<{
  memberList: MemberRow[];
  rowsByUser: Map<string, { date: string; steps: number }[]>;
}> {
  const { data: members, error: membersError } = await supabase
    .from('league_members')
    .select('user_id, joined_at, profiles(display_name, avatar_url, timezone)')
    .eq('league_id', leagueId);
  if (membersError) throw membersError;
  const memberList = (members ?? []) as unknown as MemberRow[];
  if (memberList.length === 0) return { memberList, rowsByUser: new Map() };

  const { data: steps, error: stepsError } = await supabase
    .from('daily_steps')
    .select('user_id, date, steps')
    .in(
      'user_id',
      memberList.map((m) => m.user_id)
    );
  if (stepsError) throw stepsError;

  const rowsByUser = new Map<string, { date: string; steps: number }[]>();
  for (const row of (steps ?? []) as { user_id: string; date: string; steps: number }[]) {
    const list = rowsByUser.get(row.user_id) ?? [];
    list.push(row);
    rowsByUser.set(row.user_id, list);
  }
  return { memberList, rowsByUser };
}

/**
 * End-of-round awards, computed entirely from daily_steps for the current
 * round's window (each member's own join date, or the round's start if
 * later, through the league deadline) — no extra tables needed.
 * "Biggest Comeback" compares each member's second-half total against their
 * first-half total; whoever improved the most wins, which rewards a late
 * surge more than someone who was just consistently good the whole time
 * (that's what "Most Consistent" is for).
 */
export async function getLeagueAwards(leagueId: string): Promise<LeagueAward[]> {
  const { roundStart, deadline } = await getCurrentRoundStart(leagueId);
  const { memberList, rowsByUser } = await getMembersWithSteps(leagueId);
  if (memberList.length === 0) return [];

  let bestDayWinner = { name: '', value: -1 };
  let mostConsistentWinner = { name: '', value: -1 };
  let biggestComebackWinner = { name: '', value: -Infinity };

  for (const m of memberList) {
    const name = m.profiles?.display_name ?? 'Unknown';
    const joinDate = dateKeyInTimezone(new Date(m.joined_at), m.profiles?.timezone ?? 'UTC');
    const effectiveStart = joinDate > roundStart ? joinDate : roundStart;
    const rows = (rowsByUser.get(m.user_id) ?? [])
      .filter((r) => r.date >= effectiveStart && r.date <= deadline)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (rows.length === 0) continue;

    const bestDay = Math.max(...rows.map((r) => r.steps));
    if (bestDay > bestDayWinner.value) bestDayWinner = { name, value: bestDay };

    const daysLogged = rows.filter((r) => r.steps > 0).length;
    if (daysLogged > mostConsistentWinner.value) mostConsistentWinner = { name, value: daysLogged };

    const midpoint = Math.floor(rows.length / 2);
    const firstHalf = rows.slice(0, midpoint).reduce((sum, r) => sum + r.steps, 0);
    const secondHalf = rows.slice(midpoint).reduce((sum, r) => sum + r.steps, 0);
    const improvement = secondHalf - firstHalf;
    if (rows.length >= 4 && improvement > biggestComebackWinner.value) {
      biggestComebackWinner = { name, value: improvement };
    }
  }

  const awards: LeagueAward[] = [];
  if (bestDayWinner.value >= 0) {
    awards.push({ ...AWARD_DEFS[0], winnerName: bestDayWinner.name });
  }
  if (mostConsistentWinner.value >= 0) {
    awards.push({ ...AWARD_DEFS[1], winnerName: mostConsistentWinner.name });
  }
  if (biggestComebackWinner.value > -Infinity) {
    awards.push({ ...AWARD_DEFS[2], winnerName: biggestComebackWinner.name });
  }
  return awards;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export type LeagueScoreSeries = {
  dates: string[];
  members: { user_id: string; display_name: string; is_me: boolean }[];
  totals: Record<string, number[]>; // user_id -> cumulative total_steps, one entry per `dates`
};

const SCORE_CHART_MAX_DAYS = 60;

/**
 * Cumulative total steps per day per member for the current round, capped to
 * the most recent 60 days so a long-running league still renders a readable
 * chart. Powers the "Graph" tab on the league screen.
 */
export async function getLeagueScoreSeries(leagueId: string): Promise<LeagueScoreSeries> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const { roundStart, deadline } = await getCurrentRoundStart(leagueId);
  const { memberList, rowsByUser } = await getMembersWithSteps(leagueId);
  if (memberList.length === 0) return { dates: [], members: [], totals: {} };

  const today = new Date().toISOString().slice(0, 10);
  const end = today < deadline ? today : deadline;
  const span = daysBetween(roundStart, end);
  const start = span > SCORE_CHART_MAX_DAYS ? addDaysToKey(end, -SCORE_CHART_MAX_DAYS) : roundStart;

  const dates: string[] = [];
  for (let d = start; d <= end && dates.length <= SCORE_CHART_MAX_DAYS; d = addDaysToKey(d, 1)) {
    dates.push(d);
  }
  if (dates.length === 0) return { dates: [], members: [], totals: {} };

  const totals: Record<string, number[]> = {};
  for (const m of memberList) {
    const joinDate = dateKeyInTimezone(new Date(m.joined_at), m.profiles?.timezone ?? 'UTC');
    const effectiveStart = joinDate > roundStart ? joinDate : roundStart;
    const stepsByDate = new Map((rowsByUser.get(m.user_id) ?? []).map((r) => [r.date, r.steps]));
    let running = 0;
    totals[m.user_id] = dates.map((d) => {
      if (d >= effectiveStart) running += stepsByDate.get(d) ?? 0;
      return running;
    });
  }

  const members = memberList
    .map((m) => ({
      user_id: m.user_id,
      display_name: m.profiles?.display_name ?? 'Unknown',
      is_me: m.user_id === myId,
    }))
    .sort((a, b) => (totals[b.user_id]?.at(-1) ?? 0) - (totals[a.user_id]?.at(-1) ?? 0));

  return { dates, members, totals };
}

/**
 * Every past round of this league, most recent first, with final standings
 * recomputed from daily_steps (never deleted, so old results stay visible
 * forever even after restarting the league — see restart_league() in
 * supabase/schema.sql).
 */
export async function getLeagueHistory(leagueId: string): Promise<LeagueRoundResult[]> {
  const { data: history, error } = await supabase
    .from('league_round_history')
    .select('round_number, start_date, end_date')
    .eq('league_id', leagueId)
    .order('round_number', { ascending: false });
  if (error) throw error;
  const rounds = (history ?? []) as { round_number: number; start_date: string; end_date: string }[];
  if (rounds.length === 0) return [];

  const { memberList, rowsByUser } = await getMembersWithSteps(leagueId);

  return rounds.map((round) => {
    const standings = memberList
      .map((m) => {
        const rows = rowsByUser.get(m.user_id) ?? [];
        const total = rows
          .filter((r) => r.date >= round.start_date && r.date <= round.end_date)
          .reduce((sum, r) => sum + r.steps, 0);
        return { display_name: m.profiles?.display_name ?? 'Unknown', total_steps: total };
      })
      .sort((a, b) => b.total_steps - a.total_steps);
    return { ...round, standings };
  });
}
