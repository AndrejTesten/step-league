import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme, useThemeColors } from '@/lib/theme';
import { formatCountdown, msUntilNextRollup } from '@/lib/timezone';

/** "Updates in 4h 12m" — recomputed every minute. */
export function CountdownBadge({ timezone }: { timezone: string }) {
  const colors = useThemeColors();
  const [ms, setMs] = useState(() => msUntilNextRollup(timezone));

  useEffect(() => {
    setMs(msUntilNextRollup(timezone));
    const interval = setInterval(() => setMs(msUntilNextRollup(timezone)), 60_000);
    return () => clearInterval(interval);
  }, [timezone]);

  return (
    <View style={[styles.badge, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.text, { color: colors.textMuted }]}>Updates in {formatCountdown(ms)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
});
