import { useState } from 'react';
import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, Input, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { theme, useThemeColors } from '@/lib/theme';

export default function SignIn() {
  const colors = useThemeColors();
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
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen style={{ justifyContent: 'center', gap: theme.space(4) }}>
        <View style={{ marginBottom: theme.space(6) }}>
          <Title>Welcome back</Title>
          <Muted>Sign in to see your leagues</Muted>
        </View>

        <Input
          placeholder="Email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />

        {error && <Muted style={{ color: colors.danger }}>{error}</Muted>}

        <Button label="Sign in" onPress={handleSignIn} loading={loading} />

        <Link href="/sign-up" style={{ alignSelf: 'center', marginTop: theme.space(4) }}>
          <Muted>Don&apos;t have an account? Sign up</Muted>
        </Link>
      </Screen>
    </KeyboardAvoidingView>
  );
}
