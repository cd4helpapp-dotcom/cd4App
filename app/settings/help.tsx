import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
import { MessageCircle, FileText, Info } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';
import { openWhatsAppSupport, getFormattedSupportPhone } from '../../src/utils/whatsapp';

export default function HelpSettings() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { t } = useAppLanguage();

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('help.title')} onBack={() => router.back()} theme={theme} />

            <View style={[styles.section, { backgroundColor: theme.cardBackground }]}>
                <TouchableOpacity style={styles.row} onPress={() => openWhatsAppSupport('Hi CD4 Health Support, I need help with my CD4 account.')}>
                    <View style={styles.iconRow}>
                        <View style={styles.whatsappIconBadge}>
                            <MessageCircle size={16} color="#FFFFFF" />
                        </View>
                        <View>
                            <Text style={[styles.label, { color: theme.text, fontWeight: '700' }]}>WhatsApp Helpline</Text>
                            <Text style={{ fontSize: 12, color: '#25D366', fontWeight: '600' }}>{getFormattedSupportPhone()} · Fast Support</Text>
                        </View>
                    </View>
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/support')}>
                    <View style={styles.iconRow}>
                        <MessageCircle size={22} color={theme.tint} style={styles.icon} />
                        <Text style={[styles.label, { color: theme.text }]}>{t('help.contactSupport')}</Text>
                    </View>
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/terms')}>
                    <View style={styles.iconRow}>
                        <FileText size={22} color={theme.tint} style={styles.icon} />
                        <Text style={[styles.label, { color: theme.text }]}>{t('help.terms')}</Text>
                    </View>
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/privacy-policy')}>
                    <View style={styles.iconRow}>
                        <Info size={22} color={theme.tint} style={styles.icon} />
                        <Text style={[styles.label, { color: theme.text }]}>{t('help.privacyPolicy')}</Text>
                    </View>
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
                <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

                <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/delete-account')}>
                    <View style={styles.iconRow}>
                        <Info size={22} color={theme.tint} style={styles.icon} />
                        <Text style={[styles.label, { color: theme.text }]}>Delete account</Text>
                    </View>
                    <Text style={styles.arrow}>›</Text>
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
    section: { borderRadius: 12, overflow: 'hidden' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    iconRow: { flexDirection: 'row', alignItems: 'center' },
    icon: { marginRight: 12 },
    whatsappIconBadge: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: '#25D366',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    label: { fontSize: 16 },
    arrow: { fontSize: 18, color: '#aaa', fontWeight: 'bold' },
    divider: { height: 1, marginLeft: 46 }
});
