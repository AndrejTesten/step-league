import { forwardRef, useState, type ReactNode } from 'react';
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

import { theme, useThemeColors } from '@/lib/theme';

export function Screen({ style, ...props }: ViewProps) {
  const colors = useThemeColors();
  return <View style={[styles.screen, { backgroundColor: colors.bg }, style]} {...props} />;
}

export function Card({ style, ...props }: ViewProps) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}
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
  return <Text style={[styles.muted, { color: colors.textMuted }, style]} {...props} />;
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input({ style, ...props }, ref) {
  const colors = useThemeColors();
  return (
    <TextInput
      ref={ref}
      style={[
        styles.input,
        { borderColor: colors.border, backgroundColor: colors.card, color: colors.text },
        style,
      ]}
      placeholderTextColor={colors.textMuted}
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
  const colors = useThemeColors();
  const backgroundColor =
    variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.card : colors.primary;
  const labelColor = variant === 'secondary' ? colors.text : colors.primaryText;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        { backgroundColor },
        variant === 'secondary' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
        pressed && { opacity: 0.85 },
        (disabled || loading) && { opacity: 0.5 },
        typeof style === 'function' ? undefined : style,
      ]}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

export function Avatar({ uri, name, size = 56 }: AvatarProps) {
  const colors = useThemeColors();
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatar, { backgroundColor: colors.card }, dimension]} />;
  }
  return (
    <View
      style={[
        styles.avatar,
        styles.avatarFallback,
        { backgroundColor: colors.card, borderColor: colors.border },
        dimension,
      ]}
    >
      <Text style={{ color: colors.textMuted, fontSize: size * 0.4, fontWeight: '700' }}>{initial}</Text>
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
            style={[styles.tab, active && { backgroundColor: colors.cardElevated }]}
          >
            <Text style={[styles.tabLabel, { color: active ? colors.text : colors.textMuted }]}>
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
  emptyMessage = 'No matches.',
  onQueryChange,
}: SearchableSelectProps) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = onQueryChange
    ? options.slice(0, 50)
    : query
      ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())).slice(0, 50)
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
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {loading ? (
            <ActivityIndicator style={{ padding: theme.space(3) }} color={colors.textMuted} />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
              {filtered.length === 0 ? (
                <Text style={[styles.muted, { color: colors.textMuted, padding: theme.space(3) }]}>
                  {emptyMessage}
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
                    <Text style={{ color: colors.text, fontSize: theme.font.body }}>{opt}</Text>
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheetCard, { backgroundColor: colors.bg, shadowColor: colors.shadow }]}
          onPress={(e) => e.stopPropagation()}
        >
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
      style={({ pressed }) => [styles.sheetOption, pressed && { backgroundColor: colors.card }]}
    >
      {icon}
      <Text style={{ fontSize: theme.font.body, color: colors.text, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: theme.space(5),
  },
  card: {
    borderRadius: theme.radius,
    padding: theme.space(4),
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: theme.font.title,
    fontWeight: '700',
  },
  heading: {
    fontSize: theme.font.heading,
    fontWeight: '600',
  },
  muted: {
    fontSize: theme.font.small,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    fontSize: theme.font.body,
  },
  button: {
    borderRadius: theme.radius,
    paddingVertical: theme.space(3.5),
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  avatar: {},
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: theme.radius,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius - 4,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: theme.font.small,
    fontWeight: '600',
  },
  dropdown: {
    marginTop: theme.space(1),
    borderRadius: theme.radius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 9, 12, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: theme.radius * 1.4,
    borderTopRightRadius: theme.radius * 1.4,
    padding: theme.space(5),
    paddingBottom: theme.space(8),
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    borderRadius: theme.radius,
    paddingHorizontal: theme.space(2),
  },
});
