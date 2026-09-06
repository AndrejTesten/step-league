import { useEffect, useState } from 'react';
import { router } from 'expo-router';

import { Button, Card, Heading, Input, Muted, Screen } from '@/components/ui';
import { getErrorMessage } from '@/lib/errors';
import { joinLeague, previewLeague } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';

const INVITE_CODE_LENGTH = 6;

export default function JoinLeague() {
  const colors = useThemeColors();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ id: string; name: string; deadline: string; member_count: number } | null>(
    null
  );
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Invite codes are always exactly 6 characters (see
  // generate_invite_code() in supabase/schema.sql), so we can look one up
  // automatically the moment it's fully typed instead of waiting on a
  // manual submit.
  useEffect(() => {
    setPreview(null);
    setError(null);
    if (code.length !== INVITE_CODE_LENGTH) return;
    let cancelled = false;
    setLooking(true);
    previewLeague(code)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setError('No league found for that code.');
      })
      .finally(() => {
        if (!cancelled) setLooking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const leagueId = await joinLeague(code);
      router.replace(`/leagues/${leagueId}`);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not join that league.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Input
        placeholder="Invite code"
        autoCapitalize="characters"
        maxLength={INVITE_CODE_LENGTH}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
      />

      {looking && <Muted>Looking up…</Muted>}

      {preview && (
        <Card>
          <Heading>{preview.name}</Heading>
          <Muted style={{ marginTop: theme.space(1) }}>
            {preview.member_count} member{preview.member_count === 1 ? '' : 's'} · ends{' '}
            {new Date(preview.deadline).toLocaleDateString()}
          </Muted>
        </Card>
      )}

      {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

      <Button label="Join league" onPress={handleJoin} loading={loading} disabled={!preview} />
    </Screen>
  );
}
