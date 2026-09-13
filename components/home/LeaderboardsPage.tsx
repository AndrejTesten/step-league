import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { Input, Screen, SectionLabel, Tabs, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { LEADERBOARD_PAGE_SIZE, getGlobalLeaderboard, getMyLeaderboardRank } from '@/lib/leaderboard';
import { theme, useThemeColors } from '@/lib/theme';
import type { GlobalLeaderboardRow, LeaderboardScope } from '@/lib/types';

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function LeaderboardsPage({ width }: { width: number }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { profile } = useSession();
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);

  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([]);
  const [myRank, setMyRank] = useState<{ rank: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // City/Country always mean *your* city/country (set in Profile) — no
  // picker to browse someone else's, on purpose: this tab is "how do I
  // compare to people near me," not a general location explorer.
  const scopeValue = scope === 'city' ? (profile?.city ?? null) : scope === 'country' ? (profile?.country ?? null) : null;
  const missingLocation = (scope === 'city' || scope === 'country') && !scopeValue;

  const scopeOptions = useMemo<{ value: LeaderboardScope; label: string }[]>(
    () => [
      { value: 'global', label: t('home.leaderboards.world') },
      { value: 'country', label: profile?.country ?? t('profile.location.country') },
      { value: 'city', label: profile?.city ?? t('profile.location.city') },
    ],
    [profile?.country, profile?.city, t]
  );

  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    if (missingLocation) {
      setRows([]);
      setMyRank(null);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    const myRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [page, rank] = await Promise.all([
        getGlobalLeaderboard(scope, scopeValue, { search: debouncedSearch, offset: 0 }),
        getMyLeaderboardRank(scope, scopeValue).catch(() => null),
      ]);
      if (myRequest !== requestId.current) return;
      setRows(page);
      setMyRank(rank);
      setHasMore(page.length === LEADERBOARD_PAGE_SIZE);
    } catch (e) {
      if (myRequest !== requestId.current) return;
      setError(getErrorMessage(e, t('home.leaderboards.errors.loadFailed')));
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [scope, scopeValue, missingLocation, debouncedSearch]);

  // useFocusEffect already re-runs whenever loadFirstPage's identity changes
  // (scope/search/etc.) as long as this screen is focused, so a plain
  // mount-time useEffect calling the same function would just double every
  // fetch — once here, once from the focus effect below.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage])
  );

  async function loadMore() {
    if (loading || loadingMore || !hasMore || missingLocation) return;
    setLoadingMore(true);
    try {
      const page = await getGlobalLeaderboard(scope, scopeValue, {
        search: debouncedSearch,
        offset: rows.length,
      });
      setRows((prev) => [...prev, ...page]);
      setHasMore(page.length === LEADERBOARD_PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  const scopeLabel = scope === 'global' ? t('home.leaderboards.theWorld') : scopeValue ?? '';
  const topPercent = myRank ? Math.max(1, Math.round((myRank.rank / myRank.total) * 100)) : null;

  return (
    <Screen style={{ width, paddingTop: theme.space(14) }}>
      <Title>{t('home.leaderboards.title')}</Title>
      <View style={{ marginTop: theme.space(4) }}>
        <Tabs options={scopeOptions} value={scope} onChange={setScope} />
      </View>

      <View style={{ marginTop: theme.space(3) }}>
        <Input placeholder={t('home.leaderboards.searchPlaceholder')} value={search} onChangeText={setSearch} />
      </View>

      {myRank && !missingLocation && (
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <View>
            <SectionLabel>{t('home.leaderboards.yourPlaceIn', { scope: scopeLabel })}</SectionLabel>
            <Text style={[styles.heroValue, { color: colors.accent }]}>{myRank.rank.toLocaleString()}</Text>
          </View>
          <Text style={[styles.heroMeta, { color: colors.textMuted }]}>
            {t('home.leaderboards.ofTotal', { total: myRank.total.toLocaleString() })}
            {'\n'}
            <Text style={{ color: colors.accent }}>{t('home.leaderboards.topPercent', { percent: topPercent })}</Text>
          </Text>
        </View>
      )}

      <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.tableHeaderCell, { width: 34, color: colors.textDim }]}>#</Text>
        <Text style={[styles.tableHeaderCell, { flex: 1, color: colors.textDim }]}>{t('home.leaderboards.columnWalker')}</Text>
        <Text style={[styles.tableHeaderCell, { width: 54, color: colors.textDim }]}>{t('profile.location.city')}</Text>
        <Text style={[styles.tableHeaderCell, { width: 64, textAlign: 'right', color: colors.textDim }]}>{t('home.leaderboards.columnSteps')}</Text>
      </View>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: theme.space(6) }}
        data={rows}
        keyExtractor={(r) => r.user_id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: theme.space(4) }} color={colors.textMuted} /> : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingVertical: theme.space(4) }}>
              <Text style={{ color: error ? colors.danger : colors.textSubtle, fontFamily: theme.fontFamily.bodyMedium }}>
                {error
                  ? error
                  : missingLocation
                    ? t('home.leaderboards.addLocationInProfile', { scope: scope === 'city' ? t('profile.location.city') : t('profile.location.country') })
                    : t('home.leaderboards.noStepsYet')}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const mine = item.is_me;
          return (
            <View
              style={[
                styles.row,
                { borderTopColor: colors.border },
                mine && styles.rowMine,
                mine && { backgroundColor: colors.accentWash },
              ]}
            >
              <Text style={[styles.rank, { color: mine ? colors.accent : colors.text, fontVariant: ['tabular-nums'] }]}>
                {item.rank}
              </Text>
              <Text style={[styles.name, { color: mine ? colors.accent : colors.text }]} numberOfLines={1}>
                {mine ? t('common.you') : item.display_name}
              </Text>
              <Text style={[styles.city, { color: colors.textMuted }]} numberOfLines={1}>
                {item.city ?? '-'}
              </Text>
              <Text style={[styles.steps, { color: mine ? colors.accent : colors.text, fontVariant: ['tabular-nums'] }]}>
                {item.total_steps.toLocaleString()}
              </Text>
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: theme.space(4),
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  heroValue: {
    fontSize: 48,
    lineHeight: 44,
    marginTop: theme.space(2),
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  heroMeta: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: theme.fontFamily.bodyMedium,
    textAlign: 'right',
  },
  tableHeader: {
    flexDirection: 'row',
    marginTop: theme.space(4),
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
    borderTopWidth: theme.border,
  },
  rowMine: {
    borderTopWidth: 0,
    borderRadius: theme.radius.md,
    marginHorizontal: -theme.space(2),
    paddingHorizontal: theme.space(3.5),
  },
  rank: {
    width: 34,
    fontSize: 16,
    fontFamily: theme.fontFamily.heading,
  },
  name: {
    flex: 1,
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyMedium,
    paddingRight: theme.space(2),
  },
  city: {
    width: 54,
    fontSize: 10,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  steps: {
    width: 64,
    textAlign: 'right',
    fontSize: 15,
    fontFamily: theme.fontFamily.heading,
  },
});
