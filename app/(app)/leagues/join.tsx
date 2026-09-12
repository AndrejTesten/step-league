import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Screen, SectionLabel } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { joinLeague, joinPublicLeague, previewLeague, searchPublicLeagues } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import type { PublicLeaguePreview } from '@/lib/types';

const INVITE_CODE_LENGTH = 6;

export default function JoinLeague() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const [code, setCode] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [preview, setPreview] = useState<{ id: string; name: string; deadline: string; member_count: number } | null>(
    null
  );
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [openLeagues, setOpenLeagues] = useState<PublicLeaguePreview[]>([]);
  const [openLoading, setOpenLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    searchPublicLeagues({ city: profile?.city, country: profile?.country })
      .then(setOpenLeagues)
      .catch(() => setOpenLeagues([]))
      .finally(() => setOpenLoading(false));
  }, [profile?.city, profile?.country]);

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

  async function handleJoinPublic(league: PublicLeaguePreview) {
    setJoiningId(league.id);
    try {
      await joinPublicLeague(league.id);
      router.replace(`/leagues/${league.id}`);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not join that league.'));
      setJoiningId(null);
    }
  }

  const boxes = Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => code[i] ?? '');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: theme.space(6),
          paddingBottom: insets.bottom + theme.space(6),
          gap: theme.space(5),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.space(2.5) }}>
          <SectionLabel>Enter the six-character code</SectionLabel>
          <Pressable onPress={() => inputRef.current?.focus()} style={styles.codeRow}>
            {boxes.map((char, i) => (
              <View
                key={i}
                style={[
                  styles.codeBox,
                  { borderColor: char ? colors.accent : colors.borderStrong, backgroundColor: colors.card },
                ]}
              >
                <Text style={[styles.codeChar, { color: char ? colors.accent : colors.text }]}>{char}</Text>
              </View>
            ))}
          </Pressable>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={INVITE_CODE_LENGTH}
            style={styles.hiddenInput}
          />
          <Text style={{ fontSize: 11, lineHeight: 16, fontFamily: theme.fontFamily.bodyMedium, color: colors.textDim }}>
            Codes come from whoever made the league.
          </Text>
        </View>

        {looking && <ActivityIndicator color={colors.textMuted} />}

        {preview && (
          <View style={[styles.previewCard, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 18, fontFamily: theme.fontFamily.heading, color: colors.text }}>
              {preview.name}
            </Text>
            <Text style={{ marginTop: theme.space(1), fontSize: 12, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>
              {preview.member_count} member{preview.member_count === 1 ? '' : 's'} · ends{' '}
              {new Date(preview.deadline).toLocaleDateString()}
            </Text>
          </View>
        )}

        {error && (
          <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
            {error}
          </Text>
        )}

        <Button label="Join league" onPress={handleJoin} loading={loading} disabled={!preview} arrow />

        <View style={{ gap: theme.space(2.5) }}>
          <SectionLabel>Open leagues{profile?.city ? ` near ${profile.city}` : ''}</SectionLabel>
          {openLoading ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : openLeagues.length === 0 ? (
            <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>
              No open leagues to show yet.
            </Text>
          ) : (
            openLeagues.map((league) => (
              <View key={league.id} style={[styles.openRow, { backgroundColor: colors.card }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontFamily: theme.fontFamily.heading, color: colors.text }}>
                    {league.name}
                  </Text>
                  <Text style={{ marginTop: theme.space(1.25), fontSize: 11, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>
                    {league.member_count} members · ends{' '}
                    {new Date(league.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleJoinPublic(league)}
                  disabled={joiningId === league.id}
                  style={({ pressed }) => [
                    styles.joinChip,
                    { borderColor: colors.accent },
                    pressed && { backgroundColor: colors.accent },
                  ]}
                >
                  {({ pressed }: { pressed: boolean }) =>
                    joiningId === league.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: pressed ? colors.primaryText : colors.accent }}>
                        Join
                      </Text>
                    )
                  }
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeRow: {
    flexDirection: 'row',
    gap: theme.space(1.5),
  },
  codeBox: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: theme.border,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: {
    fontSize: 24,
    fontFamily: theme.fontFamily.heading,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
  previewCard: {
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.lg,
    padding: theme.space(3.5),
    gap: theme.space(3),
  },
  joinChip: {
    borderWidth: theme.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.25),
  },
});
