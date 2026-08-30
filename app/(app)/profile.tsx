import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Heading, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { theme } from '@/lib/theme';

export default function Profile() {
  const { profile, signOut } = useSession();

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Title>{profile?.display_name ?? 'Profile'}</Title>
      <Muted>@{profile?.username}</Muted>

      <Card style={{ marginTop: theme.space(4) }}>
        <Heading style={{ fontSize: theme.font.body }}>
          {profile?.is_pro ? 'StepLeague Pro' : 'Free plan'}
        </Heading>
        <Muted style={{ marginTop: theme.space(1) }}>
          {profile?.is_pro
            ? 'Unlimited leagues, streak insurance, and history — thanks for supporting the app.'
            : 'One active league at a time. Upgrade for unlimited leagues and more.'}
        </Muted>
        {!profile?.is_pro && (
          <Button
            label="Upgrade to Pro"
            style={{ marginTop: theme.space(3) }}
            onPress={() => router.push('/paywall')}
          />
        )}
      </Card>

      <View style={{ flex: 1 }} />

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
