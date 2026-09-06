// Shared types matching the Supabase schema (see supabase/schema.sql).

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  timezone: string; // IANA timezone, e.g. "Europe/Ljubljana"
  is_pro: boolean;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  roast_mode: boolean;
  created_at: string;
};

export type League = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  deadline: string; // ISO date, end of the current round
  current_round_start: string | null; // null until the league's first restart
  round_number: number;
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
  avatar_url: string | null;
  total_steps: number;
  rank: number;
  is_me: boolean;
  todaySteps: number;
  deltaSinceYesterday: number;
  reactions: { emoji: string; count: number }[];
};

export type LeagueAward = {
  title: string;
  emoji: string;
  description: string;
  winnerName: string;
};

export type LeagueRoundResult = {
  round_number: number;
  start_date: string;
  end_date: string;
  standings: { display_name: string; total_steps: number }[];
};

export type StepTotals = {
  today: number;
  month: number;
  year: number;
  allTime: number;
};

export type StepStats = StepTotals & {
  bestDay: number;
  daysLogged: number;
  streak: number;
};

export type LeaderboardScope = 'city' | 'country' | 'global';

export type GlobalLeaderboardRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  total_steps: number;
  rank: number;
  is_me: boolean;
};
