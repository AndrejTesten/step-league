import { createContext, createElement, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme, useThemeColors } from './theme';

// Replaces Alert.alert for one-line confirmations/errors ("Link copied",
// "Saved to photos", "Could not share") — the OS dialog looks and behaves
// nothing like the rest of this app (a centered white/gray box with a
// platform-default button), where every other piece of UI here is custom.
// A toast is also the right shape for these specific messages: nothing here
// needs a user decision (that's what Sheet is for), just brief
// acknowledgement that something happened.
type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DISPLAY_MS = 2200;

export function ToastProvider({ children }: PropsWithChildren) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(next: string) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(next);
  }

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setMessage(null));
    }, DISPLAY_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  return createElement(
    ToastContext.Provider,
    { value: { showToast } },
    children,
    message
      ? createElement(Animated.View, {
          pointerEvents: 'none',
          style: [
            styles.wrap,
            { bottom: insets.bottom + theme.space(6), opacity },
          ],
          children: createElement(
            Animated.View,
            { style: [styles.pill, { backgroundColor: colors.card, borderColor: colors.borderStrong }] },
            createElement(Text, { style: [styles.text, { color: colors.text }] }, message)
          ),
        })
      : null
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    maxWidth: '86%',
    borderWidth: theme.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(4.5),
    paddingVertical: theme.space(3),
  },
  text: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodySemiBold,
    textAlign: 'center',
  },
});
