import { StyleSheet, Text, View } from 'react-native';

import { ACHIEVEMENTS } from '@/lib/achievements';
import { theme, useThemeColors } from '@/lib/theme';
import type { StepStats } from '@/lib/types';

export function BadgeGrid({ stats }: { stats: StepStats }) {
  const colors = useThemeColors();
  const earnedCount = ACHIEVEMENTS.filter((a) => a.isEarned(stats)).length;

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[styles.heading, { color: colors.text }]}>Badges</Text>
        <Text style={[styles.count, { color: colors.textMuted }]}>
          {earnedCount} / {ACHIEVEMENTS.length}
        </Text>
      </View>

      <View style={styles.grid}>
        {ACHIEVEMENTS.map((achievement) => {
          const earned = achievement.isEarned(stats);
          return (
            <View
              key={achievement.id}
              style={[
                styles.badge,
                { backgroundColor: colors.card, borderColor: colors.border },
                !earned && styles.badgeLocked,
              ]}
            >
              <Text style={[styles.icon, !earned && styles.iconLocked]}>{achievement.icon}</Text>
              <Text
                style={[styles.title, { color: earned ? colors.text : colors.textMuted }]}
                numberOfLines={1}
              >
                {achievement.title}
              </Text>
              <Text style={[styles.description, { color: colors.textMuted }]} numberOfLines={2}>
                {achievement.description}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  count: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  grid: {
    marginTop: theme.space(3),
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(3),
  },
  badge: {
    width: '30%',
    minWidth: 96,
    alignItems: 'center',
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(1),
  },
  badgeLocked: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 28,
  },
  iconLocked: {
    opacity: 0.6,
  },
  title: {
    marginTop: theme.space(1),
    fontSize: theme.font.small,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    marginTop: 2,
    fontSize: 11,
    textAlign: 'center',
  },
});
