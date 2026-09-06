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

/** Cities/countries that at least one profile has set, for the location picker above the leaderboard. */
export async function searchLeaderboardLocations(
  scope: 'city' | 'country',
  query: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc('search_locations', { p_scope: scope, p_query: query });
  if (error) throw error;
  return ((data ?? []) as { value: string }[]).map((r) => r.value);
}
