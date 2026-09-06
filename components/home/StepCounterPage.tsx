import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Card, Avatar, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getFunEquivalence } from '@/lib/equivalences';
import { getStepStats } from '@/lib/stats';
import { dateKeyInTimezone } from '@/lib/steps-shared';
import { showSupportPrompt } from '@/lib/support';
import { useSyncStatus } from '@/lib/sync-status';
import { theme, useThemeColors } from '@/lib/theme';
import type { StepStats } from '@/lib/types';

const EMPTY_STATS: StepStats = { today: 0, month: 0, year: 0, allTime: 0, bestDay: 0, daysLogged: 0, streak: 0 };

const STATS: { key: keyof StepStats; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'allTime', label: 'All time' },
];

export function StepCounterPage({ width }: { width: number }) {
  const router = useRouter();
  const colors = useThemeColors();
  const { session, profile } = useSession();
  const [totals, setTotals] = useState<StepStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const syncStatus = useSyncStatus();

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
      const stats = await getStepStats(userId, timezone);
      if (mountedRef.current && requestId === latestRequestId.current) {
        setTotals(stats);
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

  return (
    <Screen style={{ width, paddingTop: theme.space(14) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={showSupportPrompt} hitSlop={12}>
          <Text style={{ fontSize: 22 }}>☕</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/profile')} hitSlop={12}>
          <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={40} />
        </Pressable>
      </View>

      {syncStatus.error && (
        <Card style={{ marginTop: theme.space(4), borderColor: colors.danger }}>
          <Muted style={{ color: colors.danger }}>Steps aren't syncing: {syncStatus.error}</Muted>
        </Card>
      )}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space(2) }}>
        <Muted>Today</Muted>
        <Title style={{ fontSize: 64, fontWeight: '800', letterSpacing: -1 }}>
          {loading ? '—' : displayedToday.toLocaleString()}
        </Title>
        <Muted>steps</Muted>
        {!loading && (
          <Muted style={{ fontSize: theme.font.small, marginTop: theme.space(2) }}>
            {getFunEquivalence(displayedToday)}
          </Muted>
        )}
      </View>

      <View style={{ flexDirection: 'row', marginBottom: theme.space(10) }}>
        {STATS.map((stat) => (
          <View key={stat.key} style={{ flex: 1, alignItems: 'center', gap: theme.space(1) }}>
            <Title style={{ fontSize: theme.font.heading }}>
              {loading ? '—' : totals[stat.key].toLocaleString()}
            </Title>
            <Muted style={{ fontSize: theme.font.small }}>{stat.label}</Muted>
          </View>
        ))}
      </View>
    </Screen>
  );
}
