import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useAuthContext } from '../../context/AuthContext';
import { useUpdateSettings } from '../../hooks/useAuth';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';

export default function ChatsSettings() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { user } = useAuthContext();
    const updateSettingsMutation = useUpdateSettings();
    const { t } = useAppLanguage();

    const [readReceipts, setReadReceipts] = useState(user?.settings?.chats?.readReceipts ?? true);
    const [mediaAutoDownload, setMediaAutoDownload] = useState(user?.settings?.chats?.mediaAutoDownload ?? false);

    useEffect(() => {
        setReadReceipts(user?.settings?.chats?.readReceipts ?? true);
        setMediaAutoDownload(user?.settings?.chats?.mediaAutoDownload ?? false);
    }, [user?.settings?.chats?.readReceipts, user?.settings?.chats?.mediaAutoDownload]);

    const updateChatSettings = async (nextReadReceipts: boolean, nextMediaAutoDownload: boolean) => {
        const previous = {
            readReceipts,
            mediaAutoDownload,
        };
        try {
            await updateSettingsMutation.mutateAsync({
                chats: {
                    readReceipts: nextReadReceipts,
                    mediaAutoDownload: nextMediaAutoDownload,
                },
            });
        } catch {
            setReadReceipts(previous.readReceipts);
            setMediaAutoDownload(previous.mediaAutoDownload);
            Toast.show({ type: 'error', text1: t('notifications.updateFailedTitle'), text2: t('notifications.updateFailedBody') });
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('chats.title')} onBack={() => router.back()} theme={theme} />

            <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{t('chats.privacyData')}</Text>
            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                <View style={styles.row}>
                    <View>
                        <Text style={[styles.label, { color: theme.text }]}>{t('chats.readReceipts')}</Text>
                        <Text style={[styles.subtext, { color: theme.textSecondary }]}>{t('chats.readReceiptsDesc')}</Text>
                    </View>
                    <Switch
                        value={readReceipts}
                        onValueChange={(nextValue) => {
                            setReadReceipts(nextValue);
                            void updateChatSettings(nextValue, mediaAutoDownload);
                        }}
                        trackColor={{ false: '#767577', true: theme.tint }}
                        disabled={updateSettingsMutation.isPending}
                    />
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />
                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('chats.mediaAutoDownload')}</Text>
                    <Switch
                        value={mediaAutoDownload}
                        onValueChange={(nextValue) => {
                            setMediaAutoDownload(nextValue);
                            void updateChatSettings(readReceipts, nextValue);
                        }}
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
    sectionHeader: { fontSize: 14, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
    section: { borderRadius: 12, overflow: 'hidden', marginBottom: 24 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    label: { fontSize: 16 },
    subtext: { fontSize: 12, marginTop: 4, maxWidth: '85%' },
    divider: { height: 1, marginLeft: 16 }
});
