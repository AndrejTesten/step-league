import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, SectionLabel, Tabs } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { DEFAULT_DAILY_GOAL } from '@/lib/equivalences';
import { getHourlySteps } from '@/lib/steps'; // Metro resolves steps.ios.ts / steps.android.ts / steps.web.ts
import { getDailyStepsMap, getStepStats } from '@/lib/stats';
import { dateKeyInTimezone } from '@/lib/steps-shared';
import { theme, useThemeColors } from '@/lib/theme';
import type { StepStats } from '@/lib/types';

type Period = 'day' | 'month' | 'year';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const EMPTY_STATS: StepStats = { today: 0, month: 0, year: 0, allTime: 0, bestDay: 0, daysLogged: 0, streak: 0 };

function addDaysToKey(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Day/Month/Year all share one "cursor" date — the tabs are zoom levels on
 * the same point in time, not independent screens. Drilling in (tap a day
 * bar in Month, a month bar in Year) moves the cursor and switches the
 * active tab; drilling out (tap the Day/Month header) does the reverse.
 */
export default function Stats() {
  const insets = useSafeAreaInsets();
  const { session, profile } = useSession();
  const [period, setPeriod] = useState<Period>('month');
  const [stats, setStats] = useState<StepStats>(EMPTY_STATS);
  const [dailyMap, setDailyMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const today = profile?.timezone ? dateKeyInTimezone(new Date(), profile.timezone) : new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(today);

  useEffect(() => {
    if (!session || !profile) return;
    Promise.all([getStepStats(session.user.id, profile.timezone), getDailyStepsMap(session.user.id)])
      .then(([s, map]) => {
        setStats(s);
        setDailyMap(map);
      })
      .finally(() => setLoading(false));
  }, [session, profile]);

  const [cursorYear, cursorMonth] = cursor.split('-').map(Number);

  function goToDay(dateKey: string) {
    setCursor(dateKey);
    setPeriod('day');
  }
  function goToMonth(year: number, month: number) {
    setCursor(`${year}-${String(month).padStart(2, '0')}-01`);
    setPeriod('month');
  }
  function goToYear() {
    setPeriod('year');
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(8) }}
      >
        <View style={{ marginBottom: theme.space(4) }}>
          <Tabs options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        </View>

        {loading ? (
          <Text style={{ color: '#a8ada0', fontFamily: theme.fontFamily.bodyMedium }}>Loading…</Text>
        ) : period === 'month' ? (
          <MonthView
            year={cursorYear}
            month={cursorMonth}
            today={today}
            dailyMap={dailyMap}
            yearToDate={stats.year}
            dailyGoal={profile?.daily_goal ?? DEFAULT_DAILY_GOAL}
            onSelectDay={goToDay}
            onDrillUp={goToYear}
          />
        ) : period === 'year' ? (
          <YearView year={cursorYear} dailyMap={dailyMap} onSelectMonth={goToMonth} />
        ) : (
          <DayView
            dateKey={cursor}
            today={today}
            timezone={profile?.timezone}
            onNavigate={setCursor}
            onDrillUp={() => goToMonth(cursorYear, cursorMonth)}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function DayView({
  dateKey,
  today,
  timezone,
  onNavigate,
  onDrillUp,
}: {
  dateKey: string;
  today: string;
  timezone: string | undefined;
  onNavigate: (dateKey: string) => void;
  onDrillUp: () => void;
}) {
  const colors = useThemeColors();
  const [hours, setHours] = useState<number[] | null | undefined>(undefined); // undefined = loading
  const isToday = dateKey === today;

  useEffect(() => {
    if (!timezone) return;
    setHours(undefined);
    let cancelled = false;
    getHourlySteps(dateKey, timezone).then((result) => {
      if (!cancelled) setHours(result);
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey, timezone]);

  const total = hours ? hours.reduce((a, b) => a + b, 0) : 0;
  const nowHour = new Date().getHours();
  const maxHour = Math.max(1, ...(hours ?? []));
  const dayLabel = new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <View>
      <Pressable onPress={onDrillUp} hitSlop={6}>
        <SectionLabel>{isToday ? 'Today' : dayLabel}</SectionLabel>
      </Pressable>
      <View style={styles.dayNavRow}>
        <Pressable onPress={() => onNavigate(addDaysToKey(dateKey, -1))} hitSlop={10} style={styles.dayNavArrow}>
          <Text style={[styles.dayNavArrowText, { color: colors.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.hero, { color: colors.accent, flex: 1, textAlign: 'center' }]}>
          {hours === undefined ? '—' : total.toLocaleString()}
        </Text>
        <Pressable
          onPress={() => !isToday && onNavigate(addDaysToKey(dateKey, 1))}
          hitSlop={10}
          disabled={isToday}
          style={styles.dayNavArrow}
        >
          <Text style={[styles.dayNavArrowText, { color: isToday ? colors.border : colors.text }]}>›</Text>
        </Pressable>
      </View>
      <Text style={[styles.heroCaption, { color: colors.textMuted, textAlign: 'center' }]}>Steps · {dayLabel}</Text>

      <View style={{ marginTop: theme.space(5) }}>
        {hours === null ? (
          <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small, textAlign: 'center', paddingVertical: theme.space(6) }}>
            Hourly data isn't available on this device.
          </Text>
        ) : (
          <View style={{ gap: theme.space(1.5) }}>
            <View style={styles.chartRow}>
              {(hours ?? new Array(24).fill(0)).map((steps, hour) => {
                const isFuture = isToday && hour > nowHour;
                return (
                  <View
                    key={hour}
                    style={[
                      styles.hourBar,
                      isFuture
                        ? { height: 6, backgroundColor: colors.border }
                        : { height: Math.max(4, (steps / maxHour) * 110), backgroundColor: colors.accent },
                    ]}
                  />
                );
              })}
            </View>
            <View style={[styles.chartAxis, { justifyContent: 'space-between' }]}>
              {['00', '06', '12', '18', '24'].map((label) => (
                <Text key={label} style={[styles.axisLabel, { color: colors.textDim }]}>
                  {label}
                </Text>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function MonthView({
  year,
  month,
  today,
  dailyMap,
  yearToDate,
  dailyGoal,
  onSelectDay,
  onDrillUp,
}: {
  year: number;
  month: number;
  today: string;
  dailyMap: Map<string, number>;
  yearToDate: number;
  dailyGoal: number;
  onSelectDay: (dateKey: string) => void;
  onDrillUp: () => void;
}) {
  const colors = useThemeColors();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const dateKey = `${prefix}-${String(i + 1).padStart(2, '0')}`;
        return { day: i + 1, dateKey, steps: dailyMap.get(dateKey) ?? 0 };
      }),
    [prefix, daysInMonth, dailyMap]
  );

  const logged = days.filter((d) => d.steps > 0);
  const total = logged.reduce((sum, d) => sum + d.steps, 0);
  const best = logged.reduce((b, d) => (d.steps > (b?.steps ?? -1) ? d : b), logged[0] as (typeof days)[number] | undefined);
  const average = logged.length ? Math.round(total / logged.length) : 0;
  const overGoal = logged.filter((d) => d.steps >= dailyGoal).length;
  const maxSteps = Math.max(1, ...days.map((d) => d.steps));
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View>
      <Pressable onPress={onDrillUp} hitSlop={6}>
        <SectionLabel>
          {monthLabel} · {logged.length} day{logged.length === 1 ? '' : 's'}
        </SectionLabel>
      </Pressable>
      <Text style={[styles.hero, { color: colors.accent, marginTop: theme.space(1.5) }]}>{total.toLocaleString()}</Text>
      <Text style={[styles.heroCaption, { color: colors.textMuted }]}>Steps this month</Text>

      <View style={{ marginTop: theme.space(5), gap: theme.space(1.5) }}>
        <View style={styles.chartRow}>
          {days.map((d) => {
            const disabled = d.dateKey > today;
            return (
              <Pressable
                key={d.dateKey}
                disabled={disabled}
                onPress={() => onSelectDay(d.dateKey)}
                style={[
                  styles.bar,
                  {
                    height: Math.max(3, (d.steps / maxSteps) * 110),
                    backgroundColor: d.steps === 0 ? colors.border : d.dateKey === best?.dateKey ? colors.accent : colors.controlBorder,
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[styles.axisLabel, { color: colors.textDim }]}>01</Text>
          <Text style={[styles.axisLabel, { color: colors.textDim }]}>{daysInMonth}</Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        <StatCard label="Best day" value={best ? `${best.steps.toLocaleString()} · ${best.day} ${monthLabel.split(' ')[0].slice(0, 3)}` : '—'} />
        <StatCard label="Average / day" value={average.toLocaleString()} />
        <StatCard label="Days over goal" value={`${overGoal} / ${logged.length}`} />
        <StatCard label="Year to date" value={yearToDate.toLocaleString()} />
      </View>
    </View>
  );
}

function YearView({
  year,
  dailyMap,
  onSelectMonth,
}: {
  year: number;
  dailyMap: Map<string, number>;
  onSelectMonth: (year: number, month: number) => void;
}) {
  const colors = useThemeColors();
  const monthTotals = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const prefix = `${year}-${String(i + 1).padStart(2, '0')}`;
        let total = 0;
        for (const [key, steps] of dailyMap) if (key.startsWith(prefix)) total += steps;
        return { month: i + 1, total };
      }),
    [year, dailyMap]
  );
  const monthsWithData = monthTotals.filter((m) => m.total > 0);
  const total = monthTotals.reduce((sum, m) => sum + m.total, 0);
  const best = monthsWithData.reduce((b, m) => (m.total > (b?.total ?? -1) ? m : b), monthsWithData[0]);
  const average = monthsWithData.length ? Math.round(total / monthsWithData.length) : 0;
  const maxTotal = Math.max(1, ...monthTotals.map((m) => m.total));

  return (
    <View>
      <SectionLabel>{year}</SectionLabel>
      <Text style={[styles.hero, { color: colors.accent, marginTop: theme.space(1.5) }]}>{total.toLocaleString()}</Text>
      <Text style={[styles.heroCaption, { color: colors.textMuted }]}>Steps this year</Text>

      <View style={{ marginTop: theme.space(5), gap: theme.space(1.5) }}>
        <View style={styles.chartRow}>
          {monthTotals.map((m) => (
            <Pressable
              key={m.month}
              onPress={() => onSelectMonth(year, m.month)}
              style={[
                styles.bar,
                {
                  height: Math.max(3, (m.total / maxTotal) * 110),
                  backgroundColor: m.total === 0 ? colors.border : m.month === best?.month ? colors.accent : colors.controlBorder,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.chartAxis}>
          {monthTotals.map((m) => (
            <Text key={m.month} style={[styles.axisLabel, { flex: 1, textAlign: 'center', color: colors.textDim }]}>
              {new Date(year, m.month - 1, 1).toLocaleDateString(undefined, { month: 'narrow' })}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.statGrid}>
        <StatCard
          label="Best month"
          value={best ? `${best.total.toLocaleString()} · ${new Date(year, best.month - 1, 1).toLocaleDateString(undefined, { month: 'short' })}` : '—'}
        />
        <StatCard label="Average / month" value={average.toLocaleString()} />
      </View>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card }]}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ marginTop: theme.space(1.75), fontSize: 20, fontFamily: theme.fontFamily.heading, color: colors.text, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    fontSize: 60,
    lineHeight: 56,
    fontFamily: theme.fontFamily.heading,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  heroCaption: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: theme.space(1.5),
  },
  dayNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space(1.5),
  },
  dayNavArrow: {
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(2),
  },
  dayNavArrowText: {
    fontSize: 30,
    fontFamily: theme.fontFamily.heading,
  },
  chartRow: {
    flexDirection: 'row',
    gap: 2,
    height: 110,
    alignItems: 'flex-end',
  },
  chartAxis: {
    flexDirection: 'row',
  },
  bar: {
    flex: 1,
    borderRadius: 1,
  },
  hourBar: {
    flex: 1,
    borderRadius: 1,
  },
  axisLabel: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
    marginTop: theme.space(5),
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
  },
});
