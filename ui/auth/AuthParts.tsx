import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getPasswordStrength } from '../../src/utils/validation';
import AppButton from '../common/AppButton';

// Small building blocks shared by the auth screens.

export function AuthDivider({ label }: { label: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.dividerRow}>
      <View style={[styles.dividerLine, { backgroundColor: theme.borderColor }]} />
      <Text style={[Typography.caption, { color: theme.textSecondary }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: theme.borderColor }]} />
    </View>
  );
}

export function GoogleButton({ onPress, loading, title }: { onPress: () => void; loading: boolean; title: string }) {
  return (
    <AppButton
      title={title}
      variant="outline"
      onPress={onPress}
      loading={loading}
      leftIcon={<Image source={require('../../assets/images/google_logo.png')} style={styles.googleIcon} resizeMode="contain" />}
    />
  );
}

export function LegalNotice({ prefix }: { prefix: string }) {
  const { theme } = useAppTheme();
  return (
    <Text style={[Typography.caption, styles.legal, { color: theme.textSecondary }]}>
      {prefix}{' '}
      <Text style={[styles.legalLink, { color: theme.primary }]} onPress={() => router.push('/terms')}>
        Terms of Service
      </Text>{' '}
      and{' '}
      <Text style={[styles.legalLink, { color: theme.primary }]} onPress={() => router.push('/privacy-policy')}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

export function FormErrorBanner({ message }: { message?: string | null }) {
  const { theme } = useAppTheme();
  if (!message) return null;
  return (
    <View style={[styles.formError, { backgroundColor: theme.dangerSoft, borderColor: theme.dangerBorder }]}>
      <Text style={[Typography.label, { color: theme.danger }]} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </View>
  );
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { theme } = useAppTheme();
  if (!password) return null;
  const { score, label } = getPasswordStrength(password);
  const color = score <= 1 ? theme.danger : score === 2 ? theme.warning : theme.success;
  return (
    <View style={styles.strengthWrap}>
      <View style={styles.strengthBars}>
        {[1, 2, 3, 4].map((step) => (
          <View key={step} style={[styles.strengthBar, { backgroundColor: step <= score ? color : theme.borderColor }]} />
        ))}
      </View>
      <Text style={[Typography.caption, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth * 2,
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  legal: {
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    fontWeight: '600',
  },
  formError: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md + 2,
    paddingVertical: Spacing.md,
  },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  strengthBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
});
