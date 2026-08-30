import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlatList, Share, StyleSheet, View } from 'react-native';

import { Button, Card, Heading, Muted, Screen } from '@/components/ui';
import { getLeaderboard, listMyLeagues } from '@/lib/leagues';
import { theme } from '@/lib/theme';
import type { LeaderboardRow, League } from '@/lib/types';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeagueDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [officialAsOf, setOfficialAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ rows, officialAsOf }, myLeagues] = await Promise.all([
      getLeaderboard(id),
      listMyLeagues(),
    ]);
    setRows(rows);
    setOfficialAsOf(officialAsOf);
    setLeague(myLeagues.find((l) => l.id === id) ?? null);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleInvite() {
    if (!league) return;
    await Share.share({
      message: `Join my step league "${league.name}" on StepLeague! Use code ${league.invite_code} — ends ${new Date(
        league.deadline
      ).toLocaleDateString()}.`,
    });
  }

  return (
    <Screen>
      <View style={{ paddingTop: theme.space(4) }}>
        <Heading>{league?.name ?? '...'}</Heading>
        <Muted style={{ marginTop: theme.space(1) }}>
          {officialAsOf
            ? `Standings as of last night, plus today's live steps`
            : `Live steps — standings lock in after the first 22:00 update`}
        </Muted>
      </View>

      <FlatList
        style={{ marginTop: theme.space(5) }}
        data={rows}
        keyExtractor={(r) => r.user_id}
        ItemSeparatorComponent={() => <View style={{ height: theme.space(2) }} />}
        ListEmptyComponent={
          !loading ? (
            <Card>
              <Muted>No steps recorded yet — open the app on your phone with Health access granted.</Muted>
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <Card
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderColor: item.is_me ? theme.color.accent : theme.color.border,
              borderWidth: item.is_me ? 1.5 : StyleSheet.hairlineWidth,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3) }}>
              <Muted style={{ width: 28, fontSize: theme.font.body, fontWeight: '700' }}>
                {MEDAL[item.rank] ?? `#${item.rank}`}
              </Muted>
              <Heading style={{ fontSize: theme.font.body }}>
                {item.display_name}
                {item.is_me ? ' (you)' : ''}
              </Heading>
            </View>
            <Heading style={{ fontSize: theme.font.body }}>{item.total_steps.toLocaleString()}</Heading>
          </Card>
        )}
      />

      <Button
        label={`Invite friends · code ${league?.invite_code ?? ''}`}
        variant="secondary"
        onPress={handleInvite}
        style={{ marginTop: theme.space(4) }}
      />
    </Screen>
  );
}
