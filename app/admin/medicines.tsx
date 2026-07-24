import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import { useAdminMedicines, useUpdateMedicineVerification, type AdminMedicineDictionaryRow } from '../../hooks/useAdmin';

type Filter = 'pending' | 'verified' | 'rejected' | 'all';

const statusColor = (status: string, theme: typeof Colors.light) => {
    if (status === 'verified') return theme.success;
    if (status === 'rejected') return theme.error;
    return '#C47A00';
};

const formatStrength = (row: AdminMedicineDictionaryRow) => row.strength_value && row.strength_unit
    ? `${row.strength_value} ${row.strength_unit}`
    : 'Strength not specified';

export default function AdminMedicinesScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const [filter, setFilter] = useState<Filter>('pending');
    const medicinesQuery = useAdminMedicines();
    const updateMutation = useUpdateMedicineVerification();

    const medicines = useMemo(() => {
        const rows = medicinesQuery.data || [];
        if (filter === 'all') return rows;
        return rows.filter((row) => row.verification_status === filter);
    }, [filter, medicinesQuery.data]);

    const updateStatus = (row: AdminMedicineDictionaryRow, status: 'verified' | 'rejected') => {
        const action = status === 'verified' ? 'verify' : 'reject';
        Alert.alert(
            `${status === 'verified' ? 'Verify' : 'Reject'} medicine`,
            `Review ${row.generic_name}${row.brand_name ? ` (${row.brand_name})` : ''} before you ${action} it.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: status === 'verified' ? 'Verify' : 'Reject',
                    style: status === 'rejected' ? 'destructive' : 'default',
                    onPress: async () => {
                        try {
                            await updateMutation.mutateAsync({ id: row.id, status });
                            Toast.show({ type: 'success', text1: status === 'verified' ? 'Medicine verified' : 'Medicine rejected' });
                        } catch (error: any) {
                            Toast.show({ type: 'error', text1: 'Update failed', text2: error?.message || 'Could not update medicine.' });
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: theme.text }]}>Medicine Dictionary</Text>
                        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Review names and aliases before AI matching.</Text>
                    </View>
                    <Ionicons name="medical-outline" size={30} color={theme.tint} />
                </View>

                <View style={[styles.safetyNote, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={theme.success} />
                    <Text style={[styles.safetyText, { color: theme.text }]}>Pending medicines are not used for automatic matching until verified.</Text>
                </View>

                <View style={styles.filters}>
                    {(['pending', 'verified', 'rejected', 'all'] as Filter[]).map((item) => (
                        <TouchableOpacity key={item} onPress={() => setFilter(item)} style={[styles.filterChip, { backgroundColor: filter === item ? theme.tint : theme.cardBackground, borderColor: filter === item ? theme.tint : theme.borderColor }]}>
                            <Text style={[styles.filterText, { color: filter === item ? '#fff' : theme.textSecondary }]}>{item[0].toUpperCase() + item.slice(1)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {medicinesQuery.isLoading ? <ActivityIndicator color={theme.tint} style={{ marginTop: 30 }} /> : (
                    <FlatList
                        data={medicines}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        refreshControl={<RefreshControl refreshing={medicinesQuery.isRefetching} onRefresh={() => void medicinesQuery.refetch()} tintColor={theme.tint} />}
                        ListEmptyComponent={<Text style={[styles.empty, { color: theme.textSecondary }]}>No medicines in this filter.</Text>}
                        renderItem={({ item }) => (
                            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                <View style={styles.cardTop}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.medicineName, { color: theme.text }]}>{item.generic_name}{item.brand_name ? ` · ${item.brand_name}` : ''}</Text>
                                        <Text style={[styles.meta, { color: theme.textSecondary }]}>{formatStrength(item)} · {item.dosage_form || 'Form not specified'} · {item.route || 'Route not specified'}</Text>
                                    </View>
                                    <Text style={[styles.status, { color: statusColor(item.verification_status, theme) }]}>{item.verification_status.toUpperCase()}</Text>
                                </View>
                                <Text style={[styles.detail, { color: theme.textSecondary }]}>Aliases: {(item.aliases || []).join(', ') || 'None'}</Text>
                                <Text style={[styles.detail, { color: theme.textSecondary }]}>Speech variants: {(item.speech_variants || []).join(', ') || 'None'}</Text>
                                <Text style={[styles.detail, { color: theme.textSecondary }]}>Departments: {(item.clinical_departments || []).join(', ') || 'General medicine'}</Text>
                                {item.verification_status === 'pending' ? (
                                    <View style={styles.actions}>
                                        <TouchableOpacity onPress={() => updateStatus(item, 'rejected')} style={[styles.rejectButton, { borderColor: theme.error }]}><Text style={[styles.rejectText, { color: theme.error }]}>Reject</Text></TouchableOpacity>
                                        <TouchableOpacity onPress={() => updateStatus(item, 'verified')} style={[styles.verifyButton, { backgroundColor: theme.success }]}><Text style={styles.verifyText}>Verify medicine</Text></TouchableOpacity>
                                    </View>
                                ) : null}
                            </View>
                        )}
                    />
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    container: { flex: 1, paddingHorizontal: 16 },
    header: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 14, gap: 12 },
    title: { fontSize: 22, fontWeight: '800' },
    subtitle: { fontSize: 12, marginTop: 3 },
    safetyNote: { borderWidth: 1, borderRadius: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
    safetyText: { flex: 1, fontSize: 11, lineHeight: 15 },
    filters: { flexDirection: 'row', gap: 7, paddingVertical: 14 },
    filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    filterText: { fontSize: 11, fontWeight: '800' },
    listContent: { gap: 10, paddingBottom: 24 },
    card: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 7 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    medicineName: { fontSize: 15, fontWeight: '800' },
    meta: { fontSize: 11, marginTop: 4 },
    status: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
    detail: { fontSize: 11, lineHeight: 15 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 5 },
    rejectButton: { flex: 1, borderWidth: 1, borderRadius: 9, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
    rejectText: { fontSize: 12, fontWeight: '800' },
    verifyButton: { flex: 1.4, borderRadius: 9, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
    verifyText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    empty: { textAlign: 'center', paddingTop: 40, fontSize: 13 },
});
