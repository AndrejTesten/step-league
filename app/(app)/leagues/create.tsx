import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerField } from '@/components/DatePickerField';
import { Button, Input, Screen, SectionLabel } from '@/components/ui';
import { getErrorMessage } from '@/lib/errors';
import { createLeague } from '@/lib/leagues';
import { theme, useThemeColors } from '@/lib/theme';
import { toDateKey } from '@/lib/timezone';
import type { LeagueScoringMode } from '@/lib/types';

function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30); // a month-long league by default
  return d;
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function endOfYear() {
  const d = new Date();
  return new Date(d.getFullYear(), 11, 31);
}

const PRESETS: { label: string; date: () => Date }[] = [
  { label: '1 week', date: () => addDays(7) },
  { label: '1 month', date: () => addDays(30) },
  { label: 'End of year', date: endOfYear },
];

const SCORING_OPTIONS: { value: LeagueScoringMode; label: string; hint: string }[] = [
  { value: 'daily_wins', label: 'Daily wins', hint: "Daily wins: 1 point to whoever tops the 22:00 table." },
  { value: 'total_steps', label: 'Total steps', hint: 'Total steps: standings rank by the whole round’s total.' },
];

export default function CreateLeague() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [scoringMode, setScoringMode] = useState<LeagueScoringMode>('daily_wins');
  const [isPublic, setIsPublic] = useState(false);
  const [winnerStakes, setWinnerStakes] = useState('');
  const [loserStakes, setLoserStakes] = useState('');
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
      const league = await createLeague(name.trim(), toDateKey(deadline), {
        scoringMode,
        isPublic,
        winnerStakes,
        loserStakes,
      });
      router.replace(`/leagues/${league.id}`);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not create the league.'));
    } finally {
      setLoading(false);
    }
  }

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
      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>League name</SectionLabel>
        <Input placeholder="e.g. Office Squad" value={name} onChangeText={setName} maxLength={60} />
      </View>

      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>Ends on</SectionLabel>
        <DatePickerField value={deadline} onChange={setDeadline} minimumDate={new Date()} />
        <View style={{ flexDirection: 'row', gap: theme.space(1.5), flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <Pressable
              key={preset.label}
              onPress={() => setDeadline(preset.date())}
              style={[styles.presetChip, { borderColor: colors.controlBorder }]}
            >
              <Text style={{ fontSize: 10, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted }}>
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>Scoring</SectionLabel>
        <View style={[styles.segmented, { backgroundColor: colors.card }]}>
          {SCORING_OPTIONS.map((opt) => {
            const active = opt.value === scoringMode;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setScoringMode(opt.value)}
                style={[styles.segment, active && { backgroundColor: colors.accent }]}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: theme.fontFamily.bodySemiBold,
                    letterSpacing: 0.8,
                    textTransform: 'uppercase',
                    color: active ? colors.primaryText : colors.textMuted,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ fontSize: 11, lineHeight: 16, fontFamily: theme.fontFamily.bodyMedium, color: colors.textSubtle }}>
          {SCORING_OPTIONS.find((o) => o.value === scoringMode)?.hint}
        </Text>
      </View>

      <View style={{ gap: theme.space(2.25) }}>
        <SectionLabel>Who can join</SectionLabel>
        <Pressable style={styles.radioRow} onPress={() => setIsPublic(false)}>
          <View style={[styles.radioOuter, { borderColor: !isPublic ? colors.accent : colors.controlBorder }]}>
            {!isPublic && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
          </View>
          <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>
            Invite code only
          </Text>
        </Pressable>
        <Pressable style={styles.radioRow} onPress={() => setIsPublic(true)}>
          <View style={[styles.radioOuter, { borderColor: isPublic ? colors.accent : colors.controlBorder }]}>
            {isPublic && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
          </View>
          <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: isPublic ? colors.text : colors.textMuted }}>
            Anyone can find it
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>Stakes (optional)</SectionLabel>
        <Input placeholder="Winner gets… e.g. picks the next restaurant" value={winnerStakes} onChangeText={setWinnerStakes} maxLength={140} />
        <Input placeholder="Loser has to… e.g. buys coffee for a week" value={loserStakes} onChangeText={setLoserStakes} maxLength={140} />
      </View>

      {error && (
        <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
          {error}
        </Text>
      )}

      <Button label="Create league" onPress={handleCreate} loading={loading} arrow />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  presetChip: {
    borderWidth: theme.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.75),
    paddingVertical: theme.space(2),
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: theme.radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: theme.space(2.75),
    alignItems: 'center',
    borderRadius: theme.radius.pill,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2.75),
  },
  radioOuter: {
    width: 17,
    height: 17,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.pill,
  },
});
