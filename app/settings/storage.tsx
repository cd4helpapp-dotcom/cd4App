import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
import Toast from 'react-native-toast-message';
import { Trash2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { useStorageInsights } from '../../hooks/useStorageInsights';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';

export default function StorageSettings() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { t } = useAppLanguage();
    const {
        localStorageFormatted,
        reportsFormatted,
        reportsCount,
        unreadNotifications,
        totalFormatted,
        localStorageKeys,
        clearLocalCache,
        refetching,
    } = useStorageInsights();

    const handleClearCache = () => {
        Alert.alert(
            t('storage.clearCacheTitle'),
            t('storage.clearCacheMessage'),
            [
                { text: t('common.cancel'), style: "cancel" },
                {
                    text: t('common.clear'),
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const result = await clearLocalCache();
                            Toast.show({
                                type: 'success',
                                text1: t('storage.clearedTitle'),
                                text2: t('storage.clearedBody', { count: result.removedKeys }),
                            });
                        } catch {
                            Toast.show({
                                type: 'error',
                                text1: t('storage.failedTitle'),
                                text2: t('storage.failedBody'),
                            });
                        }
                    }
                }
            ]
        );
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('storage.title')} onBack={() => router.back()} theme={theme} />

            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.appCachedData')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{totalFormatted}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.localStorage')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{localStorageFormatted}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.reportFiles')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{reportsFormatted}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.reportsCount')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{reportsCount}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.unreadNotifications')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{unreadNotifications}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <View style={styles.row}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('storage.cacheKeys')}</Text>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>{localStorageKeys}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity
                    style={[styles.actionRow, { backgroundColor: colorScheme === 'dark' ? '#3e1a1a' : '#fff9f9' }]}
                    onPress={handleClearCache}
                    disabled={refetching}
                >
                    <Text style={styles.actionText}>{t('storage.clearCache')}</Text>
                    <Trash2 size={20} color="#e74c3c" />
                </TouchableOpacity>
            </View>

            <Text style={[styles.footerText, { color: theme.textSecondary }]}>
                {t('storage.description')}
            </Text>
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
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    label: { fontSize: 16 },
    valueText: { fontSize: 16, fontWeight: '500' },
    actionText: { fontSize: 16, color: '#e74c3c', fontWeight: '600' },
    divider: { height: 1, marginLeft: 16 },
    footerText: { fontSize: 13, marginTop: 16, lineHeight: 20, textAlign: 'center', paddingHorizontal: 10 }
});
