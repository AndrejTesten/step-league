import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLeagueDailyResult } from '@/lib/leagues';
import { theme } from '@/lib/theme';
import type { LeagueDailyResult } from '@/lib/types';

const INK = '#0b0c0a';
const LIME = '#ccff33';

/**
 * The "Scores are in" takeover (design screen "2h") — shown once per league
 * reset cycle, see the AsyncStorage-backed check in leagues/[id].tsx that
 * navigates here. Always full-lime regardless of light/dark mode, same as
 * the design: this is the app's one deliberate inversion, meant to stay
 * rare and loud. No fixed clock time shown here anymore — each league locks
 * in on its own 24h schedule now, not everyone's local 22:00.
 */
export default function LeagueResults() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id, date, name } = useLocalSearchParams<{ id: string; date: string; name?: string }>();
  const [result, setResult] = useState<LeagueDailyResult | null>(null);

  useEffect(() => {
    if (!id || !date) return;
    getLeagueDailyResult(id, date)
      .then(setResult)
      .catch(() => setResult({ date, winner: null, rows: [] }));
  }, [id, date]);

  const myRow = result?.rows.find((r) => r.is_me);

  const dateLabel = date
    ? new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(
        new Date(`${date}T00:00:00`)
      )
    : '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + theme.space(6.5) }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(6) }}>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>
            {dateLabel} · {name ?? ''}
          </Text>
          <Text style={styles.clockNumber}>✓</Text>
          <Text style={styles.title}>{t('leagues.results.scoresAreIn')}</Text>
        </View>

        {result?.winner && (
          <View style={styles.winnerCard}>
            <View>
              <Text style={styles.winnerEyebrow}>{t('leagues.results.todaysWinner')}</Text>
              <Text style={styles.winnerName}>{result.winner.display_name}</Text>
            </View>
            <Text style={styles.winnerSteps}>{result.winner.total_steps.toLocaleString()}</Text>
          </View>
        )}

        <View style={{ marginTop: theme.space(5) }}>
          {result?.rows.slice(0, 6).map((row, i) => {
            const delta = row.previousRank != null ? row.previousRank - row.rank : 0;
            return (
              <View key={row.user_id} style={[styles.row, row.is_me && styles.rowMine, i === 0 && styles.rowFirst]}>
                <Text style={[styles.rowRank, row.is_me && styles.rowMineText]}>{row.rank}</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: theme.space(1.5) }}>
                  <Text style={[styles.rowName, row.is_me && styles.rowMineTextBold]}>{row.display_name}</Text>
                  {delta !== 0 && (
                    <Text style={[styles.rowDelta, row.is_me && styles.rowMineText]}>
                      {delta > 0 ? t('leagues.results.deltaUp', { count: delta }) : t('leagues.results.deltaDown', { count: Math.abs(delta) })}
                    </Text>
                  )}
                </View>
                <Text style={[styles.rowSteps, row.is_me && styles.rowMineText]}>{row.total_steps.toLocaleString()}</Text>
              </View>
            );
          })}
        </View>

        {myRow && (
          <Text style={styles.blurb}>
            {(() => {
              const steps = myRow.total_steps.toLocaleString();
              if (myRow.previousRank != null && myRow.previousRank !== myRow.rank) {
                const ordinalRank = t('home.stepCounter.rankOrdinal', { count: myRow.rank, ordinal: true });
                return myRow.previousRank > myRow.rank
                  ? t('leagues.results.walkedMovedUp', { steps, rank: ordinalRank })
                  : t('leagues.results.walkedNowRank', { steps, rank: ordinalRank });
              }
              return t('leagues.results.walkedToday', { steps });
            })()}
          </Text>
        )}

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={() => id && router.replace(`/leagues/${id}`)}>
            <Text style={styles.primaryButtonText}>{t('leagues.results.openLeague')}</Text>
            <Text style={styles.primaryButtonArrow}>→</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => id && router.replace(`/leagues/${id}`)}>
            <Text style={styles.secondaryButtonText}>{t('leagues.results.sayInChat')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: LIME,
  },
  head: {
    paddingHorizontal: theme.space(5),
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: INK,
    opacity: 0.65,
  },
  clockNumber: {
    fontSize: 88,
    lineHeight: 76,
    fontFamily: theme.fontFamily.heading,
    letterSpacing: -1.5,
    color: INK,
    fontVariant: ['tabular-nums'],
    marginTop: theme.space(2.5),
  },
  title: {
    fontSize: 26,
    fontFamily: theme.fontFamily.heading,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: INK,
    marginTop: theme.space(2),
  },
  winnerCard: {
    marginTop: theme.space(4.5),
    marginHorizontal: theme.space(5),
    backgroundColor: INK,
    borderRadius: theme.radius.lg,
    padding: theme.space(4.5),
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.space(3),
  },
  winnerEyebrow: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#8b9084',
  },
  winnerName: {
    marginTop: theme.space(2),
    fontSize: 36,
    lineHeight: 33,
    fontFamily: theme.fontFamily.heading,
    color: LIME,
  },
  winnerSteps: {
    fontSize: 28,
    fontFamily: theme.fontFamily.heading,
    color: LIME,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.space(5),
    paddingVertical: theme.space(2.75),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(11,12,10,0.2)',
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowMine: {
    backgroundColor: INK,
    borderTopWidth: 0,
    marginVertical: 2,
    borderRadius: theme.radius.md,
  },
  rowRank: {
    width: 26,
    fontSize: 18,
    fontFamily: theme.fontFamily.heading,
    color: INK,
  },
  rowName: {
    fontSize: 14,
    fontFamily: theme.fontFamily.bodyMedium,
    color: INK,
  },
  rowDelta: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: INK,
    opacity: 0.6,
  },
  rowSteps: {
    fontSize: 17,
    fontFamily: theme.fontFamily.heading,
    color: INK,
    fontVariant: ['tabular-nums'],
  },
  rowMineText: {
    color: LIME,
    opacity: 1,
  },
  rowMineTextBold: {
    color: LIME,
    fontFamily: theme.fontFamily.bodySemiBold,
  },
  blurb: {
    marginTop: theme.space(4),
    paddingHorizontal: theme.space(5),
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
    fontFamily: theme.fontFamily.bodyMedium,
    color: INK,
  },
  actions: {
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(5),
    gap: theme.space(2.5),
  },
  primaryButton: {
    backgroundColor: INK,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space(4.25),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryButtonText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: LIME,
  },
  primaryButtonArrow: {
    fontSize: 15,
    color: LIME,
  },
  secondaryButton: {
    borderWidth: theme.border,
    borderColor: 'rgba(11,12,10,0.45)',
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space(3.75),
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 12,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: INK,
  },
});
