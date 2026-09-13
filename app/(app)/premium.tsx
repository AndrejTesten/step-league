import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/lib/auth-context';
import { theme, useThemeColors, type ThemeColors } from '@/lib/theme';

const FEATURE_KEYS = ['peeks', 'history', 'themes'] as const;

/**
 * The €1.99/mo paywall (design screen "2t") — reached from Peek's limit
 * sheet, the theme picker, Stat History, and Profile.
 *
 * There's no real in-app-purchase wiring yet — that's Apple/Google
 * developer accounts, store-side product setup, and a RevenueCat (or raw
 * StoreKit2/Play Billing) integration, none of which this environment can
 * do. `profiles.is_pro` used to be flippable straight from this screen for
 * testing, but that's also exactly the bug that let any signed-in user
 * grant themselves premium for free — so `is_pro` is now locked down at
 * the database level (see the `revoke update (is_pro)` in
 * supabase/schema.sql) and this screen can no longer write it at all.
 * Until real billing exists, flip it for testing via the Supabase SQL
 * editor: `update profiles set is_pro = true where id = '<uuid>';`
 *
 * Background and every "ink" text/button color come from the user's chosen
 * accent theme (useThemeColors()) rather than a fixed lime, so this screen
 * matches whichever of the 6 color themes is active.
 */
