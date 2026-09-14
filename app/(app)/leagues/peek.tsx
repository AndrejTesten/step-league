import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import { getLivePeek, triggerLeagueLiveSync, usePeek } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import type { PeekResult } from '@/lib/types';

const PEEK_SECONDS = 10;
// How long to give league-mates' phones to wake up and sync after the
// live-sync push goes out, before actually reading standings. Short enough
// to still leave most of the 10-second peek window for reading the result;
// long enough for a typical push round-trip + a background sync to land.
const LIVE_SYNC_WAIT_MS = 3000;

/**
 * "Peek" (design screens 2p/2q) — a timed, silent look at today's live
 * standings for one league. Consumes one of today's allowance (1 free / 3
 * premium, enforced server-side by use_peek()) the moment this screen
 * opens; if the quota's already spent, shows the upgrade sheet instead of
 * ever fetching live data.
 *
 * Also fires a live-sync push to every other league member the instant a
 * peek is allowed (triggerLeagueLiveSync) — the whole point of "live" is
 * that it reflects steps as of right now, not whatever last happened to
 * sync on its own. A short wait gives those pushes a chance to land before
 * getLivePeek() reads standings; anyone whose phone didn't wake in time
 * still shows their last-known count, just flagged as not fresh (see
 * PeekRow.is_fresh) instead of silently looking authoritative.
 */
export default function Peek() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [state, setState] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [remaining, setRemaining] = useState(0);
  const [limit, setLimit] = useState(1);
  const [result, setResult] = useState<PeekResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PEEK_SECONDS);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    usePeek()
      .then(async (status) => {
        if (cancelled) return;
        setLimit(status.isPro ? 3 : 1);
        setRemaining(status.remaining);
        if (!status.allowed) {
          setState('denied');
          return;
        }
        const { triggeredAt } = await triggerLeagueLiveSync(id).catch(() => ({ triggeredAt: undefined }));
        if (cancelled) return;
        if (triggeredAt) {
          await new Promise((resolve) => setTimeout(resolve, LIVE_SYNC_WAIT_MS));
          if (cancelled) return;
        }
        const live = await getLivePeek(id, triggeredAt);
        if (cancelled) return;
        setResult(live);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('denied');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (state !== 'ready') return;
    if (secondsLeft <= 0) {
      router.back();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [state, secondsLeft]);

  if (state === 'loading') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top + theme.space(20) }]}>
        <Text style={{ color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium, textAlign: 'center' }}>
          {t('leagues.peek.peeking')}
        </Text>
      </View>
    );
  }

  if (state === 'denied') {
    return <PeekDenied name={name} />;
  }

  const usedDots = limit - remaining;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top + theme.space(3.5) }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>{name ?? t('leagues.peek.leagueFallback')}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {t('leagues.peek.livePeekAt', { time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}
          </Text>
        </View>
        <View style={[styles.remainingChip, { backgroundColor: colors.accentChip }]}>
          <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.accent }}>
            {t('leagues.peek.leftToday', { count: remaining })}
          </Text>
        </View>
      </View>

      {result?.gapToFirst !== null && result?.gapToFirst !== undefined && (
        <View style={[styles.gapCard, { backgroundColor: colors.card, borderColor: colors.accent }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.gapLabel, { color: colors.textMuted }]}>{result.gapToFirst === 0 ? t('leagues.peek.inFirst') : t('leagues.peek.gapToFirst')}</Text>
            <Text style={[styles.gapCaption, { color: colors.textDim }]}>{t('leagues.peek.closesIn', { seconds: secondsLeft })}</Text>
          </View>
          {result.gapToFirst > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: theme.space(2.5) }}>
              <Text style={[styles.gapValue, { color: colors.accent }]}>{result.gapToFirst.toLocaleString()}</Text>
              <Text style={[styles.gapBehind, { color: colors.textSubtle }]}>{t('leagues.peek.behind')}{'\n'}{result.leaderName}</Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.tableHeader, { borderColor: colors.border }]}>
        <Text style={[styles.tableHeaderCell, { width: 26, color: colors.textDim }]}>#</Text>
        <Text style={[styles.tableHeaderCell, { flex: 1, color: colors.textDim }]}>{t('leagues.detail.columnMember')}</Text>
        <Text style={[styles.tableHeaderCell, { width: 56, textAlign: 'right', color: colors.textDim }]}>{t('leagues.peek.columnNow')}</Text>
        <Text style={[styles.tableHeaderCell, { width: 56, textAlign: 'right', color: colors.textDim }]}>{t('leagues.peek.columnPace')}</Text>
      </View>
      {result?.rows.map((r, i) => (
        <View
          key={r.user_id}
          style={[
            styles.row,
            { borderTopColor: colors.border },
            r.is_me && styles.rowMine,
            r.is_me && { backgroundColor: colors.accentWash },
            i === 0 && { borderTopWidth: 0 },
          ]}
        >
          <Text style={[styles.rank, { color: r.is_me ? colors.accent : colors.text }]}>{i + 1}</Text>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space(2.5) }}>
            <Avatar name={r.display_name} uri={r.avatar_url} size={26} variant={r.is_me ? 'accent' : 'default'} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: r.is_me ? colors.accent : colors.text }]} numberOfLines={1}>
                {r.is_me ? t('common.you') : r.display_name}
              </Text>
              {!r.is_fresh && (
                <Text style={[styles.staleNote, { color: colors.textDim }]} numberOfLines={2}>
                  {t('leagues.peek.stale', { name: r.display_name })}
                </Text>
              )}
            </View>
          </View>
          <Text style={[styles.now, { color: r.is_me ? colors.accent : colors.text }]}>{r.now_steps.toLocaleString()}</Text>
          <Text style={[styles.pace, { color: r.is_me ? colors.accent : colors.textMuted }]}>{formatPace(r.pace)}</Text>
        </View>
      ))}

      <Text style={[styles.footnote, { color: colors.textDim }]}>
        {t('leagues.peek.footnote')}
      </Text>

      <View style={styles.pips}>
        {Array.from({ length: limit }, (_, i) => (
          <View key={i} style={[styles.pip, { backgroundColor: i < usedDots ? colors.borderStrong : colors.accent }]} />
        ))}
        <Text style={{ marginLeft: theme.space(2), fontSize: 12, fontFamily: theme.fontFamily.bodySemiBold, color: colors.text }}>
          {t('leagues.peek.peeksLeftOf', { remaining, limit })}
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => router.back()}
        style={[styles.backButton, { borderColor: colors.controlBorder, marginBottom: insets.bottom + theme.space(4) }]}
      >
        <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted }}>
          {t('leagues.peek.backToLeague', { seconds: secondsLeft })}
        </Text>
      </Pressable>
    </View>
  );
}

