import { forwardRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme, useThemeColors } from '@/lib/theme';

export function Screen({ style, ...props }: ViewProps) {
  const colors = useThemeColors();
  return <View style={[styles.screen, { backgroundColor: colors.bg }, style]} {...props} />;
}

export function Card({ style, ...props }: ViewProps) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderStrong }, style]}
      {...props}
    />
  );
}

export function Title({ style, ...props }: TextProps) {
  const colors = useThemeColors();
  return <Text style={[styles.title, { color: colors.text }, style]} {...props} />;
}

export function Heading({ style, ...props }: TextProps) {
  const colors = useThemeColors();
  return <Text style={[styles.heading, { color: colors.text }, style]} {...props} />;
}

export function Muted({ style, ...props }: TextProps) {
  const colors = useThemeColors();
  return <Text style={[styles.muted, { color: colors.textSubtle }, style]} {...props} />;
}

/** 9-10px uppercase tracked micro-label — field/column labels throughout the design. */
export function SectionLabel({ style, ...props }: TextProps) {
  const colors = useThemeColors();
  return <Text style={[styles.sectionLabel, { color: colors.textMuted }, style]} {...props} />;
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input({ style, ...props }, ref) {
  const colors = useThemeColors();
  return (
    <TextInput
      ref={ref}
      style={[
        styles.input,
        { borderColor: colors.controlBorder, backgroundColor: colors.card, color: colors.text },
        style,
      ]}
      placeholderTextColor={colors.textDim}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
    />
  );
});

type ButtonProps = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'pill';
  /** Trailing "→" glyph — the design uses this on most primary CTAs. */
  arrow?: boolean;
};

export function Button({ label, loading, variant = 'primary', arrow, style, disabled, ...props }: ButtonProps) {
  const colors = useThemeColors();
  const isPill = variant === 'pill';
  const backgroundColor =
    variant === 'danger' ? colors.danger : variant === 'secondary' || isPill ? 'transparent' : colors.accent;
  const labelColor = variant === 'secondary' ? colors.textSubtle : isPill ? colors.accent : colors.primaryText;

  return (
    <Pressable
      style={({ pressed }) => [
        isPill ? styles.pillButton : styles.button,
        { backgroundColor },
        variant === 'secondary' && { borderWidth: theme.border, borderColor: colors.controlBorder },
        isPill && { borderWidth: theme.border, borderColor: colors.accent },
        pressed &&
          (variant === 'secondary' || isPill
            ? { backgroundColor: colors.hoverTint }
            : { backgroundColor: variant === 'danger' ? colors.danger : colors.accentHover }),
        (disabled || loading) && { opacity: 0.5 },
        typeof style === 'function' ? undefined : style,
      ]}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          <Text style={[isPill ? styles.pillButtonLabel : styles.buttonLabel, { color: labelColor }]}>{label}</Text>
          {arrow && <Text style={[styles.buttonArrow, { color: labelColor }]}>→</Text>}
        </>
      )}
    </Pressable>
  );
}

type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** "you" chips render filled with the accent color instead of the default dark chip. */
  variant?: 'default' | 'accent';
};

export function Avatar({ uri, name, size = 56, variant = 'default' }: AvatarProps) {
  const colors = useThemeColors();
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatar, { backgroundColor: colors.card }, dimension]} />;
  }
  const bg = variant === 'accent' ? colors.accent : colors.borderStrong;
  const fg = variant === 'accent' ? colors.primaryText : colors.text;
  return (
    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bg }, dimension]}>
      <Text style={{ color: fg, fontSize: size * 0.36, fontFamily: theme.fontFamily.bodySemiBold }}>{initial}</Text>
    </View>
  );
}

type TabsProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function Tabs<T extends string>({ options, value, onChange }: TabsProps<T>) {
  const colors = useThemeColors();
  return (
    <View style={[styles.tabs, { backgroundColor: colors.card }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.tab, active && { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.tabLabel, { color: active ? colors.primaryText : colors.textMuted }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type SearchableSelectProps = {
  placeholder: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  /**
   * When set, `options` is treated as already matching the latest query
   * (fetched server-side) rather than a full list to filter locally — this
   * fires on every keystroke so the caller can debounce its own fetch.
   */
  onQueryChange?: (query: string) => void;
};

export function SearchableSelect({
  placeholder,
  value,
  options,
  onSelect,
  loading,
  disabled,
  emptyMessage,
  onQueryChange,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const resolvedEmptyMessage = emptyMessage ?? t('common.noMatches');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  // Prefix match, not "contains anywhere" — a substring match on "Ljubljana"
  // also matched unrelated entries that merely *contain* it, like a city's
  // own internal districts ("Opčina Ljubljana-Bežigrad"), which is exactly
  // what made picking a real city feel broken. Typing a city/country name
  // now only ever surfaces things that actually start with it.
  const filtered = onQueryChange
    ? options.slice(0, 50)
    : query
      ? options.filter((o) => o.toLowerCase().startsWith(query.toLowerCase())).slice(0, 50)
      : options.slice(0, 50);

  return (
    <View>
      <Input
        placeholder={placeholder}
        editable={!disabled}
        value={open ? query : value}
        onFocus={() => {
          setQuery('');
          setOpen(true);
          onQueryChange?.('');
        }}
        onChangeText={(t) => {
          setQuery(t);
          onQueryChange?.(t);
          if (value) onSelect('');
        }}
      />
      {open && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.controlBorder }]}>
          {loading ? (
            <ActivityIndicator style={{ padding: theme.space(3) }} color={colors.textMuted} />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
              {filtered.length === 0 ? (
                <Text style={[styles.muted, { color: colors.textMuted, padding: theme.space(3) }]}>
                  {resolvedEmptyMessage}
                </Text>
              ) : (
                filtered.map((opt) => (
                  <Pressable
                    key={opt}
                    style={[styles.dropdownItem, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      onSelect(opt);
                      setQuery('');
                      setOpen(false);
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: theme.font.body, fontFamily: theme.fontFamily.bodyMedium }}>
                      {opt}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

/**
 * Bottom sheet for picking one of several options — replaces Alert.alert
 * for anything with more than ~2 choices. Android's native Alert can only
 * reliably render 3 buttons (it maps to AlertDialog's positive/neutral/
 * negative slots); a 4th+ button either gets dropped or the alert breaks,
 * which is exactly why the rival-picker and reaction-picker looked broken.
 */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheetCard,
            { backgroundColor: colors.card, borderColor: colors.borderStrong, shadowColor: colors.shadow, paddingBottom: insets.bottom + theme.space(5) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.sheetGrabber, { backgroundColor: colors.controlBorder }]} />
          {title && <Heading style={{ marginBottom: theme.space(3) }}>{title}</Heading>}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetOption({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sheetOption, pressed && { backgroundColor: colors.hoverTint }]}
    >
      {icon}
      <Text style={{ fontSize: theme.font.body, color: colors.text, flex: 1, fontFamily: theme.fontFamily.bodySemiBold }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: theme.space(4.5),
  },
  card: {
    borderRadius: theme.radius.md,
    padding: theme.space(4),
    borderWidth: theme.border,
  },
  title: {
    fontSize: theme.font.title,
    fontFamily: theme.fontFamily.heading,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  heading: {
    fontSize: theme.font.heading,
    fontFamily: theme.fontFamily.heading,
    textTransform: 'uppercase',
  },
  muted: {
    fontSize: theme.font.small,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  sectionLabel: {
    fontSize: theme.font.label,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: theme.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(3.5),
    fontSize: theme.font.body,
    fontFamily: theme.fontFamily.bodyMedium,
  },
  button: {
    borderRadius: theme.radius.sm,
    paddingVertical: theme.space(4),
    paddingHorizontal: theme.space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(2),
  },
  buttonLabel: {
    fontSize: 13,
    fontFamily: theme.fontFamily.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  buttonArrow: {
    fontSize: 15,
    fontFamily: theme.fontFamily.bodyBold,
  },
  pillButton: {
    borderRadius: theme.radius.pill,
    paddingVertical: theme.space(2.25),
    paddingHorizontal: theme.space(3.5),
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(1.5),
  },
  pillButtonLabel: {
    fontSize: 10,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  avatar: {},
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: theme.radius.pill,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.space(2.5),
    alignItems: 'center',
    borderRadius: theme.radius.pill,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: theme.fontFamily.bodySemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dropdown: {
    marginTop: theme.space(1),
    borderRadius: theme.radius.sm,
    borderWidth: theme.border,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 12, 10, 0.72)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: theme.radius.sheet,
    borderTopRightRadius: theme.radius.sheet,
    borderTopWidth: theme.border,
    padding: theme.space(5),
    paddingBottom: theme.space(8),
  },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: theme.radius.pill,
    alignSelf: 'center',
    marginBottom: theme.space(3),
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(2),
  },
});
