import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, FileText, Mic, UserRound } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalPatients, useHospitalVoiceIntakes } from '../../hooks/useHospital';

const formatDate = (value?: string) => {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
};

const formatStatus = (value?: string) => (value || 'draft').split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

export default function HospitalPatientProfileScreen() {
    const theme = Colors[useColorScheme() ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { patientId } = useLocalSearchParams<{ patientId?: string }>();
    const patientsQuery = useHospitalPatients();
    const intakesQuery = useHospitalVoiceIntakes();
    const patient = patientsQuery.data?.find((item) => item.patientId === patientId);
    const intakes = (intakesQuery.data || []).filter((item) => item.patientId === patientId);

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
            refreshControl={<RefreshControl refreshing={patientsQuery.isRefetching || intakesQuery.isRefetching} onRefresh={() => { void patientsQuery.refetch(); void intakesQuery.refetch(); }} tintColor={theme.tint} />}
        >
            <View style={styles.header}>
                <TouchableOpacity style={[styles.backButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]} onPress={() => router.back()}>
                    <ArrowLeft size={18} color={theme.text} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.kicker, { color: theme.tint }]}>Hospital patient</Text>
                    <Text style={[styles.title, { color: theme.text }]}>Patient profile</Text>
                </View>
            </View>

            {patientsQuery.isLoading ? <ActivityIndicator color={theme.tint} style={{ marginTop: 28 }} /> : !patient ? (
                <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.cardTitle, { color: theme.text }]}>Patient not found</Text>
                    <Text style={[styles.muted, { color: theme.textSecondary }]}>This patient is not linked to the current hospital.</Text>
                </View>
            ) : (
                <>
                    <View style={[styles.profileCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <View style={[styles.avatar, { backgroundColor: theme.successLight }]}><UserRound size={22} color={theme.tint} /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.profileName, { color: theme.text }]}>{patient.patientName}</Text>
                            <Text style={[styles.muted, { color: theme.textSecondary }]}>{patient.patientEmail || patient.patientPhone || 'Contact not available'}</Text>
                            <Text style={[styles.muted, { color: theme.textSecondary }]}>{patient.doctorName || 'Doctor not assigned'}</Text>
                        </View>
                    </View>

                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Clinical history & reports</Text>
                        <Text style={[styles.count, { color: theme.textSecondary }]}>{intakes.length}</Text>
                    </View>

                    {intakesQuery.isLoading ? <ActivityIndicator color={theme.tint} /> : intakes.length ? intakes.map((intake) => (
                        <TouchableOpacity key={intake.id} style={[styles.reportCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={() => router.push({ pathname: '/hospital/voice-intake-report', params: { id: intake.id } })} activeOpacity={0.82}>
                            <View style={[styles.reportIcon, { backgroundColor: theme.successLight }]}><FileText size={18} color={theme.tint} /></View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.reportTitle, { color: theme.text }]}>{intake.title}</Text>
                                <Text style={[styles.muted, { color: theme.textSecondary }]}>{formatDate(intake.createdAt)} • {formatStatus(intake.status)}</Text>
                            </View>
                            <Mic size={16} color={theme.tint} />
                        </TouchableOpacity>
                    )) : (
                        <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                            <Text style={[styles.cardTitle, { color: theme.text }]}>No history yet</Text>
                            <Text style={[styles.muted, { color: theme.textSecondary }]}>Start a patient voice history from the hospital dashboard.</Text>
                        </View>
                    )}
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 32 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
    backButton: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    kicker: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
    title: { fontSize: 25, fontWeight: '900', marginTop: 3 },
    profileCard: { borderWidth: 1, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    profileName: { fontSize: 19, fontWeight: '900', marginBottom: 4 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
    sectionTitle: { fontSize: 18, fontWeight: '900' },
    count: { fontSize: 13, fontWeight: '800' },
    reportCard: { borderWidth: 1, borderRadius: 17, padding: 13, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
    reportIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    reportTitle: { fontSize: 14, fontWeight: '900' },
    card: { borderWidth: 1, borderRadius: 18, padding: 16 },
    cardTitle: { fontSize: 16, fontWeight: '900' },
    muted: { fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 3 },
});
