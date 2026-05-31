import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
import HealthVaultView from '../../ui/teleconsultation/HealthVaultView';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAppLanguage } from '../../context/AppLanguageContext';

export default function RecordsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { t } = useAppLanguage();
    const insets = useSafeAreaInsets();
    const tabSwipeHandlers = useTabSwipeNavigation('records');

    return (
        <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={{ padding: 20 }}>
                <Text style={[styles.title, { color: theme.text }]}>{t('reports.myReports')}</Text>
            </View>
            <HealthVaultView theme={theme} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: { fontSize: 24, fontWeight: 'bold' },
});
