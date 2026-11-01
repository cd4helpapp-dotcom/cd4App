// CD4 design tokens — spacing, radius, typography, elevation.
// Use these instead of ad-hoc numbers so screens stay visually consistent.
import { Platform, ViewStyle } from 'react-native';

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

// Type scale. Weights stay numeric strings so they work on iOS, Android and web.
export const Typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.6 },
} as const;

export const Layout = {
  // Max content width so phone-designed screens do not stretch on tablets / desktop web.
  contentMaxWidth: 560,
  formMaxWidth: 440,
  controlHeight: 52,
  controlHeightCompact: 44,
  screenGutter: 20,
} as const;

// Soft, low-contrast elevation. Platform-specific so Android does not get heavy grey shadows.
export const elevation = (level: 0 | 1 | 2 | 3, shadowColor = '#0F172A'): ViewStyle => {
  if (level === 0) return {};
  const presets = {
    1: { opacity: 0.05, radius: 6, y: 2, elevation: 1 },
    2: { opacity: 0.08, radius: 12, y: 4, elevation: 3 },
    3: { opacity: 0.12, radius: 24, y: 10, elevation: 6 },
  }[level];

  if (Platform.OS === 'android') {
    return { elevation: presets.elevation, shadowColor };
  }

  return {
    shadowColor,
    shadowOpacity: presets.opacity,
    shadowRadius: presets.radius,
    shadowOffset: { width: 0, height: presets.y },
  };
};
