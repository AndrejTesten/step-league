import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import { Muted } from '@/components/ui';
import { theme, useThemeColors } from '@/lib/theme';
import type { LeagueScoreSeries } from '@/lib/leagues';

// A fixed, colorblind-reasonable palette — cycles if a league somehow has
// more members than colors. Kept separate from the theme's gold/silver/
// bronze trio since a graph needs one distinct hue per member, not per rank.
const PALETTE = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D'];

const CHART_HEIGHT = 180;

function Segment({ x1, y1, x2, y2, color, width }: { x1: number; y1: number; x2: number; y2: number; color: string; width: number }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: 'absolute',
        left: x1,
        top: y1 - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${angleDeg}deg` }],
        transformOrigin: '0 50%',
      }}
    />
  );
}

/** Pure-View line chart (no SVG/chart-library dependency) of cumulative steps per member. */
export function LeagueScoreChart({ series }: { series: LeagueScoreSeries }) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  if (series.dates.length < 2 || series.members.length === 0) {
    return (
      <View style={{ paddingVertical: theme.space(6), alignItems: 'center' }}>
        <Muted>{t('leagues.chart.notEnoughData')}</Muted>
      </View>
    );
  }

  const max = Math.max(1, ...series.members.flatMap((m) => series.totals[m.user_id] ?? [0]));
  const n = series.dates.length;
  const stepX = width > 0 ? width / (n - 1) : 0;

  function toPoint(value: number, i: number) {
    return { x: i * stepX, y: CHART_HEIGHT - (value / max) * CHART_HEIGHT };
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Muted style={styles.axisLabel}>{max.toLocaleString()}</Muted>
      </View>
      <View style={[styles.chart, { height: CHART_HEIGHT, borderColor: colors.border }]} onLayout={onLayout}>
        {width > 0 &&
          series.members.map((m, mi) => {
            const values = series.totals[m.user_id] ?? [];
            const color = PALETTE[mi % PALETTE.length];
            const lineWidth = m.is_me ? 3 : 1.5;
            const points = values.map((v, i) => toPoint(v, i));
            return (
              <View key={m.user_id} style={StyleSheet.absoluteFill}>
                {points.slice(1).map((p, i) => (
                  <Segment
                    key={i}
                    x1={points[i].x}
                    y1={points[i].y}
                    x2={p.x}
                    y2={p.y}
                    color={color}
                    width={lineWidth}
                  />
                ))}
              </View>
            );
          })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space(1) }}>
        <Muted style={styles.axisLabel}>{formatShortDate(series.dates[0], i18n.language)}</Muted>
        <Muted style={styles.axisLabel}>{formatShortDate(series.dates[n - 1], i18n.language)}</Muted>
      </View>

      <View style={styles.legend}>
        {series.members.map((m, i) => (
          <View key={m.user_id} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={[styles.legendLabel, { color: m.is_me ? colors.text : colors.textMuted }]} numberOfLines={1}>
              {m.display_name}
              {m.is_me ? t('leagues.chart.youSuffix') : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function formatShortDate(dateKey: string, locale: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  chart: {
    marginTop: theme.space(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  axisLabel: {
    fontSize: 11,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(3),
    marginTop: theme.space(4),
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1.5),
    maxWidth: 160,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: theme.font.small,
  },
});
