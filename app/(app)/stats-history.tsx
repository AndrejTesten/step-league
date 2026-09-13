import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tabs } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getMyLeaguesPlayed, getMySnapshotWinStats } from '@/lib/leagues';
import { getStepStatsAndMap } from '@/lib/stats';
import { theme, useThemeColors } from '@/lib/theme';
import type { LeaguePlayedSummary, StepStats } from '@/lib/types';

type Tab = 'leagues' | 'year' | 'alltime';
type PredictionRow = { label: string; value: string; caption: string; accent?: boolean };

// Locale-aware weekday/month abbreviations (the app's selected language, not
// the device's — same convention used elsewhere for calendar labels, e.g.
// YearView's month axis in stats.tsx) rather than a hardcoded English array.
// Jan 1 2024 was a Monday, so offsetting from it gives Mon..Sun in order.
// Functions, not constants, so they can be recomputed for the current
// language instead of being frozen to whatever was active at first import.
function dayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1).toLocaleDateString(locale, { weekday: 'short' }));
}
function monthLabels(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) => new Date(2024, i, 1).toLocaleDateString(locale, { month: 'short' }));
}

function dowIndex(dateKey: string): number {
  // getDay(): 0=Sun..6=Sat -> remap to 0=Mon..6=Sun to match DAY_LABELS.
  const d = new Date(`${dateKey}T00:00:00`).getDay();
  return (d + 6) % 7;
}

function ordinal(t: TFunction, n: number): string {
  return t('home.stepCounter.rankOrdinal', { count: n, ordinal: true });
}

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysElapsedInYear(year: number): number {
  const start = new Date(year, 0, 1).getTime();
  const now = Date.now();
  if (new Date().getFullYear() > year) return isLeapYear(year) ? 366 : 365;
  return Math.floor((now - start) / 86400000) + 1;
}

/** Straight-line projection from this year's pace so far — only offered once there's enough of the year behind it to mean something. */
function yearEndProjection(yearTotal: number, year: number): number | null {
  if (year !== new Date().getFullYear()) return null;
  const elapsed = daysElapsedInYear(year);
  if (elapsed < 14) return null;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  return Math.round((yearTotal / elapsed) * daysInYear);
}

function dateKeyDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Average steps/day (including rest days — this is a real pace, not an active-day average) over a trailing window. */
function windowDailyRate(dailyMap: Map<string, number>, startDaysAgo: number, endDaysAgo: number): number {
  let total = 0;
  let count = 0;
  for (let i = startDaysAgo; i < endDaysAgo; i++) {
    total += dailyMap.get(dateKeyDaysAgo(i)) ?? 0;
    count += 1;
  }
  return count ? total / count : 0;
}

/** Compares two equal, back-to-back trailing windows (e.g. last 14 days vs the 14 before that) — null when there's not enough history to compare. */
function recentTrend(dailyMap: Map<string, number>, windowDays: number): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  const recent = windowDailyRate(dailyMap, 0, windowDays);
  const prior = windowDailyRate(dailyMap, windowDays, windowDays * 2);
  if (recent === 0 || prior === 0) return null;
  const pct = Math.round(((recent - prior) / prior) * 100);
  return { pct, direction: pct > 3 ? 'up' : pct < -3 ? 'down' : 'flat' };
}

/** Next round-number milestone above the current all-time total, and an estimated date based on the last 90 days' real pace. */
function milestoneProjection(total: number, dailyMap: Map<string, number>): { milestone: number; days: number; date: Date } | null {
  const milestone = MILESTONES.find((m) => m > total);
  if (!milestone) return null;
  const rate = windowDailyRate(dailyMap, 0, 90);
  if (rate <= 0) return null;
  const days = Math.ceil((milestone - total) / rate);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return { milestone, days, date };
}

