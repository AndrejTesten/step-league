import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button, Screen, SectionLabel, Title } from '@/components/ui';
import { getLeaderboard, listMyLeagues } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { useCountdownClock } from '@/lib/use-countdown-clock';
import { useSession } from '@/lib/auth-context';
import type { League } from '@/lib/types';

type Row = League & { myRank: number | null; memberCount: number; ended: boolean; won: boolean };

function isLeagueEnded(league: League): boolean {
  return new Date(league.deadline) < new Date(new Date().toDateString());
}

export function YourLeaguesPage({ width }: { width: number }) {
  const router = useRouter();
  const colors = useThemeColors();
  const { profile } = useSession();
  const clock = useCountdownClock(profile?.timezone);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const leagues = await listMyLeagues();
      const enriched = await Promise.all(
        leagues.map(async (league) => {
          const ended = isLeagueEnded(league);
          try {
            const { rows: board } = await getLeaderboard(league.id);
            const mine = board.find((r) => r.is_me);
            return {
              ...league,
              myRank: mine?.rank ?? null,
              memberCount: board.length,
              ended,
              won: ended && mine?.rank === 1,
            };
          } catch {
            return { ...league, myRank: null, memberCount: 0, ended, won: false };
          }
        })
      );
      setRows(enriched);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <Screen style={{ width, paddingTop: theme.space(14) }}>
      <View style={{ gap: theme.space(3.5), marginBottom: theme.space(4) }}>
        <Title>Leagues</Title>
        <View style={{ flexDirection: 'row', gap: theme.space(2) }}>
          <View style={{ flex: 1 }}>
            <Button label="Create league" onPress={() => router.push('/leagues/create')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Join with code" variant="secondary" onPress={() => router.push('/leagues/join')} />
          </View>
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={{ height: theme.space(2.5) }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingVertical: theme.space(4) }}>
              <Text style={{ color: colors.text, fontFamily: theme.fontFamily.heading, fontSize: theme.font.heading }}>
                No leagues yet
              </Text>
              <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, marginTop: theme.space(1) }}>
                Create one and send the invite code to your friends.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/leagues/${item.id}`)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: item.ended && !item.won ? colors.bg : colors.card,
                borderColor: pressed ? colors.accent : item.ended && !item.won ? colors.border : colors.borderStrong,
              },
            ]}
          >
            <View style={{ flex: 1, gap: theme.space(2) }}>
              <Text
                style={{
                  fontSize: 22,
                  fontFamily: theme.fontFamily.heading,
                  color: item.ended && !item.won ? colors.textMuted : colors.text,
                }}
              >
                {item.name}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodyMedium, color: item.ended ? colors.textDim : colors.textMuted }}>
                {item.memberCount} member{item.memberCount === 1 ? '' : 's'} ·{' '}
                {item.ended ? 'finished' : 'ends'}{' '}
                {new Date(item.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </Text>
              {item.won ? (
                <View style={[styles.pill, { backgroundColor: colors.accent, alignSelf: 'flex-start' }]}>
                  <Text style={[styles.pillText, { color: colors.primaryText }]}>You won</Text>
                </View>
              ) : !item.ended ? (
                <View style={[styles.pill, { backgroundColor: colors.accentChip, alignSelf: 'flex-start' }]}>
                  <Text style={[styles.pillText, { color: colors.accent }]}>Sealed · {clock.split(':').slice(0, 2).join(':')} left</Text>
                </View>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 40, lineHeight: 36, fontFamily: theme.fontFamily.heading, color: item.won ? colors.accent : colors.text, fontVariant: ['tabular-nums'] }}>
                {item.myRank ?? '—'}
              </Text>
              <SectionLabel style={{ marginTop: theme.space(1) }}>Of {item.memberCount}</SectionLabel>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          rows.length > 0 ? (
            <Text style={{ marginTop: theme.space(3), maxWidth: 300, fontSize: 12, lineHeight: 18, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium }}>
              Tables always show yesterday. Today's rows unlock at 22:00.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: theme.space(6) }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    borderWidth: theme.border,
    padding: theme.space(4),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space(3.5),
  },
  pill: {
    paddingHorizontal: theme.space(2.25),
    paddingVertical: theme.space(1.25),
    borderRadius: theme.radius.pill,
  },
  pillText: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
