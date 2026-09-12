import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tabs } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getMyLeaguesPlayed, getMySnapshotWinStats } from '@/lib/leagues';
import { getDailyStepsMap, getStepStats } from '@/lib/stats';
import { theme, useThemeColors } from '@/lib/theme';
import type { LeaguePlayedSummary, StepStats } from '@/lib/types';

type Tab = 'leagues' | 'year' | 'alltime';

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: 'leagues', label: 'Leagues' },
  { value: 'year', label: 'Year' },
  { value: 'alltime', label: 'All-time' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dowIndex(dateKey: string): number {
  // getDay(): 0=Sun..6=Sat -> remap to 0=Mon..6=Sun to match DAY_LABELS.
  const d = new Date(`${dateKey}T00:00:00`).getDay();
  return (d + 6) % 7;
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
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
    Promise.all([getStepStats(session.user.id, profile.timezone), getDailyStepsMap(session.user.id)])
      .then(([s, map]) => {
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
    ? `${new Date(`${firstDateKey}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} – today · ${daysTracked} day${daysTracked === 1 ? '' : 's'}`
    : 'No steps recorded yet';

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

  if (!profile?.is_pro) return null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + theme.space(3) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space(3) }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingTop: theme.space(1) }}>
            <Text style={{ fontSize: 22, color: colors.text }}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Stat history</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
          </View>
        </View>
        <View style={[styles.premiumChip, { backgroundColor: colors.accentChip }]}>
          <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.accent }}>
            Premium
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
              totalLabel={`Total ${year}`}
              total={stats?.year ?? 0}
              dailyAvg={yearDailyAvg}
              winRate={yearWinRate}
              chartTitle="Monthly average"
              chartBars={monthAverages.map((m) => ({ key: String(m.month), value: m.avg }))}
              chartAxis={monthlyAxis(monthAverages)}
              dow={yearDow}
              leagues={leagues}
              insight={dowInsight(yearDow)}
            />
          ) : (
            <ScopeSection
              totalLabel="Total all-time"
              total={stats?.allTime ?? 0}
              dailyAvg={allTimeDailyAvg}
              winRate={allTimeWinRate}
              chartTitle="Yearly average"
              chartBars={yearAverages.map((y) => ({ key: y.year, value: y.avg }))}
              chartAxis={yearlyAxis(yearAverages)}
              dow={allTimeDow}
              leagues={leagues}
              insight={
                streak > 1
                  ? `${dowInsight(allTimeDow)} Your longest streak is ${streak} days.`
                  : dowInsight(allTimeDow)
              }
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function monthlyAxis(monthAverages: { month: number; avg: number }[]): [string, string, string] {
  const withData = monthAverages.filter((m) => m.avg > 0);
  const best = withData.reduce((b, m) => (m.avg > (b?.avg ?? -1) ? m : b), withData[0]);
  const bestLabel = best ? `${MONTH_LABELS[best.month - 1]} · best` : '—';
  return [MONTH_LABELS[0], bestLabel, MONTH_LABELS[11]];
}

function yearlyAxis(yearAverages: { year: string; avg: number }[]): [string, string, string] {
  if (yearAverages.length === 0) return ['—', '—', '—'];
  const best = yearAverages.reduce((b, y) => (y.avg > b.avg ? y : b), yearAverages[0]);
  return [yearAverages[0].year, `${best.year} · best`, yearAverages[yearAverages.length - 1].year];
}

function dowInsight(dow: number[]): string {
  const withData = dow.map((v, i) => ({ v, i })).filter((d) => d.v > 0);
  if (withData.length === 0) return "Log a few more days to see your day-of-week pattern.";
  const best = withData.reduce((b, d) => (d.v > b.v ? d : b));
  const worst = withData.reduce((b, d) => (d.v < b.v ? d : b));
  if (best.i === worst.i) return `You average ${best.v.toLocaleString()} steps on ${DAY_LABELS[best.i]}s.`;
  const multiplier = Math.round((best.v / Math.max(1, worst.v)) * 10) / 10;
  return `${DAY_LABELS[best.i]}s are your strongest day — about ${multiplier}x your ${DAY_LABELS[worst.i]} average.`;
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
  chartTitle: string;
  chartBars: { key: string; value: number }[];
  chartAxis: [string, string, string];
  dow: number[];
  leagues: LeaguePlayedSummary[] | null;
  insight: string;
}) {
  const colors = useThemeColors();
  const maxBar = Math.max(1, ...chartBars.map((b) => b.value));
  const maxDow = Math.max(1, ...dow);
  const bestDowIdx = dow.indexOf(Math.max(...dow));

  return (
    <View>
      <View style={styles.statRow}>
        <StatCard label={totalLabel} value={compactNumber(total)} accent />
        <StatCard label="Daily avg" value={dailyAvg.toLocaleString()} />
        <StatCard label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
      </View>

      <Text style={[styles.sectionHeading, { color: colors.textMuted }]}>{chartTitle}</Text>
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

      <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: theme.space(5) }]}>By day of week</Text>
      <View style={{ gap: theme.space(2) }}>
        {DAY_LABELS.map((label, i) => (
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

      <Text style={[styles.sectionHeading, { color: colors.textMuted, marginTop: theme.space(5) }]}>Every league you've played</Text>
      <LeagueListSection leagues={leagues} compact />

      <Text style={[styles.insight, { color: colors.textSubtle }]}>{insight}</Text>
    </View>
  );
}

function LeagueListSection({ leagues, compact }: { leagues: LeaguePlayedSummary[] | null; compact?: boolean }) {
  const colors = useThemeColors();
  if (leagues === null) return <ActivityIndicator color={colors.textMuted} style={{ marginTop: theme.space(6) }} />;
  if (leagues.length === 0) {
    return (
      <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, marginTop: theme.space(2) }}>
        You haven't played any leagues yet.
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
              {l.memberCount} member{l.memberCount === 1 ? '' : 's'} · {l.isLive ? 'live' : `${l.days} day${l.days === 1 ? '' : 's'}`}
            </Text>
          </View>
          <View
            style={[
              styles.rankPill,
              l.rank === 1 ? { backgroundColor: colors.accent } : { borderWidth: theme.border, borderColor: colors.controlBorder },
            ]}
          >
            <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: l.rank === 1 ? colors.primaryText : colors.textSubtle }}>
              {l.rank ? ordinal(l.rank) : '—'}
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
});
