import { supabase } from './supabase';
import type {
  LeagueAward,
  LeaderboardRow,
  League,
  LeagueDailyResult,
  LeagueMessage,
  LeaguePlayedSummary,
  LeagueRoundResult,
  LeagueScoringMode,
  PeekResult,
  PeekStatus,
  PublicLeaguePreview,
} from './types';

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

export async function createLeague(
  name: string,
  deadline: string,
  options?: { scoringMode?: LeagueScoringMode; isPublic?: boolean; winnerStakes?: string; loserStakes?: string }
): Promise<League> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('leagues')
    .insert({
      name,
      deadline,
      created_by: userId,
      scoring_mode: options?.scoringMode ?? 'total_steps',
      is_public: options?.isPublic ?? false,
      winner_stakes: options?.winnerStakes?.trim() || null,
      loser_stakes: options?.loserStakes?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as League;
}

/** Open leagues near a city/country, or matching a search term — powers the join screen's discovery list. */
export async function searchPublicLeagues(params: {
  city?: string | null;
  country?: string | null;
  query?: string;
}): Promise<PublicLeaguePreview[]> {
  const { data, error } = await supabase.rpc('search_public_leagues', {
    p_city: params.city ?? null,
    p_country: params.country ?? null,
    p_query: params.query?.trim() || null,
  });
  if (error) throw error;
  return (data ?? []) as PublicLeaguePreview[];
}

/** One-tap join for a league found via searchPublicLeagues — no invite code needed. */
export async function joinPublicLeague(leagueId: string): Promise<void> {
  const { error } = await supabase.rpc('join_public_league', { p_league_id: leagueId });
  if (error) throw error;
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

/**
 * Only the creator can call this, and only after the current round ended —
 * enforced server-side too. `memberIds`, when given, is who continues into
 * the new round (everyone else is removed from the league, the creator is
 * always kept); omit it to keep every current member.
 */
export async function restartLeague(
  leagueId: string,
  newDeadline: string,
  options?: { memberIds?: string[]; winnerStakes?: string; loserStakes?: string }
): Promise<void> {
  const { error } = await supabase.rpc('restart_league', {
    p_league_id: leagueId,
    p_new_deadline: newDeadline,
    p_member_ids: options?.memberIds ?? null,
    p_winner_stakes: options?.winnerStakes?.trim() || null,
    p_loser_stakes: options?.loserStakes?.trim() || null,
  });
  if (error) throw error;
}

/** A member removes themselves from a league. The creator can't leave their own league — see leave_league() in schema.sql. */
export async function leaveLeague(leagueId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_league', { p_league_id: leagueId });
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
 * Official rank comes from the league's last reset snapshot (see
 * supabase/functions/nightly-rollup and process_league_reset() in
 * supabase/schema.sql). Until the first snapshot exists — a league is at
 * most 24 hours old — we fall back to summing daily_steps directly so the
 * screen isn't empty on day one. Either way we also show each member's
 * steps so far today, which haven't been counted yet.
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

  const pointsByUser = await getLeagueDailyWins(leagueId, roundStart);

  const ranked = memberList
    .map((m) => {
      const todaySteps = todayByUser.get(m.user_id) ?? 0;
      const yesterdaySteps = yesterdayByUser.get(m.user_id) ?? 0;
      // Sealed once a snapshot exists: standings show exactly what the
      // last reset wrote, nothing from today folded in. (This used to
      // silently add today's live steps on top, which quietly contradicted
      // every "unlocks at next reset" label in the UI — today's live
      // totals are now only ever visible through Peek, see getLivePeek()
      // below.)
      const reactionMap = reactionsByUser.get(m.user_id);
      return {
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? 'Unknown',
        avatar_url: m.profiles?.avatar_url ?? null,
        total_steps: totals.get(m.user_id) ?? 0,
        is_me: m.user_id === myId,
        todaySteps,
        deltaSinceYesterday: todaySteps - yesterdaySteps,
        reactions: reactionMap
          ? Array.from(reactionMap.entries()).map(([emoji, count]) => ({ emoji, count }))
          : [],
        points: pointsByUser.get(m.user_id) ?? 0,
      };
    })
    .sort((a, b) => b.total_steps - a.total_steps)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { rows: ranked, officialAsOf };
}

/**
 * Per-member count of days they ranked #1 in `leaderboard_snapshots` for the
 * current round — the "Pts" column for the daily-wins scoring mode, and a
 * secondary stat shown regardless of mode. Derived entirely from snapshots
 * the nightly rollup already writes, so no new table or edge function
 * change is needed.
 */
export async function getLeagueDailyWins(leagueId: string, roundStart?: string): Promise<Map<string, number>> {
  const start = roundStart ?? (await getCurrentRoundStart(leagueId)).roundStart;
  const { data, error } = await supabase
    .from('leaderboard_snapshots')
    .select('user_id')
    .eq('league_id', leagueId)
    .eq('rank', 1)
    .gte('snapshot_date', start);
  if (error) throw error;
  const points = new Map<string, number>();
  for (const row of (data ?? []) as { user_id: string }[]) {
    points.set(row.user_id, (points.get(row.user_id) ?? 0) + 1);
  }
  return points;
}

function dayFractionElapsed(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return ((hour === 24 ? 0 : hour) + minute / 60) / 24;
}

/**
 * Today's live standings for one league — what "Peek" reveals. Deliberately
 * separate from getLeaderboard(): this shows each member's steps *today*
 * (not the sealed round total) plus a same-day pace projection, so a peek
 * answers "how am I doing right now" rather than duplicating the frozen
 * table. Consumed via usePeek() below, which enforces the daily quota
 * server-side before the caller bothers fetching this.
 *
 * `since`, when given, is the instant triggerLeagueLiveSync() fired the
 * live-sync pushes for this peek — each row's is_fresh is then whether
 * their daily_steps row for today has updated since that push went out
 * (RLS already lets league-mates read each other's today's daily_steps —
 * see "league-mates can view today's live steps" in supabase/schema.sql —
 * so no extra RPC is needed to read updated_at here). Omit it to skip the
 * freshness check entirely (every row comes back is_fresh: true).
 */
export async function getLivePeek(leagueId: string, since?: string): Promise<PeekResult> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const { data: members, error: membersError } = await supabase
    .from('league_members')
    .select('user_id, profiles(display_name, avatar_url, timezone)')
    .eq('league_id', leagueId);
  if (membersError) throw membersError;

  type PeekMemberRow = { user_id: string; profiles: { display_name: string; avatar_url: string | null; timezone: string } | null };
  const memberList = (members ?? []) as unknown as PeekMemberRow[];
  if (memberList.length === 0) return { rows: [], gapToFirst: null, leaderName: null };

  const todayKeyByUser = new Map(memberList.map((m) => [m.user_id, todayInTimezone(m.profiles?.timezone ?? 'UTC')]));
  const uniqueDates = Array.from(new Set(todayKeyByUser.values()));

  const { data: stepsRows, error: stepsError } = await supabase
    .from('daily_steps')
    .select('user_id, date, steps, updated_at')
    .in('user_id', memberList.map((m) => m.user_id))
    .in('date', uniqueDates);
  if (stepsError) throw stepsError;

  const nowByUser = new Map<string, number>();
  const updatedAtByUser = new Map<string, string>();
  for (const row of (stepsRows ?? []) as { user_id: string; date: string; steps: number; updated_at: string }[]) {
    if (row.date === todayKeyByUser.get(row.user_id)) {
      nowByUser.set(row.user_id, row.steps);
      updatedAtByUser.set(row.user_id, row.updated_at);
    }
  }

  const sinceMs = since ? new Date(since).getTime() : null;

  const rows = memberList
    .map((m) => {
      const now = nowByUser.get(m.user_id) ?? 0;
      const fraction = dayFractionElapsed(m.profiles?.timezone ?? 'UTC');
      const updatedAt = updatedAtByUser.get(m.user_id);
      return {
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? 'Unknown',
        avatar_url: m.profiles?.avatar_url ?? null,
        now_steps: now,
        // Simple same-day extrapolation, clamped so a peek taken at 00:05
        // doesn't project someone into the millions. Real methodology, just
        // not the "last three hours" a fancier version might use — this app
        // doesn't store other members' hourly data to do that.
        pace: Math.round(now / Math.max(fraction, 0.08)),
        is_me: m.user_id === myId,
        is_fresh: sinceMs === null || m.user_id === myId || (!!updatedAt && new Date(updatedAt).getTime() >= sinceMs),
      };
    })
    .sort((a, b) => b.now_steps - a.now_steps);

  const leader = rows[0];
  const me = rows.find((r) => r.is_me);
  const gapToFirst = me && leader && !leader.is_me ? leader.now_steps - me.now_steps : me && leader && leader.is_me ? 0 : null;

  return { rows, gapToFirst, leaderName: leader?.display_name ?? null };
}

