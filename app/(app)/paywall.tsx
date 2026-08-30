import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Heading, Muted, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { purchasePro } from '@/lib/purchases';
import { theme } from '@/lib/theme';

const PERKS = [
  'Unlimited simultaneous leagues',
  'Streak insurance — protect your rank if you miss a day',
  'Full history and stats across past leagues',
  'Custom league themes and badges',
];

export default function Paywall() {
  const { session, refreshProfile } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePurchase() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      // Stub — see lib/purchases.ts for how this becomes a real RevenueCat
      // purchase flow (App Store / Play Store) instead of a direct flag flip.
      await purchasePro(session.user.id);
      await refreshProfile();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ paddingTop: theme.space(6), gap: theme.space(4) }}>
      <Title>StepLeague Pro</Title>
      <Muted>$2.99/month, cancel anytime.</Muted>

      <Card style={{ gap: theme.space(3) }}>
        {PERKS.map((perk) => (
          <View key={perk} style={{ flexDirection: 'row', gap: theme.space(2) }}>
            <Muted style={{ color: theme.color.accent, fontWeight: '700' }}>✓</Muted>
            <Muted style={{ flex: 1, color: theme.color.text }}>{perk}</Muted>
          </View>
        ))}
      </Card>

      {error && <Muted style={{ color: theme.color.danger }}>{error}</Muted>}

      <View style={{ flex: 1 }} />

      <Button label="Upgrade — $2.99/mo" onPress={handlePurchase} loading={loading} />
      <Button label="Not now" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
