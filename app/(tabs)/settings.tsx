import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme, ScrollView, ActivityIndicator, Image } from 'react-native';
import Colors from '../../constants/Colors';
import { router } from 'expo-router';
import { useAuthContext } from '../../context/AuthContext';
import { LogOut, User, Image as ImageIcon, MessageCircle, Stethoscope, Bell, Globe, HelpCircle, SunMoon, CreditCard, ChevronRight, Receipt } from 'lucide-react-native';
import { useLogout } from '../../hooks/useAuth';
import Toast from 'react-native-toast-message';
import { useThemePreference } from '../../context/ThemePreferenceContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useStorageInsights } from '../../hooks/useStorageInsights';

import { getImageUrl } from '../../constants/Config';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { user, refreshAuth } = useAuthContext();
  const logoutMutation = useLogout();
  const { themePreference, resolvedColorScheme } = useThemePreference();
  const { t, languageLabel } = useAppLanguage();
  const storageInsights = useStorageInsights();
  const unreadCount = Number(storageInsights.unreadNotifications || 0);
  const notificationCountText = unreadCount > 99 ? '99+' : String(unreadCount);
  const storageLabel = storageInsights.totalFormatted || t('common.notAvailable');
  const appearanceModeLabel =
    themePreference === 'system'
      ? `${t('appearance.mode.system')} (${resolvedColorScheme === 'dark' ? t('appearance.mode.dark') : t('appearance.mode.light')})`
      : themePreference === 'dark'
        ? t('appearance.mode.dark')
        : t('appearance.mode.light');
  const appearanceLabel =
    themePreference === 'system' ? appearanceModeLabel : appearanceModeLabel;
  const subscriptionStatusLabel = React.useMemo(() => {
    const current = user?.subscription;
    if (!current) return t('settings.subscriptionFree');

    const status = String(current.status || '').toLowerCase();
    const expiryMs =
      typeof current.expiresAt === 'string' && current.expiresAt.trim().length > 0
        ? new Date(current.expiresAt).getTime()
        : null;
    const hasExpired = typeof expiryMs === 'number' && Number.isFinite(expiryMs) && expiryMs <= Date.now();

    if (hasExpired && (status === 'active' || status === 'trialing' || status === 'grace')) {
      return t('settings.subscriptionExpired');
    }
    if (status === 'active' || status === 'trialing') return t('settings.subscriptionActive');
    if (status === 'grace') return t('settings.subscriptionGrace');
    if (status === 'cancelled') return t('settings.subscriptionCancelled');
    if (status === 'expired') return t('settings.subscriptionExpired');
    if (status === 'pending') return t('settings.subscriptionPending');
    return t('settings.subscriptionStatusUnknown');
  }, [t, user?.subscription]);

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      refreshAuth(); // Update context state

      Toast.show({
        type: 'success',
        text1: t('settings.loggedOutTitle'),
        text2: t('settings.loggedOutBody'),
      });

      // Navigate to login
      router.replace('/auth/login');
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: t('settings.logoutFailed'),
        text2: t('settings.logoutFailedBody'),
      });
    }
  };

  // Group settings for better structure
  const accountSettings = [
    { key: 'account', label: t('settings.account'), icon: User, action: () => router.push('/(tabs)/profile-details') },
    { key: 'avatar', label: t('settings.avatar'), icon: ImageIcon, action: () => router.push('/settings/avatar') },
    { key: 'chats', label: t('settings.chats'), icon: MessageCircle, action: () => router.push('/settings/chats') },
    {
      key: 'subscription',
      label: t('settings.subscriptionWithStatus', { status: subscriptionStatusLabel }),
      icon: CreditCard,
      action: () => router.push('/settings/subscription'),
    },
    { key: 'paymentHistory', label: 'Payment history', icon: Receipt, action: () => router.push('/payment-history') },
  ];

  // Add Doctor Recruitment for Marketing and Admin roles
  if (user?.role === 'Marketing' || user?.role === 'Admin') {
    accountSettings.push({
      key: 'doctorRecruitment',
      label: t('settings.doctorRecruitment'),
      icon: Stethoscope,
      action: () => router.push('/doctor-recruitment'),
    });
  }

  const appSettings = [
    {
      key: 'appearance',
      label: t('settings.appearanceWithMode', { mode: appearanceLabel }),
      icon: SunMoon,
      action: () => router.push('/settings/appearance'),
    },
    {
      key: 'notifications',
      label: t('settings.notificationsWithCount', { count: notificationCountText }),
      icon: Bell,
      action: () => router.push('/settings/notifications'),
    },
    // Temporarily disabled as requested:
    // {
    //   key: 'storageData',
    //   label: t('settings.storageWithSize', { size: storageLabel }),
    //   icon: Database,
    //   action: () => router.push('/settings/storage'),
    // },
    {
      key: 'appLanguage',
      label: t('settings.languageWithLabel', { language: languageLabel }),
      icon: Globe,
      action: () => router.push('/settings/language'),
    },
    { key: 'help', label: t('settings.help'), icon: HelpCircle, action: () => router.push('/settings/help') }
  ];

  // Construct full image URL
  const profileImageUrl = getImageUrl(user?.profilePicture);
  const settingsIconSize = 17;
  const settingsIconStrokeWidth = 2;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Profile Header Block */}
      <TouchableOpacity
        style={[styles.profileHeader, { backgroundColor: theme.cardBackground, borderBottomColor: theme.borderColor, paddingTop: 20 }]}
        onPress={() => router.push('/(tabs)/profile-details')}
      >
        <View style={styles.avatarContainer}>
          {profileImageUrl ? (
            <Image
              source={{ uri: profileImageUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>{user?.firstName?.[0] || '?'}{user?.lastName?.[0] || '?'}</Text>
          )}
        </View>
        <View>
          <Text style={[styles.profileName, { color: theme.text }]}>{user?.firstName} {user?.lastName}</Text>
          <Text style={[styles.profileSubtitle, { color: theme.textSecondary }]}>{t('settings.patientGreeting')}</Text>
        </View>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View
          style={[
            styles.section,
            { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, borderTopColor: theme.borderColor },
          ]}
        >
          {accountSettings.map((option, index) => {
            const Icon = option.icon;
            return (
            <View key={option.key}>
              <TouchableOpacity style={styles.optionRow} onPress={option.action}>
                <View style={styles.optionLeft}>
                  <View style={[styles.iconWrap, { backgroundColor: theme.tint + '10' }]}>
                    <Icon size={settingsIconSize} strokeWidth={settingsIconStrokeWidth} color={theme.tint} />
                  </View>
                  <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>
                </View>
                <ChevronRight size={16} strokeWidth={2.2} color={theme.textSecondary} />
              </TouchableOpacity>
              {index < accountSettings.length - 1 && <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />}
            </View>
          )})}

          <View style={[styles.groupDivider, { backgroundColor: theme.borderColor }]} />

          {appSettings.map((option, index) => {
            const Icon = option.icon;
            return (
            <View key={option.key}>
              <TouchableOpacity style={styles.optionRow} onPress={option.action}>
                <View style={styles.optionLeft}>
                  <View style={[styles.iconWrap, { backgroundColor: theme.tint + '10' }]}>
                    <Icon size={settingsIconSize} strokeWidth={settingsIconStrokeWidth} color={theme.tint} />
                  </View>
                  <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>
                </View>
                <ChevronRight size={16} strokeWidth={2.2} color={theme.textSecondary} />
              </TouchableOpacity>
              {index < appSettings.length - 1 && <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />}
            </View>
          )})}
        </View>

        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: theme.cardBackground, flexDirection: 'row', justifyContent: 'center' }]}
          onPress={handleLogout}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? (
            <ActivityIndicator color="#e74c3c" />
          ) : (
            <>
              <LogOut size={18} strokeWidth={2} color="#e74c3c" style={{ marginRight: 8 }} />
              <Text style={styles.logoutText}>{t('settings.logout')}</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.versionText}>{t('settings.version')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingBottom: 28,
  },
  headerSpace: { height: 20 },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 15,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#555',
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileSubtitle: {
    fontSize: 14,
  },
  section: {
    borderTopWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 14,
  },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    marginRight: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontSize: 16,
    fontWeight: '500',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
  },
  logoutButton: {
    marginHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF3B30',
  },
  versionText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 12,
    color: '#999',
  },
});
