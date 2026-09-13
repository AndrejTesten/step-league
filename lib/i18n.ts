import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { createContext, createElement, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { initReactI18next } from 'react-i18next';

import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const LANGUAGE_STORAGE_KEY = 'stepleague:language';

function isSupported(code: string | null | undefined): code is LanguageCode {
  return !!code && SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

function detectDeviceLanguage(): LanguageCode {
  for (const locale of Localization.getLocales()) {
    if (isSupported(locale.languageCode)) return locale.languageCode;
  }
  return 'en';
}

// Initialized once at module load with the best synchronous guess (device
// locale) — same "local-first" tradeoff as ThemeProvider's mode/color-theme
// (see lib/theme.ts): the first frame may use the wrong language for the
// rare user whose saved preference overrides their device locale, until
// that preference loads from AsyncStorage a moment later in I18nProvider.
i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    it: { translation: it },
    es: { translation: es },
    fr: { translation: fr },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<LanguageCode>(i18next.language as LanguageCode);

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
      if (isSupported(stored) && stored !== i18next.language) {
        i18next.changeLanguage(stored);
        setLanguageState(stored);
      }
    });
  }, []);

  function setLanguage(code: LanguageCode) {
    setLanguageState(code);
    i18next.changeLanguage(code);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code).catch(() => {});
  }

  const value: LanguageContextValue = { language, setLanguage };
  return createElement(LanguageContext.Provider, { value }, children);
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within an I18nProvider');
  return ctx;
}

export default i18next;
