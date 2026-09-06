import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Heading, Muted, Screen, Title } from '@/components/ui';
import { listMyLeagues } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import type { League } from '@/lib/types';

export function YourLeaguesPage({ width }: { width: number }) {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setLeagues(await listMyLeagues());
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
      <Title>Your leagues</Title>

      <FlatList
        data={leagues}
        keyExtractor={(item) => item.id}
        style={{ marginTop: theme.space(5) }}
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
            <Card>
              <Heading>No leagues yet</Heading>
              <Muted style={{ marginTop: theme.space(1) }}>
                Create one and send the invite code to your friends.
              </Muted>
            </Card>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => router.push(`/leagues/${item.id}`)}
            style={({ pressed }) => [
              styles.row,
              { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Heading style={{ fontSize: theme.font.body }}>{item.name}</Heading>
              <Muted style={{ marginTop: 2 }}>
                Ends {new Date(item.deadline).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                · Code {item.invite_code}
              </Muted>
            </View>
          </Pressable>
        )}
      />

      <View
        style={{
          flexDirection: 'row',
          gap: theme.space(3),
          marginTop: theme.space(4),
          paddingBottom: insets.bottom > 0 ? insets.bottom : theme.space(4),
        }}
      >
        <View style={{ flex: 1 }}>
          <Button label="Join a league" variant="secondary" onPress={() => router.push('/leagues/join')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Create a league" onPress={() => router.push('/leagues/create')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = { row: { paddingVertical: theme.space(3.5) } } as const;
