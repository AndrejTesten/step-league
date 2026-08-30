import { useState } from 'react';
import { router } from 'expo-router';

import { Button, Card, Heading, Input, Muted, Screen } from '@/components/ui';
import { joinLeague, previewLeague } from '@/lib/leagues';
import { theme } from '@/lib/theme';

export default function JoinLeague() {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ name: string; deadline: string; member_count: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLookup() {
    setError(null);
    setPreview(null);
    if (code.trim().length < 4) return;
    try {
      setPreview(await previewLeague(code.trim()));
    } catch {
      setError('No league found for that code.');
    }
  }

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const leagueId = await joinLeague(code.trim());
      router.replace(`/leagues/${leagueId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that league.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Input
        placeholder="Invite code"
        autoCapitalize="characters"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        onEndEditing={handleLookup}
        onSubmitEditing={handleLookup}
      />

      {preview && (
        <Card>
          <Heading>{preview.name}</Heading>
          <Muted style={{ marginTop: theme.space(1) }}>
            {preview.member_count} member{preview.member_count === 1 ? '' : 's'} · ends{' '}
            {new Date(preview.deadline).toLocaleDateString()}
          </Muted>
        </Card>
      )}

      {error && <Muted style={{ color: theme.color.danger }}>{error}</Muted>}

      <Button label="Join league" onPress={handleJoin} loading={loading} disabled={!preview} />
    </Screen>
  );
}
