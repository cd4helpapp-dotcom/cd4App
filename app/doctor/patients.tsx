import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarClock, FileText, MessageCircle, Users } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { PersonInitial, readableSummary, ScreenTitle, SearchBox } from '../../ui/doctor/DoctorUI';
import { useDoctorAppointments } from '../../hooks/useAppointment';
import { useChatRooms } from '../../hooks/useChat';
import { buildDoctorInsights, DoctorPatientInsight } from '../../src/utils/doctorInsights';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { downloadAiReport, openAiReport } from '../../src/utils/reportDownload';

const formatDateShort = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const sanitizeFileNamePart = (value: string) =>
    (value || 'patient')
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'patient';

export default function DoctorPatientsScreen() {
    const router = useRouter();
    const { theme } = useAppTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-patients');

    const { data: appointments = [], isLoading } = useDoctorAppointments();
    const { data: chatRooms = [], isFetching } = useChatRooms();

    const insights = useMemo(() => buildDoctorInsights({ appointments, chatRooms }), [appointments, chatRooms]);

    const filteredPatients = useMemo(() => {
        if (!searchQuery.trim()) return insights.patients;
        const needle = searchQuery.trim().toLowerCase();
        return insights.patients.filter((patient) => {
            const name = patient.fullName.toLowerCase();
            const summary = (patient.latestAiSummary || '').toLowerCase();
            return name.includes(needle) || summary.includes(needle);
        });
    }, [insights.patients, searchQuery]);

    const openPdf = (item: DoctorPatientInsight) => {
        if (!item.latestAiPdfUrl) return;
        void openAiReport(item.latestAiPdfUrl).catch((error) => {
            console.warn('Failed to open patient AI report PDF:', error);
            Toast.show({ type: 'error', text1: 'PDF unavailable', text2: 'Could not open the latest summary right now.' });
        });
    };

    const downloadPdf = (item: DoctorPatientInsight) => {
        if (!item.latestAiPdfUrl) return;
        const fileName = `cd4-summary-${sanitizeFileNamePart(item.fullName)}-${sanitizeFileNamePart(formatDateShort(item.lastAppointmentAt || item.lastChatAt))}.pdf`;
        void downloadAiReport(item.latestAiPdfUrl, fileName)
            .then(() => Toast.show({ type: 'success', text1: 'Downloading PDF', text2: 'Latest summary download has started.' }))
            .catch(() => Toast.show({ type: 'error', text1: 'Download failed', text2: 'Could not download the latest summary right now.' }));
    };

    const renderPatient = ({ item }: { item: DoctorPatientInsight }) => {
        const summary = readableSummary(item.latestAiSummary);
        const next = formatDateShort(item.nextAppointmentAt);
        const last = formatDateShort(item.lastAppointmentAt || item.lastChatAt);
        const count = `${item.totalAppointments} appointment${item.totalAppointments === 1 ? '' : 's'}`;

        return (
            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                <View style={styles.top}>
                    <PersonInitial name={item.firstName} />
                    <View style={styles.flex}>
                        <Text style={[Typography.subheading, { color: theme.text }]} numberOfLines={1}>{item.fullName || 'Patient'}</Text>
                        <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                            {count}{last ? ` · Last ${last}` : ''}{item.unreadChatCount > 0 ? ` · ${item.unreadChatCount} unread` : ''}
                        </Text>
                    </View>
                </View>

                {next ? (
                    <View style={[styles.next, { backgroundColor: theme.primarySoft }]}>
                        <CalendarClock size={14} color={theme.primary} />
                        <Text style={[Typography.label, { color: theme.primary }]}>Next: {next}</Text>
                    </View>
                ) : null}

                {summary ? <Text style={[Typography.body, { color: theme.textSecondary }]} numberOfLines={2}>{summary}</Text> : null}

                <View style={styles.actions}>
                    <Pressable
                        onPress={() => router.push({ pathname: '/chat-detail', params: { roomId: item.roomId || undefined, otherId: item.patientId, name: item.fullName } })}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.primary, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}
                    >
                        <MessageCircle size={15} color="#FFFFFF" />
                        <Text style={styles.primaryText}>Open chat</Text>
                    </Pressable>
                    {item.latestAiPdfUrl ? (
                        <Pressable
                            onPress={() => openPdf(item)}
                            onLongPress={() => downloadPdf(item)}
                            delayLongPress={260}
                            accessibilityRole="button"
                            accessibilityHint="Long press to download"
                            style={({ pressed }) => [styles.secondary, { borderColor: theme.primaryBorder, backgroundColor: pressed ? theme.primaryBorder : theme.primarySoft }]}
                        >
                            <FileText size={15} color={theme.primary} />
                            <Text style={[Typography.label, { color: theme.primary }]}>Summary PDF</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        );
    };

    const isSyncing = (isLoading || isFetching) && insights.patients.length === 0;

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']} panHandlers={tabSwipeHandlers}>
            <FlatList
                data={filteredPatients}
                keyExtractor={(item) => item.patientId}
                renderItem={renderPatient}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                    <View style={styles.header}>
                        <ScreenTitle
                            title="Patients"
                            subtitle={`${insights.metrics.totalPatients} patients · ${insights.metrics.upcomingAppointments} upcoming · ${insights.metrics.aiPdfCount} summaries`}
                        />
                        <SearchBox value={searchQuery} onChangeText={setSearchQuery} placeholder="Search by name or summary" />
                    </View>
                }
                ListEmptyComponent={
                    <View style={styles.empty}>
                        {isSyncing ? (
                            <Text style={[Typography.body, { color: theme.textSecondary }]}>Loading patients…</Text>
                        ) : (
                            <>
                                <Users size={40} color={theme.textTertiary} />
                                <Text style={[Typography.subheading, { color: theme.text }]}>
                                    {searchQuery.trim() ? 'No matching patients' : 'No patients yet'}
                                </Text>
                                <Text style={[Typography.body, styles.emptyText, { color: theme.textSecondary }]}>
                                    {searchQuery.trim() ? 'Try a different name or word.' : 'Patients appear here after their first appointment or chat.'}
                                </Text>
                            </>
                        )}
                    </View>
                }
            />
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    list: { paddingHorizontal: Layout.screenGutter, paddingBottom: Spacing.xxxl, gap: Spacing.md, width: '100%', maxWidth: Layout.contentMaxWidth, alignSelf: 'center' },
    header: { paddingTop: Spacing.lg, gap: Spacing.md },
    card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
    top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    next: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 },
    actions: { flexDirection: 'row', gap: Spacing.sm },
    primary: { flex: 1, height: 44, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    secondary: { flex: 1, height: 44, borderRadius: Radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.huge },
    emptyText: { textAlign: 'center' },
});
