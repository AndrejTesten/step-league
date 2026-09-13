import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Muted, SearchableSelect, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { fetchCitiesForCountry, fetchCountries } from '@/lib/geo';
import { useStepsConsent } from '@/lib/steps-consent';
import { supabase } from '@/lib/supabase';
import { theme, useThemeColors } from '@/lib/theme';

// Required once, right after sign-up (see the redirect guard in
// app/(app)/_layout.tsx) — powers the City and Country leaderboard tabs.
// Country first, then that country's cities, since a city list only makes
// sense once you know which country's cities to show.
export default function OnboardingLocation() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { session, refreshProfile } = useSession();
  const { consentGiven } = useStepsConsent();
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
      .catch((e) => setError(getErrorMessage(e, t('onboarding.location.errors.countries'))))
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
      .catch((e) => setError(getErrorMessage(e, t('onboarding.location.errors.cities'))))
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
      // Go straight to wherever onboarding actually continues instead of
      // replacing to '/' and relying on the (app) layout's own redirect
      // guard to immediately bounce us onward again — that extra hop
      // through the home screen (mounting all three of its pages) right as
      // `profile` changes shape was enough to send React Navigation into
      // "Maximum update depth exceeded".
      router.replace(consentGiven ? '/' : '/onboarding-health');
    } catch (e) {
      setError(getErrorMessage(e, t('onboarding.location.errors.save')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen style={{ paddingTop: theme.space(14), gap: theme.space(4) }}>
      <View>
        <Title>{t('onboarding.location.heading')}</Title>
        <Muted style={{ marginTop: theme.space(1) }}>
          {t('onboarding.location.subheading')}
        </Muted>
      </View>

      <SearchableSelect
        placeholder={t('profile.location.country')}
        value={country}
        options={countries}
        onSelect={handleSelectCountry}
        loading={countriesLoading}
        emptyMessage={t('profile.location.noCountries')}
      />

      <SearchableSelect
        placeholder={t('profile.location.city')}
        value={city}
        options={cities}
        onSelect={setCity}
        loading={citiesLoading}
        disabled={!country}
        emptyMessage={country ? t('profile.location.noCities') : t('profile.location.pickCountryFirst')}
      />

      {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

      <View style={{ flex: 1 }} />

      <View style={{ paddingBottom: insets.bottom }}>
        <Button label={t('common.continue')} onPress={handleSave} loading={saving} disabled={!country || !city} />
      </View>
    </Screen>
    </KeyboardAvoidingView>
  );
}
