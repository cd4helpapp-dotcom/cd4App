import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    useColorScheme,
    ActivityIndicator,
    RefreshControl,
    Modal,
    Pressable,
} from 'react-native';
import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { Calendar, Clock, Video, Bot, FileText, ExternalLink, Users, MessageCircle, Menu, X, LogOut } from 'lucide-react-native';
import { useDoctorAppointments } from '../../hooks/useAppointment';
import { useDoctorProfile } from '../../hooks/useDoctor';
import { useChatRooms } from '../../hooks/useChat';
import { Appointment } from '../../src/types';
import { useRouter } from 'expo-router';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { buildDoctorInsights } from '../../src/utils/doctorInsights';
import { buildDisplayName } from '../../src/utils/nameSanitizer';
import { clearAppointmentCalendarSync, syncAppointmentWithDeviceCalendar } from '../../services/appointmentCalendar';
import { useLogout } from '../../hooks/useAuth';
import Toast from 'react-native-toast-message';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { downloadAiReport, openAiReport } from '../../src/utils/reportDownload';

const CALENDAR_SYNC_STATUSES: Appointment['status'][] = ['pending', 'confirmed'];
const CALENDAR_CLEAR_STATUSES: Appointment['status'][] = ['cancelled'];

const formatCurrency = (value: number) => {
    const amount = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);
};

