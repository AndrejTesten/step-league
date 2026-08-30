import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, View } from 'react-native';

import { Button, Card, Heading, Input, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { createLeague, listMyLeagues } from '@/lib/leagues';
import { FREE_TIER_LEAGUE_LIMIT } from '@/lib/purchases';
import { theme } from '@/lib/theme';

function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30); // a month-long league by default
  return d;
}

function isActive(deadline: string) {
  return new Date(deadline) >= new Date(new Date().toDateString());
}

export default function CreateLeague() {
  const { profile } = useSession();
  const [name, setName] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gated, setGated] = useState(false);
  const [checkingLimit, setCheckingLimit] = useState(true);

  useEffect(() => {
    if (profile?.is_pro) {
      setCheckingLimit(false);
      return;
    }
    listMyLeagues()
      .then((leagues) => setGated(leagues.filter((l) => isActive(l.deadline)).length >= FREE_TIER_LEAGUE_LIMIT))
      .finally(() => setCheckingLimit(false));
  }, [profile?.is_pro]);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your league a name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const league = await createLeague(name.trim(), deadline.toISOString().slice(0, 10));
      router.replace(`/leagues/${league.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the league.');
    } finally {
      setLoading(false);
    }
  }

  if (checkingLimit) return null;

  if (gated) {
    return (
      <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
        <Title>One league at a time</Title>
        <Card>
          <Heading style={{ fontSize: theme.font.body }}>Free plan limit reached</Heading>
          <Muted style={{ marginTop: theme.space(1) }}>
            The free plan includes {FREE_TIER_LEAGUE_LIMIT} active league at a time. Upgrade to Pro for
            unlimited leagues running at once.
          </Muted>
        </Card>
        <Button label="Upgrade to Pro" onPress={() => router.push('/paywall')} />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Input placeholder="League name (e.g. Office Squad)" value={name} onChangeText={setName} />

      <View>
        <Muted style={{ marginBottom: theme.space(2) }}>Ends on</Muted>
        {Platform.OS === 'android' && !showPicker && (
          <Button
            label={deadline.toLocaleDateString()}
            variant="secondary"
            onPress={() => setShowPicker(true)}
          />
        )}
        {showPicker && (
          <DateTimePicker
            value={deadline}
            mode="date"
            minimumDate={new Date()}
            onChange={(_, date) => {
              if (Platform.OS === 'android') setShowPicker(false);
              if (date) setDeadline(date);
            }}
          />
        )}
      </View>

      {error && <Muted style={{ color: theme.color.danger }}>{error}</Muted>}

      <Button label="Create league" onPress={handleCreate} loading={loading} />
    </Screen>
  );
}
