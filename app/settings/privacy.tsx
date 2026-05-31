import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useColorScheme } from 'react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useUpdateSettings } from '../../hooks/useAuth';
import Colors from '../../constants/Colors';
import Toast from 'react-native-toast-message';
import { Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';

export default function PrivacySettings() {
    const { user } = useAuthContext();
    const updateSettingsMutation = useUpdateSettings();
    const { t } = useAppLanguage();

    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [visibility, setVisibility] = useState<'public' | 'private' | 'doctors_only'>(
        user?.settings?.privacy?.profileVisibility || 'public'
    );

    useEffect(() => {
        setVisibility(user?.settings?.privacy?.profileVisibility || 'public');
    }, [user?.settings?.privacy?.profileVisibility]);

    const handleSelect = async (val: 'public' | 'private' | 'doctors_only') => {
        setVisibility(val);
        try {
            await updateSettingsMutation.mutateAsync({ privacy: { profileVisibility: val } });
            Toast.show({ type: 'success', text1: t('privacy.updatedTitle') });
        } catch {
            Toast.show({ type: 'error', text1: t('privacy.updateFailedTitle') });
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('privacy.title')} onBack={() => router.back()} theme={theme} />

            <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>{t('privacy.profileVisibility')}</Text>
            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                <TouchableOpacity style={styles.row} onPress={() => handleSelect('public')}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('privacy.publicEveryone')}</Text>
                    {visibility === 'public' && <Check size={20} color={theme.tint} />}
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => handleSelect('doctors_only')}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('privacy.doctorsOnly')}</Text>
                    {visibility === 'doctors_only' && <Check size={20} color={theme.tint} />}
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => handleSelect('private')}>
                    <Text style={[styles.label, { color: theme.text }]}>{t('privacy.privateNoOne')}</Text>
                    {visibility === 'private' && <Check size={20} color={theme.tint} />}
                </TouchableOpacity>
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
    divider: { height: 1, marginLeft: 16 }
});
