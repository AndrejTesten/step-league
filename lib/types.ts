// Shared types matching the Supabase schema (see supabase/schema.sql).

export type ColorTheme = 'lime' | 'cyan' | 'ember' | 'violet' | 'paper' | 'mono';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  timezone: string; // IANA timezone, e.g. "Europe/Ljubljana"
  is_pro: boolean;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  daily_goal: number;
  color_theme: ColorTheme;
  created_at: string;
};

export type LeagueScoringMode = 'total_steps' | 'daily_wins';

export type League = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  deadline: string; // ISO date, end of the current round
  current_round_start: string | null; // null until the league's first restart
  round_number: number;
  next_reset_at: string; // timestamptz — when this league's standings next lock in (a fixed 24h cycle from creation/restart, not tied to any member's timezone)
  last_reset_at: string | null; // timestamptz — when this league's cycle last actually locked in; null until the first reset fires
  scoring_mode: LeagueScoringMode;
  is_public: boolean;
  /** Optional, freeform house-rule text — e.g. "Winner picks the next restaurant." Not enforced by the app. */
  winner_stakes: string | null;
  /** Optional, freeform house-rule text — e.g. "Loser buys coffee for a week." Not enforced by the app. */
  loser_stakes: string | null;
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
  /** Count of days this member ranked #1 in the current round — the "Pts" column. */
  points: number;
};

export type PublicLeaguePreview = {
  id: string;
  name: string;
  deadline: string;
  member_count: number;
};

export type LeagueMessage = {
  id: string;
  league_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
  is_me: boolean;
};

export type LeagueDailyResult = {
  date: string;
  winner: { user_id: string; display_name: string; total_steps: number } | null;
  rows: {
    user_id: string;
    display_name: string;
    total_steps: number;
    rank: number;
    previousRank: number | null;
    is_me: boolean;
  }[];
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

export type PeekRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  now_steps: number;
  pace: number;
  is_me: boolean;
  /**
   * false when a live-sync push (see triggerLeagueLiveSync in lib/leagues.ts)
   * was sent for this peek but this member's daily_steps row hasn't updated
   * since — their phone likely didn't wake in time. now_steps still shows
   * their last-known count; the UI adds a "couldn't reach their phone just
   * now" note rather than hiding the number. Always true when no live sync
   * was triggered (getLivePeek called without `since`).
   */
  is_fresh: boolean;
};

export type PeekResult = {
  rows: PeekRow[];
  gapToFirst: number | null;
  leaderName: string | null;
};

export type PeekStatus = {
  remaining: number;
  is_pro: boolean;
};

/** One row of "every league you've played" for the premium Stat History screen. */
export type LeaguePlayedSummary = {
  league_id: string;
  name: string;
  memberCount: number;
  isLive: boolean;
  rank: number;
  totalSteps: number;
  /** Calendar length of the round, in days. */
  days: number;
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
