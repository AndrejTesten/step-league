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

import type { ColorTheme } from './types';

// "Sport/tech dark" design system (v2): Barlow Condensed for every numeral
// and screen title, Space Grotesk for everything read as words, one accent
// color that means exactly four things (your number, your row, the active
// control, the primary action) and nothing else. Rounded, not sharp — a
// radius scale instead of the v1 "radius 0 everywhere" rule. Layout
// constants stay mode-independent so every existing `theme.space(...)` call
// site keeps working unchanged — only colors vary by mode and color theme.
//
// Fonts are loaded at runtime via expo-font's `useFonts` (see app/_layout.tsx),
// not the SDK 57 config-plugin route — that needs a native dev-client rebuild
// this environment can't produce, while `useFonts` works identically on web,
// iOS and Android. Runtime-registered fonts use the same family name on every
// platform (unlike the config-plugin path, which needs OS-specific names).
export const theme = {
  space: (n: number) => n * 4,
  border: 1,
  radius: {
    sm: 4, // buttons, fields
    md: 6, // stat cards
    lg: 8, // league cards, takeover panels
    pill: 999, // pills, segmented tabs, avatars
    sheet: 16, // top corners only, on sheets
  },
  fontFamily: {
    heading: 'BarlowCondensed_700Bold', // every numeral and screen title, 700 only
    body: 'SpaceGrotesk_400Regular',
    bodyMedium: 'SpaceGrotesk_500Medium',
    bodySemiBold: 'SpaceGrotesk_600SemiBold',
    bodyBold: 'SpaceGrotesk_700Bold',
  },
  font: {
    hero: 108,
    title: 30,
    heading: 20,
    body: 16,
    small: 13,
    label: 10,
  },
};

// Literal values from the "Step League — style" v2 dark reference doc
// (design canvas export) — copied straight into tokens rather than
// approximated. Lime is the free default; every other field here is
// independent of which color theme is selected.
const darkBase = {
  bg: '#0b0c0a',
  card: '#161814',
  cardElevated: '#1c1f1a',
  border: '#1c1f1a', // row hairline
  borderStrong: '#2a2d26', // panel border / under-nav rule
  controlBorder: '#3a3e35', // input / button / field outline
  hoverTint: '#1c1f1a',
  text: '#f2f4ee',
  textSubtle: '#a8ada0',
  textMuted: '#8b9084',
  textDim: '#6e7368', // fine print, axis labels, inactive tab
  primaryText: '#0b0c0a', // primary button text is always black on the accent, never white
  inputEmpty: '#101210', // empty code-entry slot
  danger: '#ff6b5b', // the one intentional exception to "no red" — functional error text only, never decoration
  shadow: '#000000',
};

// No light variant was designed for v2 — this derives one that keeps the
// same structural relationships (ground/panel/ink/accent) so the existing
// Appearance (Auto/Light/Dark) toggle still does something meaningful.
const lightBase = {
  bg: '#f4f5f1',
  card: '#ffffff',
  cardElevated: '#ffffff',
  border: '#e7e8e2',
  borderStrong: '#d7d9d0',
  controlBorder: '#c3c6bb',
  hoverTint: '#eceee7',
  text: '#12140f',
  textSubtle: '#565b4e',
  textMuted: '#6e7368',
  textDim: '#8b9084',
  primaryText: '#ffffff',
  inputEmpty: '#eceee7',
  danger: '#c23b28',
  shadow: '#000000',
};

type AccentSet = {
  accent: string;
  accentHover: string;
  accentText: string;
  accentWash: string;
  accentChip: string;
};

// Five color themes — "lime" is the free default; the other four are
// premium (see profiles.color_theme / is_pro in supabase/schema.sql and the
// theme picker at app/(app)/theme-picker.tsx). Light-mode accents are hand
// -picked darker/saturated counterparts of each dark accent, following the
// same relationship as the original lime -> #5f8a00 derivation.
export const ACCENT_PALETTES: Record<ColorTheme, { dark: AccentSet; light: AccentSet }> = {
  lime: {
    dark: { accent: '#ccff33', accentHover: '#e2ff85', accentText: '#ccff33', accentWash: '#1c2410', accentChip: '#2a3a08' },
    light: { accent: '#5f8a00', accentHover: '#4c7000', accentText: '#4c7000', accentWash: '#eaf6c8', accentChip: '#e3f4b0' },
  },
  cyan: {
    dark: { accent: '#3bd6c6', accentHover: '#7de8dc', accentText: '#3bd6c6', accentWash: '#0f2b28', accentChip: '#123b40' },
    light: { accent: '#0e7a6e', accentHover: '#0a5f56', accentText: '#0a5f56', accentWash: '#d8f3ef', accentChip: '#c4ede6' },
  },
  ember: {
    dark: { accent: '#ff7a3d', accentHover: '#ffa06b', accentText: '#ff7a3d', accentWash: '#2b160a', accentChip: '#3d2417' },
    light: { accent: '#b34d15', accentHover: '#953f10', accentText: '#953f10', accentWash: '#fbe4d4', accentChip: '#f7d3b8' },
  },
  violet: {
    dark: { accent: '#b79bff', accentHover: '#cdb8ff', accentText: '#b79bff', accentWash: '#1c1638', accentChip: '#2d2444' },
    light: { accent: '#6b46c1', accentHover: '#5936a3', accentText: '#5936a3', accentWash: '#ece3fb', accentChip: '#ddccf7' },
  },
  // A callback to the v1 "Modernist" redesign's red-on-paper palette.
  paper: {
    dark: { accent: '#ec3013', accentHover: '#ff5b3a', accentText: '#ec3013', accentWash: '#2b0f08', accentChip: '#3d150a' },
    light: { accent: '#ec3013', accentHover: '#ae1800', accentText: '#ae1800', accentWash: '#ffe0d9', accentChip: '#ffd0c4' },
  },
  mono: {
    dark: { accent: '#f2f4ee', accentHover: '#ffffff', accentText: '#f2f4ee', accentWash: '#262626', accentChip: '#333333' },
    light: { accent: '#201e1d', accentHover: '#000000', accentText: '#201e1d', accentWash: '#e5e5e0', accentChip: '#d4d4cd' },
  },
};

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  lime: 'Lime',
  cyan: 'Cyan',
  ember: 'Ember',
  violet: 'Violet',
  paper: 'Paper',
  mono: 'Mono',
};

