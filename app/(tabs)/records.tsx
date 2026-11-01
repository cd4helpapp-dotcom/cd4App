import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import ReportsScreen, { type ReportsTabKey } from '../../ui/reports/ReportsScreen';

const VALID_TABS: ReportsTabKey[] = ['all', 'lab', 'prescription', 'insights'];

export default function RecordsScreen() {
    const params = useLocalSearchParams<{ tab?: string | string[] }>();
    const requested = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    const initialTab = (VALID_TABS as string[]).includes(requested || '') ? (requested as ReportsTabKey) : 'all';
    const tabSwipeHandlers = useTabSwipeNavigation('records');

    return (
        <View {...tabSwipeHandlers} style={{ flex: 1 }}>
            <ReportsScreen initialTab={initialTab} />
        </View>
    );
}
