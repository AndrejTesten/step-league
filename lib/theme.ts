import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

// Layout constants — same in both color modes, so every existing
// `theme.space(...)` / `theme.radius` / `theme.font.*` call site keeps
// working unchanged. Only colors vary by mode (see ThemeProvider below).
export const theme = {
  space: (n: number) => n * 4,
  radius: 14,
  font: {
    title: 28,
    heading: 20,
    body: 16,
    small: 13,
  },
};

export const lightColors = {
  bg: '#FFFFFF',
  card: '#F5F6F8',
  cardElevated: '#FFFFFF',
  border: '#E4E6EB',
  text: '#111318',
  textMuted: '#6B7280',
  primary: '#111318',
  primaryText: '#FFFFFF',
  accent: '#2563EB',
  gold: '#C89116',
  silver: '#9CA3AF',
  bronze: '#B87333',
  danger: '#DC2626',
  shadow: '#0F1115',
};

export const darkColors: typeof lightColors = {
  bg: '#0B0C10',
  card: '#17191F',
  cardElevated: '#1E2028',
  border: '#2A2D36',
  text: '#F5F6F8',
  textMuted: '#8B92A3',
  primary: '#F5F6F8',
  primaryText: '#0B0C10',
  accent: '#6C9BFF',
  gold: '#E8C158',
  silver: '#B7BDC9',
  bronze: '#D19A66',
  danger: '#F87171',
  shadow: '#000000',
};

export type ThemeColors = typeof lightColors;
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'stepleague:theme-mode';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedScheme: 'light' | 'dark';
  colors: ThemeColors;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Loaded async after first paint (same tradeoff as session restore
  // elsewhere in the app) — worst case the very first frame uses the
  // system scheme as a fallback until the stored preference arrives.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
    });
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  const resolvedScheme: 'light' | 'dark' = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const colors = resolvedScheme === 'dark' ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, resolvedScheme, colors }),
    [mode, resolvedScheme, colors]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useThemeColors(): ThemeColors {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeColors must be used within a ThemeProvider');
  return ctx.colors;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used within a ThemeProvider');
  return ctx;
}
