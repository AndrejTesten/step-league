import { useState } from 'react';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthLogo, SocialButtons } from '@/components/AuthExtras';
import { Button, Input, Screen, SectionLabel } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { theme, useThemeColors } from '@/lib/theme';

export default function SignIn() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) setError(error);
    // On success, the root layout's Stack.Protected swaps to (app) automatically.
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: theme.space(24) }} keyboardShouldPersistTaps="handled">
          <AuthLogo tagline={t('auth.signIn.tagline')} />

          <View style={{ gap: theme.space(3.5), marginTop: theme.space(7) }}>
            <View style={{ gap: theme.space(2) }}>
              <SectionLabel>{t('auth.signIn.emailLabel')}</SectionLabel>
              <Input
                placeholder={t('auth.signIn.emailPlaceholder')}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
            <View style={{ gap: theme.space(2) }}>
              <SectionLabel>{t('auth.signIn.passwordLabel')}</SectionLabel>
              <Input placeholder="••••••••" secureTextEntry value={password} onChangeText={setPassword} />
            </View>

            {error && (
              <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
                {error}
              </Text>
            )}

            <Button label={t('common.continue')} onPress={handleSignIn} loading={loading} arrow />

            <SocialButtons />
          </View>

          <View style={{ flex: 1 }} />

          <Link href="/sign-up" style={{ alignSelf: 'center', marginBottom: insets.bottom + theme.space(6) }}>
            <Text style={{ fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small, color: colors.textSubtle }}>
              {t('auth.signIn.noAccount')}
            </Text>
          </Link>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
