import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import Toast from 'react-native-toast-message';
import {
  Bell,
  ChevronRight,
  CreditCard,
  FileText,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Receipt,
  Shield,
  Stethoscope,
  SunMoon,
  Trash2,
  User,
} from 'lucide-react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useLogout } from '../../hooks/useAuth';
import { useThemePreference } from '../../context/ThemePreferenceContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useStorageInsights } from '../../hooks/useStorageInsights';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getImageUrl, PRO_PLAN_ENABLED } from '../../constants/Config';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { SettingsGroup, SettingsRow } from '../../ui/common/SettingsGroup';
import { confirmAction } from '../../src/utils/confirm';

export default function SettingsScreen() {
  const { theme } = useAppTheme();
  const { user } = useAuthContext();
  const logoutMutation = useLogout();
  const { themePreference, resolvedColorScheme } = useThemePreference();
  const { t, languageLabel } = useAppLanguage();
  const storageInsights = useStorageInsights();
  const unreadCount = Number(storageInsights.unreadNotifications || 0);

  const appearanceValue =
    themePreference === 'system'
      ? `${t('appearance.mode.system')} · ${resolvedColorScheme === 'dark' ? t('appearance.mode.dark') : t('appearance.mode.light')}`
      : themePreference === 'dark'
        ? t('appearance.mode.dark')
        : t('appearance.mode.light');

  const subscription = React.useMemo(() => {
    const current = user?.subscription;
    if (!current) return { label: t('settings.subscriptionFree'), isActive: false };

    const status = String(current.status || '').toLowerCase();
    const expiryMs = typeof current.expiresAt === 'string' && current.expiresAt.trim() ? new Date(current.expiresAt).getTime() : null;
    const hasExpired = typeof expiryMs === 'number' && Number.isFinite(expiryMs) && expiryMs <= Date.now();

    if (hasExpired && (status === 'active' || status === 'trialing' || status === 'grace')) return { label: t('settings.subscriptionExpired'), isActive: false };
    if (status === 'active' || status === 'trialing') return { label: t('settings.subscriptionActive'), isActive: true };
    if (status === 'grace') return { label: t('settings.subscriptionGrace'), isActive: true };
    if (status === 'cancelled') return { label: t('settings.subscriptionCancelled'), isActive: false };
    if (status === 'expired') return { label: t('settings.subscriptionExpired'), isActive: false };
    if (status === 'pending') return { label: t('settings.subscriptionPending'), isActive: false };
    return { label: t('settings.subscriptionStatusUnknown'), isActive: false };
  }, [t, user?.subscription]);

  const handleLogout = async () => {
    const confirmed = await confirmAction({
      title: 'Log out of CD4?',
      message: 'You will need to sign in again to access your consultations and reports.',
      confirmText: t('settings.logout'),
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await logoutMutation.mutateAsync();
      Toast.show({ type: 'success', text1: t('settings.loggedOutTitle'), text2: t('settings.loggedOutBody') });
      router.replace('/auth/login');
    } catch {
      Toast.show({ type: 'error', text1: t('settings.logoutFailed'), text2: t('settings.logoutFailedBody') });
    }
  };

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'Your profile';
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';
  const profileImageUrl = getImageUrl(user?.profilePicture);
  const canRecruitDoctors = user?.role === 'Marketing' || user?.role === 'Admin';
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.inner}>
        <Pressable
          onPress={() => router.push('/(tabs)/profile-details')}
          accessibilityRole="button"
          accessibilityLabel={`${fullName}, view profile`}
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: theme.cardBackground, borderColor: theme.borderColor },
            elevation(1),
            pressed && { opacity: 0.9 },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
            {profileImageUrl ? (
              <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={[Typography.title, { color: theme.primary }]}>{initials}</Text>
            )}
          </View>
          <View style={styles.profileText}>
            <Text style={[Typography.heading, { color: theme.text }]} numberOfLines={1}>
              {fullName}
            </Text>
            {user?.email ? (
              <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            {PRO_PLAN_ENABLED ? (
            <View style={[styles.planPill, { backgroundColor: subscription.isActive ? theme.primarySoft : theme.surfaceMuted }]}>
              <Text style={[Typography.caption, { color: subscription.isActive ? theme.primary : theme.textSecondary, fontWeight: '600' }]}>
                {subscription.isActive ? 'CD4 Pro' : 'Free plan'}
              </Text>
            </View>
            ) : null}
          </View>
          <ChevronRight size={20} color={theme.textTertiary} />
        </Pressable>

        <SettingsGroup title="Account">
          <SettingsRow icon={User} label={t('settings.account')} onPress={() => router.push('/(tabs)/profile-details')} />
          <SettingsRow icon={ImageIcon} label={t('settings.avatar')} onPress={() => router.push('/settings/avatar')} />
          {PRO_PLAN_ENABLED ? (
            <SettingsRow icon={CreditCard} label={t('settings.subscription')} value={subscription.label} onPress={() => router.push('/settings/subscription')} />
          ) : null}
          <SettingsRow icon={Receipt} label="Payment history" onPress={() => router.push('/payment-history')} />
          {canRecruitDoctors ? (
            <SettingsRow icon={Stethoscope} label={t('settings.doctorRecruitment')} onPress={() => router.push('/doctor-recruitment')} />
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Preferences">
          <SettingsRow icon={SunMoon} tone="accent" label={t('appearance.title')} value={appearanceValue} onPress={() => router.push('/settings/appearance')} />
          <SettingsRow icon={Bell} tone="accent" label={t('notifications.title')} badge={unreadCount} onPress={() => router.push('/settings/notifications')} />
          <SettingsRow icon={Globe} tone="accent" label={t('language.title')} value={languageLabel} onPress={() => router.push('/settings/language')} />
          <SettingsRow icon={MessageCircle} tone="accent" label={t('settings.chats')} onPress={() => router.push('/settings/chats')} />
        </SettingsGroup>

        <SettingsGroup title="Support & legal">
          <SettingsRow icon={HelpCircle} tone="success" label={t('settings.help')} onPress={() => router.push('/settings/help')} />
          <SettingsRow icon={Shield} tone="success" label="Privacy policy" onPress={() => router.push('/privacy-policy')} />
          <SettingsRow icon={FileText} tone="success" label="Terms of service" onPress={() => router.push('/terms')} />
        </SettingsGroup>

        <SettingsGroup footer="Permanently deletes your account, consultations and reports.">
          <SettingsRow icon={Trash2} label="Delete account" destructive onPress={() => router.push('/settings/delete-account')} />
        </SettingsGroup>

        <Pressable
          onPress={handleLogout}
          disabled={logoutMutation.isPending}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutButton,
            { backgroundColor: theme.cardBackground, borderColor: theme.borderColor },
            pressed && { backgroundColor: theme.surfaceMuted },
          ]}
        >
          {logoutMutation.isPending ? (
            <ActivityIndicator color={theme.danger} />
          ) : (
            <>
              <LogOut size={18} color={theme.danger} />
              <Text style={[Typography.bodyStrong, { color: theme.danger }]}>{t('settings.logout')}</Text>
            </>
          )}
        </Pressable>

        <Text style={[Typography.caption, styles.version, { color: theme.textTertiary }]}>CD4 · Version {appVersion}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.huge,
  },
  inner: {
    width: '100%',
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md + 2,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.xxl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  profileText: { flex: 1, gap: 2 },
  planPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 6,
  },
  logoutButton: {
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  version: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
