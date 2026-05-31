import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, useColorScheme } from 'react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useUpdateSettings } from '../../hooks/useAuth';
import Colors from '../../constants/Colors';
import Toast from 'react-native-toast-message';
import { router } from 'expo-router';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { supabase } from '../../src/lib/supabase';
import SettingsHeader from '../../ui/common/SettingsHeader';

export default function NotificationsSettings() {
    const { user } = useAuthContext();
    const updateSettingsMutation = useUpdateSettings();
    const { t } = useAppLanguage();

    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [pushEnabled, setPushEnabled] = useState(user?.settings?.notifications?.push ?? true);
    const [emailEnabled, setEmailEnabled] = useState(user?.settings?.notifications?.email ?? true);
    const [smsEnabled, setSmsEnabled] = useState(user?.settings?.notifications?.sms ?? false);
    const [marketingEnabled, setMarketingEnabled] = useState(user?.settings?.notifications?.marketing ?? false);

    useEffect(() => {
        setPushEnabled(user?.settings?.notifications?.push ?? true);
        setEmailEnabled(user?.settings?.notifications?.email ?? true);
        setSmsEnabled(user?.settings?.notifications?.sms ?? false);
        setMarketingEnabled(user?.settings?.notifications?.marketing ?? false);
    }, [
        user?.settings?.notifications?.push,
        user?.settings?.notifications?.email,
        user?.settings?.notifications?.sms,
        user?.settings?.notifications?.marketing,
    ]);

    useEffect(() => {
        if (!user?.id) return;

        const channel = supabase
            .channel(`settings-notifications-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${user.id}`,
                },
                (payload) => {
                    const nextSettings = (payload.new as any)?.settings;
                    const nextNotifications = nextSettings?.notifications;
                    if (!nextNotifications || typeof nextNotifications !== 'object') return;

                    if (typeof nextNotifications.push === 'boolean') {
                        setPushEnabled(nextNotifications.push);
                    }
                    if (typeof nextNotifications.email === 'boolean') {
                        setEmailEnabled(nextNotifications.email);
                    }
                    if (typeof nextNotifications.sms === 'boolean') {
                        setSmsEnabled(nextNotifications.sms);
                    }
                    if (typeof nextNotifications.marketing === 'boolean') {
                        setMarketingEnabled(nextNotifications.marketing);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id]);

    const handleToggle = async (key: 'push' | 'email' | 'sms' | 'marketing', value: boolean) => {
        const previousState = {
            push: pushEnabled,
            email: emailEnabled,
            sms: smsEnabled,
            marketing: marketingEnabled,
        };
        const nextState = {
            push: key === 'push' ? value : pushEnabled,
            email: key === 'email' ? value : emailEnabled,
            sms: key === 'sms' ? value : smsEnabled,
            marketing: key === 'marketing' ? value : marketingEnabled,
        };

        // Optimistic UI Update
        setPushEnabled(nextState.push);
        setEmailEnabled(nextState.email);
        setSmsEnabled(nextState.sms);
        setMarketingEnabled(nextState.marketing);

        try {
            await updateSettingsMutation.mutateAsync({
                notifications: nextState
            });
        } catch (error) {
            Toast.show({ type: 'error', text1: t('notifications.updateFailedTitle'), text2: t('notifications.updateFailedBody') });

            // Revert UI Update
            setPushEnabled(previousState.push);
            setEmailEnabled(previousState.email);
            setSmsEnabled(previousState.sms);
            setMarketingEnabled(previousState.marketing);
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('notifications.title')} onBack={() => router.back()} theme={theme} />

            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('notifications.push')}</Text>
                    <Switch
                        value={pushEnabled}
                        onValueChange={(val) => handleToggle('push', val)}
                        trackColor={{ false: '#767577', true: theme.tint }}
                        disabled={updateSettingsMutation.isPending}
                    />
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('notifications.email')}</Text>
                    <Switch
                        value={emailEnabled}
                        onValueChange={(val) => handleToggle('email', val)}
                        trackColor={{ false: '#767577', true: theme.tint }}
                        disabled={updateSettingsMutation.isPending}
                    />
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('notifications.sms')}</Text>
                    <Switch
                        value={smsEnabled}
                        onValueChange={(val) => handleToggle('sms', val)}
                        trackColor={{ false: '#767577', true: theme.tint }}
                        disabled={updateSettingsMutation.isPending}
                    />
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('notifications.marketing')}</Text>
                    <Switch
                        value={marketingEnabled}
                        onValueChange={(val) => handleToggle('marketing', val)}
                        trackColor={{ false: '#767577', true: theme.tint }}
                        disabled={updateSettingsMutation.isPending}
                    />
                </View>

            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    backButton: { marginRight: 15, padding: 5 },
    headerTitle: { fontSize: 24, fontWeight: 'bold' },
    section: { borderRadius: 12, overflow: 'hidden', marginBottom: 24 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    label: { fontSize: 16 },
    divider: { height: 1, marginLeft: 16 }
});
