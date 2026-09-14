import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppMark } from '@/components/AuthExtras';
import { Button, Screen, Sheet } from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getNotificationStatus, requestAndRegisterPushNotifications } from '@/lib/push-notifications';
import { useStepsConsent } from '@/lib/steps-consent';
import { theme, useThemeColors } from '@/lib/theme';

const READ_ROW_KEYS = ['whatWeRead', 'whoSeesIt', 'backgroundSync', 'whatWeNeverTouch'] as const;
const READ_ROW_OK = [true, true, true, false];

/**
 * "Step access — in-app consent" (design screen 2u) — shown once, after
 * onboarding-location and before the native Health Connect/HealthKit
 * permission dialog ever appears (see the redirect guard in
 * app/(app)/_layout.tsx and the `enabled` gate on useStepSync). Google Play
 * and Apple both expect a plain-language explanation like this ahead of a
 * sensitive-permission prompt, not just the bare OS dialog.
 *
 * Notification permission is requested here too, and is NOT optional the
 * way it used to be: without it there's no way to wake the app for a
 * background sync (see lib/push-notifications.ts), which means a day
 * someone doesn't open the app is a day their league-mates don't see their
 * real steps when their league resets. Denying it here is a hard stop, not
 * a skippable checkbox — see handleContinue.
 */
export default function OnboardingHealth() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { setConsentGiven } = useStepsConsent();
  const [agreed, setAgreed] = useState(false);
  const [notificationsAgreed, setNotificationsAgreed] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const READ_ROWS = READ_ROW_KEYS.map((key, i) => ({
    ok: READ_ROW_OK[i],
    title: t(`onboarding.health.readRows.${key}.title`),
    body: t(`onboarding.health.readRows.${key}.body`),
  }));

  async function handleContinue() {
    if (!agreed || !notificationsAgreed || !session) return;
    setNotificationError(null);
    setRegistering(true);
    try {
      const granted = await requestAndRegisterPushNotifications(session.user.id);
      if (!granted) {
        const status = await getNotificationStatus();
        if (status === 'denied') {
          // The OS permission itself was refused — this is the one case
          // that has to actually block continuing, since without it
          // there's no way to fix background sync later short of the user
          // finding Settings on their own. Everything else (offline right
          // now, a simulator with no real push capability) is treated as
          // "fix it later" — the home-screen status banner keeps flagging
          // it until it's resolved, but doesn't trap onboarding over a
          // transient environmental issue.
          setNotificationError(t('onboarding.health.errors.notificationsDenied'));
          return;
        }
      }
      setConsentGiven(true, true);
      router.replace('/');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.space(4.5),
          paddingTop: insets.top + theme.space(3),
          paddingBottom: theme.space(4),
        }}
      >
        <AppMark size={44} />

        <Text style={[styles.heading, { color: colors.text }]}>{t('onboarding.health.heading')}</Text>
        <Text style={[styles.body, { color: colors.textSubtle }]}>
          {t('onboarding.health.subheading')}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {READ_ROWS.map((row, i) => (
            <View key={READ_ROW_KEYS[i]} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={[styles.badge, { backgroundColor: row.ok ? colors.accent : colors.danger }]}>
                <Text style={[styles.badgeGlyph, { color: row.ok ? colors.primaryText : '#ffffff' }]}>{row.ok ? '✓' : '✕'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{row.title}</Text>
                <Text style={[styles.rowBody, { color: colors.textMuted }]}>{row.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable onPress={() => setAgreed((v) => !v)} style={styles.checkboxRow} hitSlop={6}>
          <View style={[styles.checkbox, { borderColor: colors.controlBorder }, agreed && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            {agreed && <Text style={[styles.checkGlyph, { color: colors.primaryText }]}>✓</Text>}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.text }]}>
            {t('onboarding.health.agreeLabel')}{'\n'}
            <Text onPress={() => setPrivacyOpen(true)} style={{ color: colors.accent, fontFamily: theme.fontFamily.bodySemiBold }}>
              {t('onboarding.health.privacyNoteLink')}
            </Text>
          </Text>
        </Pressable>

        <Pressable onPress={() => setNotificationsAgreed((v) => !v)} style={[styles.checkboxRow, { marginTop: theme.space(3) }]} hitSlop={6}>
          <View style={[styles.checkbox, { borderColor: colors.controlBorder }, notificationsAgreed && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            {notificationsAgreed && <Text style={[styles.checkGlyph, { color: colors.primaryText }]}>✓</Text>}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.text }]}>
            {t('onboarding.health.notificationsRequired.label')}
          </Text>
        </Pressable>
        <Text style={{ marginTop: theme.space(1.5), fontSize: 11.5, lineHeight: 16, fontFamily: theme.fontFamily.bodyMedium, color: colors.danger }}>
          {t('onboarding.health.notificationsRequired.warning')}
        </Text>

        {notificationError && (
          <View style={{ marginTop: theme.space(3), gap: theme.space(2) }}>
            <Text style={{ color: colors.danger, fontFamily: theme.fontFamily.bodyMedium, fontSize: theme.font.small }}>
              {notificationError}
            </Text>
            <Button label={t('common.openSettings')} variant="secondary" onPress={() => Linking.openSettings()} />
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.space(4.5), paddingBottom: insets.bottom + theme.space(3), gap: theme.space(2.5) }}>
        <Button
          label={t('common.continue')}
          onPress={handleContinue}
          disabled={!agreed || !notificationsAgreed}
          loading={registering}
          arrow
        />
        <Text style={[styles.footnote, { color: colors.textDim }]}>
          {t('onboarding.health.footnote')}
        </Text>
      </View>

      <Sheet visible={privacyOpen} onClose={() => setPrivacyOpen(false)} title={t('onboarding.health.privacyNoteTitle')}>
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 14, lineHeight: 21, fontFamily: theme.fontFamily.bodyMedium, color: colors.textSubtle }}>
            {t('onboarding.health.privacyNoteBody')}
          </Text>
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: theme.space(5),
    fontSize: 30,
    lineHeight: 32,
    fontFamily: theme.fontFamily.heading,
    textTransform: 'uppercase',
  },
  body: {
    marginTop: theme.space(3),
    fontSize: 14,
    lineHeight: 20,
    fontFamily: theme.fontFamily.bodyMedium,
    maxWidth: 340,
  },
  card: {
    marginTop: theme.space(5),
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.space(4),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space(3),
    paddingVertical: theme.space(3.5),
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  badgeGlyph: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: theme.fontFamily.bodySemiBold,
  },
  rowBody: {
    marginTop: theme.space(1),
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  checkboxRow: {
    marginTop: theme.space(5),
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space(3),
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: theme.border + 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkGlyph: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: theme.fontFamily.bodyMedium,
  },
});
