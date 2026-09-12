import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Button, Input, Screen, SearchableSelect, SectionLabel, Tabs } from '@/components/ui';
import { pickAndUploadAvatar } from '@/lib/avatar';
import { useSession } from '@/lib/auth-context';
import { DEFAULT_DAILY_GOAL } from '@/lib/equivalences';
import { getErrorMessage } from '@/lib/errors';
import { fetchCitiesForCountry, fetchCountries } from '@/lib/geo';
import { getMyTotalWins, listMyLeagues } from '@/lib/leagues';
import { getStepStats } from '@/lib/stats';
import { supabase } from '@/lib/supabase';
import { theme, useThemeColors, useThemeMode, type ThemeMode } from '@/lib/theme';
import type { StepStats } from '@/lib/types';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const EMPTY_STATS: StepStats = { today: 0, month: 0, year: 0, allTime: 0, bestDay: 0, daysLogged: 0, streak: 0 };

export default function Profile() {
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useThemeMode();
  const { session, profile, signOut, refreshProfile } = useSession();
  const [city, setCity] = useState(profile?.city ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [cities, setCities] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(String(profile?.daily_goal ?? DEFAULT_DAILY_GOAL));
  const [stats, setStats] = useState<StepStats>(EMPTY_STATS);
  const [leagueCount, setLeagueCount] = useState(0);
  const [wins, setWins] = useState(0);

  useEffect(() => {
    setCity(profile?.city ?? '');
    setCountry(profile?.country ?? '');
  }, [profile?.city, profile?.country]);

  useEffect(() => {
    fetchCountries()
      .then(setCountries)
      .catch(() => setCountries([]))
      .finally(() => setCountriesLoading(false));
  }, []);

  // Loads whichever country is currently selected's cities — including the
  // profile's existing city on first load — but deliberately doesn't touch
  // `city` itself here; only a real tap on a country option (below) clears
  // it, so restoring the saved country from the profile doesn't wipe the
  // saved city out from under it.
  useEffect(() => {
    if (!country) {
      setCities([]);
      return;
    }
    setCitiesLoading(true);
    fetchCitiesForCountry(country)
      .then(setCities)
      .catch(() => setCities([]))
      .finally(() => setCitiesLoading(false));
  }, [country]);

  function handleSelectCountry(value: string) {
    setCountry(value);
    setCity('');
  }

  useEffect(() => {
    setDailyGoal(String(profile?.daily_goal ?? DEFAULT_DAILY_GOAL));
  }, [profile?.daily_goal]);

  useEffect(() => {
    if (!session || !profile) return;
    getStepStats(session.user.id, profile.timezone)
      .then(setStats)
      .catch(() => {});
    listMyLeagues()
      .then((leagues) => setLeagueCount(leagues.length))
      .catch(() => {});
    getMyTotalWins()
      .then(setWins)
      .catch(() => {});
  }, [session, profile]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locationChanged = city !== (profile?.city ?? '') || country !== (profile?.country ?? '');
  const parsedGoal = Math.round(Number(dailyGoal));
  const goalValid = Number.isFinite(parsedGoal) && parsedGoal > 0;
  const goalChanged = goalValid && parsedGoal !== (profile?.daily_goal ?? DEFAULT_DAILY_GOAL);

  async function handleChangePhoto() {
    if (!session) return;
    setError(null);
    setUploadingPhoto(true);
    try {
      await pickAndUploadAvatar(session.user.id);
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update photo.'));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSaveLocation() {
    if (!session) return;
    setError(null);
    setSavingLocation(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ city: city.trim() || null, country: country.trim() || null })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save location.'));
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleSaveGoal() {
    if (!session || !goalValid) return;
    setError(null);
    setSavingGoal(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ daily_goal: parsedGoal })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your daily goal.'));
    } finally {
      setSavingGoal(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(8) }}
      >
        <View style={styles.identity}>
          <Pressable onPress={handleChangePhoto} disabled={uploadingPhoto}>
            <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={72} variant="accent" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.text }]}>{profile?.display_name ?? 'Profile'}</Text>
            <Pressable onPress={handleChangePhoto} disabled={uploadingPhoto} hitSlop={8}>
              <Text style={{ marginTop: theme.space(1.5), fontSize: 11, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>
                @{profile?.username} · {uploadingPhoto ? 'Uploading…' : 'change photo'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCell, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{stats.streak}</Text>
            <SectionLabel style={{ marginTop: theme.space(1.75) }}>Day streak</SectionLabel>
          </View>
          <View style={[styles.statCell, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: colors.text }]}>{leagueCount}</Text>
            <SectionLabel style={{ marginTop: theme.space(1.75) }}>Leagues</SectionLabel>
          </View>
          <View style={[styles.statCell, { backgroundColor: colors.card }]}>
            <Text style={[styles.statValue, { color: colors.text }]}>{wins}</Text>
            <SectionLabel style={{ marginTop: theme.space(1.75) }}>Wins</SectionLabel>
          </View>
        </View>

        <View style={[styles.locationBlock, { borderTopColor: colors.border }]}>
          <SectionLabel>Country</SectionLabel>
          <SearchableSelect
            placeholder="Country"
            value={country}
            options={countries}
            onSelect={handleSelectCountry}
            loading={countriesLoading}
            emptyMessage="No countries found."
          />
        </View>
        <View style={[styles.locationBlock, { paddingTop: theme.space(3), borderTopWidth: 0 }]}>
          <SectionLabel>City</SectionLabel>
          <SearchableSelect
            placeholder="City"
            value={city}
            options={cities}
            onSelect={setCity}
            loading={citiesLoading}
            disabled={!country}
            emptyMessage={country ? 'No cities found.' : 'Pick a country first.'}
          />
        </View>
        {locationChanged && (
          <View style={{ paddingVertical: theme.space(3) }}>
            <Button label="Save location" onPress={handleSaveLocation} loading={savingLocation} />
          </View>
        )}

        <View style={[styles.settingRow, { borderTopColor: colors.border }]}>
          <SectionLabel>Daily goal</SectionLabel>
          <Input
            placeholder={String(DEFAULT_DAILY_GOAL)}
            value={dailyGoal}
            onChangeText={(t) => setDailyGoal(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            style={[styles.settingInput, { fontFamily: theme.fontFamily.heading, fontSize: 20 }]}
          />
        </View>
        {goalChanged && (
          <View style={{ paddingVertical: theme.space(3) }}>
            <Button label="Save daily goal" onPress={handleSaveGoal} loading={savingGoal} />
          </View>
        )}
        <View style={[styles.settingRow, { borderTopColor: colors.border, justifyContent: 'space-between', alignItems: 'center' }]}>
          <SectionLabel>Score update</SectionLabel>
          <Text style={{ fontSize: 15, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>
            22:00 <Text style={{ color: colors.textDim, fontSize: 11 }}>local</Text>
          </Text>
        </View>
        <View style={[styles.settingRow, { borderTopColor: colors.border, borderBottomWidth: theme.border, borderBottomColor: colors.border, justifyContent: 'space-between', alignItems: 'center' }]}>
          <SectionLabel>Notifications</SectionLabel>
          <Text style={{ fontSize: 15, fontFamily: theme.fontFamily.bodyMedium, color: colors.text }}>Results only</Text>
        </View>

        <View style={{ paddingTop: theme.space(5), gap: theme.space(2.75) }}>
          {profile?.is_pro ? (
            <Pressable
              onPress={() => router.push('/premium')}
              style={[styles.coffeeRow, { borderColor: colors.accent, backgroundColor: colors.accentWash }]}
            >
              <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.accent }}>
                Premium active
              </Text>
              <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodyMedium, color: colors.textMuted }}>€1.99/mo →</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/premium')}
              style={({ pressed }) => [
                styles.coffeeRow,
                { borderColor: colors.accent },
                pressed && { backgroundColor: colors.accent },
              ]}
            >
              {({ pressed }: { pressed: boolean }) => (
                <>
                  <Text style={{ fontSize: 12, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: pressed ? colors.primaryText : colors.accent }}>
                    Get premium · €1.99/mo
                  </Text>
                  <Text style={{ fontSize: 15, color: pressed ? colors.primaryText : colors.accent }}>→</Text>
                </>
              )}
            </Pressable>
          )}
          <Text style={{ fontSize: 11, lineHeight: 16, maxWidth: 300, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium }}>
            Step League is one person and a server bill. No ads, no selling your steps.
          </Text>
        </View>

        <Pressable
          onPress={() => router.push(profile?.is_pro ? '/stats-history' : '/premium')}
          style={[styles.settingRow, { borderTopColor: colors.border, justifyContent: 'space-between', alignItems: 'center', marginTop: theme.space(3) }]}
        >
          <SectionLabel>Stat history</SectionLabel>
          <Text style={{ fontSize: 13, fontFamily: theme.fontFamily.bodySemiBold, color: profile?.is_pro ? colors.text : colors.textMuted }}>
            {profile?.is_pro ? 'Every league, all time →' : 'Premium →'}
          </Text>
        </Pressable>

        <View style={{ gap: theme.space(2), marginTop: theme.space(5) }}>
          <Text style={{ fontSize: theme.font.small, fontFamily: theme.fontFamily.heading, color: colors.text, textTransform: 'uppercase' }}>
            Appearance
          </Text>
          <Tabs options={THEME_OPTIONS} value={mode} onChange={setMode} />
          <Pressable onPress={() => router.push('/theme-picker')} style={{ paddingVertical: theme.space(2) }} hitSlop={4}>
            <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.accent }}>
              Color themes →
            </Text>
          </Pressable>
        </View>

        {error && (
          <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small, marginTop: theme.space(3) }}>
            {error}
          </Text>
        )}

        <Pressable onPress={signOut} hitSlop={8} style={{ paddingVertical: theme.space(2), marginTop: theme.space(5) }}>
          <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted }}>
            Sign out
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3.5),
    paddingTop: theme.space(3),
    paddingBottom: theme.space(4.5),
  },
  name: {
    fontSize: 30,
    fontFamily: theme.fontFamily.heading,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.space(2),
    marginBottom: theme.space(2),
  },
  statCell: {
    flex: 1,
    borderRadius: theme.radius.md,
    padding: theme.space(3.5),
  },
  statValue: {
    fontSize: 30,
    fontFamily: theme.fontFamily.heading,
    fontVariant: ['tabular-nums'],
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space(3.75),
    borderTopWidth: theme.border,
    gap: theme.space(3),
  },
  locationBlock: {
    paddingTop: theme.space(3.75),
    borderTopWidth: theme.border,
    gap: theme.space(2),
  },
  settingInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlign: 'right',
    fontSize: 15,
  },
  coffeeRow: {
    borderWidth: theme.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
