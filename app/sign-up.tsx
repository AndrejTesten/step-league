import { useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Input, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { theme, useThemeColors } from '@/lib/theme';

export default function SignUp() {
  const colors = useThemeColors();
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
      setError('Fill in every field.');
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
        <Title>Check your email</Title>
        <Muted>We sent a confirmation link to {email}. Tap it, then come back and sign in.</Muted>
        <Link href="/sign-in" asChild>
          <Button label="Back to sign in" variant="secondary" />
        </Link>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen style={{ justifyContent: 'center', gap: theme.space(4) }}>
        <View style={{ marginBottom: theme.space(6) }}>
          <Title>Create your account</Title>
          <Muted>Compete with friends, one league at a time</Muted>
        </View>

        <Input placeholder="Display name" value={displayName} onChangeText={setDisplayName} />
        <Input placeholder="Username" value={username} onChangeText={setUsername} />
        <Input
          placeholder="Email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

        {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

        <Button label="Sign up" onPress={handleSignUp} loading={loading} />

        <Link href="/sign-in" style={{ alignSelf: 'center', marginTop: theme.space(4) }}>
          <Muted>Already have an account? Sign in</Muted>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
