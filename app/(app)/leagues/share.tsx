import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { Input, Screen, SectionLabel } from '@/components/ui';
import { getLeaderboard, listMyLeagues } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import type { LeaderboardRow, League } from '@/lib/types';

type RowLimit = 3 | 5 | 'me';

/**
 * Share a league's final standings (design screen "2n") — reachable from
 * the "Share final table" button on a finished league. The card below is
 * the actual thing that gets shared: captured as a real PNG via
 * react-native-view-shot, not a text approximation of it. Web can't
 * generate or share that image (no native module there), so the few
 * actions below degrade to a text-only share on web specifically —
 * everywhere this app actually ships (Android now, iOS later) gets the
 * real image.
 */
export default function ShareResults() {
  const { t, i18n } = useTranslation();
  const ROW_LIMIT_OPTIONS: { value: RowLimit; label: string }[] = [
    { value: 3, label: t('leagues.share.top3') },
    { value: 5, label: t('leagues.share.top5') },
    { value: 'me', label: t('leagues.share.justMe') },
  ];
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [league, setLeague] = useState<League | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [rowLimit, setRowLimit] = useState<RowLimit>(5);
  const [caption, setCaption] = useState('');
  const cardRef = useRef<View>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([listMyLeagues(), getLeaderboard(id)])
      .then(([leagues, { rows }]) => {
        setLeague(leagues.find((l) => l.id === id) ?? null);
        setRows(rows);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const winner = rows[0];
  const myRow = rows.find((r) => r.is_me);
  const totalSteps = rows.reduce((sum, r) => sum + r.total_steps, 0);
  const inviteLink = league ? `stepleague://join/${league.invite_code}` : '';
  const visibleRows = rowLimit === 'me' ? [] : rows.slice(1, rowLimit);

  function ordinalWord(n: number): string {
    return t('home.stepCounter.rankOrdinal', { count: n, ordinal: true });
  }

  function fallbackText(): string {
    if (!league) return '';
    const lines =
      rowLimit === 'me' && myRow
        ? [t('leagues.share.placeSteps', { place: ordinalWord(myRow.rank), steps: myRow.total_steps.toLocaleString() })]
        : rows
            .slice(0, rowLimit === 'me' ? 5 : rowLimit)
            .map((r, i) => `${i + 1}. ${r.is_me ? t('common.you') : r.display_name}: ${r.total_steps.toLocaleString()}`);
    const stakes = league.winner_stakes ? t('leagues.share.winnerGetsLine', { stakes: league.winner_stakes }) : '';
    const captionLine = caption.trim() ? `\n"${caption.trim()}"` : '';
    return t('leagues.share.fallbackText', { name: league.name, lines: lines.join('\n'), stakes, captionLine });
  }

  async function captureCardImage(): Promise<string> {
    if (!cardRef.current) throw new Error('Card not ready yet.');
    return captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
  }

  async function handleShareImage() {
    if (busy) return;
    setBusy('share');
    try {
      if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
        await Share.share({ message: fallbackText() });
        return;
      }
      const uri = await captureCardImage();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('leagues.share.dialogTitle', { name: league?.name ?? t('leagues.peek.leagueFallback') }) });
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('leagues.share.errors.shareFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyLink() {
    if (!inviteLink) return;
    await Clipboard.setStringAsync(inviteLink);
    showToast(t('leagues.share.linkCopied'));
  }

  async function handleSaveToPhotos() {
    if (busy) return;
    if (Platform.OS === 'web') {
      showToast(t('leagues.share.errors.notAvailableOnWeb'));
      return;
    }
    setBusy('save');
    try {
      // Dynamic import, not a top-level one — expo-media-library has no web
      // implementation at all and throws on import (not just on use), which
      // would crash this whole screen on web before this function ever
      // runs. Deferring the import to here means only native platforms
      // (which is what this branch is guarded to anyway) ever load it.
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        showToast(t('leagues.share.errors.photoAccessNeeded'));
        return;
      }
      const uri = await captureCardImage();
      await MediaLibrary.saveToLibraryAsync(uri);
      showToast(t('leagues.share.savedToPhotos'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('leagues.share.errors.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  if (loading || !league) {
    return (
      <Screen style={{ paddingTop: theme.space(6) }}>
        <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>{t('common.loading')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingTop: theme.space(4), paddingBottom: insets.bottom + theme.space(6), gap: theme.space(4) }}
        showsVerticalScrollIndicator={false}
      >
        <View ref={cardRef} collapsable={false} style={[styles.shareCard, { backgroundColor: colors.accent }]}>
          <View style={styles.shareCardHeader}>
            <Text style={[styles.shareCardEyebrow, { color: colors.primaryText }]}>{t('leagues.share.cardEyebrow', { name: league.name })}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1.5) }}>
              <View style={[styles.shareCardMark, { backgroundColor: colors.primaryText }]}>
                <Text style={[styles.shareCardMarkText, { color: colors.accent }]}>SL</Text>
              </View>
              <Text style={[styles.shareCardEyebrow, { color: colors.primaryText }]}>{t('leagues.share.appName')}</Text>
            </View>
          </View>

          {winner && (
            <View>
              <Text style={[styles.shareCardLabel, { color: colors.primaryText }]}>{t('leagues.share.winner')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space(3), marginTop: theme.space(2) }}>
                <Text style={[styles.shareCardWinner, { color: colors.primaryText }]}>{winner.display_name}</Text>
                <Text style={[styles.shareCardWinnerSteps, { color: colors.primaryText }]}>{winner.total_steps.toLocaleString()}</Text>
              </View>
              {league.winner_stakes && (
                <Text style={[styles.shareCardStakes, { color: colors.primaryText }]}>{t('leagues.share.winsLabel', { stakes: league.winner_stakes })}</Text>
              )}
            </View>
          )}

          <View style={[styles.shareCardDivider, { backgroundColor: colors.primaryText, opacity: 0.25 }]} />

          {rowLimit === 'me' ? (
            myRow &&
            myRow.rank !== 1 && (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space(3) }}>
                <Text style={[styles.shareCardLabel, { color: colors.primaryText }]}>
                  {t('leagues.share.yourResult')}{'\n'}
                  <Text style={[styles.shareCardWinner, { color: colors.primaryText, fontSize: 26 }]}>{t('leagues.share.placeLabel', { place: ordinalWord(myRow.rank) })}</Text>
                </Text>
                <Text style={[styles.shareCardWinnerSteps, { color: colors.primaryText }]}>{myRow.total_steps.toLocaleString()}</Text>
              </View>
            )
          ) : (
            <View style={{ gap: theme.space(2.25) }}>
              {visibleRows.map((r, i) => (
                <View key={r.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) }}>
                  <Text style={[styles.shareCardRank, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]}>{i + 2}</Text>
                  <Text style={[styles.shareCardName, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]} numberOfLines={1}>
                    {r.is_me ? t('common.you') : r.display_name}
                  </Text>
                  <Text style={[styles.shareCardSteps, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]}>{r.total_steps.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.shareCardDivider, { backgroundColor: colors.primaryText, opacity: 0.25 }]} />

          {caption.trim().length > 0 && (
            <Text style={[styles.shareCardCaption, { color: colors.primaryText }]}>"{caption.trim()}"</Text>
          )}
          {league.loser_stakes && (
            <Text style={[styles.shareCardMeta, { color: colors.primaryText }]}>{t('leagues.share.lastPlaceLabel', { stakes: league.loser_stakes })}</Text>
          )}
          <Text style={[styles.shareCardMeta, { color: colors.primaryText }]}>
            {t('leagues.share.cardFooter', {
              date: new Date(league.deadline).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
              memberCount: rows.length,
              steps: totalSteps.toLocaleString(),
            })}
          </Text>
        </View>

        <View style={{ gap: theme.space(2.5) }}>
          <SectionLabel>{t('leagues.share.customize')}</SectionLabel>
          <View style={styles.rowLimitRow}>
            {ROW_LIMIT_OPTIONS.map((opt) => {
              const active = opt.value === rowLimit;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => setRowLimit(opt.value)}
                  style={[styles.rowLimitChip, active ? { backgroundColor: colors.accent } : { borderWidth: theme.border, borderColor: colors.controlBorder }]}
                >
                  <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', color: active ? colors.primaryText : colors.textMuted }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Input
            placeholder={t('leagues.share.captionPlaceholder')}
            value={caption}
            onChangeText={setCaption}
            maxLength={60}
          />
        </View>

        <View>
          <Pressable onPress={handleShareImage} disabled={busy !== null} style={[styles.infoRow, { borderTopColor: colors.border, opacity: busy ? 0.5 : 1 }]}>
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>{t('leagues.share.shareImage')}</Text>
            <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted }}>
              {busy === 'share' ? t('leagues.share.working') : 'PNG'}
            </Text>
          </Pressable>
          <Pressable onPress={handleCopyLink} style={[styles.infoRow, { borderTopColor: colors.border }]}>
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>{t('leagues.share.copyLink')}</Text>
            <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>{inviteLink}</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveToPhotos}
            disabled={busy !== null}
            style={[styles.infoRow, { borderTopColor: colors.border, borderBottomWidth: theme.border, borderBottomColor: colors.border, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>{t('leagues.share.saveToPhotos')}</Text>
            <Text style={{ fontSize: 14, color: colors.textMuted }}>{busy === 'save' ? t('leagues.share.working') : '→'}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleShareImage}
          disabled={busy !== null}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? colors.accentHover : colors.accent, opacity: busy ? 0.7 : 1 }]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>{t('leagues.share.share')}</Text>
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>→</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shareCard: {
    borderRadius: theme.radius.lg + 2,
    padding: theme.space(5),
    gap: theme.space(4),
  },
  shareCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareCardEyebrow: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  shareCardMark: {
    width: 16,
    height: 16,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCardMarkText: {
    fontSize: 9,
    fontFamily: theme.fontFamily.heading,
  },
  shareCardLabel: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  shareCardWinner: {
    fontSize: 34,
    lineHeight: 31,
    fontFamily: theme.fontFamily.heading,
  },
  shareCardWinnerSteps: {
    fontSize: 24,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  shareCardStakes: {
    marginTop: theme.space(2),
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: theme.fontFamily.bodySemiBold,
  },
  shareCardDivider: {
    height: 1,
  },
  shareCardRank: {
    width: 16,
    fontSize: 15,
    fontFamily: theme.fontFamily.heading,
  },
  shareCardName: {
    flex: 1,
    fontSize: 13,
    fontFamily: theme.fontFamily.bodySemiBold,
  },
  shareCardSteps: {
    fontSize: 15,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  shareCardMeta: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
    opacity: 0.7,
  },
  shareCardCaption: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: theme.fontFamily.bodySemiBold,
    fontStyle: 'italic',
  },
  rowLimitRow: {
    flexDirection: 'row',
    gap: theme.space(2),
  },
  rowLimitChip: {
    flex: 1,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.space(2.5),
    alignItems: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space(3.75),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space(4.25),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space(1),
  },
  primaryButtonText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
