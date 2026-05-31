import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useColorScheme } from 'react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useUpdateSettings } from '../../hooks/useAuth';
import Colors from '../../constants/Colors';
import Toast from 'react-native-toast-message';
import { Check } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { normalizeLanguageCode } from '../../src/i18n/settingsI18n';
import SettingsHeader from '../../ui/common/SettingsHeader';

const COMING_SOON_LANGUAGE_CODES = new Set(['bn', 'mr', 'ta']);

export default function AppLanguageSettings() {
    const { user } = useAuthContext();
    const updateSettingsMutation = useUpdateSettings();
    const { t, language: activeLanguageCode, setLanguagePreference, availableLanguages } = useAppLanguage();

    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [selectedLanguageCode, setSelectedLanguageCode] = useState<string>(
        normalizeLanguageCode(user?.settings?.language || activeLanguageCode)
    );

    useEffect(() => {
        const normalized = normalizeLanguageCode(user?.settings?.language || activeLanguageCode);
        setSelectedLanguageCode((current) => (current === normalized ? current : normalized));
    }, [activeLanguageCode, user?.settings?.language]);

    const handleSelectLanguage = async (val: string) => {
        const isComingSoon = COMING_SOON_LANGUAGE_CODES.has(val);
        if (isComingSoon) {
            const selectedLanguage = availableLanguages.find((item) => item.code === val)?.nativeLabel || val;
            Toast.show({
                type: 'info',
                text1: t('language.comingSoon'),
                text2: t('language.comingSoonBody', { language: selectedLanguage }),
            });
            return;
        }

        if (val === selectedLanguageCode || updateSettingsMutation.isPending) {
            return;
        }
        setSelectedLanguageCode(val);
        setLanguagePreference(normalizeLanguageCode(val));
        try {
            await updateSettingsMutation.mutateAsync({ language: val });
            const selectedLanguage = availableLanguages.find((item) => item.code === val)?.nativeLabel || val;
            Toast.show({
                type: 'success',
                text1: t('language.updatedTitle'),
                text2: t('language.updatedBody', { language: selectedLanguage }),
            });
        } catch {
            setSelectedLanguageCode(activeLanguageCode);
            setLanguagePreference(activeLanguageCode);
            Toast.show({ type: 'error', text1: t('language.updateFailedTitle'), text2: t('language.updateFailedBody') });
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('language.title')} onBack={() => router.back()} theme={theme} />

            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                {availableLanguages.map((lang, index) => (
                    <View key={lang.code}>
                        <TouchableOpacity
                            style={styles.row}
                            onPress={() => handleSelectLanguage(lang.code)}
                            disabled={updateSettingsMutation.isPending || COMING_SOON_LANGUAGE_CODES.has(lang.code)}
                        >
                            <View style={styles.labelWrap}>
                                <Text style={[styles.label, { color: theme.text }]}>{lang.nativeLabel}</Text>
                                {COMING_SOON_LANGUAGE_CODES.has(lang.code) && (
                                    <View style={[styles.comingSoonBadge, { backgroundColor: theme.tint + '16', borderColor: theme.tint + '55' }]}>
                                        <Text style={[styles.comingSoonText, { color: theme.tint }]}>{t('language.comingSoon')}</Text>
                                    </View>
                                )}
                            </View>
                            {selectedLanguageCode === lang.code && !COMING_SOON_LANGUAGE_CODES.has(lang.code) && (
                                <Check size={20} color={theme.tint} />
                            )}
                        </TouchableOpacity>
                        {index < availableLanguages.length - 1 && <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />}
                    </View>
                ))}
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
    labelWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 8 },
    label: { fontSize: 16 },
    comingSoonBadge: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    comingSoonText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    divider: { height: 1, marginLeft: 16 }
});