function formatPace(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function PeekDenied({ name }: { name?: string }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, opacity: 0.25, paddingTop: insets.top + theme.space(16), paddingHorizontal: theme.space(4.5) }} pointerEvents="none">
        <Text style={{ fontSize: 28, fontFamily: theme.fontFamily.heading, textTransform: 'uppercase', color: colors.text }}>
          {name ?? t('leagues.peek.leagueFallback')}
        </Text>
      </View>
      <View style={[styles.deniedSheet, { backgroundColor: colors.card, borderColor: colors.borderStrong, paddingBottom: insets.bottom + theme.space(4) }]}>
        <View style={[styles.grabber, { backgroundColor: colors.controlBorder }]} />
        <View style={[styles.deniedIcon, { backgroundColor: colors.accent }]}>
          <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primaryText, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.primaryText }} />
          </View>
        </View>
        <View style={[styles.premiumChip, { backgroundColor: colors.accentChip, alignSelf: 'flex-start' }]}>
          <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.accent }}>
            {t('leagues.peek.premium')}
          </Text>
        </View>
        <Text style={{ fontSize: 30, lineHeight: 29, fontFamily: theme.fontFamily.heading, textTransform: 'uppercase', color: colors.text }}>
          {t('leagues.peek.deniedHeading')}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>
          {t('leagues.peek.deniedBody')}
        </Text>
        <Pressable
          onPress={() => router.replace('/premium')}
          style={({ pressed }) => [styles.getPremiumButton, { backgroundColor: pressed ? colors.accentHover : colors.accent }]}
        >
          <Text style={[styles.getPremiumButtonText, { color: colors.primaryText }]}>{t('leagues.peek.getPremium')}</Text>
          <Text style={[styles.getPremiumButtonText, { color: colors.primaryText }]}>→</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'center' }}>
          <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted }}>
            {t('leagues.peek.waitFor2200')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: theme.space(4.5),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space(3),
    marginBottom: theme.space(4),
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
  remainingChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.25),
    paddingVertical: theme.space(1.5),
  },
  gapCard: {
    borderWidth: theme.border,
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
    marginBottom: theme.space(4.5),
  },
  gapLabel: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  gapCaption: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  gapValue: {
    fontSize: 48,
    lineHeight: 44,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  gapBehind: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'right',
    fontFamily: theme.fontFamily.bodyMedium,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space(1.5),
    paddingVertical: theme.space(2.75),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMine: {
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
  name: {
    flex: 1,
    fontSize: 14,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  staleNote: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 13,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  now: {
    width: 56,
    textAlign: 'right',
    fontSize: 17,
    fontFamily: theme.fontFamily.heading,
  },
  pace: {
    width: 56,
    textAlign: 'right',
    fontSize: 11,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  footnote: {
    marginTop: theme.space(3.5),
    fontSize: 12,
    lineHeight: 18,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  pips: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space(3.5),
  },
  pip: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginRight: 5,
  },
  backButton: {
    borderWidth: theme.border,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space(3.75),
    alignItems: 'center',
  },
  deniedSheet: {
    borderTopLeftRadius: theme.radius.sheet,
    borderTopRightRadius: theme.radius.sheet,
    borderTopWidth: theme.border,
    paddingHorizontal: theme.space(5.5),
    paddingTop: theme.space(3),
    gap: theme.space(4),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: theme.radius.pill,
    alignSelf: 'center',
  },
  deniedIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.25),
    paddingVertical: theme.space(1.25),
    marginTop: -theme.space(2),
  },
  getPremiumButton: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4.25),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  getPremiumButtonText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
