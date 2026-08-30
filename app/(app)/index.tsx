import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Button, Card, Heading, Muted, Screen, Title } from '@/components/ui';
import { listMyLeagues } from '@/lib/leagues';
import { theme } from '@/lib/theme';
import type { League } from '@/lib/types';

export default function MyLeagues() {
  const router = useRouter();
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
    <Screen style={{ paddingTop: theme.space(14) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>Your leagues</Title>
        <Pressable onPress={() => router.push('/profile')} hitSlop={12}>
          <Muted>Profile</Muted>
        </Pressable>
      </View>

      <FlatList
        data={leagues}
        keyExtractor={(item) => item.id}
        style={{ marginTop: theme.space(6) }}
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
        ItemSeparatorComponent={() => <View style={{ height: theme.space(3) }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/leagues/${item.id}`)}>
            <Card>
              <Heading>{item.name}</Heading>
              <Muted style={{ marginTop: theme.space(1) }}>
                Ends {new Date(item.deadline).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                · Code {item.invite_code}
              </Muted>
            </Card>
          </Pressable>
        )}
      />

      <View style={{ flexDirection: 'row', gap: theme.space(3), marginTop: theme.space(4) }}>
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