/**
 * Fires the moment someone opens Peek: silently wakes every *other* league
 * member's phone (see supabase/functions/peek-live-sync) so their real
 * steps land in daily_steps before getLivePeek() reads live standings a
 * few seconds later. Returns the instant the pushes went out, to pass as
 * `since` to getLivePeek() for the freshness check above. Best-effort —
 * a failure here (offline, function cold-start hiccup) just means the
 * peek falls back to whatever was already synced, same as before this
 * existed, so callers can safely ignore a rejected promise.
 */
export async function triggerLeagueLiveSync(leagueId: string): Promise<{ triggeredAt: string }> {
  const { data, error } = await supabase.functions.invoke('peek-live-sync', { body: { leagueId } });
  if (error) throw error;
  return { triggeredAt: (data as { triggeredAt: string }).triggeredAt };
}

/**
 * Whether `nextResetAt` (a league's upcoming reset) is the last one before
 * `deadline` — i.e. the round ends before this league would reset again.
 * Pure client-side date math, no schema support needed: the UI uses this to
 * show an exclamation-mark "last stretch" warning next to the countdown.
 */
export function isFinalResetBeforeDeadline(nextResetAt: string, deadline: string): boolean {
  const afterNextResetMs = new Date(nextResetAt).getTime() + 24 * 60 * 60 * 1000;
  // deadline is a date (YYYY-MM-DD); the league stays active through the
  // end of that day, UTC.
  const deadlineEndMs = new Date(`${deadline}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
  return afterNextResetMs >= deadlineEndMs;
}

/** Consumes one of today's peek allowance (1 free / 3 premium) — see use_peek() in supabase/schema.sql. */
export async function usePeek(): Promise<{ allowed: boolean; remaining: number; isPro: boolean }> {
  const { data, error } = await supabase.rpc('use_peek').single();
  if (error) throw error;
  const row = data as { allowed: boolean; remaining: number; is_pro: boolean };
  return { allowed: row.allowed, remaining: row.remaining, isPro: row.is_pro };
}

/** Read-only peek quota check — doesn't consume one, just reports "N left today". */
export async function getPeekStatus(): Promise<PeekStatus> {
  const { data, error } = await supabase.rpc('peeks_remaining_today').single();
  if (error) throw error;
  const row = data as { remaining: number; is_pro: boolean };
  return { remaining: row.remaining, is_pro: row.is_pro };
}

/** Every league (finished or live) the caller has ever been a member of, with their standing in each — the premium Stat History screen's league list. */
export async function getMyLeaguesPlayed(): Promise<LeaguePlayedSummary[]> {
  const leagues = await listMyLeagues();
  const results = await Promise.all(
    leagues.map(async (l) => {
      try {
        const { rows } = await getLeaderboard(l.id);
        const mine = rows.find((r) => r.is_me);
        const ended = new Date(l.deadline) < new Date(new Date().toDateString());
        const roundStart = l.current_round_start ?? l.created_at;
        const days = Math.max(1, Math.round((Date.parse(l.deadline) - Date.parse(roundStart)) / 86400000) + 1);
        return {
          league_id: l.id,
          name: l.name,
          memberCount: rows.length,
          isLive: !ended,
          rank: mine?.rank ?? 0,
          totalSteps: mine?.total_steps ?? 0,
          days,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is LeaguePlayedSummary => r !== null);
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

/** Lifetime count of days this user ranked #1 in any league — the profile screen's "Wins" stat. */
export async function getMyTotalWins(): Promise<number> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('leaderboard_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('rank', 1);
  if (error) throw error;
  return count ?? 0;
}

/**
 * "Win rate" for the premium Stat History screen — the share of league-days
 * (rows in leaderboard_snapshots, one per league you were standing in on a
 * given night) that you finished #1 in, optionally scoped to a date range.
 * Same underlying data as getMyTotalWins(), just with a denominator.
 */
export async function getMySnapshotWinStats(range?: { start?: string; end?: string }): Promise<{ total: number; wins: number }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { total: 0, wins: 0 };
  let query = supabase.from('leaderboard_snapshots').select('rank').eq('user_id', userId);
  if (range?.start) query = query.gte('snapshot_date', range.start);
  if (range?.end) query = query.lte('snapshot_date', range.end);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as { rank: number }[];
  return { total: rows.length, wins: rows.filter((r) => r.rank === 1).length };
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

const MESSAGE_PAGE_SIZE = 50;

type MessageRow = {
  id: string;
  league_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

/** Most recent messages first, then reversed to chronological order for rendering. */
export async function getLeagueMessages(leagueId: string): Promise<LeagueMessage[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const { data, error } = await supabase
    .from('messages')
    .select('id, league_id, user_id, body, created_at, profiles(display_name, avatar_url)')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (error) throw error;

  return ((data ?? []) as unknown as MessageRow[])
    .map((row) => ({
      id: row.id,
      league_id: row.league_id,
      user_id: row.user_id,
      display_name: row.profiles?.display_name ?? 'Unknown',
      avatar_url: row.profiles?.avatar_url ?? null,
      body: row.body,
      created_at: row.created_at,
      is_me: row.user_id === myId,
    }))
    .reverse();
}

export async function sendLeagueMessage(leagueId: string, body: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in.');
  const trimmed = body.trim();
  if (!trimmed) return;

  const { error } = await supabase
    .from('messages')
    .insert({ league_id: leagueId, user_id: userId, body: trimmed.slice(0, 500) });
  if (error) throw error;
}

/**
 * A single day's result for the "scores are in" takeover screen: each member's own
 * step count for that specific day (from daily_steps — a real, meaningful
 * "how much did I walk today" number) ranked league-wide for the day's
 * winner, plus each member's *cumulative* standing rank that day vs. the day
 * before (from leaderboard_snapshots, for the ↑/↓ delta arrows). Both are
 * derived from data the nightly rollup already writes — no new table or
 * edge function change needed.
 */
export async function getLeagueDailyResult(leagueId: string, date: string): Promise<LeagueDailyResult> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const previousDate = (() => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const { data: members, error: membersError } = await supabase
    .from('league_members')
    .select('user_id, profiles(display_name)')
    .eq('league_id', leagueId);
  if (membersError) throw membersError;
  const memberList = (members ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[];
  if (memberList.length === 0) return { date, winner: null, rows: [] };

  const userIds = memberList.map((m) => m.user_id);

  const [{ data: dayStepsRows }, { data: snapshotRows }, { data: prevSnapshotRows }] = await Promise.all([
    supabase.from('daily_steps').select('user_id, steps').eq('date', date).in('user_id', userIds),
    supabase
      .from('leaderboard_snapshots')
      .select('user_id, rank')
      .eq('league_id', leagueId)
      .eq('snapshot_date', date),
    supabase
      .from('leaderboard_snapshots')
      .select('user_id, rank')
      .eq('league_id', leagueId)
      .eq('snapshot_date', previousDate),
  ]);

  const stepsByUser = new Map(((dayStepsRows ?? []) as { user_id: string; steps: number }[]).map((r) => [r.user_id, r.steps]));
  const rankByUser = new Map(((snapshotRows ?? []) as { user_id: string; rank: number }[]).map((r) => [r.user_id, r.rank]));
  const prevRankByUser = new Map(
    ((prevSnapshotRows ?? []) as { user_id: string; rank: number }[]).map((r) => [r.user_id, r.rank])
  );

  const rows = memberList
    .map((m) => ({
      user_id: m.user_id,
      display_name: m.profiles?.display_name ?? 'Unknown',
      total_steps: stepsByUser.get(m.user_id) ?? 0,
      rank: rankByUser.get(m.user_id) ?? memberList.length,
      previousRank: prevRankByUser.get(m.user_id) ?? null,
      is_me: m.user_id === myId,
    }))
    .sort((a, b) => b.total_steps - a.total_steps);

  const winner = rows.length > 0 && rows[0].total_steps > 0 ? rows[0] : null;

  return { date, winner, rows };
}
