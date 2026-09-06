import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme, useThemeColors, type ThemeColors } from '@/lib/theme';

const WEEKS = 20;
const CELL = 12;
const GAP = 3;

function levelFor(steps: number): number {
  if (steps <= 0) return 0;
  if (steps < 3000) return 1;
  if (steps < 6000) return 2;
  if (steps < 10_000) return 3;
  return 4;
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function colorForLevel(level: number, colors: ThemeColors): string {
  if (level <= 0) return colors.bg;
  const alpha = [0, 0.28, 0.52, 0.76, 1][level];
  return `rgba(${hexToRgb(colors.accent)}, ${alpha})`;
}

type Cell = { date: string; level: number };

function buildColumns(stepsByDate: Map<string, number>, weeks: number): Cell[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back up to that week's Sunday

  const columns: Cell[][] = [];
  const cursor = new Date(start);
  while (cursor <= today || cursor.getDay() !== 0) {
    const col: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      col.push({
        date: key,
        level: cursor > today ? -1 : levelFor(stepsByDate.get(key) ?? 0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }
  return columns;
}

export function ContributionHeatmap({ stepsByDate }: { stepsByDate: Map<string, number> }) {
  const colors = useThemeColors();
  const columns = useMemo(() => buildColumns(stepsByDate, WEEKS), [stepsByDate]);

  return (
    <View>
      <Text style={[styles.heading, { color: colors.text }]}>Activity</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.space(2) }}>
        <View style={{ flexDirection: 'row', gap: GAP }}>
          {columns.map((col, i) => (
            <View key={i} style={{ gap: GAP }}>
              {col.map((cell, j) => (
                <View
                  key={j}
                  style={[
                    styles.cell,
                    {
                      borderColor: colors.border,
                      backgroundColor: cell.level < 0 ? 'transparent' : colorForLevel(cell.level, colors),
                      borderWidth: cell.level < 0 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: theme.space(2) }}>
        <Text style={[styles.legend, { color: colors.textMuted }]}>Less</Text>
        {[0, 1, 2, 3, 4].map((level) => (
          <View
            key={level}
            style={[
              styles.cell,
              { width: CELL - 2, height: CELL - 2, borderColor: colors.border, backgroundColor: colorForLevel(level, colors) },
            ]}
          />
        ))}
        <Text style={[styles.legend, { color: colors.textMuted }]}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 3,
  },
  legend: {
    fontSize: theme.font.small,
  },
});
