import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from './AuthContext';
import {
  APP_LANGUAGE_OPTIONS,
  AppLanguageCode,
  SettingsTranslationKey,
  getLanguageOptionByCode,
  normalizeLanguageCode,
  translateSettings,
} from '../src/i18n/settingsI18n';

type TranslationParams = Record<string, string | number | null | undefined>;

type AppLanguageContextValue = {
  language: AppLanguageCode;
  languageLabel: string;
  setLanguagePreference: (next: AppLanguageCode) => void;
  t: (key: SettingsTranslationKey, params?: TranslationParams) => string;
  availableLanguages: typeof APP_LANGUAGE_OPTIONS;
  isLanguageLoaded: boolean;
};

const APP_LANGUAGE_STORAGE_KEY = 'cd4_app_language_v1';

const AppLanguageContext = createContext<AppLanguageContextValue | undefined>(undefined);

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const [language, setLanguage] = useState<AppLanguageCode>('en');
  const [isLanguageLoaded, setIsLanguageLoaded] = useState(false);

  const setLanguagePreference = useCallback((next: AppLanguageCode) => {
    setLanguage(normalizeLanguageCode(next));
  }, []);

  useEffect(() => {
    let mounted = true;
    const hydrateLanguage = async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
        if (!mounted) return;
        if (stored) {
          setLanguage(normalizeLanguageCode(stored));
        }
      } catch (error) {
        console.warn('Failed to hydrate app language preference:', error);
      } finally {
        if (mounted) setIsLanguageLoaded(true);
      }
    };

    void hydrateLanguage();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isLanguageLoaded) return;
    AsyncStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language).catch((error) => {
      console.warn('Failed to persist app language preference:', error);
    });
  }, [isLanguageLoaded, language]);

  useEffect(() => {
    const rawProfileLanguage = user?.settings?.language;
    if (typeof rawProfileLanguage !== 'string' || !rawProfileLanguage.trim()) {
      return;
    }
    const profileLanguage = normalizeLanguageCode(rawProfileLanguage);
    setLanguage((current) => (current === profileLanguage ? current : profileLanguage));
  }, [user?.settings?.language]);

  const languageLabel = useMemo(() => getLanguageOptionByCode(language).label, [language]);

  const t = useCallback(
    (key: SettingsTranslationKey, params?: TranslationParams) =>
      translateSettings(language, key, params),
    [language]
  );

  const value = useMemo<AppLanguageContextValue>(
    () => ({
      language,
      languageLabel,
      setLanguagePreference,
      t,
      availableLanguages: APP_LANGUAGE_OPTIONS,
      isLanguageLoaded,
    }),
    [isLanguageLoaded, language, languageLabel, setLanguagePreference, t]
  );

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (!context) {
    throw new Error('useAppLanguage must be used inside AppLanguageProvider');
  }
  return context;
}