function longestStreak(dailyMap: Map<string, number>): number {
  const days = Array.from(dailyMap.entries())
    .filter(([, steps]) => steps > 0)
    .map(([date]) => date)
    .sort();
  let best = 0;
  let current = 0;
  let prev: string | null = null;
  for (const date of days) {
    if (prev) {
      const gapDays = Math.round((Date.parse(date) - Date.parse(prev)) / 86400000);
      current = gapDays === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    prev = date;
  }
  return best;
}

/**
 * Premium "stat history" (design screen 2s). Everything here is derived
 * straight from daily_steps + leaderboard_snapshots the app already writes
 * — no fabricated superlatives. "Win rate" is the share of league-nights
 * (leaderboard_snapshots rows) you finished #1 in; "Daily avg" is per
 * active day, matching the app's existing month/year stat conventions.
 */
export default function StatsHistory() {
  const { t, i18n } = useTranslation();
  const TAB_OPTIONS: { value: Tab; label: string }[] = [
    { value: 'leagues', label: t('stats.history.tabs.leagues') },
    { value: 'year', label: t('stats.history.tabs.year') },
    { value: 'alltime', label: t('stats.history.tabs.allTime') },
  ];
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { session, profile } = useSession();
  const [tab, setTab] = useState<Tab>('year');
  const [stats, setStats] = useState<StepStats | null>(null);
  const [dailyMap, setDailyMap] = useState<Map<string, number>>(new Map());
  const [leagues, setLeagues] = useState<LeaguePlayedSummary[] | null>(null);
  const [yearWinRate, setYearWinRate] = useState<number | null>(null);
  const [allTimeWinRate, setAllTimeWinRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile && !profile.is_pro) router.replace('/premium');
  }, [profile]);

  useEffect(() => {
    if (!session || !profile) return;
    getStepStatsAndMap(session.user.id, profile.timezone)
      .then(({ stats: s, map }) => {
        setStats(s);
        setDailyMap(map);
      })
      .finally(() => setLoading(false));
  }, [session, profile]);

  useEffect(() => {
    getMyLeaguesPlayed()
      .then(setLeagues)
      .catch(() => setLeagues([]));
  }, []);

  const year = new Date().getFullYear();

  useEffect(() => {
    getMySnapshotWinStats({ start: `${year}-01-01`, end: `${year}-12-31` })
      .then((r) => setYearWinRate(r.total ? Math.round((r.wins / r.total) * 100) : 0))
      .catch(() => setYearWinRate(0));
    getMySnapshotWinStats()
      .then((r) => setAllTimeWinRate(r.total ? Math.round((r.wins / r.total) * 100) : 0))
      .catch(() => setAllTimeWinRate(0));
  }, [year]);

  const firstDateKey = useMemo(() => {
    const keys = Array.from(dailyMap.entries())
      .filter(([, v]) => v > 0)
      .map(([k]) => k)
      .sort();
    return keys[0] ?? null;
  }, [dailyMap]);

  const daysTracked = firstDateKey ? Math.round((Date.now() - Date.parse(`${firstDateKey}T00:00:00`)) / 86400000) + 1 : 0;
  const subtitle = firstDateKey
    ? t('stats.history.trackingSince', {
        date: new Date(`${firstDateKey}T00:00:00`).toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' }),
        count: daysTracked,
      })
    : t('stats.history.noStepsYet');

  const yearActiveDays = useMemo(
    () => Array.from(dailyMap.entries()).filter(([k, v]) => k.startsWith(String(year)) && v > 0).length,
    [dailyMap, year]
  );
  const yearDailyAvg = yearActiveDays ? Math.round((stats?.year ?? 0) / yearActiveDays) : 0;
  const allTimeDailyAvg = stats?.daysLogged ? Math.round((stats?.allTime ?? 0) / stats.daysLogged) : 0;

  const monthAverages = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const prefix = `${year}-${String(i + 1).padStart(2, '0')}`;
      let total = 0;
      let active = 0;
      for (const [k, v] of dailyMap) {
        if (v > 0 && k.startsWith(prefix)) {
          total += v;
          active += 1;
        }
      }
      return { month: i + 1, avg: active ? Math.round(total / active) : 0 };
    });
  }, [dailyMap, year]);

  const yearAverages = useMemo(() => {
    const byYear = new Map<string, { total: number; active: number }>();
    for (const [k, v] of dailyMap) {
      if (v <= 0) continue;
      const y = k.slice(0, 4);
      const e = byYear.get(y) ?? { total: 0, active: 0 };
      e.total += v;
      e.active += 1;
      byYear.set(y, e);
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([y, e]) => ({ year: y, avg: e.active ? Math.round(e.total / e.active) : 0 }));
  }, [dailyMap]);

  function dowAveragesFor(scopeYear?: number) {
    const sums = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    for (const [k, v] of dailyMap) {
      if (v <= 0) continue;
      if (scopeYear && !k.startsWith(String(scopeYear))) continue;
      const idx = dowIndex(k);
      sums[idx] += v;
      counts[idx] += 1;
    }
    return sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]) : 0));
  }
  const yearDow = useMemo(() => dowAveragesFor(year), [dailyMap, year]);
  const allTimeDow = useMemo(() => dowAveragesFor(), [dailyMap]);

  const streak = useMemo(() => longestStreak(dailyMap), [dailyMap]);

  const yearProjection = useMemo(() => yearEndProjection(stats?.year ?? 0, year), [stats?.year, year]);
  const yearTrend = useMemo(() => recentTrend(dailyMap, 14), [dailyMap]);
  const yearConsistency = yearActiveDays ? Math.round((yearActiveDays / daysElapsedInYear(year)) * 100) : 0;

  const allTimeTrend = useMemo(() => recentTrend(dailyMap, 30), [dailyMap]);
  const allTimeConsistency = stats?.daysLogged && daysTracked ? Math.round((stats.daysLogged / daysTracked) * 100) : 0;
  const milestone = useMemo(() => milestoneProjection(stats?.allTime ?? 0, dailyMap), [stats?.allTime, dailyMap]);

  const yearPredictions: PredictionRow[] = [
    ...(yearProjection
      ? [{ label: t('stats.history.predictions.yearEndPace'), value: compactNumber(yearProjection), caption: t('stats.history.predictions.yearEndPaceCaption') }]
      : []),
    ...(yearTrend
      ? [
          {
            label: t('stats.history.predictions.trend'),
            value: `${yearTrend.pct > 0 ? '+' : ''}${yearTrend.pct}%`,
            caption: t('stats.history.predictions.trendCaption14'),
            accent: yearTrend.direction === 'up',
          },
        ]
      : []),
    { label: t('stats.history.predictions.consistency'), value: `${yearConsistency}%`, caption: t('stats.history.predictions.consistencyCaptionYear') },
  ];

  const allTimePredictions: PredictionRow[] = [
    ...(milestone
      ? [
          {
            label: t('stats.history.predictions.nextMilestone', { milestone: compactNumber(milestone.milestone) }),
            value: t('stats.history.predictions.daysApprox', { count: milestone.days }),
            caption: t('stats.history.predictions.nextMilestoneCaption', {
              date: milestone.date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' }),
            }),
          },
        ]
      : []),
    ...(allTimeTrend
      ? [
          {
            label: t('stats.history.predictions.trend'),
            value: `${allTimeTrend.pct > 0 ? '+' : ''}${allTimeTrend.pct}%`,
            caption: t('stats.history.predictions.trendCaption30'),
            accent: allTimeTrend.direction === 'up',
          },
        ]
      : []),
    { label: t('stats.history.predictions.consistency'), value: `${allTimeConsistency}%`, caption: t('stats.history.predictions.consistencyCaptionAllTime') },
  ];

  if (!profile?.is_pro) return null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + theme.space(3) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(3) }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingTop: theme.space(1) }}>
            <Text style={{ fontSize: 22, color: colors.text }}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>{t('stats.history.title')}</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
          </View>
        </View>
        <View style={[styles.premiumChip, { backgroundColor: colors.accentChip }]}>
          <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.accent }}>
            {t('leagues.peek.premium')}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.space(4.5), paddingTop: theme.space(3), paddingBottom: insets.bottom + theme.space(8) }}
      >
        <Tabs options={TAB_OPTIONS} value={tab} onChange={setTab} />
        <View style={{ marginTop: theme.space(4) }}>
          {loading ? (
            <ActivityIndicator color={colors.textMuted} style={{ marginTop: theme.space(8) }} />
          ) : tab === 'leagues' ? (
            <LeagueListSection leagues={leagues} />
          ) : tab === 'year' ? (
            <ScopeSection
              totalLabel={t('stats.history.totalYear', { year })}
              total={stats?.year ?? 0}
              dailyAvg={yearDailyAvg}
              winRate={yearWinRate}
              predictions={yearPredictions}
              chartTitle={t('stats.history.monthlyAverage')}
              chartBars={monthAverages.map((m) => ({ key: String(m.month), value: m.avg }))}
              chartAxis={monthlyAxis(t, i18n.language, monthAverages)}
              dow={yearDow}
              leagues={leagues}
              insight={dowInsight(t, i18n.language, yearDow)}
            />
          ) : (
            <ScopeSection
              totalLabel={t('stats.history.totalAllTime')}
              total={stats?.allTime ?? 0}
              dailyAvg={allTimeDailyAvg}
              winRate={allTimeWinRate}
              predictions={allTimePredictions}
              chartTitle={t('stats.history.yearlyAverage')}
              chartBars={yearAverages.map((y) => ({ key: y.year, value: y.avg }))}
              chartAxis={yearlyAxis(t, yearAverages)}
              dow={allTimeDow}
              leagues={leagues}
              insight={
                streak > 1
                  ? t('stats.history.insightWithStreak', { insight: dowInsight(t, i18n.language, allTimeDow), count: streak })
                  : dowInsight(t, i18n.language, allTimeDow)
              }
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function monthlyAxis(t: TFunction, locale: string, monthAverages: { month: number; avg: number }[]): [string, string, string] {
  const labels = monthLabels(locale);
  const withData = monthAverages.filter((m) => m.avg > 0);
  const best = withData.reduce((b, m) => (m.avg > (b?.avg ?? -1) ? m : b), withData[0]);
  const bestLabel = best ? t('stats.history.axisBest', { label: labels[best.month - 1] }) : '-';
  return [labels[0], bestLabel, labels[11]];
}

function yearlyAxis(t: TFunction, yearAverages: { year: string; avg: number }[]): [string, string, string] {
  if (yearAverages.length === 0) return ['-', '-', '-'];
  const best = yearAverages.reduce((b, y) => (y.avg > b.avg ? y : b), yearAverages[0]);
  return [yearAverages[0].year, t('stats.history.axisBest', { label: best.year }), yearAverages[yearAverages.length - 1].year];
}

function dowInsight(t: TFunction, locale: string, dow: number[]): string {
  const labels = dayLabels(locale);
  const withData = dow.map((v, i) => ({ v, i })).filter((d) => d.v > 0);
  if (withData.length === 0) return t('stats.history.dowInsightEmpty');
  const best = withData.reduce((b, d) => (d.v > b.v ? d : b));
  const worst = withData.reduce((b, d) => (d.v < b.v ? d : b));
  if (best.i === worst.i) return t('stats.history.dowInsightSingle', { count: best.v, day: labels[best.i] });
  const multiplier = Math.round((best.v / Math.max(1, worst.v)) * 10) / 10;
  return t('stats.history.dowInsightCompare', { bestDay: labels[best.i], multiplier, worstDay: labels[worst.i] });
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: accent ? colors.accent : colors.text }]}>{value}</Text>
    </View>
  );
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

