import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { DatePickerField } from '@/components/DatePickerField';
import { Button, Input, Muted, Screen } from '@/components/ui';
import { getErrorMessage } from '@/lib/errors';
import { createLeague } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { toDateKey } from '@/lib/timezone';

function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30); // a month-long league by default
  return d;
}

export default function CreateLeague() {
  const colors = useThemeColors();
  const [name, setName] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give your league a name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const league = await createLeague(name.trim(), toDateKey(deadline));
      router.replace(`/leagues/${league.id}`);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create the league.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Input
        placeholder="League name (e.g. Office Squad)"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />

      <View>
        <Muted style={{ marginBottom: theme.space(2) }}>Ends on</Muted>
        <DatePickerField value={deadline} onChange={setDeadline} minimumDate={new Date()} />
      </View>

      {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

      <Button label="Create league" onPress={handleCreate} loading={loading} />
    </Screen>
  );
}
