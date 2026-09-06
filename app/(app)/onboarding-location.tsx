import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Muted, SearchableSelect, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { fetchCitiesForCountry, fetchCountries } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import { theme, useThemeColors } from '@/lib/theme';

// Required once, right after sign-up (see the redirect guard in
// app/(app)/_layout.tsx) — powers the City and Country leaderboard tabs.
// Country first, then that country's cities, since a city list only makes
// sense once you know which country's cities to show.
export default function OnboardingLocation() {
  const colors = useThemeColors();
  const { session, refreshProfile } = useSession();
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [country, setCountry] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCountries()
      .then(setCountries)
      .catch((e) => setError(getErrorMessage(e, 'Could not load countries.')))
      .finally(() => setCountriesLoading(false));
  }, []);

  function handleSelectCountry(value: string) {
    setCountry(value);
    setCity('');
    setCities([]);
    if (!value) return;
    setError(null);
    setCitiesLoading(true);
    fetchCitiesForCountry(value)
      .then(setCities)
      .catch((e) => setError(getErrorMessage(e, 'Could not load cities.')))
      .finally(() => setCitiesLoading(false));
  }

  async function handleSave() {
    if (!session || !country || !city) return;
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ country, city })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      router.replace('/');
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your location.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen style={{ paddingTop: theme.space(14), gap: theme.space(4) }}>
      <View>
        <Title>Where are you?</Title>
        <Muted style={{ marginTop: theme.space(1) }}>
          Powers the City and Country leaderboards — you can change this later in your profile.
        </Muted>
      </View>

      <SearchableSelect
        placeholder="Country"
        value={country}
        options={countries}
        onSelect={handleSelectCountry}
        loading={countriesLoading}
        emptyMessage="No countries found."
      />

      <SearchableSelect
        placeholder="City"
        value={city}
        options={cities}
        onSelect={setCity}
        loading={citiesLoading}
        disabled={!country}
        emptyMessage={country ? 'No cities found.' : 'Pick a country first.'}
      />

      {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

      <View style={{ flex: 1 }} />

      <Button label="Continue" onPress={handleSave} loading={saving} disabled={!country || !city} />
    </Screen>
  );
}
