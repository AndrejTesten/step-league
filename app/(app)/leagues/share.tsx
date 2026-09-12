import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { Screen } from '@/components/ui';
import { getLeaderboard, listMyLeagues } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { useToast } from '@/lib/toast';
import type { LeaderboardRow, League } from '@/lib/types';

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
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [league, setLeague] = useState<League | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
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
  const totalSteps = rows.reduce((sum, r) => sum + r.total_steps, 0);
  const inviteLink = league ? `stepleague://join/${league.invite_code}` : '';

  function fallbackText(): string {
    if (!league) return '';
    const lines = rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.is_me ? 'You' : r.display_name} — ${r.total_steps.toLocaleString()}`);
    const stakes = league.winner_stakes ? `\nWinner gets: ${league.winner_stakes}` : '';
    return `${league.name} — final standings\n${lines.join('\n')}${stakes}\n— Step League`;
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
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${league?.name ?? 'League'} results` });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not share the results.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyLink() {
    if (!inviteLink) return;
    await Clipboard.setStringAsync(inviteLink);
    showToast('Link copied.');
  }

  async function handleSaveToPhotos() {
    if (busy) return;
    if (Platform.OS === 'web') {
      showToast("Saving photos isn't available in the browser.");
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
        showToast('Photo library access is needed to save the results card.');
        return;
      }
      const uri = await captureCardImage();
      await MediaLibrary.saveToLibraryAsync(uri);
      showToast('Saved to photos.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save the image.');
    } finally {
      setBusy(null);
    }
  }

  if (loading || !league) {
    return (
      <Screen style={{ paddingTop: theme.space(6) }}>
        <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>Loading…</Text>
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
            <Text style={[styles.shareCardEyebrow, { color: colors.primaryText }]}>{league.name} · final</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1.5) }}>
              <View style={[styles.shareCardMark, { backgroundColor: colors.primaryText }]}>
                <Text style={[styles.shareCardMarkText, { color: colors.accent }]}>SL</Text>
              </View>
              <Text style={[styles.shareCardEyebrow, { color: colors.primaryText }]}>Step League</Text>
            </View>
          </View>

          {winner && (
            <View>
              <Text style={[styles.shareCardLabel, { color: colors.primaryText }]}>Winner</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space(3), marginTop: theme.space(2) }}>
                <Text style={[styles.shareCardWinner, { color: colors.primaryText }]}>{winner.display_name}</Text>
                <Text style={[styles.shareCardWinnerSteps, { color: colors.primaryText }]}>{winner.total_steps.toLocaleString()}</Text>
              </View>
              {league.winner_stakes && (
                <Text style={[styles.shareCardStakes, { color: colors.primaryText }]}>Wins: {league.winner_stakes}</Text>
              )}
            </View>
          )}

          <View style={[styles.shareCardDivider, { backgroundColor: colors.primaryText, opacity: 0.25 }]} />

          <View style={{ gap: theme.space(2.25) }}>
            {rows.slice(1, 5).map((r, i) => (
              <View key={r.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) }}>
                <Text style={[styles.shareCardRank, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]}>{i + 2}</Text>
                <Text style={[styles.shareCardName, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]} numberOfLines={1}>
                  {r.is_me ? 'You' : r.display_name}
                </Text>
                <Text style={[styles.shareCardSteps, { color: colors.primaryText }, i > 0 && { opacity: 0.75 }]}>{r.total_steps.toLocaleString()}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.shareCardDivider, { backgroundColor: colors.primaryText, opacity: 0.25 }]} />

          {league.loser_stakes && (
            <Text style={[styles.shareCardMeta, { color: colors.primaryText }]}>Last place: {league.loser_stakes}</Text>
          )}
          <Text style={[styles.shareCardMeta, { color: colors.primaryText }]}>
            {new Date(league.deadline).toLocaleDateString()} · {rows.length} members · {totalSteps.toLocaleString()} steps
            walked
          </Text>
        </View>

        <View>
          <Pressable onPress={handleShareImage} disabled={busy !== null} style={[styles.infoRow, { borderTopColor: colors.border, opacity: busy ? 0.5 : 1 }]}>
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>Share image</Text>
            <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted }}>
              {busy === 'share' ? 'Working…' : 'PNG'}
            </Text>
          </Pressable>
          <Pressable onPress={handleCopyLink} style={[styles.infoRow, { borderTopColor: colors.border }]}>
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>Copy link</Text>
            <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>{inviteLink}</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveToPhotos}
            disabled={busy !== null}
            style={[styles.infoRow, { borderTopColor: colors.border, borderBottomWidth: theme.border, borderBottomColor: colors.border, opacity: busy ? 0.5 : 1 }]}
          >
            <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>Save to photos</Text>
            <Text style={{ fontSize: 14, color: colors.textMuted }}>{busy === 'save' ? 'Working…' : '→'}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleShareImage}
          disabled={busy !== null}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? colors.accentHover : colors.accent, opacity: busy ? 0.7 : 1 }]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.primaryText }]}>Share</Text>
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