export function colorThemeLabel(t: ColorTheme): string {
  return COLOR_THEME_LABELS[t];
}

export const FREE_COLOR_THEME: ColorTheme = 'lime';
export const PREMIUM_COLOR_THEMES: ColorTheme[] = ['cyan', 'ember', 'violet', 'paper', 'mono'];

function buildColors(scheme: 'light' | 'dark', colorTheme: ColorTheme) {
  const base = scheme === 'dark' ? darkBase : lightBase;
  const accents = scheme === 'dark' ? ACCENT_PALETTES[colorTheme].dark : ACCENT_PALETTES[colorTheme].light;
  return {
    ...base,
    ...accents,
    primary: accents.accent,
    accentDark: base.bg,
    accentTint: accents.accentChip,
    gold: accents.accent,
    silver: base.textSubtle,
    bronze: base.textMuted,
  };
}

export const darkColors = buildColors('dark', FREE_COLOR_THEME);
export const lightColors = buildColors('light', FREE_COLOR_THEME);

export type ThemeColors = ReturnType<typeof buildColors>;
export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_STORAGE_KEY = 'stepleague:theme-mode';
const COLOR_STORAGE_KEY = 'stepleague:color-theme';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedScheme: 'light' | 'dark';
  colors: ThemeColors;
  colorTheme: ColorTheme;
  setColorTheme: (t: ColorTheme) => void;
  previewColorTheme: (t: ColorTheme | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(FREE_COLOR_THEME);
  // A locked (premium, not-owned) theme preview lives only here — never
  // written to AsyncStorage or Supabase — so it can never outlive the
  // component that started it. Leaving the theme-picker screen, or the app
  // being killed mid-preview, both just mean this resets to null and
  // `colorTheme` (the real, persisted value) is what renders — instead of
  // the previous bug where the preview *was* the persisted value, so
  // interrupting the countdown left a premium theme permanently applied.
  const [previewOverride, setPreviewOverride] = useState<ColorTheme | null>(null);

  // Loaded async after first paint (same tradeoff as session restore
  // elsewhere in the app) — worst case the very first frame uses the
  // system scheme / lime accent as a fallback until the stored preference
  // arrives.
  useEffect(() => {
    AsyncStorage.getItem(MODE_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
    });
    AsyncStorage.getItem(COLOR_STORAGE_KEY).then((stored) => {
      if (stored && stored in ACCENT_PALETTES) setColorThemeState(stored as ColorTheme);
    });
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    AsyncStorage.setItem(MODE_STORAGE_KEY, next).catch(() => {});
  }

  // Local-first, same pattern as setMode — the theme picker screen is
  // additionally responsible for persisting this to profiles.color_theme in
  // Supabase (and for checking is_pro before allowing anything but lime;
  // the database also enforces this now — see
  // enforce_color_theme_gating() in supabase/schema.sql).
  function setColorTheme(next: ColorTheme) {
    setPreviewOverride(null);
    setColorThemeState(next);
    AsyncStorage.setItem(COLOR_STORAGE_KEY, next).catch(() => {});
  }

  // Applies a theme for live preview only — never persisted. Pass null to
  // clear the preview and fall back to the real `colorTheme`.
  function previewColorTheme(t: ColorTheme | null) {
    setPreviewOverride(t);
  }

  const resolvedScheme: 'light' | 'dark' = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const colors = useMemo(
    () => buildColors(resolvedScheme, previewOverride ?? colorTheme),
    [resolvedScheme, colorTheme, previewOverride]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode, resolvedScheme, colors, colorTheme, setColorTheme, previewColorTheme }),
    [mode, resolvedScheme, colors, colorTheme]
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
