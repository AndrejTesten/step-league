import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

const PRESET_DATES: { key: string; date: () => Date }[] = [
  { key: '1week', date: () => addDays(7) },
  { key: '1month', date: () => addDays(30) },
  { key: 'endOfYear', date: endOfYear },
];

const SCORING_KEYS: { value: LeagueScoringMode; key: string }[] = [
  { value: 'daily_wins', key: 'dailyWins' },
  { value: 'total_steps', key: 'totalSteps' },
];

export default function CreateLeague() {
  const { t } = useTranslation();
  const PRESETS = PRESET_DATES.map((p) => ({ ...p, label: t(`leagues.create.presets.${p.key}`) }));
  const SCORING_OPTIONS = SCORING_KEYS.map((o) => ({
    ...o,
    label: t(`leagues.create.scoring.${o.key}.label`),
    hint: t(`leagues.create.scoring.${o.key}.hint`),
  }));
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
      setError(t('leagues.create.errors.nameRequired'));
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
      setError(getErrorMessage(e, t('leagues.create.errors.createFailed')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        <SectionLabel>{t('leagues.create.nameLabel')}</SectionLabel>
        <Input placeholder={t('leagues.create.namePlaceholder')} value={name} onChangeText={setName} maxLength={60} />
      </View>

      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>{t('leagues.create.endsOnLabel')}</SectionLabel>
        <DatePickerField value={deadline} onChange={setDeadline} minimumDate={new Date()} />
        <View style={{ flexDirection: 'row', gap: theme.space(1.5), flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <Pressable
              key={preset.key}
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
        <SectionLabel>{t('leagues.create.scoringLabel')}</SectionLabel>
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
        <SectionLabel>{t('leagues.create.whoCanJoinLabel')}</SectionLabel>
        <Pressable style={styles.radioRow} onPress={() => setIsPublic(false)}>
          <View style={[styles.radioOuter, { borderColor: !isPublic ? colors.accent : colors.controlBorder }]}>
            {!isPublic && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
          </View>
          <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>
            {t('leagues.create.inviteCodeOnly')}
          </Text>
        </Pressable>
        <Pressable style={styles.radioRow} onPress={() => setIsPublic(true)}>
          <View style={[styles.radioOuter, { borderColor: isPublic ? colors.accent : colors.controlBorder }]}>
            {isPublic && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
          </View>
          <Text style={{ fontSize: 14, fontFamily: theme.fontFamily.bodyMedium, color: isPublic ? colors.text : colors.textMuted }}>
            {t('leagues.create.anyoneCanFindIt')}
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: theme.space(1.75) }}>
        <SectionLabel>{t('leagues.create.stakesLabel')}</SectionLabel>
        <Input placeholder={t('leagues.create.winnerStakesPlaceholder')} value={winnerStakes} onChangeText={setWinnerStakes} maxLength={140} />
        <Input placeholder={t('leagues.create.loserStakesPlaceholder')} value={loserStakes} onChangeText={setLoserStakes} maxLength={140} />
      </View>

      {error && (
        <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
          {error}
        </Text>
      )}

      <Button label={t('leagues.create.submit')} onPress={handleCreate} loading={loading} arrow />
      </ScrollView>
    </Screen>
    </KeyboardAvoidingView>
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
