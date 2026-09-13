import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerField } from '@/components/DatePickerField';
import { LeagueScoreChart } from '@/components/LeagueScoreChart';
import { Avatar, Button, Input, Screen, SectionLabel, Sheet, SheetOption, Tabs } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { dateKeyInTimezone } from '@/lib/steps-shared';
import {
  getLeaderboard,
  getLeagueAwards,
  getLeagueHistory,
  getLeagueMessages,
  getLeagueScoreSeries,
  getMyNemesis,
  getReactionEmojis,
  leaveLeague,
  listMyLeagues,
  reactToMember,
  restartLeague,
  sendLeagueMessage,
  setMyNemesis,
} from '@/lib/leagues';
import type { LeagueScoreSeries } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';
import { theme, useThemeColors } from '@/lib/theme';
import { toDateKey } from '@/lib/timezone';
import { useCountdownClock } from '@/lib/use-countdown-clock';
import type { LeaderboardRow, League, LeagueAward, LeagueMessage, LeagueRoundResult } from '@/lib/types';

function isLeagueEnded(league: League | null): boolean {
  if (!league) return false;
  return new Date(league.deadline) < new Date(new Date().toDateString());
}

function defaultNewDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

export default function LeagueDetail() {
  const { t, i18n } = useTranslation();
  const VIEW_OPTIONS: { value: 'list' | 'graph'; label: string }[] = [
    { value: 'list', label: t('leagues.detail.viewList') },
    { value: 'graph', label: t('leagues.detail.viewGraph') },
  ];
  const colors = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useSession();
  const clock = useCountdownClock(profile?.timezone);
  const insets = useSafeAreaInsets();
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
  const [restartWinnerStakes, setRestartWinnerStakes] = useState('');
  const [restartLoserStakes, setRestartLoserStakes] = useState('');
  const [restartMemberIds, setRestartMemberIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [exitSheetOpen, setExitSheetOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const [messages, setMessages] = useState<LeagueMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

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
      setLoadError(getErrorMessage(e, t('leagues.detail.errors.loadFailed')));
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

  // Chat: initial load + focus refresh, plus a Realtime subscription for new
  // messages so the composer feels live without polling.
  useEffect(() => {
    if (!id) return;
    getLeagueMessages(id)
      .then(setMessages)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `league_id=eq.${id}` },
        () => {
          getLeagueMessages(id)
            .then(setMessages)
            .catch(() => {});
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // The 22:00 results takeover: shown once per league per day, the first
  // time the user opens a league whose standings just locked in for today.
  // "Just landed" means officialAsOf is today in the member's own timezone
  // — otherwise every league visit on an old snapshot would pop it.
  useEffect(() => {
    if (!id || !league || !officialAsOf || isLeagueEnded(league) || !profile?.timezone) return;
    const today = dateKeyInTimezone(new Date(), profile.timezone);
    if (officialAsOf !== today) return;
    const storageKey = `stepleague:results-seen:${id}`;
    let cancelled = false;
    AsyncStorage.getItem(storageKey).then((seen) => {
      if (cancelled || seen === officialAsOf) return;
      AsyncStorage.setItem(storageKey, officialAsOf).catch(() => {});
      router.push({ pathname: '/leagues/results', params: { id, date: officialAsOf, name: league.name } });
    });
    return () => {
      cancelled = true;
    };
  }, [id, league, officialAsOf, profile?.timezone, router]);

  async function handleSendMessage() {
    if (!id || !messageDraft.trim()) return;
    const body = messageDraft.trim();
    setMessageDraft('');
    setSendingMessage(true);
    try {
      await sendLeagueMessage(id, body);
      setMessages(await getLeagueMessages(id));
    } catch {
      setMessageDraft(body);
    } finally {
      setSendingMessage(false);
    }
  }

  const ended = isLeagueEnded(league);
  const isCreator = !!session && league?.created_by === session.user.id;

  const myRow = rows.find((r) => r.is_me);
  const nemesisRow = rows.find((r) => r.user_id === nemesisId);
  const winner = rows[0];

  async function handleInvite() {
    if (!league) return;
    await Share.share({
      message: t('leagues.detail.inviteMessage', {
        name: league.name,
        code: league.invite_code,
        date: new Date(league.deadline).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
      }),
    });
  }

  function handleStartRestart() {
    setRestartMemberIds(new Set(rows.map((r) => r.user_id)));
    setRestartWinnerStakes(league?.winner_stakes ?? '');
    setRestartLoserStakes(league?.loser_stakes ?? '');
    setRestarting(true);
  }

  function toggleRestartMember(userId: string) {
    setRestartMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleConfirmRestart() {
    if (!id) return;
    setRestartError(null);
    setRestartLoading(true);
    try {
      await restartLeague(id, toDateKey(newDeadline), {
        memberIds: Array.from(restartMemberIds),
        winnerStakes: restartWinnerStakes,
        loserStakes: restartLoserStakes,
      });
      setRestarting(false);
      await load();
    } catch (e) {
      setRestartError(getErrorMessage(e, t('leagues.detail.errors.restartFailed')));
    } finally {
      setRestartLoading(false);
    }
  }

  async function handleExitLeague() {
    if (!id) return;
    setExitError(null);
    setExiting(true);
    try {
      await leaveLeague(id);
      setExitSheetOpen(false);
      router.replace('/');
    } catch (e) {
      setExitError(getErrorMessage(e, t('leagues.detail.errors.exitFailed')));
    } finally {
      setExiting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: theme.space(1.5) }}>
          <Text style={[styles.leagueName, { color: colors.text }]}>{league?.name ?? '…'}</Text>
          <Text style={[styles.leagueMeta, { color: colors.textMuted }]}>
            {t('leagues.detail.membersCount', { count: rows.length })}
            {' · '}
            {ended
              ? t('leagues.detail.finished')
              : league
                ? t('leagues.detail.endsOn', { date: new Date(league.deadline).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) })
                : ''}
            {league ? ` · ${league.scoring_mode === 'daily_wins' ? t('leagues.detail.scoringDailyWins') : t('leagues.detail.scoringTotalSteps')}` : ''}
          </Text>
        </View>
        {!ended && (
          <View style={{ flexDirection: 'row', gap: theme.space(2) }}>
            <Pressable
              onPress={() =>
                id &&
                router.push({ pathname: '/leagues/peek', params: { id, name: league?.name ?? '' } })
              }
              style={({ pressed }) => [styles.inviteButton, { borderColor: pressed ? colors.accent : colors.controlBorder }]}
            >
              <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted }}>
                {t('leagues.detail.peek')}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleInvite}
              style={({ pressed }) => [styles.inviteButton, { borderColor: pressed ? colors.accent : colors.controlBorder }]}
            >
              <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted }}>
                {t('leagues.detail.invite')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {(league?.winner_stakes || league?.loser_stakes) && (
        <View style={[styles.stakesCard, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}>
          {league?.winner_stakes && (
            <Text style={{ fontSize: 12.5, lineHeight: 18, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>
              <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, color: colors.accent }}>{t('leagues.detail.winnerGets')} </Text>
              {league.winner_stakes}
            </Text>
          )}
          {league?.loser_stakes && (
            <Text
              style={{
                marginTop: league?.winner_stakes ? theme.space(1.5) : 0,
                fontSize: 12.5,
                lineHeight: 18,
                fontFamily: theme.fontFamily.bodyMedium,
                color: colors.text,
              }}
            >
              <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, color: colors.textMuted }}>{t('leagues.detail.loserHasTo')} </Text>
              {league.loser_stakes}
            </Text>
          )}
        </View>
      )}

      {!ended && (
        <View style={[styles.countdownCard, { backgroundColor: colors.card, marginBottom: theme.space(4) }]}>
          <View style={{ flex: 1 }}>
            <SectionLabel>
              {officialAsOf
                ? t('leagues.detail.showingDate', { date: new Date(officialAsOf).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }) })
                : t('leagues.detail.liveSteps')}
            </SectionLabel>
            <Text style={[styles.countdownCaption, { color: colors.textDim }]}>{t('leagues.detail.unlocksAt2200')}</Text>
          </View>
          <Text style={[styles.countdownClock, { color: colors.accent, flexShrink: 0 }]}>{clock}</Text>
        </View>
      )}

      {loadError && (
        <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, marginBottom: theme.space(3) }}>
          {loadError}
        </Text>
      )}

      <View style={{ marginBottom: theme.space(3) }}>
        <Tabs options={VIEW_OPTIONS} value={view} onChange={setView} />
      </View>

      {view === 'graph' ? (
        <View style={{ paddingBottom: insets.bottom }}>
          {scoreLoading || !scoreSeries ? (
            <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>{t('leagues.detail.loadingGraph')}</Text>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <Text style={{ fontFamily: theme.fontFamily.heading, fontSize: theme.font.heading, color: colors.text, marginBottom: theme.space(2), textTransform: 'uppercase' }}>
                {t('leagues.detail.leagueScore')}
              </Text>
              <LeagueScoreChart series={scoreSeries} />
            </View>
          )}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(r) => r.user_id}
          ListHeaderComponent={
            <View>
              {ended ? (
                <View>
                  {winner && (
                    <View style={[styles.finalPanel, { backgroundColor: colors.accent }]}>
                      <Text style={styles.finalEyebrow}>{t('leagues.detail.finalStandingsWinner')}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space(3), marginTop: theme.space(2.5) }}>
                        <Text style={styles.finalWinnerName}>{winner.display_name}</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.finalWinnerSteps}>{winner.total_steps.toLocaleString()}</Text>
                          <Text style={styles.finalWinnerMeta}>
                            {t('leagues.detail.dailyWinsCount', { count: winner.points })}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              ) : (
                rows.length > 1 && (
                  <Text style={{ fontSize: 11, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium, marginBottom: theme.space(2) }}>
                    {t('leagues.detail.holdToReact')}
                  </Text>
                )
              )}

              <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.tableHeaderCell, { width: 26, color: colors.textDim }]}>#</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1, color: colors.textDim }]}>{t('leagues.detail.columnMember')}</Text>
                <Text style={[styles.tableHeaderCell, { width: 70, textAlign: 'right', color: colors.textDim }]}>{t('home.leaderboards.columnSteps')}</Text>
                <Text style={[styles.tableHeaderCell, { width: 40, textAlign: 'right', color: colors.textDim }]}>{t('leagues.detail.columnPoints')}</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <Text style={{ paddingVertical: theme.space(4), color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>
                {t('leagues.detail.noStepsRecorded')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const mine = item.is_me;
            return (
              <Pressable
                disabled={ended || mine}
                delayLongPress={450}
                onLongPress={() => setReactionTarget({ userId: item.user_id, name: item.display_name })}
              >
                <View
                  style={[
                    styles.memberRow,
                    { borderTopColor: colors.border },
                    mine && styles.memberRowMine,
                    mine && { backgroundColor: colors.accentWash },
                  ]}
                >
                  <Text style={[styles.rank, { color: mine ? colors.accent : colors.text }]}>{item.rank}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) }}>
                    <Avatar name={item.display_name} uri={item.avatar_url} size={26} variant={mine ? 'accent' : 'default'} />
                    <Text style={[styles.memberName, { color: mine ? colors.accent : colors.text }]} numberOfLines={1}>
                      {mine ? t('common.you') : item.display_name}
                    </Text>
                  </View>
                  <Text style={[styles.stepsCell, { color: mine ? colors.accent : colors.text }]}>
                    {item.total_steps.toLocaleString()}
                  </Text>
                  <Text style={[styles.ptsCell, { color: mine ? colors.accent : colors.text }]}>{item.points}</Text>
                </View>
                {item.reactions.length > 0 && (
                  <View style={[styles.reactionRow, mine && { paddingHorizontal: theme.space(3.5) }]}>
                    {item.reactions.map((r) => (
                      <View key={r.emoji} style={[styles.reactionPill, { backgroundColor: colors.card }]}>
                        <Text style={{ fontSize: 12 }}>
                          {r.emoji} {r.count}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </Pressable>
            );
          }}
          ListFooterComponent={
            <View>
              {ended && awards && awards.length > 0 && (
                <View style={styles.awardRow}>
                  {awards.map((a) => (
                    <View key={a.title} style={[styles.awardCell, { backgroundColor: colors.card }]}>
                      <SectionLabel>{a.title}</SectionLabel>
                      <Text style={{ marginTop: theme.space(2), fontFamily: theme.fontFamily.heading, fontSize: 17, color: colors.text }}>
                        {a.winnerName}
                      </Text>
                      <Text style={{ marginTop: 2, fontSize: 11, color: colors.textMuted, fontFamily: theme.fontFamily.bodyMedium }}>
                        {a.description}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {ended && (
                <View style={{ paddingTop: theme.space(4), gap: theme.space(3) }}>
                  {isCreator ? (
                    !restarting ? (
                      <Button label={t('leagues.detail.rematchNewLeague')} onPress={handleStartRestart} arrow />
                    ) : (
                      <View style={{ gap: theme.space(3) }}>
                        <SectionLabel>{t('leagues.detail.newEndDate')}</SectionLabel>
                        <DatePickerField value={newDeadline} onChange={setNewDeadline} minimumDate={new Date()} />

                        <SectionLabel style={{ marginTop: theme.space(2) }}>{t('leagues.create.stakesLabel')}</SectionLabel>
                        <Input
                          placeholder={t('leagues.create.winnerStakesPlaceholder')}
                          value={restartWinnerStakes}
                          onChangeText={setRestartWinnerStakes}
                          maxLength={140}
                        />
                        <Input
                          placeholder={t('leagues.create.loserStakesPlaceholder')}
                          value={restartLoserStakes}
                          onChangeText={setRestartLoserStakes}
                          maxLength={140}
                        />

                        <SectionLabel style={{ marginTop: theme.space(2) }}>{t('leagues.detail.whosPlaying')}</SectionLabel>
                        <View style={{ gap: theme.space(2) }}>
                          {rows.map((r) => {
                            const checked = restartMemberIds.has(r.user_id);
                            const isSelf = r.user_id === session?.user.id;
                            return (
                              <Pressable
                                key={r.user_id}
                                onPress={() => !isSelf && toggleRestartMember(r.user_id)}
                                disabled={isSelf}
                                style={styles.restartMemberRow}
                              >
                                <View
                                  style={[
                                    styles.restartCheckbox,
                                    { borderColor: colors.controlBorder },
                                    (checked || isSelf) && { backgroundColor: colors.accent, borderColor: colors.accent },
                                  ]}
                                >
                                  {(checked || isSelf) && <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodyBold, color: colors.primaryText }}>✓</Text>}
                                </View>
                                <Avatar name={r.display_name} uri={r.avatar_url} size={26} />
                                <Text style={{ flex: 1, fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>
                                  {isSelf ? t('common.you') : r.display_name}
                                  {isSelf ? t('leagues.detail.alwaysIn') : ''}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        {restartError && (
                          <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium }}>{restartError}</Text>
                        )}
                        <View style={{ flexDirection: 'row', gap: theme.space(3), alignItems: 'stretch' }}>
                          <Button style={{ flex: 1 }} label={t('common.cancel')} variant="secondary" onPress={() => setRestarting(false)} />
                          <Button
                            style={{ flex: 1 }}
                            label={t('leagues.detail.confirm')}
                            onPress={handleConfirmRestart}
                            loading={restartLoading}
                          />
                        </View>
                      </View>
                    )
                  ) : (
                    <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>
                      {t('leagues.detail.waitingForOwner')}
                    </Text>
                  )}
                  <Button
                    label={t('leagues.detail.shareFinalTable')}
                    variant="secondary"
                    onPress={() => id && router.push({ pathname: '/leagues/share', params: { id } })}
                  />
                </View>
              )}

              {!ended && myRow && (
                <Pressable onPress={() => setNemesisSheetOpen(true)} style={[styles.rivalRow, { backgroundColor: colors.card }]}>
                  <SectionLabel>{t('leagues.detail.rival')}</SectionLabel>
                  {nemesisRow ? (
                    <Text style={{ marginTop: theme.space(1.5), fontFamily: theme.fontFamily.heading, fontSize: 17, color: colors.text }}>
                      {nemesisRow.display_name}
                      <Text style={{ fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>
                        {' '}
                        ·{' '}
                        {myRow.total_steps >= nemesisRow.total_steps
                          ? t('leagues.detail.stepsAhead', {
                              count: Math.abs(myRow.total_steps - nemesisRow.total_steps),
                              steps: Math.abs(myRow.total_steps - nemesisRow.total_steps).toLocaleString(),
                            })
                          : t('leagues.detail.stepsBehind', {
                              count: Math.abs(myRow.total_steps - nemesisRow.total_steps),
                              steps: Math.abs(myRow.total_steps - nemesisRow.total_steps).toLocaleString(),
                            })}
                      </Text>
                    </Text>
                  ) : (
                    <Text style={{ marginTop: theme.space(1.5), color: colors.textMuted, fontFamily: theme.fontFamily.bodyMedium }}>
                      {t('leagues.detail.tapToPickRival')}
                    </Text>
                  )}
                </Pressable>
              )}

              {history.length > 0 && (
                <View style={{ paddingTop: theme.space(4), gap: theme.space(2.5) }}>
                  <Text style={{ fontFamily: theme.fontFamily.heading, fontSize: theme.font.heading, color: colors.text, textTransform: 'uppercase' }}>
                    {t('leagues.detail.pastRounds')}
                  </Text>
                  {history.map((round) => (
                    <View key={round.round_number} style={[styles.pastRound, { backgroundColor: colors.card }]}>
                      <Text style={{ fontSize: 11, color: colors.textMuted, fontFamily: theme.fontFamily.bodyMedium }}>
                        {t('leagues.detail.roundDateRange', {
                          number: round.round_number,
                          start: new Date(round.start_date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
                          end: new Date(round.end_date).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
                        })}
                      </Text>
                      {round.standings[0] && (
                        <Text style={{ marginTop: theme.space(1), fontFamily: theme.fontFamily.heading, fontSize: 17, color: colors.text }}>
                          {t('leagues.detail.standingSteps', {
                            name: round.standings[0].display_name,
                            count: round.standings[0].total_steps,
                            steps: round.standings[0].total_steps.toLocaleString(),
                          })}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <View style={{ paddingTop: theme.space(5), paddingBottom: theme.space(2) }}>
                <SectionLabel>{t('leagues.detail.leagueChat')}</SectionLabel>
              </View>
              <View style={{ gap: theme.space(3), paddingBottom: theme.space(3) }}>
                {messages.length === 0 ? (
                  <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
                    {t('leagues.detail.noMessagesYet')}
                  </Text>
                ) : (
                  messages.map((m) => (
                    <View key={m.id} style={{ flexDirection: 'row', gap: theme.space(2.75) }}>
                      <Avatar name={m.display_name} uri={m.avatar_url} size={26} variant={m.is_me ? 'accent' : 'default'} />
                      <View style={{ flex: 1 }}>
                        <Text>
                          <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 12, color: colors.text }}>
                            {m.is_me ? t('common.you') : m.display_name}{' '}
                          </Text>
                          <Text style={{ fontFamily: theme.fontFamily.bodyMedium, fontSize: 11, color: colors.textDim }}>
                            {new Date(m.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </Text>
                        <Text style={{ marginTop: 3, fontSize: 13, fontFamily: theme.fontFamily.bodyMedium, color: colors.textSubtle }}>
                          {m.body}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {!isCreator && (
                <Pressable onPress={() => setExitSheetOpen(true)} hitSlop={8} style={{ paddingVertical: theme.space(3), alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted }}>
                    {t('leagues.detail.exitLeague')}
                  </Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}

      {view === 'list' && (
        <View style={[styles.composer, { borderTopColor: colors.borderStrong, paddingBottom: insets.bottom + theme.space(2) }]}>
          <TextInput
            value={messageDraft}
            onChangeText={setMessageDraft}
            placeholder={t('leagues.detail.saySomething')}
            placeholderTextColor={colors.textDim}
            style={[styles.composerInput, { backgroundColor: colors.card, color: colors.text }]}
            onSubmitEditing={handleSendMessage}
          />
          <Pressable
            onPress={handleSendMessage}
            disabled={sendingMessage || !messageDraft.trim()}
            style={[styles.sendButton, { backgroundColor: colors.accent, opacity: sendingMessage || !messageDraft.trim() ? 0.5 : 1 }]}
          >
            <Text style={styles.sendButtonText}>{t('leagues.detail.send')}</Text>
          </Pressable>
        </View>
      )}

      <Sheet visible={nemesisSheetOpen} onClose={() => setNemesisSheetOpen(false)} title={t('leagues.detail.pickRival')}>
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
        title={reactionTarget ? t('leagues.detail.reactTo', { name: reactionTarget.name }) : undefined}
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

      <Sheet visible={exitSheetOpen} onClose={() => setExitSheetOpen(false)} title={t('leagues.detail.exitThisLeague')}>
        <View style={{ gap: theme.space(3.5) }}>
          <Text style={{ fontSize: 14, lineHeight: 20, fontFamily: theme.fontFamily.bodyMedium, color: colors.textSubtle }}>
            {t('leagues.detail.exitWarning', { name: league?.name ?? t('leagues.detail.thisLeague') })}
          </Text>
          {exitError && (
            <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>{exitError}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: theme.space(3), alignItems: 'stretch' }}>
            <Button style={{ flex: 1 }} label={t('leagues.detail.stay')} variant="secondary" onPress={() => setExitSheetOpen(false)} />
            <Button
              style={{ flex: 1 }}
              label={t('leagues.detail.exitLeague')}
              variant="danger"
              onPress={handleExitLeague}
              loading={exiting}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: theme.space(3),
    paddingBottom: theme.space(3.5),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space(3),
  },
  leagueName: {
    fontSize: 28,
    fontFamily: theme.fontFamily.heading,
    textTransform: 'uppercase',
  },
  leagueMeta: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  inviteButton: {
    borderWidth: theme.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
  },
  countdownCard: {
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(3),
  },
  stakesCard: {
    borderWidth: theme.border,
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
    marginBottom: theme.space(4),
  },
  countdownCaption: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
    marginTop: theme.space(1.75),
  },
  countdownClock: {
    fontSize: 32,
    lineHeight: 30,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  card: {
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
  },
  finalPanel: {
    marginBottom: theme.space(4),
    borderRadius: theme.radius.lg,
    padding: theme.space(4.5),
  },
  finalEyebrow: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#0b0c0a',
    opacity: 0.65,
  },
  finalWinnerName: {
    fontSize: 40,
    lineHeight: 36,
    fontFamily: theme.fontFamily.heading,
    color: '#0b0c0a',
  },
  finalWinnerSteps: {
    fontSize: 26,
    fontFamily: theme.fontFamily.heading,
    color: '#0b0c0a',
    fontVariant: ['tabular-nums'],
  },
  finalWinnerMeta: {
    marginTop: theme.space(1.5),
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#0b0c0a',
    opacity: 0.7,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: theme.space(1.5),
    paddingBottom: theme.space(2.25),
    borderBottomWidth: theme.border,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space(1.5),
    paddingVertical: theme.space(2.75),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  memberRowMine: {
    borderTopWidth: 0,
    borderRadius: theme.radius.md,
    marginHorizontal: -theme.space(2),
    paddingHorizontal: theme.space(3.5),
  },
  rank: {
    width: 26,
    fontSize: 18,
    fontFamily: theme.fontFamily.heading,
  },
  memberName: {
    flex: 1,
    fontSize: 14,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  stepsCell: {
    width: 70,
    textAlign: 'right',
    fontSize: 17,
    fontFamily: theme.fontFamily.heading,
  },
  ptsCell: {
    width: 40,
    textAlign: 'right',
    fontSize: 15,
    fontFamily: theme.fontFamily.heading,
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(1.5),
    paddingHorizontal: theme.space(1.5),
    paddingBottom: theme.space(2.5),
  },
  reactionPill: {
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(1),
    borderRadius: theme.radius.pill,
  },
  awardRow: {
    flexDirection: 'row',
    gap: theme.space(2),
    marginTop: theme.space(3),
  },
  awardCell: {
    flex: 1,
    padding: theme.space(3.5),
    borderRadius: theme.radius.md,
  },
  rivalRow: {
    marginTop: theme.space(3),
    padding: theme.space(3.5),
    borderRadius: theme.radius.lg,
  },
  pastRound: {
    padding: theme.space(3.5),
    borderRadius: theme.radius.lg,
  },
  restartMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2.75),
  },
  restartCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: theme.border + 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingTop: theme.space(3),
    borderTopWidth: theme.border,
  },
  composerInput: {
    flex: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3.25),
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  sendButton: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(4.5),
    paddingVertical: theme.space(3.25),
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#0b0c0a',
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
