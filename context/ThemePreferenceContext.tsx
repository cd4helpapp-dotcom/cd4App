import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { useAuthContext } from './AuthContext';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemePreferenceContextValue = {
  themePreference: ThemePreference;
  resolvedColorScheme: 'light' | 'dark';
  setThemePreference: (preference: ThemePreference) => void;
  isThemePreferenceLoaded: boolean;
};

const THEME_PREFERENCE_STORAGE_KEY = 'cd4_theme_preference_v1';
const FALLBACK_THEME_PREFERENCE: ThemePreference = 'system';
let webAppearancePatched = false;

type AppearanceListener = (appearance: { colorScheme: 'light' | 'dark' | null | undefined }) => void;

const patchWebAppearanceOverride = (): void => {
  if (webAppearancePatched || Platform.OS !== 'web') {
    return;
  }

  const appearanceAny = Appearance as any;
  if (!appearanceAny || typeof appearanceAny.getColorScheme !== 'function') {
    return;
  }

  if (typeof appearanceAny.setColorScheme === 'function') {
    // Modern runtime already supports forcing scheme directly.
    webAppearancePatched = true;
    return;
  }

  const originalGetColorScheme: () => 'light' | 'dark' | null | undefined = appearanceAny.getColorScheme.bind(Appearance);
  const originalAddChangeListener:
    | ((listener: AppearanceListener) => { remove?: () => void })
    | undefined =
      typeof appearanceAny.addChangeListener === 'function'
        ? appearanceAny.addChangeListener.bind(Appearance)
        : undefined;

  let forcedScheme: 'light' | 'dark' | null = null;
  const localListeners = new Set<AppearanceListener>();

  const resolveScheme = (): 'light' | 'dark' => {
    const current = forcedScheme ?? originalGetColorScheme();
    return current === 'dark' ? 'dark' : 'light';
  };

  const emitManualChange = () => {
    const payload = { colorScheme: resolveScheme() };
    localListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.warn('Theme listener callback failed:', error);
      }
    });
  };

  appearanceAny.getColorScheme = () => resolveScheme();

  appearanceAny.addChangeListener = (listener: AppearanceListener) => {
    const safeListener: AppearanceListener =
      typeof listener === 'function' ? listener : () => {};
    localListeners.add(safeListener);

    const upstreamSubscription = originalAddChangeListener
      ? originalAddChangeListener(() => {
          safeListener({ colorScheme: resolveScheme() });
        })
      : undefined;

    return {
      remove: () => {
        localListeners.delete(safeListener);
        upstreamSubscription?.remove?.();
      },
    };
  };

  appearanceAny.setColorScheme = (nextScheme: 'light' | 'dark' | null | undefined) => {
    forcedScheme =
      nextScheme === 'dark' || nextScheme === 'light'
        ? nextScheme
        : null;
    emitManualChange();
  };

  webAppearancePatched = true;
};

const parseThemePreference = (value: unknown): ThemePreference | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'system' || normalized === 'light' || normalized === 'dark') {
    return normalized;
  }
  return null;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | undefined>(undefined);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const { user } = useAuthContext();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(FALLBACK_THEME_PREFERENCE);
  const [isThemePreferenceLoaded, setIsThemePreferenceLoaded] = useState(false);

  useEffect(() => {
    patchWebAppearanceOverride();
  }, []);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    const normalized = parseThemePreference(preference) || FALLBACK_THEME_PREFERENCE;
    setThemePreferenceState(normalized);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const hydrateThemePreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
        const parsed = parseThemePreference(stored);
        if (!isMounted) return;
        if (parsed) {
          setThemePreferenceState(parsed);
        }
      } catch (error) {
        console.warn('Failed to hydrate theme preference from storage:', error);
      } finally {
        if (isMounted) {
          setIsThemePreferenceLoaded(true);
        }
      }
    };

    void hydrateThemePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isThemePreferenceLoaded) return;
    AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference).catch((error) => {
      console.warn('Failed to persist theme preference:', error);
    });
  }, [isThemePreferenceLoaded, themePreference]);

  useEffect(() => {
    const profileThemePreference = parseThemePreference(user?.settings?.appearance?.mode);
    if (!profileThemePreference) return;
    setThemePreferenceState((current) => (current === profileThemePreference ? current : profileThemePreference));
  }, [user?.settings?.appearance?.mode]);

  useEffect(() => {
    try {
      Appearance.setColorScheme(themePreference === 'system' ? null : themePreference);
    } catch (error) {
      console.warn('Failed to apply app theme preference:', error);
    }
  }, [themePreference]);

  const resolvedColorScheme: 'light' | 'dark' = useMemo(() => {
    if (themePreference === 'light' || themePreference === 'dark') {
      return themePreference;
    }
    return systemColorScheme === 'dark' ? 'dark' : 'light';
  }, [themePreference, systemColorScheme]);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      themePreference,
      resolvedColorScheme,
      setThemePreference,
      isThemePreferenceLoaded,
    }),
    [isThemePreferenceLoaded, resolvedColorScheme, setThemePreference, themePreference]
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error('useThemePreference must be used within ThemePreferenceProvider');
  }
  return context;
}
