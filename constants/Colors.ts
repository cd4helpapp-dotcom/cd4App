// CD4 design tokens — colors.
// Primary is a medical emerald green (health/trust); sky blue is the accent for AI and Pro. Success states use a
// separate, lighter green (#16A34A) and always carry a check icon, so "Ready/Normal" never reads as a button.
// Legacy keys (tint, buttonPrimary, badgeText, ...) are kept so existing screens pick up
// the palette without code changes. Prefer the semantic keys (primary, danger, ...) in new code.

const light = {
  // Text
  text: '#0F172A',
  textSecondary: '#5B6B82',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Surfaces
  background: '#F5F7FB',
  cardBackground: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  inputBackground: '#FFFFFF',
  borderColor: '#E2E8F0',
  divider: '#EEF2F6',
  overlay: 'rgba(15, 23, 42, 0.55)',
  shadow: '#0F172A',

  // Brand
  primary: '#059669',
  primaryPressed: '#065F46',
  primarySoft: '#E7F8F0',
  primaryBorder: '#A7E9CB',
  accent: '#0EA5E9',
  accentSoft: '#E0F2FE',

  // Status
  success: '#16A34A',
  successLight: '#ECFDF3',
  successBorder: '#BBF7D0',
  warning: '#B45309',
  warningSoft: '#FFF7E6',
  warningBorder: '#FCD9A0',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  info: '#0369A1',
  infoSoft: '#EFF8FF',

  // Legacy aliases (kept for existing screens)
  tint: '#059669',
  tabIconDefault: '#94A3B8',
  tabIconSelected: '#059669',
  badgeText: '#DC2626',
  badgeBackground: '#FEF2F2',
  buttonPrimary: '#047857',
  buttonText: '#FFFFFF',
  iconPrimary: '#0F172A',
  error: '#DC2626',
};

const dark: typeof light = {
  text: '#E6EDF7',
  textSecondary: '#9AA8BC',
  textTertiary: '#64748B',
  textInverse: '#FFFFFF',

  background: '#0B1220',
  cardBackground: '#121B2D',
  surfaceMuted: '#18233A',
  inputBackground: '#0F1828',
  borderColor: '#223049',
  divider: '#1A2539',
  overlay: 'rgba(2, 6, 15, 0.7)',
  shadow: '#000000',

  primary: '#34D399',
  primaryPressed: '#047857',
  primarySoft: '#0A2E22',
  primaryBorder: '#14532D',
  accent: '#38BDF8',
  accentSoft: '#0C2A3F',

  success: '#22C55E',
  successLight: '#0F2A1C',
  successBorder: '#166534',
  warning: '#FBBF24',
  warningSoft: '#2A2110',
  warningBorder: '#5C4512',
  danger: '#F87171',
  dangerSoft: '#2A1215',
  dangerBorder: '#5B1F24',
  info: '#38BDF8',
  infoSoft: '#0C2233',

  tint: '#34D399',
  tabIconDefault: '#64748B',
  tabIconSelected: '#34D399',
  badgeText: '#F87171',
  badgeBackground: '#2A1215',
  // Darker than primary so white button text keeps 4.5:1 contrast.
  buttonPrimary: '#047857',
  buttonText: '#FFFFFF',
  iconPrimary: '#E6EDF7',
  error: '#F87171',
};

export type Theme = typeof light;
export default { light, dark };
