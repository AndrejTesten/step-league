// Shared types matching the Supabase schema (see supabase/schema.sql).

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  timezone: string; // IANA timezone, e.g. "Europe/Ljubljana"
  is_pro: boolean;
  created_at: string;
};

export type League = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  deadline: string; // ISO date, end of the league
  created_at: string;
};

export type LeagueMember = {
  league_id: string;
  user_id: string;
  joined_at: string;
};

export type DailySteps = {
  user_id: string;
  date: string; // YYYY-MM-DD, in the user's own timezone
  steps: number;
  updated_at: string;
};

// One row per (league, user, night) — written by the nightly rollup function.
export type LeaderboardSnapshot = {
  league_id: string;
  user_id: string;
  snapshot_date: string; // YYYY-MM-DD the snapshot was taken for
  total_steps: number;
  rank: number;
  created_at: string;
};

export type LeaderboardRow = {
  user_id: string;
  display_name: string;
  total_steps: number;
  rank: number;
  is_me: boolean;
};
