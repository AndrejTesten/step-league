import type { StepStats } from './types';

export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  isEarned: (stats: StepStats) => boolean;
};

// Purely computed from daily_steps totals — no database table needed. Add
// an entry here and it just works retroactively for everyone, since it's
// re-evaluated from the same step history every time the badges list
// renders, instead of needing a backfill migration for existing users.
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_steps',
    title: 'First Steps',
    description: 'Log your first day of steps.',
    icon: '👣',
    isEarned: (s) => s.daysLogged >= 1,
  },
  {
    id: 'ten_k_day',
    title: '10K Day',
    description: 'Hit 10,000 steps in a single day.',
    icon: '🔥',
    isEarned: (s) => s.bestDay >= 10_000,
  },
  {
    id: 'twenty_k_day',
    title: '20K Day',
    description: 'Hit 20,000 steps in a single day.',
    icon: '⚡',
    isEarned: (s) => s.bestDay >= 20_000,
  },
  {
    id: 'streak_3',
    title: '3-Day Streak',
    description: 'Log steps 3 days in a row.',
    icon: '🌱',
    isEarned: (s) => s.streak >= 3,
  },
  {
    id: 'streak_7',
    title: 'Week Streak',
    description: 'Log steps 7 days in a row.',
    icon: '🌟',
    isEarned: (s) => s.streak >= 7,
  },
  {
    id: 'streak_30',
    title: 'Month Streak',
    description: 'Log steps 30 days in a row.',
    icon: '👑',
    isEarned: (s) => s.streak >= 30,
  },
  {
    id: 'hundred_k_total',
    title: '100K Club',
    description: 'Walk 100,000 steps total.',
    icon: '💯',
    isEarned: (s) => s.allTime >= 100_000,
  },
  {
    id: 'half_million_total',
    title: 'Half Millionaire',
    description: 'Walk 500,000 steps total.',
    icon: '🚀',
    isEarned: (s) => s.allTime >= 500_000,
  },
  {
    id: 'million_total',
    title: 'Millionaire',
    description: 'Walk 1,000,000 steps total.',
    icon: '🏆',
    isEarned: (s) => s.allTime >= 1_000_000,
  },
];
