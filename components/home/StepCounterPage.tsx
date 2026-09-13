import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Screen, SectionLabel } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { DEFAULT_DAILY_GOAL, KCAL_PER_STEP, METERS_PER_STEP, STEPS_PER_MINUTE } from '@/lib/equivalences';
import { getLeaderboard, listMyLeagues } from '@/lib/leagues';
import { getStepStatsAndMap } from '@/lib/stats';
import { dateKeyInTimezone } from '@/lib/steps-shared';
import { useSyncStatus } from '@/lib/sync-status';
import { useCountdownClock } from '@/lib/use-countdown-clock';
import { theme, useThemeColors } from '@/lib/theme';
import type { StepStats } from '@/lib/types';

const EMPTY_STATS: StepStats = { today: 0, month: 0, year: 0, allTime: 0, bestDay: 0, daysLogged: 0, streak: 0 };

function addDaysToKey(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

export function StepCounterPage({ width }: { width: number }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const { session, profile } = useSession();
  const [totals, setTotals] = useState<StepStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [last7, setLast7] = useState<{ dateKey: string; steps: number }[]>([]);
  const [rankInfo, setRankInfo] = useState<{ leagueName: string; rank: number } | null>(null);
  const [leagueCount, setLeagueCount] = useState(0);
  const syncStatus = useSyncStatus();
  const clock = useCountdownClock(profile?.timezone);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Depend on the stable id/timezone strings, not the session/profile
  // objects themselves — Supabase gives those new references on every
  // session-changed event (token refresh, etc.), which would otherwise
  // recreate `load` constantly and, combined with the effect below, reset
  // the polling interval before it ever got a chance to fire on its own.
  const userId = session?.user.id;
  const timezone = profile?.timezone;

  // If an older, slower request resolves after a newer one (a request that
  // fires every 15s has plenty of chances to race a slow network response),
  // discard it instead of letting it overwrite the display with stale
  // numbers — same class of "counter looks wrong" bug as the sync side.
  const latestRequestId = useRef(0);

  const load = useCallback(async () => {
    if (!userId || !timezone) return;
    const requestId = ++latestRequestId.current;
    try {
      const [{ stats, map: dailyMap }, myLeagues] = await Promise.all([
        getStepStatsAndMap(userId, timezone),
        listMyLeagues().catch(() => []),
      ]);
      if (!mountedRef.current || requestId !== latestRequestId.current) return;
      setTotals(stats);
      setLeagueCount(myLeagues.length);

      const today = dateKeyInTimezone(new Date(), timezone);
      const days: { dateKey: string; steps: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const key = addDaysToKey(today, -i);
        days.push({ dateKey: key, steps: dailyMap.get(key) ?? 0 });
      }
      setLast7(days);

      if (myLeagues[0]) {
        getLeaderboard(myLeagues[0].id)
          .then(({ rows }) => {
            if (!mountedRef.current) return;
            const mine = rows.find((r) => r.is_me);
            if (mine) setRankInfo({ leagueName: myLeagues[0].name, rank: mine.rank });
          })
          .catch(() => {});
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, timezone]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // useStepSync (see lib/use-step-sync.ts) re-pulls from HealthKit/Health
  // Connect into daily_steps on mount, on foreground-return, and every 15s
  // — and reports every attempt (success or failure) through lastSyncAt.
  // Reacting to that directly, instead of re-reading daily_steps on our own
  // independent timer, means the number on screen updates the instant a
  // sync actually lands rather than up to 15s later on an uncoordinated
  // interval of our own — the gap between "data synced" and "UI shows it"
  // was adding its own lag on top of Health Connect/HealthKit's inherent
  // delay.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.lastSyncAt]);

  // HealthKit/Health Connect can revise a day's total downward between
  // syncs (a corrected overcount, a permission hiccup narrowing the query
  // window) — upsert_daily_steps_monotonic (see supabase/schema.sql)
  // already protects the *stored* value, but a later poll can still read a
  // lower number than an earlier one did before that protection caught up.
  // Track the highest value shown today and never display less than that,
  // resetting only when the calendar day itself changes.
  const maxDisplayedRef = useRef(0);
  const dateKeyRef = useRef<string | null>(null);
  const currentDateKey = timezone ? dateKeyInTimezone(new Date(), timezone) : null;
  if (currentDateKey !== dateKeyRef.current) {
    dateKeyRef.current = currentDateKey;
    maxDisplayedRef.current = 0;
  }
  const displayedToday = Math.max(maxDisplayedRef.current, totals.today);
  maxDisplayedRef.current = displayedToday;

  const yesterday = last7.length ? last7[last7.length - 2] : undefined;
  const todayLabel = timezone
    ? new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(
        new Date()
      )
    : '';

  const km = (displayedToday * METERS_PER_STEP) / 1000;
  const kcal = Math.round(displayedToday * KCAL_PER_STEP);
  const movingMinutes = displayedToday / STEPS_PER_MINUTE;
  const maxLast7 = Math.max(1, ...last7.map((d) => d.steps));
  const dailyGoal = profile?.daily_goal ?? DEFAULT_DAILY_GOAL;
  const goalPct = Math.min(100, Math.round((displayedToday / dailyGoal) * 100));
  const toGo = Math.max(0, dailyGoal - displayedToday);

  return (
    <Screen style={{ width, paddingTop: theme.space(14) }}>
      <View style={styles.header}>
        {profile?.is_pro ? (
          <Pressable
            onPress={() => router.push('/premium')}
            hitSlop={12}
            style={[styles.coffeeButton, { borderColor: colors.accent }]}
          >
            <Text style={[styles.coffeeLabel, { color: colors.accent }]}>{t('home.stepCounter.premium')}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push('/premium')}
            hitSlop={12}
            style={[styles.coffeeButton, { borderColor: colors.controlBorder }]}
          >
            <Text style={[styles.coffeeLabel, { color: colors.textSubtle }]}>{t('home.stepCounter.goPremium')}</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/profile')} hitSlop={12}>
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={32} />
        </Pressable>
      </View>

      {syncStatus.errorCode && (
        <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small, marginBottom: theme.space(2) }}>
          {t(`home.stepCounter.syncErrors.${syncStatus.errorCode}`)}
        </Text>
      )}

      <Pressable onPress={() => router.push('/stats')}>
        <SectionLabel>{t('home.stepCounter.todayLabel', { date: todayLabel })}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: theme.space(2.5), marginTop: theme.space(1.5) }}>
          <Text style={[styles.hero, { color: colors.accent }]}>{loading ? '-' : displayedToday.toLocaleString()}</Text>
          <Text style={[styles.stepsWord, { color: colors.textMuted }]} numberOfLines={1}>
            {t('home.stepCounter.steps')}
          </Text>
        </View>
      </Pressable>

      <View style={{ gap: theme.space(2), marginTop: theme.space(4.5) }}>
        <View style={[styles.goalTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.goalFill, { width: `${goalPct}%`, backgroundColor: colors.accent }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[styles.goalCaption, { color: colors.textMuted }]}>{t('home.stepCounter.goalPct', { percent: goalPct, goal: dailyGoal.toLocaleString() })}</Text>
          <Text style={[styles.goalCaption, { color: colors.textMuted }]}>{toGo === 0 ? t('home.stepCounter.goalReached') : t('home.stepCounter.toGo', { total: toGo.toLocaleString() })}</Text>
        </View>
      </View>

      <View style={{ gap: theme.space(1.75), marginTop: theme.space(5.5), marginBottom: theme.space(4) }}>
        <View style={styles.chartRow}>
          {last7.map((d) => (
            <View
              key={d.dateKey}
              style={[
                styles.bar,
                {
                  height: Math.max(4, (d.steps / maxLast7) * 52),
                  backgroundColor: d.steps > 0 ? colors.accent : colors.borderStrong,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.chartAxis}>
          {last7.map((d) => (
            <Text key={d.dateKey} style={[styles.axisLabel, { color: colors.textDim }]}>
              {new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }).format(new Date(`${d.dateKey}T00:00:00`))}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCell, { backgroundColor: colors.card }]}>
          <SectionLabel>{t('home.stepCounter.distance')}</SectionLabel>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {km.toFixed(1)}
            <Text style={styles.statUnit}> {t('home.stepCounter.km')}</Text>
          </Text>
        </View>
        <View style={[styles.statCell, { backgroundColor: colors.card }]}>
          <SectionLabel>{t('home.stepCounter.kcal')}</SectionLabel>
          <Text style={[styles.statValue, { color: colors.text }]}>{kcal}</Text>
        </View>
        <View style={[styles.statCell, { backgroundColor: colors.card }]}>
          <SectionLabel>{t('home.stepCounter.moving')}</SectionLabel>
          <Text style={[styles.statValue, { color: colors.text }]}>{formatMinutes(movingMinutes)}</Text>
        </View>
      </View>

      <View style={[styles.countdownCard, { borderColor: colors.controlBorder }]}>
        <View style={{ flex: 1 }}>
          <SectionLabel>{t('home.stepCounter.scoresUnlockIn')}</SectionLabel>
          <Text style={[styles.countdownCaption, { color: colors.textSubtle }]}>
            {t('home.stepCounter.leaguesWaiting', { count: leagueCount })}
          </Text>
        </View>
        <Text style={[styles.countdownClock, { color: colors.accent, flexShrink: 0 }]}>{clock}</Text>
      </View>

      {yesterday && (
        <View style={{ marginTop: theme.space(4) }}>
          <SectionLabel>{t('home.stepCounter.yesterday')}</SectionLabel>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: theme.space(2) }}>
            <Text style={[styles.yesterdayValue, { color: colors.text }]}>{yesterday.steps.toLocaleString()}</Text>
            {rankInfo && (
              <Text style={[styles.rankText, { color: colors.accent }]}>
                {t('home.stepCounter.rankInLeague', {
                  rank: t('home.stepCounter.rankOrdinal', { count: rankInfo.rank, ordinal: true }),
                  league: rankInfo.leagueName,
                })}
              </Text>
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space(4),
  },
  coffeeButton: {
    borderWidth: theme.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1.75),
  },
  coffeeLabel: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hero: {
    fontSize: 84,
    lineHeight: 74,
    fontFamily: theme.fontFamily.heading,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  stepsWord: {
    fontSize: 12,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingBottom: theme.space(1.5),
  },
  goalTrack: {
    height: 6,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    borderRadius: theme.radius.pill,
  },
  goalCaption: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chartRow: {
    flexDirection: 'row',
    gap: 3,
    height: 52,
    alignItems: 'flex-end',
  },
  bar: {
    flex: 1,
    borderRadius: 1,
  },
  chartAxis: {
    flexDirection: 'row',
    gap: 3,
  },
  axisLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.space(2),
  },
  statCell: {
    flex: 1,
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
    gap: theme.space(1.5),
  },
  statValue: {
    fontSize: 28,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontSize: 12,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  countdownCard: {
    marginTop: theme.space(4),
    borderWidth: theme.border,
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(3),
  },
  countdownCaption: {
    fontSize: 12,
    fontFamily: theme.fontFamily.bodyMedium,
    marginTop: theme.space(1.75),
  },
  countdownClock: {
    fontSize: 36,
    lineHeight: 32,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  yesterdayValue: {
    fontSize: 30,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  rankText: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 0.6,
  },
});