const formatDateLabel = (rawDate?: string) => {
    if (!rawDate) return 'Date unavailable';
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const sanitizeFileNamePart = (value: string) =>
    (value || 'patient')
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'patient';


export default function DoctorDashboard() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { user, refreshAuth } = useAuthContext();
    const logoutMutation = useLogout();

    const { data: appointments = [], isLoading, refetch: refetchAppointments, isRefetching } = useDoctorAppointments();
    const { data: chatRooms = [], refetch: refetchRooms } = useChatRooms();
    const { data: doctorProfileResponse, refetch: refetchDoctorProfile } = useDoctorProfile();

    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [menuVisible, setMenuVisible] = React.useState(false);
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-dashboard');

    const insights = useMemo(() => {
        return buildDoctorInsights({
            appointments,
            chatRooms,
            consultationFee: doctorProfileResponse?.data?.fee || 0,
        });
    }, [appointments, chatRooms, doctorProfileResponse?.data?.fee]);

    const metrics = insights.metrics;
    const upcomingAppointments = insights.upcomingList;

    React.useEffect(() => {
        if (!user?.id || !appointments.length) {
            return;
        }

        appointments.forEach((appointment) => {
            if (CALENDAR_CLEAR_STATUSES.includes(appointment.status)) {
                void clearAppointmentCalendarSync({
                    syncKey: `doctor:${user.id}`,
                    appointmentId: appointment._id || appointment.id,
                });
                return;
            }

            if (!CALENDAR_SYNC_STATUSES.includes(appointment.status)) return;

            const slot = appointment.slot as any;
            if (!slot?.date || !slot?.startTime) {
                void clearAppointmentCalendarSync({
                    syncKey: `doctor:${user.id}`,
                    appointmentId: appointment._id || appointment.id,
                });
                return;
            }

            const patientName = buildDisplayName(
                appointment.patient?.firstName,
                appointment.patient?.lastName,
                'Patient'
            );

            void syncAppointmentWithDeviceCalendar({
                syncKey: `doctor:${user.id}`,
                appointmentId: appointment._id || appointment.id,
                title: `Consultation with ${patientName}`,
                date: slot.date,
                startTime: slot.startTime,
                endTime: slot.endTime,
                notes: `CD4 consultation with ${patientName}.`,
                reminderMinutes: 30,
            });
        });
    }, [appointments, user?.id]);

    const onRefresh = async () => {
        setIsRefreshing(true);
        try {
            await Promise.all([
                refetchAppointments(),
                refetchRooms(),
                refetchDoctorProfile(),
            ]);
        } finally {
            setIsRefreshing(false);
        }
    };

    const settingsOptions = [
        { label: 'Profile & Credentials', route: '/doctor/profile-details' as const },
        { label: 'Consultation Fees', route: '/doctor/profile/fees' as const },
        { label: 'Clinic Details', route: '/doctor/profile/clinic' as const },
        { label: 'Notifications', route: '/doctor/notifications' as const },
        { label: 'Storage and Data', route: '/doctor/storage' as const },
        { label: 'App Language', route: '/doctor/language' as const },
        { label: 'Help & Support', route: '/doctor/help' as const },
        { label: 'Open Full Settings', route: '/doctor/settings' as const },
    ];

    const handleOpenMenu = () => setMenuVisible(true);
    const handleCloseMenu = () => setMenuVisible(false);

    const handleOpenSettingsRoute = (route: (typeof settingsOptions)[number]['route']) => {
        setMenuVisible(false);
        router.push(route);
    };

    const handleLogout = async () => {
        try {
            await logoutMutation.mutateAsync();
            await refreshAuth();
            setMenuVisible(false);
            Toast.show({
                type: 'success',
                text1: 'Logged Out',
                text2: 'Goodbye Doctor! 👋',
            });
            router.replace('/auth/login');
        } catch (error) {
            Toast.show({
                type: 'error',
                text1: 'Logout Failed',
                text2: 'Please try again.',
            });
        }
    };

    const metricCards = [
        {
            key: 'upcoming',
            label: 'Upcoming',
            value: String(metrics.upcomingAppointments),
            helper: `${metrics.totalAppointments} total appointments`,
            icon: Calendar,
        },
        {
            key: 'patients',
            label: 'Patients',
            value: String(metrics.totalPatients),
            helper: `${metrics.completedAppointments} completed consults`,
            icon: Users,
        },
        {
            key: 'ai',
            label: 'AI Reports',
            value: String(metrics.aiSummaryCount),
            helper: `${metrics.aiPdfCount} PDFs available`,
            icon: Bot,
        },
        {
            key: 'revenue',
            label: 'Est. Revenue',
            value: formatCurrency(metrics.estimatedRevenue),
            helper: `Realized ${formatCurrency(metrics.realizedRevenue)}`,
            icon: FileText,
        },
    ];

    const renderMetricCard = (card: (typeof metricCards)[number]) => {
        const Icon = card.icon;
        return (
            <View key={card.key} style={[styles.metricCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.metricHeader}>
                    <Icon size={16} color={theme.tint} />
                    <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{card.label}</Text>
                </View>
                <Text numberOfLines={1} style={[styles.metricValue, { color: theme.text }]}>
                    {card.value}
                </Text>
                <Text style={[styles.metricHelper, { color: theme.textSecondary }]} numberOfLines={1}>
                    {card.helper}
                </Text>
            </View>
        );
    };

    const renderAppointment = ({ item }: { item: Appointment }) => {
        const slot = item.slot as any;
        const formattedDate = formatDateLabel(slot?.date || item.createdAt);
        const timeLabel = slot?.startTime && slot?.endTime ? `${slot.startTime} - ${slot.endTime}` : 'Time not set';
        const patientName = buildDisplayName(item.patient.firstName, item.patient.lastName, 'Patient');
        const reportFileName = `cd4-ai-report-${sanitizeFileNamePart(patientName)}-${sanitizeFileNamePart(formattedDate)}.pdf`;

        return (
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                activeOpacity={0.9}
                onPress={() =>
                    router.push({
                        pathname: '/chat-detail',
                        params: {
                            otherId: item.patient._id,
                            name: patientName,
                        },
                    })
                }
            >
                <View style={styles.cardHeader}>
                    <View style={styles.patientInfoRow}>
                        <View style={[styles.avatarPlaceholder, { backgroundColor: theme.tint + '20' }]}>
                            <Text style={[styles.avatarText, { color: theme.tint }]}>
                                {item.patient.firstName?.charAt(0) || 'P'}
                            </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.patientName, { color: theme.text }]} numberOfLines={1}>
                                {patientName}
                            </Text>
                            <Text style={[styles.patientAge, { color: theme.textSecondary }]}>
                                {item.patient.age ? `${item.patient.age} years` : 'Age not shared'}
                            </Text>
                        </View>
                    </View>
                </View>

                {item.aiReport?.summary || item.aiReport?.pdf_url ? (
                    <View style={[styles.aiSummaryBox, { backgroundColor: theme.tint + '08', borderColor: theme.tint + '20' }]}>
                        <View style={styles.aiSummaryHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <Bot size={14} color={theme.tint} style={{ marginRight: 6 }} />
                                <Text style={[styles.aiSummaryTitle, { color: theme.tint }]}>AI Triage Summary</Text>
                            </View>
                            {item.aiReport?.pdf_url ? (
                                <TouchableOpacity
                                    style={styles.pdfBadge}
                                    onPress={() => {
                                        void openAiReport(item.aiReport?.pdf_url || '').catch((error) => {
                                            console.warn('Failed to open/download AI report PDF:', error);
                                            Toast.show({
                                                type: 'error',
                                                text1: 'PDF unavailable',
                                                text2: 'Could not open the AI report right now.',
                                            });
                                        });
                                    }}
                                    onLongPress={() => {
                                        void downloadAiReport(item.aiReport?.pdf_url || '', reportFileName).then(() => {
                                            Toast.show({
                                                type: 'success',
                                                text1: 'Downloading PDF',
                                                text2: 'AI report download has started.',
                                            });
                                        }).catch((error) => {
                                            console.warn('Failed to download AI report PDF:', error);
                                            Toast.show({
                                                type: 'error',
                                                text1: 'Download failed',
                                                text2: 'Could not download the AI report right now.',
                                            });
                                        });
                                    }}
                                    delayLongPress={260}
                                >
                                    <FileText size={12} color={theme.tint} style={{ marginRight: 4 }} />
                                    <Text style={[styles.pdfBadgeText, { color: theme.tint }]}>PDF</Text>
                                    <ExternalLink size={10} color={theme.tint} style={{ marginLeft: 2 }} />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                        <Text style={[styles.aiSummaryText, { color: theme.text }]} numberOfLines={3}>
                            {item.aiReport?.summary || 'AI consultation PDF is attached for this appointment.'}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.cardFooter}>
                    <View style={styles.timeSlot}>
                        <Calendar size={16} color={theme.tint} style={{ marginRight: 6 }} />
                        <Text style={[styles.timeText, { color: theme.text }]}>{formattedDate}</Text>
                    </View>
                    <View style={styles.timeSlot}>
                        <Clock size={16} color={theme.tint} style={{ marginRight: 6 }} />
                        <Text style={[styles.timeText, { color: theme.text }]}>{timeLabel}</Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.consultButton, { backgroundColor: theme.tint }]}
                    onPress={() =>
                        router.push({
                            pathname: '/chat-detail',
                            params: {
                                otherId: item.patient._id,
                                name: patientName,
                            },
                        })
                    }
                >
                    <Video size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.consultButtonText}>Consult Now</Text>
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    const isFirstLoad = isLoading && appointments.length === 0 && !isRefetching;

    return (
        <DoctorSafeScreen backgroundColor={theme.background} panHandlers={tabSwipeHandlers}>
            {isFirstLoad ? (
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color={theme.tint} />
                </View>
            ) : (
                <FlatList
                    data={upcomingAppointments}
                    keyExtractor={(item) => item._id || item.id}
                    renderItem={renderAppointment}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={onRefresh}
                            colors={[theme.tint]}
                            tintColor={theme.tint}
                        />
                    }
                    ListHeaderComponent={
                        <View>
                            <View style={styles.welcomeSection}>
                                <Text style={[styles.doctorName, { color: theme.text }]}>Dr. {user?.firstName} {user?.lastName}</Text>
                                <Text style={[styles.welcomeSubtext, { color: theme.textSecondary }]}>
                                    Track your clinic performance and consult faster.
                                </Text>
                            </View>

                            <View style={styles.metricGrid}>{metricCards.map(renderMetricCard)}</View>

                            <View style={styles.quickActionsRow}>
                                <TouchableOpacity
                                    style={[styles.quickActionButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                                    onPress={() => router.push('/doctor/chats')}
                                >
                                    <MessageCircle size={16} color={theme.tint} />
                                    <Text style={[styles.quickActionText, { color: theme.text }]}>Open Chats</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.quickActionButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                                    onPress={() => router.push('/doctor/patients')}
                                >
                                    <Users size={16} color={theme.tint} />
                                    <Text style={[styles.quickActionText, { color: theme.text }]}>Patient List</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={[styles.sectionTitle, { color: theme.text }]}>Upcoming Appointments</Text>
                        </View>
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Calendar size={48} color={theme.textSecondary} />
                            <Text style={[styles.emptyStateText, { color: theme.textSecondary }]}>No upcoming appointments</Text>
                            <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
                                New confirmed bookings will appear here automatically.
                            </Text>
                        </View>
                    }
                />
            )}

            <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={handleCloseMenu}>
                <View style={styles.drawerRoot}>
                    <Pressable style={styles.drawerBackdrop} onPress={handleCloseMenu} />
                    <View style={[styles.drawerPanel, { backgroundColor: theme.cardBackground, borderRightColor: theme.borderColor }]}>
                        <View style={[styles.drawerHeader, { borderBottomColor: theme.borderColor }]}>
                            <Text style={[styles.drawerTitle, { color: theme.text }]}>Doctor Menu</Text>
                            <TouchableOpacity style={styles.drawerCloseButton} onPress={handleCloseMenu}>
                                <X size={18} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.drawerProfileCard, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                            <Text style={[styles.drawerDoctorName, { color: theme.text }]} numberOfLines={1}>
                                Dr. {user?.firstName} {user?.lastName}
                            </Text>
                            <Text style={[styles.drawerDoctorHint, { color: theme.textSecondary }]}>
                                Manage your profile and app settings.
                            </Text>
                        </View>

                        <View style={styles.drawerOptionList}>
                            {settingsOptions.map((option, index) => (
                                <TouchableOpacity
                                    key={option.label}
                                    style={[
                                        styles.drawerOptionRow,
                                        {
                                            borderBottomColor: theme.borderColor,
                                            borderBottomWidth: index === settingsOptions.length - 1 ? 0 : StyleSheet.hairlineWidth,
                                        },
                                    ]}
                                    onPress={() => handleOpenSettingsRoute(option.route)}
                                >
                                    <Text style={[styles.drawerOptionText, { color: theme.text }]}>{option.label}</Text>
                                    <Text style={[styles.drawerChevron, { color: theme.textSecondary }]}>›</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={[styles.drawerLogoutBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                            onPress={handleLogout}
                            disabled={logoutMutation.isPending}
                        >
                            {logoutMutation.isPending ? (
                                <ActivityIndicator color="#e74c3c" />
                            ) : (
                                <>
                                    <LogOut size={16} color="#e74c3c" style={{ marginRight: 8 }} />
                                    <Text style={styles.drawerLogoutText}>Log Out</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    welcomeSection: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 6,
    },
    welcomeHeaderRow: {
        marginBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    menuButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    welcomeText: {
        fontSize: 15,
    },
    doctorName: {
        fontSize: 24,
        fontWeight: '800',
        marginTop: 2,
    },
    welcomeSubtext: {
        marginTop: 6,
        fontSize: 13,
    },
    metricGrid: {
        paddingHorizontal: 20,
        paddingTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    metricCard: {
        width: '48%',
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
    },
    metricHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    metricLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    metricValue: {
        marginTop: 8,
        fontSize: 20,
        fontWeight: '800',
    },
    metricHelper: {
        marginTop: 2,
        fontSize: 11,
    },
    quickActionsRow: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    quickActionButton: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        gap: 6,
    },
    quickActionText: {
        fontSize: 13,
        fontWeight: '700',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginHorizontal: 20,
        marginTop: 16,
        marginBottom: 12,
    },
    listContainer: {
        paddingBottom: 30,
    },
    card: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        marginHorizontal: 20,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    patientInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    avatarPlaceholder: {
        width: 46,
        height: 46,
        borderRadius: 23,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    patientName: {
        fontSize: 17,
        fontWeight: '600',
        marginBottom: 2,
    },
    patientAge: {
        fontSize: 13,
    },
    aiSummaryBox: {
        borderRadius: 12,
        padding: 12,
        marginTop: 12,
        marginBottom: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    aiSummaryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    aiSummaryTitle: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    aiSummaryText: {
        fontSize: 13,
        lineHeight: 18,
    },
    pdfBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    pdfBadgeText: {
        fontSize: 11,
        fontWeight: 'bold',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        flexWrap: 'wrap',
        marginBottom: 14,
        gap: 12,
    },
    timeSlot: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeText: {
        fontSize: 14,
        fontWeight: '500',
    },
    consultButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 12,
    },
    consultButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 56,
        paddingHorizontal: 20,
    },
    emptyStateText: {
        marginTop: 16,
        fontSize: 16,
        fontWeight: '700',
    },
    emptyStateSubtext: {
        marginTop: 6,
        fontSize: 13,
        textAlign: 'center',
    },
    drawerRoot: {
        flex: 1,
        flexDirection: 'row',
    },
    drawerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    drawerPanel: {
        width: '78%',
        maxWidth: 340,
        borderRightWidth: 1,
        paddingTop: 24,
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    drawerHeader: {
        minHeight: 42,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    drawerTitle: {
        fontSize: 18,
        fontWeight: '800',
    },
    drawerCloseButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    drawerProfileCard: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        marginBottom: 12,
    },
    drawerDoctorName: {
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 4,
    },
    drawerDoctorHint: {
        fontSize: 12,
        lineHeight: 18,
    },
    drawerOptionList: {
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 14,
    },
    drawerOptionRow: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 2,
        paddingVertical: 8,
    },
    drawerOptionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    drawerChevron: {
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 8,
    },
    drawerLogoutBtn: {
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    drawerLogoutText: {
        color: '#e74c3c',
        fontSize: 14,
        fontWeight: '700',
    },
});

