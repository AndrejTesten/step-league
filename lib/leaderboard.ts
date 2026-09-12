import { supabase } from './supabase';
import type { GlobalLeaderboardRow, LeaderboardScope } from './types';

export const LEADERBOARD_PAGE_SIZE = 20;

/**
 * City / Country / Global leaderboard tabs — ranks every profile by
 * lifetime total steps via the get_leaderboard() Postgres function (see
 * supabase/schema.sql), which aggregates server-side so the client never
 * needs raw daily_steps access to other users. Paged 20 rows at a time;
 * `search` matches a display name but still returns each row's true rank.
 */
export async function getGlobalLeaderboard(
  scope: LeaderboardScope,
  value: string | null,
  opts: { search?: string; offset?: number; limit?: number } = {}
): Promise<GlobalLeaderboardRow[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_scope: scope,
    p_value: scope === 'global' ? null : value,
    p_search: opts.search?.trim() || null,
    p_limit: opts.limit ?? LEADERBOARD_PAGE_SIZE,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;

  return ((data ?? []) as Omit<GlobalLeaderboardRow, 'is_me'>[]).map((row) => ({
    ...row,
    is_me: row.user_id === myId,
  }));
}

/** "Your place in Poland: 4,182 of 91,203" hero stat — see get_leaderboard_rank_summary() in supabase/schema.sql. */
export async function getMyLeaderboardRank(
  scope: LeaderboardScope,
  value: string | null
): Promise<{ rank: number; total: number } | null> {
  const { data, error } = await supabase
    .rpc('get_leaderboard_rank_summary', { p_scope: scope, p_value: scope === 'global' ? null : value })
    .single();
  if (error) throw error;
  const row = data as { my_rank: number | null; total: number } | null;
  if (!row || row.my_rank == null) return null;
  return { rank: row.my_rank, total: row.total };
}
