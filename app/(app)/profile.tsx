import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BadgeGrid } from '@/components/BadgeGrid';
import { ContributionHeatmap } from '@/components/ContributionHeatmap';
import { Avatar, Button, Card, Heading, Input, Muted, Screen, Tabs, Title } from '@/components/ui';
import { pickAndUploadAvatar } from '@/lib/avatar';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { getDailyStepsMap, getStepStats } from '@/lib/stats';
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
  const { mode, setMode } = useThemeMode();
  const { session, profile, signOut, refreshProfile } = useSession();
  const [city, setCity] = useState(profile?.city ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [stats, setStats] = useState<StepStats>(EMPTY_STATS);
  const [dailyStepsMap, setDailyStepsMap] = useState<Map<string, number>>(new Map());

  // This screen's own instance can stay mounted (and its useState initial
  // value only ever applies once) across the profile object being replaced
  // out from under it — e.g. after onboarding writes city/country, or after
  // refreshProfile() runs elsewhere. Re-sync whenever the underlying
  // profile's location actually changes.
  useEffect(() => {
    setCity(profile?.city ?? '');
    setCountry(profile?.country ?? '');
  }, [profile?.city, profile?.country]);

  useEffect(() => {
    if (!session || !profile) return;
    getStepStats(session.user.id, profile.timezone)
      .then(setStats)
      .catch(() => {});
    getDailyStepsMap(session.user.id)
      .then(setDailyStepsMap)
      .catch(() => {});
  }, [session, profile]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locationChanged = city !== (profile?.city ?? '') || country !== (profile?.country ?? '');

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

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingTop: theme.space(6), paddingBottom: theme.space(8), gap: theme.space(4) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: theme.space(3) }}>
          <Pressable onPress={handleChangePhoto} disabled={uploadingPhoto}>
            <Avatar uri={profile?.avatar_url} name={profile?.display_name} size={96} />
          </Pressable>
          <Pressable onPress={handleChangePhoto} disabled={uploadingPhoto} hitSlop={8}>
            <Muted style={{ color: colors.accent }}>
              {uploadingPhoto ? 'Uploading…' : 'Change photo'}
            </Muted>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center' }}>
          <Title>{profile?.display_name ?? 'Profile'}</Title>
          <Muted>@{profile?.username}</Muted>
        </View>

        <Card>
          <BadgeGrid stats={stats} />
        </Card>

        <Card>
          <ContributionHeatmap stepsByDate={dailyStepsMap} />
        </Card>

        <Card style={{ gap: theme.space(3) }}>
          <Heading style={{ fontSize: theme.font.body }}>Location</Heading>
          <Muted>Powers the City and Country leaderboard tabs.</Muted>
          <Input placeholder="City" value={city} onChangeText={setCity} />
          <Input placeholder="Country" value={country} onChangeText={setCountry} />
          {locationChanged && (
            <Button label="Save location" onPress={handleSaveLocation} loading={savingLocation} />
          )}
        </Card>

        <Card style={{ gap: theme.space(3) }}>
          <Heading style={{ fontSize: theme.font.body }}>Appearance</Heading>
          <Tabs options={THEME_OPTIONS} value={mode} onChange={setMode} />
        </Card>

        {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

        <Button label="Sign out" variant="secondary" onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}
