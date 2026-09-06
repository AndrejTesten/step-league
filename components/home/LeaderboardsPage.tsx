import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { Avatar, Card, Heading, Input, Muted, Screen, SearchableSelect, Tabs, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { LEADERBOARD_PAGE_SIZE, getGlobalLeaderboard, searchLeaderboardLocations } from '@/lib/leaderboard';
import { theme, useThemeColors } from '@/lib/theme';
import type { GlobalLeaderboardRow, LeaderboardScope } from '@/lib/types';

const SCOPE_OPTIONS: { value: LeaderboardScope; label: string }[] = [
  { value: 'city', label: 'City' },
  { value: 'country', label: 'Country' },
  { value: 'global', label: 'Global' },
];

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function LeaderboardsPage({ width }: { width: number }) {
  const colors = useThemeColors();
  const { profile } = useSession();
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [cityValue, setCityValue] = useState<string | null>(null);
  const [countryValue, setCountryValue] = useState<string | null>(null);
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 350);

  const [rows, setRows] = useState<GlobalLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default each location picker to the user's own city/country the first
  // time it becomes known, but never overwrite a location the user already
  // picked (including picking one back to empty via the dropdown).
  useEffect(() => {
    if (cityValue === null && profile?.city) setCityValue(profile.city);
  }, [profile?.city, cityValue]);
  useEffect(() => {
    if (countryValue === null && profile?.country) setCountryValue(profile.country);
  }, [profile?.country, countryValue]);

  const scopeValue = scope === 'city' ? cityValue : scope === 'country' ? countryValue : null;
  const missingLocation = (scope === 'city' || scope === 'country') && !scopeValue;

  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    if (missingLocation) {
      setRows([]);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    const myRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await getGlobalLeaderboard(scope, scopeValue, { search: debouncedSearch, offset: 0 });
      if (myRequest !== requestId.current) return;
      setRows(page);
      setHasMore(page.length === LEADERBOARD_PAGE_SIZE);
    } catch (e) {
      if (myRequest !== requestId.current) return;
      setError(getErrorMessage(e, 'Could not load the leaderboard.'));
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [scope, scopeValue, missingLocation, debouncedSearch]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

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
      // A failed "load more" just stops pagination quietly — the list already shown stays usable.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  const locationSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleLocationQueryChange(query: string) {
    if (scope !== 'city' && scope !== 'country') return;
    if (locationSearchTimer.current) clearTimeout(locationSearchTimer.current);
    setLocationLoading(true);
    locationSearchTimer.current = setTimeout(async () => {
      try {
        setLocationOptions(await searchLeaderboardLocations(scope, query));
      } catch {
        setLocationOptions([]);
      } finally {
        setLocationLoading(false);
      }
    }, 250);
  }

  return (
    <Screen style={{ width, paddingTop: theme.space(14) }}>
      <Title>Leaderboards</Title>

      <View style={{ marginTop: theme.space(5) }}>
        <Tabs options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
      </View>

      <View style={{ marginTop: theme.space(3), gap: theme.space(2) }}>
        {(scope === 'city' || scope === 'country') && (
          <SearchableSelect
            placeholder={scope === 'city' ? 'City' : 'Country'}
            value={scopeValue ?? ''}
            options={locationOptions}
            onSelect={(v) => (scope === 'city' ? setCityValue(v || null) : setCountryValue(v || null))}
            loading={locationLoading}
            onQueryChange={handleLocationQueryChange}
            emptyMessage="No matches yet."
          />
        )}
        <Input placeholder="Search by name" value={search} onChangeText={setSearch} />
      </View>

      <FlatList
        style={{ marginTop: theme.space(4) }}
        data={rows}
        keyExtractor={(r) => r.user_id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={{ marginVertical: theme.space(4) }} color={colors.textMuted} /> : null
        }
        ListEmptyComponent={
          !loading ? (
            <Card>
              <Muted style={error ? { color: colors.danger } : undefined}>
                {error
                  ? error
                  : missingLocation
                    ? `Pick a ${scope} above to see its leaderboard.`
                    : 'No one has recorded any steps here yet.'}
              </Muted>
            </Card>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.row,
              { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth },
            ]}
          >
            <Muted style={styles.rank}>{item.rank}</Muted>
            <Avatar uri={item.avatar_url} name={item.display_name} size={28} />
            <Heading
              style={[styles.name, item.is_me && { color: colors.accent }]}
              numberOfLines={1}
            >
              {item.display_name}
              {item.is_me ? ' (you)' : ''}
            </Heading>
            <Muted style={styles.steps}>{item.total_steps.toLocaleString()}</Muted>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(2.5),
  },
  rank: {
    width: 24,
    fontSize: theme.font.small,
    fontVariant: ['tabular-nums'],
  },
  name: {
    flex: 1,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  steps: {
    fontSize: theme.font.small,
    fontVariant: ['tabular-nums'],
  },
});