function ScopeSection({
  totalLabel,
  total,
  dailyAvg,
  winRate,
  predictions,
  chartTitle,
  chartBars,
  chartAxis,
  dow,
  leagues,
  insight,
}: {
  totalLabel: string;
  total: number;
  dailyAvg: number;
  winRate: number | null;
  predictions: PredictionRow[];
  chartTitle: string;
  chartBars: { key: string; value: number }[];
  chartAxis: [string, string, string];
  dow: number[];
  leagues: LeaguePlayedSummary[] | null;
  insight: string;
}) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const labels = useMemo(() => dayLabels(i18n.language), [i18n.language]);
  const maxBar = Math.max(1, ...chartBars.map((b) => b.value));
  const maxDow = Math.max(1, ...dow);
  const bestDowIdx = dow.indexOf(Math.max(...dow));

  return (
    <View>
      <View style={styles.statRow}>
        <StatCard label={totalLabel} value={compactNumber(total)} accent />
        <StatCard label={t('stats.history.dailyAvg')} value={dailyAvg.toLocaleString()} />
        <StatCard label={t('stats.history.winRate')} value={winRate === null ? '-' : `${winRate}%`} />
      </View>

      {predictions.length > 0 && (
        <>
          <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>{t('stats.history.predictionsHeading')}</Text>
          <View style={[styles.predictionsCard, { backgroundColor: colors.card }]}>
            {predictions.map((p, i) => (
              <View key={p.label} style={[styles.predictionRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: theme.fontFamily.bodySemiBold, color: colors.text }}>{p.label}</Text>
                  <Text style={{ marginTop: 2, fontSize: 11, lineHeight: 15, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium }}>{p.caption}</Text>
                </View>
                <Text style={{ fontSize: 20, fontFamily: theme.fontFamily.heading, color: p.accent ? colors.accent : colors.text, fontVariant: ['tabular-nums'] }}>
                  {p.value}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.predictionsFootnote, { color: colors.textDim }]}>
            {t('stats.history.predictionsFootnote')}
          </Text>
        </>
      )}

      <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: predictions.length > 0 ? theme.space(5) : 0 }]}>{chartTitle}</Text>
      <View style={{ gap: theme.space(1.5) }}>
        <View style={styles.chartRow}>
          {chartBars.map((b, i) => (
            <View
              key={b.key}
              style={[
                styles.bar,
                { height: Math.max(3, (b.value / maxBar) * 104), backgroundColor: b.value === 0 ? colors.border : b.value === maxBar ? colors.accent : colors.controlBorder },
              ]}
            />
          ))}
          {chartBars.length === 0 && <View style={{ height: 104 }} />}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[styles.axisLabel, { color: colors.textDim }]}>{chartAxis[0]}</Text>
          <Text style={[styles.axisLabel, { color: colors.textDim }]}>{chartAxis[1]}</Text>
          <Text style={[styles.axisLabel, { color: colors.textDim }]}>{chartAxis[2]}</Text>
        </View>
      </View>

      <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: theme.space(5) }]}>{t('stats.history.byDayOfWeek')}</Text>
      <View style={{ gap: theme.space(2) }}>
        {labels.map((label, i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) }}>
            <Text style={[styles.dowLabel, { color: i === bestDowIdx ? colors.accent : colors.textMuted }]}>{label}</Text>
            <View style={[styles.dowTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.dowFill,
                  { width: `${(dow[i] / maxDow) * 100}%`, backgroundColor: i === bestDowIdx ? colors.accent : colors.controlBorder },
                ]}
              />
            </View>
            <Text style={[styles.dowValue, { color: i === bestDowIdx ? colors.accent : colors.text }]}>{dow[i].toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: theme.space(5) }]}>{t('stats.history.everyLeaguePlayed')}</Text>
      <LeagueListSection leagues={leagues} compact />

      <Text style={[styles.insight, { color: colors.textSubtle }]}>{insight}</Text>
    </View>
  );
}

