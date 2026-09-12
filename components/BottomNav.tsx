import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme, useThemeColors } from '@/lib/theme';

const SEGMENTS = ['Leagues', 'Steps', 'Global'];

/**
 * The 3-page bottom nav shared by the swipeable home pages. Words, no
 * icons; the active tab is lime with a 2px lime top rule (design v2
 * screen "Bottom nav"). Tapping a segment scrolls the pager to it.
 */
export function BottomNav({ activeIndex, onChange }: { activeIndex: 0 | 1 | 2; onChange: (index: 0 | 1 | 2) => void }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.row, { borderTopColor: colors.borderStrong, paddingBottom: Math.max(insets.bottom, theme.space(3)) }]}>
      {SEGMENTS.map((label, i) => {
        const active = i === activeIndex;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(i as 0 | 1 | 2)}
            style={[
              styles.segment,
              active && { borderTopColor: colors.accent, borderTopWidth: 2, marginTop: -2 },
              i === 0 && styles.segmentLeft,
              i === 2 && styles.segmentRight,
            ]}
          >
            <Text style={[styles.label, { color: active ? colors.accent : colors.textDim }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 2,
    borderTopWidth: theme.border,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingTop: theme.space(3.5),
    paddingBottom: theme.space(3.25),
  },
  segmentLeft: {
    alignItems: 'flex-start',
    paddingLeft: theme.space(4.5),
  },
  segmentRight: {
    alignItems: 'flex-end',
    paddingRight: theme.space(4.5),
  },
  label: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
