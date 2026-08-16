import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme, ScrollView, ActivityIndicator, Image } from 'react-native';
import Colors from '../../constants/Colors';
import { router } from 'expo-router';
import { useAuthContext } from '../../context/AuthContext';
import { LogOut, UserCheck, Banknote, Building, Bell, Database, Globe, HelpCircle, SunMoon, Receipt } from 'lucide-react-native';
import { useLogout } from '../../hooks/useAuth';
import Toast from 'react-native-toast-message';
import { getImageUrl } from '../../constants/Config';
import { useThemePreference } from '../../context/ThemePreferenceContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useStorageInsights } from '../../hooks/useStorageInsights';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';

export default function DoctorSettings() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { user } = useAuthContext();
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
        themePreference === 'system'
            ? appearanceModeLabel
            : appearanceModeLabel;

    const handleLogout = async () => {
        try {
            await logoutMutation.mutateAsync();

            Toast.show({
                type: 'success',
                text1: t('settings.loggedOutTitle'),
                text2: t('settings.loggedOutBody'),
            });

            router.replace('/auth/login');
        } catch (error) {
            Toast.show({
                type: 'error',
                text1: t('settings.logoutFailed'),
                text2: t('settings.logoutFailedBody'),
            });
        }
    };

    const doctorSettings = [
        { key: 'profileCredentials', label: t('settings.profileCredentials'), icon: UserCheck, action: () => router.push('/doctor/profile-details') },
        { key: 'consultationFees', label: t('settings.consultationFees'), icon: Banknote, action: () => router.push('/doctor/profile/fees') },
        { key: 'clinicDetails', label: t('settings.clinicDetails'), icon: Building, action: () => router.push('/doctor/profile/clinic') },
        { key: 'transactions', label: 'Transactions', icon: Receipt, action: () => router.push('/doctor/transactions') },
    ];

    const appSettings = [
        {
            key: 'appearance',
            label: t('settings.appearanceWithMode', { mode: appearanceLabel }),
            icon: SunMoon,
            action: () => router.push('/doctor/appearance')
        },
        {
            key: 'notifications',
            label: t('settings.notificationsWithCount', { count: notificationCountText }),
            icon: Bell,
            action: () => router.push('/doctor/notifications')
        },
        {
            key: 'storageData',
            label: t('settings.storageWithSize', { size: storageLabel }),
            icon: Database,
            action: () => router.push('/doctor/storage')
        },
        {
            key: 'appLanguage',
            label: t('settings.languageWithLabel', { language: languageLabel }),
            icon: Globe,
            action: () => router.push('/doctor/language')
        },
        { key: 'helpSupport', label: t('settings.helpSupport'), icon: HelpCircle, action: () => router.push('/doctor/help') }
    ];

    const profileImageUrl = getImageUrl(user?.profilePicture);

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']}>
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Profile Header Block */}
            <TouchableOpacity
                style={[styles.profileHeader, { backgroundColor: theme.cardBackground, borderBottomColor: theme.borderColor }]}
                onPress={() => router.push('/doctor/profile-details')}
            >
                <View style={[styles.avatarContainer, { backgroundColor: theme.tint + '20' }]}>
                    {profileImageUrl ? (
                        <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
                    ) : (
                        <Text style={[styles.avatarText, { color: theme.tint }]}>{user?.firstName?.[0] || '?'}{user?.lastName?.[0] || '?'}</Text>
                    )}
                </View>
                <View>
                    <Text style={[styles.profileName, { color: theme.text }]}>Dr. {user?.firstName} {user?.lastName}</Text>
                    <Text style={[styles.profileSubtitle, { color: theme.textSecondary }]}>{t('settings.doctorGreeting')}</Text>
                </View>
            </TouchableOpacity>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View
                    style={[
                        styles.section,
                        { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, borderTopColor: theme.borderColor },
                    ]}
                >
                    {doctorSettings.map((option, index) => {
                        const Icon = option.icon;
                        return (
                        <View key={option.key}>
                            <TouchableOpacity style={styles.optionRow} onPress={option.action}>
                                <View style={styles.optionLeft}>
                                  <View style={[styles.iconWrap, { backgroundColor: theme.tint + '10' }]}>
                                    <Icon size={18} color={theme.tint} />
                                  </View>
                                  <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>
                                </View>
                                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>›</Text>
                            </TouchableOpacity>
                            {index < doctorSettings.length - 1 && <View style={[styles.separator, { backgroundColor: theme.borderColor }]} />}
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
                                    <Icon size={18} color={theme.tint} />
                                  </View>
                                  <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>
                                </View>
                                <Text style={{ color: theme.textSecondary, fontSize: 16 }}>›</Text>
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
                            <LogOut size={20} color="#e74c3c" style={{ marginRight: 8 }} />
                            <Text style={styles.logoutText}>{t('settings.logout')}</Text>
                        </>
                    )}
                </TouchableOpacity>

                <Text style={styles.versionText}>{t('settings.versionDoctor')}</Text>
            </ScrollView>
        </View>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollContent: {
        paddingBottom: 28,
        paddingTop: 12,
    },
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
        borderTopWidth: StyleSheet.hairlineWidth,
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