function LeagueListSection({ leagues, compact }: { leagues: LeaguePlayedSummary[] | null; compact?: boolean }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  if (leagues === null) return <ActivityIndicator color={colors.textMuted} style={{ marginTop: theme.space(6) }} />;
  if (leagues.length === 0) {
    return (
      <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, marginTop: theme.space(2) }}>
        {t('stats.history.noLeaguesPlayed')}
      </Text>
    );
  }
  return (
    <View>
      {leagues.map((l, i) => (
        <View key={l.league_id} style={[styles.leagueRow, { borderTopColor: colors.border }, i === 0 && compact && { borderTopWidth: 0 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 13, color: colors.text }} numberOfLines={1}>
              {l.name}
            </Text>
            <Text style={{ marginTop: theme.space(1), fontSize: 10, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium }}>
              {t('stats.history.membersAndDuration', {
                count: l.memberCount,
                duration: l.isLive ? t('stats.history.live') : t('stats.history.daysCount', { count: l.days }),
              })}
            </Text>
          </View>
          <View
            style={[
              styles.rankPill,
              l.rank === 1 ? { backgroundColor: colors.accent } : { borderWidth: theme.border, borderColor: colors.controlBorder },
            ]}
          >
            <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: l.rank === 1 ? colors.primaryText : colors.textSubtle }}>
              {l.rank ? ordinal(t, l.rank) : '-'}
            </Text>
          </View>
          <Text style={{ width: 56, textAlign: 'right', fontSize: 17, fontFamily: theme.fontFamily.heading, color: colors.text, fontVariant: ['tabular-nums'] }}>
            {compactNumber(l.totalSteps)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: theme.space(4.5),
    paddingBottom: theme.space(4),
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.space(3),
  },
  title: {
    fontSize: 28,
    fontFamily: theme.fontFamily.heading,
    textTransform: 'uppercase',
  },
  subtitle: {
    marginTop: theme.space(1.5),
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  premiumChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.25),
    paddingVertical: theme.space(1.5),
  },
  statRow: {
    flexDirection: 'row',
    gap: theme.space(2),
    marginBottom: theme.space(5),
  },
  statCard: {
    flex: 1,
    borderRadius: theme.radius.md,
    padding: theme.space(3),
  },
  statLabel: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statValue: {
    marginTop: theme.space(1.75),
    fontSize: 22,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  sectionHeading: {
    marginBottom: theme.space(2),
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  chartRow: {
    flexDirection: 'row',
    gap: 4,
    height: 104,
    alignItems: 'flex-end',
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
  axisLabel: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dowLabel: {
    width: 30,
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dowTrack: {
    flex: 1,
    height: 10,
    borderRadius: 2,
    overflow: 'hidden',
  },
  dowFill: {
    height: '100%',
  },
  dowValue: {
    width: 50,
    textAlign: 'right',
    fontSize: 15,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3.25),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rankPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(1),
  },
  insight: {
    marginTop: theme.space(5),
    fontSize: 13,
    lineHeight: 19,
    fontFamily: theme.fontFamily.bodyMedium,
    maxWidth: 320,
  },
  predictionsCard: {
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space(4),
  },
  predictionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3.25),
  },
  predictionsFootnote: {
    marginTop: theme.space(2),
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: theme.fontFamily.bodyMedium,
  },
});
