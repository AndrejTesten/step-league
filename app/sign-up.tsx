import { useState } from 'react';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthLogo, SocialButtons } from '@/components/AuthExtras';
import { Button, Input, Screen, SectionLabel, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { theme, useThemeColors } from '@/lib/theme';

export default function SignUp() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { signUp } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (!email || !password || !username || !displayName) {
      setError(t('auth.signUp.fillAllFields'));
      return;
    }
    setLoading(true);
    const { error } = await signUp({
      email: email.trim(),
      password,
      username: username.trim().toLowerCase(),
      displayName: displayName.trim(),
    });
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    setConfirmEmailSent(true);
    // If your Supabase project has email confirmation disabled, the auth
    // state change fires immediately and Stack.Protected takes the user
    // straight into (app) — this screen is skipped entirely in that case.
  }

  if (confirmEmailSent) {
    return (
      <Screen style={{ justifyContent: 'center', gap: theme.space(3) }}>
        <Title>{t('auth.signUp.checkEmailTitle')}</Title>
        <Text style={{ fontFamily: theme.fontFamily.bodyMedium, color: colors.textSubtle }}>
          {t('auth.signUp.checkEmailMessage', { email })}
        </Text>
        <Link href="/sign-in" asChild>
          <Button label={t('auth.signUp.backToSignIn')} variant="secondary" />
        </Link>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: theme.space(18) }} keyboardShouldPersistTaps="handled">
          <AuthLogo tagline={t('auth.signUp.tagline')} />

          <View style={{ gap: theme.space(3), marginTop: theme.space(7) }}>
            <View style={{ gap: theme.space(2) }}>
              <SectionLabel>{t('auth.signUp.displayNameLabel')}</SectionLabel>
              <Input placeholder="Maja Kowalska" value={displayName} onChangeText={setDisplayName} />
            </View>
            <View style={{ gap: theme.space(2) }}>
              <SectionLabel>{t('auth.signUp.usernameLabel')}</SectionLabel>
              <Input placeholder="maja" value={username} onChangeText={setUsername} />
            </View>
            <View style={{ gap: theme.space(2) }}>
              <SectionLabel>{t('auth.signIn.emailLabel')}</SectionLabel>
              <Input placeholder="you@example.com" keyboardType="email-address" value={email} onChangeText={setEmail} />
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

            <Button label={t('auth.signUp.submit')} onPress={handleSignUp} loading={loading} arrow />

            <SocialButtons />
          </View>

          <View style={{ flex: 1 }} />

          <Link href="/sign-in" style={{ alignSelf: 'center', marginBottom: insets.bottom + theme.space(6) }}>
            <Text style={{ fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small, color: colors.textSubtle }}>
              {t('auth.signUp.noAccountFlip')}
            </Text>
          </Link>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