export default function Premium() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const FEATURES = FEATURE_KEYS.map((key) => ({
    key,
    title: t(`premium.features.${key}.title`),
    body: t(`premium.features.${key}.body`),
  }));

  if (profile?.is_pro) {
    return <ManagePremium colors={colors} insets={insets} />;
  }

  const ink = colors.primaryText;

  return (
    <View style={[styles.screen, { backgroundColor: colors.accent }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
          <View style={[styles.mark, { backgroundColor: ink }]}>
            <Text style={[styles.markText, { color: colors.accent }]}>SL</Text>
          </View>
          <Text style={[styles.headerLabel, { color: ink }]}>{t('premium.headerLabel')}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={[styles.close, { color: ink }]}>✕</Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: theme.space(5.5), paddingBottom: theme.space(5) }}>
        <Text style={[styles.price, { color: ink }]}>
          €1.99<Text style={[styles.priceSuffix, { color: ink }]}> {t('premium.perMonth')}</Text>
        </Text>
        <Text style={[styles.pitch, { color: ink }]}>
          {t('premium.pitch')}
        </Text>
      </View>

      <View style={[styles.featureCard, { backgroundColor: colors.accentDark }]}>
        {FEATURES.map((f, i) => (
          <View key={f.key} style={[styles.featureRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
            <View style={[styles.featureIconBox, { backgroundColor: colors.accentChip }]}>
              <FeatureGlyph index={i} color={colors.accent} altColor={colors.accentDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.featureTitle, { color: colors.text }]}>{f.title}</Text>
              <Text style={[styles.featureBody, { color: colors.textMuted }]}>{f.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <View style={[styles.actions, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <View style={[styles.primaryButton, { backgroundColor: colors.accentDark, opacity: 0.6 }]}>
          <Text style={[styles.primaryButtonText, { color: colors.text }]}>{t('premium.notLiveYet')}</Text>
        </View>
        <Text style={[styles.fineprint, { color: ink }]}>
          {t('premium.finishingSetup')}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'center' }}>
          <Text style={[styles.notNow, { color: ink }]}>{t('common.back')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Shown for accounts where `is_pro` is already true (today: only via a
 * manual SQL flip during testing; later: real subscribers). Real
 * subscriptions live in Apple/Google's billing systems, not this app, so
 * cancellation genuinely has to route there — this copy stays accurate
 * once real StoreKit/Play Billing is wired up.
 */
function ManagePremium({ colors, insets }: { colors: ThemeColors; insets: { bottom: number } }) {
  const { t } = useTranslation();
  const ink = colors.primaryText;

  return (
    <View style={[styles.screen, { backgroundColor: colors.accent }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
          <View style={[styles.mark, { backgroundColor: ink }]}>
            <Text style={[styles.markText, { color: colors.accent }]}>SL</Text>
          </View>
          <Text style={[styles.headerLabel, { color: ink }]}>{t('premium.headerLabel')}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={[styles.close, { color: ink }]}>✕</Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: theme.space(5.5), paddingBottom: theme.space(5) }}>
        <Text style={[styles.price, { color: ink, fontSize: 34, lineHeight: 32 }]}>{t('premium.manage.youArePremium')}</Text>
        <Text style={[styles.pitch, { color: ink }]}>{t('premium.manage.subtitle')}</Text>
      </View>

      <View style={[styles.featureCard, { backgroundColor: colors.accentDark }]}>
        <View style={styles.featureRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>{t('premium.manage.howToCancel.title')}</Text>
            <Text style={[styles.featureBody, { color: colors.textMuted }]}>
              {t('premium.manage.howToCancel.body')}
            </Text>
          </View>
        </View>
        <View style={[styles.featureRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>{t('premium.manage.onIphone.title')}</Text>
            <Text style={[styles.featureBody, { color: colors.textMuted }]}>{t('premium.manage.onIphone.body')}</Text>
          </View>
        </View>
        <View style={[styles.featureRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.featureTitle, { color: colors.text }]}>{t('premium.manage.onAndroid.title')}</Text>
            <Text style={[styles.featureBody, { color: colors.textMuted }]}>{t('premium.manage.onAndroid.body')}</Text>
          </View>
        </View>
      </View>

      <View style={{ flex: 1 }} />

      <View style={[styles.actions, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={[styles.fineprint, { color: ink }]}>{t('premium.manage.keepUntilBillingEnds')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ alignSelf: 'center' }}>
          <Text style={[styles.notNow, { color: ink }]}>{t('common.back')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeatureGlyph({ index, color, altColor }: { index: number; color: string; altColor: string }) {
  if (index === 0) {
    // Peek — a simple eye: outer ring + pupil.
    return (
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
      </View>
    );
  }
  if (index === 1) {
    // History — ascending bars.
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
        <View style={{ width: 3, height: 7, backgroundColor: color }} />
        <View style={{ width: 3, height: 11, backgroundColor: color }} />
        <View style={{ width: 3, height: 16, backgroundColor: color }} />
      </View>
    );
  }
  // Themes — a half-and-half circle.
  return (
    <View style={{ width: 16, height: 16, borderRadius: 8, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: 8, height: 16, backgroundColor: color }} />
      <View style={{ width: 8, height: 16, backgroundColor: altColor }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: theme.space(17),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space(5.5),
    paddingBottom: theme.space(4.5),
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontSize: 12,
    fontFamily: theme.fontFamily.heading,
  },
  headerLabel: {
    fontSize: 9,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 2,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  close: {
    fontSize: 18,
    opacity: 0.5,
  },
  price: {
    fontSize: 52,
    lineHeight: 47,
    fontFamily: theme.fontFamily.heading,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  priceSuffix: {
    fontSize: 22,
    opacity: 0.55,
  },
  pitch: {
    marginTop: theme.space(3.5),
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 320,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  featureCard: {
    marginHorizontal: theme.space(5.5),
    borderRadius: theme.radius.lg + 2,
    paddingHorizontal: theme.space(4),
  },
  featureRow: {
    flexDirection: 'row',
    gap: theme.space(3.25),
    paddingVertical: theme.space(3.75),
  },
  featureIconBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: theme.fontFamily.bodySemiBold,
  },
  featureBody: {
    marginTop: theme.space(1.25),
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  actions: {
    paddingHorizontal: theme.space(5.5),
    paddingBottom: theme.space(8),
    gap: theme.space(2.75),
  },
  primaryButton: {
    borderRadius: theme.radius.md,
    paddingVertical: theme.space(4.5),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  fineprint: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    opacity: 0.6,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  notNow: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.55,
  },
});
