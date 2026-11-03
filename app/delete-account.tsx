import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { ArrowLeft, Mail, ShieldAlert } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../constants/Design';
import { useAppTheme } from '../hooks/useAppTheme';

export default function PublicDeleteAccountPage() {
  const { theme } = useAppTheme();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: theme.borderColor }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={[styles.backButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={theme.text} />
        </TouchableOpacity>
        <Text style={[Typography.subheading, styles.headerTitle, { color: theme.text }]}>Account Deletion</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={[styles.iconWrap, { backgroundColor: theme.dangerSoft }]}>
            <ShieldAlert size={28} color={theme.danger} />
          </View>
          <Text style={[Typography.title, styles.title, { color: theme.text }]}>Account & Data Deletion</Text>
          <Text style={[Typography.body, styles.body, { color: theme.textSecondary }]}>
            To delete your CD4 account and associated personal and health data:
          </Text>

          <View style={[styles.stepsContainer, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderColor }]}>
            <Text style={[Typography.bodyStrong, styles.step, { color: theme.text }]}>1. Sign in to the CD4 app.</Text>
            <Text style={[Typography.bodyStrong, styles.step, { color: theme.text }]}>2. Open Settings → Delete account.</Text>
            <Text style={[Typography.bodyStrong, styles.step, { color: theme.text }]}>3. Confirm deletion twice.</Text>
          </View>

          <Text style={[Typography.body, styles.body, { color: theme.textSecondary }]}>
            Your profile, uploaded reports, report conversations and account records will be permanently deleted.
            Some legally required transaction or audit records may be retained where required by law.
          </Text>

          <Text style={[Typography.body, styles.body, { color: theme.textSecondary }]}>
            If you cannot sign in, email support@cd4.app from your registered email address with the subject “Account deletion request”.
          </Text>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.primary }]}
            onPress={() => Linking.openURL('mailto:support@cd4.app?subject=Account%20deletion%20request')}
            activeOpacity={0.85}
          >
            <Mail size={18} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={[Typography.bodyStrong, styles.buttonText]}>Email Support</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTitle: {
    fontWeight: '700',
  },
  headerSpacer: {
    width: 40,
  },
  container: {
    flexGrow: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    marginBottom: Spacing.sm,
    fontWeight: '800',
  },
  body: {
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  stepsContainer: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  step: {
    lineHeight: 22,
  },
  button: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  buttonIcon: {
    marginRight: Spacing.sm,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
