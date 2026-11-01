import Colors, { Theme } from '../constants/Colors';
import { useThemePreference } from '../context/ThemePreferenceContext';

// Single source for the active palette. Prefer this over reading Colors + useThemePreference by hand.
export function useAppTheme(): { theme: Theme; isDark: boolean } {
  const { resolvedColorScheme } = useThemePreference();
  const isDark = resolvedColorScheme === 'dark';
  return { theme: isDark ? Colors.dark : Colors.light, isDark };
}
