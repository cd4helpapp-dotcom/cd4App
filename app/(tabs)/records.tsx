import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
import HealthVaultView from '../../ui/teleconsultation/HealthVaultView';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useLocalSearchParams } from 'expo-router';

export default function RecordsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { t } = useAppLanguage();
    const params = useLocalSearchParams<{ tab?: string | string[] }>();
    const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    const initialTab = requestedTab === 'insights' || requestedTab === 'prescription' ? requestedTab : 'all';
    const insets = useSafeAreaInsets();
    const tabSwipeHandlers = useTabSwipeNavigation('records');

    return (
        <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={{ padding: 20 }}>
                <Text style={[styles.title, { color: theme.text }]}>{t('reports.myReports')}</Text>
            </View>
            <HealthVaultView theme={theme} initialTab={initialTab} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: { fontSize: 24, fontWeight: 'bold' },
});
