import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { CountdownBadge } from '@/components/CountdownBadge';
import { DatePickerField } from '@/components/DatePickerField';
import { LeagueScoreChart } from '@/components/LeagueScoreChart';
import { Avatar, Button, Card, Heading, Muted, Screen, Sheet, SheetOption, Tabs, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import {
  getLeaderboard,
  getLeagueAwards,
  getLeagueHistory,
  getLeagueScoreSeries,
  getMyNemesis,
  getReactionEmojis,
  listMyLeagues,
  reactToMember,
  restartLeague,
  setMyNemesis,
} from '@/lib/leagues';
import type { LeagueScoreSeries } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { toDateKey } from '@/lib/timezone';
import type { LeaderboardRow, League, LeagueAward, LeagueRoundResult } from '@/lib/types';

function isLeagueEnded(league: League | null): boolean {
  if (!league) return false;
  return new Date(league.deadline) < new Date(new Date().toDateString());
}

function defaultNewDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

const VIEW_OPTIONS: { value: 'list' | 'graph'; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'graph', label: 'Graph' },
];

export default function LeagueDetail() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useSession();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [officialAsOf, setOfficialAsOf] = useState<string | null>(null);
  const [awards, setAwards] = useState<LeagueAward[] | null>(null);
  const [history, setHistory] = useState<LeagueRoundResult[]>([]);
  const [nemesisId, setNemesisId] = useState<string | null>(null);
  const [nemesisSheetOpen, setNemesisSheetOpen] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<{ userId: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [scoreSeries, setScoreSeries] = useState<LeagueScoreSeries | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  const [restarting, setRestarting] = useState(false);
  const [newDeadline, setNewDeadline] = useState(defaultNewDeadline);
  const [restartLoading, setRestartLoading] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    let lg: League | null = null;
    try {
      const [{ rows, officialAsOf }, myLeagues, historyResult] = await Promise.all([
        getLeaderboard(id),
        listMyLeagues(),
        getLeagueHistory(id).catch(() => []),
      ]);
      setRows(rows);
      setOfficialAsOf(officialAsOf);
      lg = myLeagues.find((l) => l.id === id) ?? null;
      setLeague(lg);
      setHistory(historyResult);
    } catch (e) {
      setLoadError(getErrorMessage(e, 'Could not load this league.'));
    } finally {
      setLoading(false);
    }

    if (isLeagueEnded(lg)) {
      getLeagueAwards(id)
        .then(setAwards)
        .catch(() => setAwards([]));
    } else {
      getMyNemesis(id)
        .then(setNemesisId)
        .catch(() => setNemesisId(null));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (view !== 'graph' || !id) return;
    setScoreLoading(true);
    getLeagueScoreSeries(id)
      .then(setScoreSeries)
      .catch(() => setScoreSeries({ dates: [], members: [], totals: {} }))
      .finally(() => setScoreLoading(false));
  }, [view, id]);

  const ended = isLeagueEnded(league);
  const isCreator = !!session && league?.created_by === session.user.id;

  const underdog = !ended
    ? rows.reduce<LeaderboardRow | null>(
        (best, r) => (r.deltaSinceYesterday > (best?.deltaSinceYesterday ?? 0) ? r : best),
        null
      )
    : null;

  const myRow = rows.find((r) => r.is_me);
  const nemesisRow = rows.find((r) => r.user_id === nemesisId);
  const leaderTotal = rows[0]?.total_steps ?? 0;

  async function handleInvite() {
    if (!league) return;
    await Share.share({
      message: `Join my step league "${league.name}" on StepLeague! Use code ${league.invite_code} — ends ${new Date(
        league.deadline
      ).toLocaleDateString()}.`,
    });
  }

  async function handleConfirmRestart() {
    if (!id) return;
    setRestartError(null);
    setRestartLoading(true);
    try {
      await restartLeague(id, toDateKey(newDeadline));
      setRestarting(false);
      await load();
    } catch (e) {
      setRestartError(getErrorMessage(e, 'Could not start a new round.'));
    } finally {
      setRestartLoading(false);
    }
  }

  return (
    <Screen>
      <View
        style={{
          paddingTop: theme.space(4),
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
            <Heading>{league?.name ?? '...'}</Heading>
            {league && league.round_number > 1 && (
              <View style={[styles.roundBadge, { backgroundColor: colors.card }]}>
                <Text style={[styles.roundBadgeText, { color: colors.textMuted }]}>Round {league.round_number}</Text>
              </View>
            )}
          </View>
          <Muted style={{ marginTop: theme.space(1) }}>
            {ended
              ? 'Final standings'
              : officialAsOf
                ? `Standings as of last night, plus today's live steps`
                : `Live steps — standings lock in after the first 22:00 update`}
          </Muted>
        </View>
        {profile && !ended && <CountdownBadge timezone={profile.timezone} />}
      </View>

      {loadError && (
        <Card style={{ marginTop: theme.space(4), borderColor: colors.danger }}>
          <Muted style={{ color: colors.danger }}>{loadError}</Muted>
        </Card>
      )}

      <View style={{ marginTop: theme.space(4) }}>
        <Tabs options={VIEW_OPTIONS} value={view} onChange={setView} />
      </View>

      {view === 'graph' ? (
        <View style={{ marginTop: theme.space(5) }}>
          {scoreLoading || !scoreSeries ? (
            <Muted>Loading graph…</Muted>
          ) : (
            <Card>
              <Heading style={{ fontSize: theme.font.body, marginBottom: theme.space(2) }}>League score</Heading>
              <LeagueScoreChart series={scoreSeries} />
            </Card>
          )}
        </View>
      ) : (
        <FlatList
          style={{ marginTop: theme.space(4) }}
          data={rows}
          keyExtractor={(r) => r.user_id}
          ItemSeparatorComponent={() => <View style={{ height: theme.space(2) }} />}
          ListHeaderComponent={
            <View style={{ gap: theme.space(3), marginBottom: theme.space(3) }}>
              {ended && (
                <View style={{ gap: theme.space(2) }}>
                  <Title style={{ fontSize: theme.font.heading }}>Round {league?.round_number ?? 1} ended</Title>
                  {awards === null ? (
                    <Muted>Loading awards…</Muted>
                  ) : awards.length === 0 ? (
                    <Muted>Not enough data for awards this time.</Muted>
                  ) : (
                    awards.map((a) => (
                      <Card key={a.title}>
                        <Heading style={{ fontSize: theme.font.body }}>{a.title}</Heading>
                        <Muted style={{ marginTop: 2 }}>
                          {a.description} · {a.winnerName}
                        </Muted>
                      </Card>
                    ))
                  )}

                  {isCreator ? (
                    <Card style={{ gap: theme.space(3) }}>
                      <Heading style={{ fontSize: theme.font.body }}>Ready for another round?</Heading>
                      {!restarting ? (
                        <Button label="Start again" onPress={() => setRestarting(true)} />
                      ) : (
                        <>
                          <Muted>New end date</Muted>
                          <DatePickerField
                            value={newDeadline}
                            onChange={setNewDeadline}
                            minimumDate={new Date()}
                          />
                          {restartError && <Muted style={{ color: colors.danger }}>{restartError}</Muted>}
                          <View style={{ flexDirection: 'row', gap: theme.space(3) }}>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Cancel"
                                variant="secondary"
                                onPress={() => setRestarting(false)}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Button
                                label="Confirm"
                                onPress={handleConfirmRestart}
                                loading={restartLoading}
                              />
                            </View>
                          </View>
                        </>
                      )}
                    </Card>
                  ) : (
                    <Card>
                      <Muted>Waiting for the league owner to start a new round.</Muted>
                    </Card>
                  )}
                </View>
              )}

              {!ended && underdog && underdog.deltaSinceYesterday > 0 && (
                <Card style={[styles.accentCard, { borderColor: colors.accent }]}>
                  <Muted style={styles.caption}>TODAY'S MOVER</Muted>
                  <Heading style={{ fontSize: theme.font.body, marginTop: 2 }}>
                    {underdog.display_name}
                    <Muted> +{underdog.deltaSinceYesterday.toLocaleString()} vs yesterday</Muted>
                  </Heading>
                </Card>
              )}

              {!ended && myRow && (
                <Pressable onPress={() => setNemesisSheetOpen(true)}>
                  <Card>
                    <Muted style={styles.caption}>RIVAL</Muted>
                    {nemesisRow ? (
                      <Heading style={{ fontSize: theme.font.body, marginTop: 2 }}>
                        {nemesisRow.display_name}
                        <Muted>
                          {' '}
                          · {Math.abs(myRow.total_steps - nemesisRow.total_steps).toLocaleString()} steps{' '}
                          {myRow.total_steps >= nemesisRow.total_steps ? 'ahead' : 'behind'}
                        </Muted>
                      </Heading>
                    ) : (
                      <Muted style={{ marginTop: 2 }}>Tap to pick a rival to track head-to-head.</Muted>
                    )}
                  </Card>
                </Pressable>
              )}

              {!ended && rows.length > 1 && <Muted style={styles.hint}>Hold a name to react to it</Muted>}
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <Card>
                <Muted>No steps recorded yet — open the app on your phone with Health access granted.</Muted>
              </Card>
            ) : null
          }
          renderItem={({ item }) => {
            const progress = leaderTotal > 0 ? Math.min(100, (item.total_steps / leaderTotal) * 100) : 0;
            return (
              <Pressable
                disabled={ended || item.is_me}
                delayLongPress={450}
                onLongPress={() => setReactionTarget({ userId: item.user_id, name: item.display_name })}
              >
                <Card
                  style={{
                    borderColor: item.is_me ? colors.accent : colors.border,
                    borderWidth: item.is_me ? 1.5 : StyleSheet.hairlineWidth,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), flex: 1 }}>
                      <Muted style={styles.rank}>{item.rank}</Muted>
                      <Avatar uri={item.avatar_url} name={item.display_name} size={32} />
                      <Heading style={{ fontSize: theme.font.body, flexShrink: 1 }}>
                        {item.display_name}
                        {item.is_me ? ' (you)' : ''}
                      </Heading>
                    </View>
                    <Heading style={{ fontSize: theme.font.body }}>{item.total_steps.toLocaleString()}</Heading>
                  </View>

                  <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                    <View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${progress}%` }]} />
                  </View>

                  {item.reactions.length > 0 && (
                    <View style={styles.reactionRow}>
                      {item.reactions.map((r) => (
                        <View key={r.emoji} style={[styles.reactionPill, { backgroundColor: colors.card }]}>
                          <Text style={[styles.reactionPillText, { color: colors.text }]}>
                            {r.emoji} {r.count}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>
              </Pressable>
            );
          }}
          ListFooterComponent={
            history.length > 0 ? (
              <View style={{ marginTop: theme.space(5), gap: theme.space(2) }}>
                <Heading style={{ fontSize: theme.font.body }}>Past rounds</Heading>
                {history.map((round) => (
                  <Card key={round.round_number}>
                    <Muted>
                      Round {round.round_number} · {new Date(round.start_date).toLocaleDateString()} –{' '}
                      {new Date(round.end_date).toLocaleDateString()}
                    </Muted>
                    {round.standings[0] && (
                      <Heading style={{ fontSize: theme.font.body, marginTop: theme.space(1) }}>
                        {round.standings[0].display_name} — {round.standings[0].total_steps.toLocaleString()} steps
                      </Heading>
                    )}
                  </Card>
                ))}
              </View>
            ) : null
          }
        />
      )}

      {!ended && (
        <Button
          label={`Invite friends · code ${league?.invite_code ?? ''}`}
          variant="secondary"
          onPress={handleInvite}
          style={{ marginTop: theme.space(4) }}
        />
      )}

      <Sheet visible={nemesisSheetOpen} onClose={() => setNemesisSheetOpen(false)} title="Pick a rival">
        {rows
          .filter((r) => !r.is_me)
          .map((r) => (
            <SheetOption
              key={r.user_id}
              label={r.display_name}
              icon={<Avatar uri={r.avatar_url} name={r.display_name} size={32} />}
              onPress={() => {
                if (!id) return;
                setMyNemesis(id, r.user_id).then(() => {
                  setNemesisSheetOpen(false);
                  load();
                });
              }}
            />
          ))}
      </Sheet>

      <Sheet
        visible={!!reactionTarget}
        onClose={() => setReactionTarget(null)}
        title={reactionTarget ? `React to ${reactionTarget.name}` : undefined}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: theme.space(2) }}>
          {getReactionEmojis().map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                if (!reactionTarget || !id) return;
                reactToMember(id, reactionTarget.userId, emoji).then(() => {
                  setReactionTarget(null);
                  load();
                });
              }}
              hitSlop={8}
            >
              <Text style={{ fontSize: 32 }}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rank: {
    width: 24,
    fontSize: theme.font.small,
    fontVariant: ['tabular-nums'],
  },
  roundBadge: {
    borderRadius: 999,
    paddingHorizontal: theme.space(2.5),
    paddingVertical: 2,
  },
  roundBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  caption: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  hint: {
    fontSize: 11,
    textAlign: 'center',
  },
  accentCard: {
    borderWidth: 1,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    marginTop: theme.space(3),
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.space(2),
    marginTop: theme.space(3),
  },
  reactionPill: {
    borderRadius: 999,
    paddingHorizontal: theme.space(2.5),
    paddingVertical: 3,
  },
  reactionPillText: {
    fontSize: theme.font.small,
  },
});
