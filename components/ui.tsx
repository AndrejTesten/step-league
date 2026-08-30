import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';

import { theme } from '@/lib/theme';

export function Screen({ style, ...props }: ViewProps) {
  return <View style={[styles.screen, style]} {...props} />;
}

export function Card({ style, ...props }: ViewProps) {
  return <View style={[styles.card, style]} {...props} />;
}

export function Title({ style, ...props }: TextProps) {
  return <Text style={[styles.title, style]} {...props} />;
}

export function Heading({ style, ...props }: TextProps) {
  return <Text style={[styles.heading, style]} {...props} />;
}

export function Muted({ style, ...props }: TextProps) {
  return <Text style={[styles.muted, style]} {...props} />;
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { style, ...props },
  ref
) {
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor={theme.color.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
    />
  );
});

type ButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ label, loading, variant = 'primary', style, disabled, ...props }: ButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && { opacity: 0.85 },
        (disabled || loading) && { opacity: 0.5 },
        typeof style === 'function' ? undefined : style,
      ]}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? theme.color.text : theme.color.primaryText} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'secondary' && { color: theme.color.text },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.bg,
    paddingHorizontal: theme.space(5),
  },
  card: {
    backgroundColor: theme.color.card,
    borderRadius: theme.radius,
    padding: theme.space(4),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  title: {
    fontSize: theme.font.title,
    fontWeight: '700',
    color: theme.color.text,
  },
  heading: {
    fontSize: theme.font.heading,
    fontWeight: '600',
    color: theme.color.text,
  },
  muted: {
    fontSize: theme.font.small,
    color: theme.color.textMuted,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    backgroundColor: theme.color.card,
    borderRadius: theme.radius,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    fontSize: theme.font.body,
    color: theme.color.text,
  },
  button: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius,
    paddingVertical: theme.space(3.5),
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: theme.color.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  buttonDanger: {
    backgroundColor: theme.color.danger,
  },
  buttonLabel: {
    color: theme.color.primaryText,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
});
