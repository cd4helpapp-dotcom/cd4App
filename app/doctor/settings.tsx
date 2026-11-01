import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import Toast from 'react-native-toast-message';
import { Banknote, Bell, Building, ChevronRight, Database, Globe, HelpCircle, LogOut, Receipt, SunMoon, UserCheck } from 'lucide-react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useLogout } from '../../hooks/useAuth';
import { useThemePreference } from '../../context/ThemePreferenceContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useStorageInsights } from '../../hooks/useStorageInsights';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getImageUrl } from '../../constants/Config';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { SettingsGroup, SettingsRow } from '../../ui/common/SettingsGroup';
import { confirmAction } from '../../src/utils/confirm';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';

export default function DoctorSettings() {
    const { theme } = useAppTheme();
    const { user } = useAuthContext();
    const logoutMutation = useLogout();
    const { themePreference, resolvedColorScheme } = useThemePreference();
    const { t, languageLabel } = useAppLanguage();
    const storageInsights = useStorageInsights();
    const unreadCount = Number(storageInsights.unreadNotifications || 0);
    const storageLabel = storageInsights.totalFormatted || t('common.notAvailable');

    const appearanceValue =
        themePreference === 'system'
            ? `${t('appearance.mode.system')} · ${resolvedColorScheme === 'dark' ? t('appearance.mode.dark') : t('appearance.mode.light')}`
            : themePreference === 'dark'
                ? t('appearance.mode.dark')
                : t('appearance.mode.light');

    const handleLogout = async () => {
        const confirmed = await confirmAction({
            title: 'Log out of CD4?',
            message: 'You will stop receiving consultation alerts until you sign in again.',
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

    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'DR';
    const profileImageUrl = getImageUrl(user?.profilePicture);
    const appVersion = Constants.expoConfig?.version || '1.0.0';

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']}>
            <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.inner}>
                    <Pressable
                        onPress={() => router.push('/doctor/profile-details')}
                        accessibilityRole="button"
                        accessibilityLabel={`${fullName || 'Your profile'}, view profile`}
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
                                Dr. {fullName || 'Doctor'}
                            </Text>
                            {user?.email ? (
                                <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                                    {user.email}
                                </Text>
                            ) : null}
                            <View style={[styles.rolePill, { backgroundColor: theme.primarySoft }]}>
                                <Text style={[Typography.caption, { color: theme.primary, fontWeight: '600' }]}>CD4 Doctor</Text>
                            </View>
                        </View>
                        <ChevronRight size={20} color={theme.textTertiary} />
                    </Pressable>

                    <SettingsGroup title="Practice">
                        <SettingsRow icon={UserCheck} label={t('settings.profileCredentials')} onPress={() => router.push('/doctor/profile-details')} />
                        <SettingsRow icon={Banknote} label={t('settings.consultationFees')} onPress={() => router.push('/doctor/profile/fees')} />
                        <SettingsRow icon={Building} label={t('settings.clinicDetails')} onPress={() => router.push('/doctor/profile/clinic')} />
                        <SettingsRow icon={Receipt} label="Transactions" onPress={() => router.push('/doctor/transactions')} />
                    </SettingsGroup>

                    <SettingsGroup title="Preferences">
                        <SettingsRow icon={SunMoon} tone="accent" label={t('appearance.title')} value={appearanceValue} onPress={() => router.push('/doctor/appearance')} />
                        <SettingsRow icon={Bell} tone="accent" label={t('notifications.title')} badge={unreadCount} onPress={() => router.push('/doctor/notifications')} />
                        <SettingsRow icon={Globe} tone="accent" label={t('language.title')} value={languageLabel} onPress={() => router.push('/doctor/language')} />
                        <SettingsRow icon={Database} tone="accent" label={t('settings.storageData')} value={storageLabel} onPress={() => router.push('/doctor/storage')} />
                    </SettingsGroup>

                    <SettingsGroup title="Support">
                        <SettingsRow icon={HelpCircle} tone="success" label={t('settings.helpSupport')} onPress={() => router.push('/doctor/help')} />
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

                    <Text style={[Typography.caption, styles.version, { color: theme.textTertiary }]}>CD4 Health · Version {appVersion}</Text>
                </View>
            </ScrollView>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.huge },
    inner: { width: '100%', maxWidth: Layout.contentMaxWidth, alignSelf: 'center' },
    profileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md + 2,
        borderWidth: 1,
        borderRadius: Radius.xl,
        padding: Spacing.lg,
        marginBottom: Spacing.xxl,
    },
    avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarImage: { width: '100%', height: '100%' },
    profileText: { flex: 1, gap: 2 },
    rolePill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3, marginTop: 6 },
    logoutButton: {
        height: 52,
        borderRadius: Radius.lg,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    version: { textAlign: 'center', marginTop: Spacing.xl },
});
