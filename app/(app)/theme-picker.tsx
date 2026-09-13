import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  ACCENT_PALETTES,
  FREE_COLOR_THEME,
  PREMIUM_COLOR_THEMES,
  colorThemeLabel,
  theme,
  useThemeColors,
  useThemeMode,
} from '@/lib/theme';
import type { ColorTheme } from '@/lib/types';

const PREVIEW_SECONDS = 10;

export default function ThemePicker() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { resolvedScheme, colorTheme, setColorTheme, previewColorTheme, setMode } = useThemeMode();
  const { session, profile, refreshProfile } = useSession();
  const isPro = !!profile?.is_pro;

  const [previewing, setPreviewing] = useState<ColorTheme | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!previewing) return;
    if (secondsLeft <= 0) {
      previewColorTheme(null);
      setPreviewing(null);
      router.push('/premium');
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [previewing, secondsLeft, previewColorTheme]);

  // Leaving this screen — by any route: back button, tab switch, the OS
  // task switcher killing the app mid-preview — clears the preview
  // immediately rather than leaving a premium theme applied until a
  // 10-second timer no longer has a screen to finish counting down on.
  // (previewColorTheme never persists, so even an app kill is safe: next
  // launch just has no preview to resume.)
  useFocusEffect(
    useCallback(() => {
      return () => {
        previewColorTheme(null);
      };
    }, [previewColorTheme])
  );

  async function selectTheme(t: ColorTheme) {
    const locked = PREMIUM_COLOR_THEMES.includes(t) && !isPro;
    if (locked) {
      if (previewing === t) return; // already previewing this one
      previewColorTheme(t);
      setPreviewing(t);
      setSecondsLeft(PREVIEW_SECONDS);
      return;
    }
    setPreviewing(null);
    setColorTheme(t);
    if (session) {
      try {
        await supabase.from('profiles').update({ color_theme: t }).eq('id', session.user.id);
        await refreshProfile();
      } catch {
        // Local color already applied; Supabase sync can retry next visit.
      }
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: theme.space(3), paddingBottom: insets.bottom + theme.space(8) }}
      >
        {previewing && (
          <View style={[styles.previewBanner, { borderColor: colors.accent, backgroundColor: colors.accentWash }]}>
            <Text style={{ flex: 1, fontSize: 12, fontFamily: theme.fontFamily.bodySemiBold, color: colors.accent }}>
              {t('themePicker.previewing', { theme: colorThemeLabel(previewing), seconds: secondsLeft })}
            </Text>
            <Pressable onPress={() => router.push('/premium')} hitSlop={6} style={{ flexShrink: 0 }}>
              <Text style={{ fontSize: 11, fontFamily: theme.fontFamily.bodyBold, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.accent }}>
                {t('themePicker.getPremium')}
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('themePicker.included')}</Text>
        <View style={styles.grid2}>
          <ModeSwatch label={t('themePicker.dark')} active={resolvedScheme === 'dark'} scheme="dark" onPress={() => setMode('dark')} />
          <ModeSwatch label={t('themePicker.light')} active={resolvedScheme === 'light'} scheme="light" onPress={() => setMode('light')} />
        </View>
        <Text style={[styles.hint, { color: colors.textDim }]}>
          {t('themePicker.switchHint')}
        </Text>

        <View style={styles.premiumHeader}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('themePicker.premiumThemes')}</Text>
          {!isPro && (
            <View style={[styles.priceChip, { backgroundColor: colors.accentChip }]}>
              <Text style={{ fontSize: 9, fontFamily: theme.fontFamily.bodySemiBold, letterSpacing: 1, textTransform: 'uppercase', color: colors.accent }}>
                {t('premium.priceShort')}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.grid}>
          <ColorSwatch
            themeKey={FREE_COLOR_THEME}
            active={colorTheme === FREE_COLOR_THEME && !previewing}
            locked={false}
            onPress={() => selectTheme(FREE_COLOR_THEME)}
          />
          {PREMIUM_COLOR_THEMES.map((t) => (
            <ColorSwatch
              key={t}
              themeKey={t}
              active={colorTheme === t}
              locked={!isPro}
              previewing={previewing === t}
              onPress={() => selectTheme(t)}
            />
          ))}
          <View style={[styles.comingSoon, { borderColor: colors.controlBorder }]}>
            <Text style={{ fontSize: 20, lineHeight: 20, fontFamily: theme.fontFamily.heading, color: colors.accent }}>
              {t('themePicker.moreComing')}
            </Text>
            <Text style={{ marginTop: theme.space(1.5), fontSize: 10, lineHeight: 14, color: colors.textDim, fontFamily: theme.fontFamily.bodyMedium }}>
              {t('themePicker.newThemeCadence')}
            </Text>
          </View>
        </View>

        <Text style={[styles.footnote, { color: colors.textDim }]}>
          {t('themePicker.previewFootnote')}
        </Text>

        {!isPro && (
          <Pressable
            onPress={() => router.push('/premium')}
            style={({ pressed }) => [styles.unlockButton, { backgroundColor: pressed ? colors.accentHover : colors.accent }]}
          >
            <Text style={[styles.unlockButtonText, { color: colors.primaryText }]}>{t('themePicker.unlockThemes')}</Text>
            <Text style={[styles.unlockButtonText, { color: colors.primaryText }]}>→</Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  );
}

function ModeSwatch({
  label,
  active,
  scheme,
  onPress,
}: {
  label: string;
  active: boolean;
  scheme: 'dark' | 'light';
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const previewBg = scheme === 'dark' ? '#0b0c0a' : '#f2f4ee';
  const previewAccent = scheme === 'dark' ? '#ccff33' : '#5a7a00';
  const previewMuted = scheme === 'dark' ? '#2a2d26' : '#d5d9cf';
  return (
    <Pressable
      onPress={onPress}
      style={[styles.swatchCard, { backgroundColor: colors.card, borderColor: active ? colors.accent : colors.borderStrong }]}
    >
      <View style={[styles.swatchPreview, { backgroundColor: previewBg }]}>
        <View style={{ width: 40, height: 9, borderRadius: 2, backgroundColor: previewAccent }} />
        <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end' }}>
          <View style={{ width: 6, height: 10, backgroundColor: previewAccent }} />
          <View style={{ width: 6, height: 18, backgroundColor: previewAccent }} />
          <View style={{ width: 6, height: 8, backgroundColor: previewMuted }} />
        </View>
      </View>
      <Text style={[styles.swatchLabel, { color: active ? colors.accent : colors.textMuted }]}>
        {label}
        {active ? t('themePicker.onSuffix') : ''}
      </Text>
    </Pressable>
  );
}

function ColorSwatch({
  themeKey,
  active,
  locked,
  previewing,
  onPress,
}: {
  themeKey: ColorTheme;
  active: boolean;
  locked: boolean;
  previewing?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const accents = ACCENT_PALETTES[themeKey].dark;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.swatchCard,
        { backgroundColor: colors.card, borderColor: active || previewing ? accents.accent : colors.borderStrong },
      ]}
    >
      <View style={[styles.swatchPreview, { backgroundColor: '#0b0c0a' }]}>
        <View style={{ width: 40, height: 9, borderRadius: 2, backgroundColor: accents.accent }} />
        <View style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end' }}>
          <View style={{ width: 6, height: 10, backgroundColor: accents.accent }} />
          <View style={{ width: 6, height: 18, backgroundColor: accents.accent }} />
          <View style={{ width: 6, height: 8, backgroundColor: '#2a2d26' }} />
        </View>
      </View>
      <Text style={[styles.swatchLabel, { color: active || previewing ? accents.accent : colors.textMuted }]} numberOfLines={1}>
        {colorThemeLabel(themeKey)}
        {locked ? t('themePicker.lockedSuffix') : active ? t('themePicker.onSuffix') : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: theme.font.label,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: theme.space(2.5),
  },
  grid2: {
    flexDirection: 'row',
    gap: theme.space(2),
    marginBottom: theme.space(2.5),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
  },
  swatchCard: {
    width: '47%',
    flexGrow: 1,
    borderWidth: theme.border,
    borderRadius: theme.radius.lg,
    padding: 4,
    paddingBottom: theme.space(3),
  },
  swatchPreview: {
    height: 62,
    borderRadius: theme.radius.md - 1,
    padding: theme.space(2.25),
    justifyContent: 'space-between',
  },
  swatchLabel: {
    marginTop: theme.space(2.5),
    textAlign: 'center',
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  comingSoon: {
    width: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: theme.radius.lg,
    padding: theme.space(3),
    justifyContent: 'center',
  },
  hint: {
    marginTop: theme.space(2),
    marginBottom: theme.space(5),
    fontSize: 11,
    lineHeight: 16,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  premiumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space(2.5),
  },
  priceChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(2.25),
    paddingVertical: theme.space(1),
  },
  footnote: {
    marginTop: theme.space(3),
    fontSize: 12,
    lineHeight: 18,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: theme.border,
    borderRadius: theme.radius.md,
    padding: theme.space(3),
    marginBottom: theme.space(4),
  },
  unlockButton: {
    marginTop: theme.space(5),
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4.25),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unlockButtonText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
