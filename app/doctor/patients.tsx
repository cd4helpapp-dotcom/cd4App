import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, useColorScheme, TextInput } from 'react-native';
import { Search, Users, MessageCircle, FileText, CalendarClock, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { useDoctorAppointments } from '../../hooks/useAppointment';
import { useChatRooms } from '../../hooks/useChat';
import { buildDoctorInsights, DoctorPatientInsight } from '../../src/utils/doctorInsights';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import Toast from 'react-native-toast-message';
import { downloadAiReport, openAiReport } from '../../src/utils/reportDownload';

const formatDateShort = (value: string | null) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
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
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const [searchQuery, setSearchQuery] = useState('');
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-patients');

    const { data: appointments = [], isLoading } = useDoctorAppointments();
    const { data: chatRooms = [], isFetching } = useChatRooms();

    const insights = useMemo(() => {
        return buildDoctorInsights({
            appointments,
            chatRooms,
        });
    }, [appointments, chatRooms]);

    const filteredPatients = useMemo(() => {
        if (!searchQuery.trim()) return insights.patients;
        const needle = searchQuery.trim().toLowerCase();
        return insights.patients.filter((patient) => {
            const name = patient.fullName.toLowerCase();
            const summary = (patient.latestAiSummary || '').toLowerCase();
            return name.includes(needle) || summary.includes(needle);
        });
    }, [insights.patients, searchQuery]);

    const renderPatient = ({ item }: { item: DoctorPatientInsight }) => {
        const reportFileName = `cd4-ai-report-${sanitizeFileNamePart(item.fullName)}-${sanitizeFileNamePart(
            formatDateShort(item.lastAppointmentAt || item.lastChatAt),
        )}.pdf`;

        return (
            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.cardTopRow}>
                    <View style={[styles.avatar, { backgroundColor: theme.tint + '20' }]}>
                        <Text style={[styles.avatarText, { color: theme.tint }]}>
                            {item.firstName?.charAt(0)?.toUpperCase() || 'P'}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.patientName, { color: theme.text }]} numberOfLines={1}>
                            {item.fullName || 'Patient'}
                        </Text>
                        <Text style={[styles.metaText, { color: theme.textSecondary }]}>
                            {item.totalAppointments} appointments
                            {item.unreadChatCount > 0 ? ` • ${item.unreadChatCount} unread chats` : ''}
                        </Text>
                    </View>
                </View>

                <View style={styles.metaGrid}>
                    <View style={[styles.metaPill, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                        <CalendarClock size={13} color={theme.tint} />
                        <Text style={[styles.metaPillText, { color: theme.textSecondary }]}>
                            Next: {formatDateShort(item.nextAppointmentAt)}
                        </Text>
                    </View>
                    <View style={[styles.metaPill, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                        <FileText size={13} color={theme.tint} />
                        <Text style={[styles.metaPillText, { color: theme.textSecondary }]}>
                            Last: {formatDateShort(item.lastAppointmentAt || item.lastChatAt)}
                        </Text>
                    </View>
                </View>

                {item.latestAiSummary ? (
                    <Text numberOfLines={2} style={[styles.summaryText, { color: theme.textSecondary }]}>
                        {item.latestAiSummary}
                    </Text>
                ) : (
                    <Text numberOfLines={1} style={[styles.summaryText, { color: theme.textSecondary }]}>
                        No AI triage summary linked yet.
                    </Text>
                )}

                <View style={styles.actionsRow}>
                    <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: theme.tint }]}
                        onPress={() =>
                            router.push({
                                pathname: '/chat-detail',
                                params: {
                                    roomId: item.roomId || undefined,
                                    otherId: item.patientId,
                                    name: item.fullName,
                                },
                            })
                        }
                    >
                        <MessageCircle size={14} color="#fff" />
                        <Text style={styles.primaryActionText}>Open Chat</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.actionButtonSecondary,
                            {
                                borderColor: item.latestAiPdfUrl ? theme.tint : theme.borderColor,
                                backgroundColor: item.latestAiPdfUrl ? theme.tint + '16' : theme.background,
                            },
                        ]}
                        disabled={!item.latestAiPdfUrl}
                        onPress={() => {
                            if (!item.latestAiPdfUrl) return;
                            void openAiReport(item.latestAiPdfUrl).catch((error) => {
                                console.warn('Failed to open patient AI report PDF:', error);
                                Toast.show({
                                    type: 'error',
                                    text1: 'PDF unavailable',
                                    text2: 'Could not open the latest AI report right now.',
                                });
                            });
                        }}
                        onLongPress={() => {
                            if (!item.latestAiPdfUrl) return;
                            void downloadAiReport(item.latestAiPdfUrl, reportFileName).then(() => {
                                Toast.show({
                                    type: 'success',
                                    text1: 'Downloading PDF',
                                    text2: 'Latest AI report download has started.',
                                });
                            }).catch((error) => {
                                console.warn('Failed to download patient AI report PDF:', error);
                                Toast.show({
                                    type: 'error',
                                    text1: 'Download failed',
                                    text2: 'Could not download the latest AI report right now.',
                                });
                            });
                        }}
                        delayLongPress={260}
                    >
                        <FileText size={14} color={item.latestAiPdfUrl ? theme.tint : theme.textSecondary} />
                        <Text style={[styles.secondaryActionText, { color: item.latestAiPdfUrl ? theme.tint : theme.textSecondary }]}>
                            {item.latestAiPdfUrl ? 'Latest PDF' : 'No PDF'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const showSyncingState = (isLoading || isFetching) && insights.patients.length === 0;

    return (
        <DoctorSafeScreen backgroundColor={theme.background} panHandlers={tabSwipeHandlers}>
            <View style={styles.headerContainer}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Patients</Text>
                <Text style={[styles.headerSub, { color: theme.textSecondary }]}>
                    Track consultations, open chats, and AI triage PDFs in one place.
                </Text>
            </View>

            <View style={styles.metricsRow}>
                <View style={[styles.metricMiniCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.metricMiniValue, { color: theme.text }]}>{insights.metrics.totalPatients}</Text>
                    <Text style={[styles.metricMiniLabel, { color: theme.textSecondary }]}>Total Patients</Text>
                </View>
                <View style={[styles.metricMiniCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.metricMiniValue, { color: theme.text }]}>{insights.metrics.aiPdfCount}</Text>
                    <Text style={[styles.metricMiniLabel, { color: theme.textSecondary }]}>AI PDFs</Text>
                </View>
                <View style={[styles.metricMiniCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.metricMiniValue, { color: theme.text }]}>{insights.metrics.upcomingAppointments}</Text>
                    <Text style={[styles.metricMiniLabel, { color: theme.textSecondary }]}>Upcoming</Text>
                </View>
            </View>

            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: theme.cardBackground }]}>
                    <Search size={18} color={theme.textSecondary} />
                    <TextInput
                        style={[styles.searchInput, { color: theme.text }]}
                        placeholder="Search patient or AI summary"
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 ? (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <X size={16} color={theme.textSecondary} />
                        </TouchableOpacity>
                    ) : null}
                </View>
            </View>

            {showSyncingState ? (
                <View style={styles.centerState}>
                    <Text style={{ color: theme.textSecondary }}>Syncing patients...</Text>
                </View>
            ) : filteredPatients.length === 0 ? (
                <View style={styles.centerState}>
                    <Users size={44} color={theme.textSecondary} />
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>
                        {searchQuery.trim() ? 'No matching patients' : 'No patients yet'}
                    </Text>
                    <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
                        {searchQuery.trim()
                            ? 'Try a different keyword'
                            : 'Patients appear here after first appointment or chat.'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredPatients}
                    keyExtractor={(item) => item.patientId}
                    renderItem={renderPatient}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    headerContainer: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 6,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
    },
    headerSub: {
        marginTop: 6,
        fontSize: 13,
    },
    metricsRow: {
        paddingHorizontal: 16,
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
    },
    metricMiniCard: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 10,
        alignItems: 'center',
    },
    metricMiniValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    metricMiniLabel: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '600',
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: 12,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 14,
        paddingVertical: 0,
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingBottom: 28,
    },
    card: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginBottom: 10,
    },
    cardTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '700',
    },
    patientName: {
        fontSize: 16,
        fontWeight: '700',
    },
    metaText: {
        marginTop: 2,
        fontSize: 12,
    },
    metaGrid: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    metaPill: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    metaPillText: {
        fontSize: 11,
        fontWeight: '600',
    },
    summaryText: {
        marginTop: 10,
        fontSize: 12,
        lineHeight: 17,
    },
    actionsRow: {
        marginTop: 12,
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        flex: 1,
        borderRadius: 10,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    primaryActionText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    actionButtonSecondary: {
        minWidth: 110,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    secondaryActionText: {
        fontSize: 12,
        fontWeight: '700',
    },
    centerState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 30,
    },
    emptyTitle: {
        marginTop: 12,
        fontSize: 16,
        fontWeight: '700',
    },
    emptySub: {
        marginTop: 4,
        fontSize: 13,
        textAlign: 'center',
    },
});
