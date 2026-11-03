import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AlertCircle, Bot, Calendar, CalendarX, ChevronRight, Clock, FileText, IndianRupee, MessageCircle, Users, Video } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAuthContext } from '../../context/AuthContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useCancelAppointment, useDoctorAppointments } from '../../hooks/useAppointment';
import { useDoctorEarnings, useDoctorProfile } from '../../hooks/useDoctor';
import { useChatRooms } from '../../hooks/useChat';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { Appointment } from '../../src/types';
import { confirmAction } from '../../src/utils/confirm';
import { buildDoctorInsights } from '../../src/utils/doctorInsights';
import { buildDisplayName } from '../../src/utils/nameSanitizer';
import { downloadAiReport, openAiReport } from '../../src/utils/reportDownload';
import { formatClock, slotMoment } from '../../src/utils/slotTime';
import { clearAppointmentCalendarSync, syncAppointmentWithDeviceCalendar } from '../../services/appointmentCalendar';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { PersonInitial, readableSummary, StatTile } from '../../ui/doctor/DoctorUI';

const CALENDAR_SYNC_STATUSES: Appointment['status'][] = ['pending', 'confirmed'];
const CALENDAR_CLEAR_STATUSES: Appointment['status'][] = ['cancelled'];

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);

const sanitizeFileNamePart = (value: string) =>
    (value || 'patient')
        .trim()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'patient';

const greeting = () => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

const dayLabel = (date?: string) => {
    if (!date) return 'Date not set';
    const [y, m, d] = date.slice(0, 10).split('-').map(Number);
    const value = new Date(y, m - 1, d);
    const startOf = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
    const diff = Math.round((startOf(value) - startOf(new Date())) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return value.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function DoctorDashboard() {
    const router = useRouter();
    const { theme } = useAppTheme();
    const { user } = useAuthContext();

    const {
        data: appointments = [],
        isLoading,
        isError: isAppointmentsError,
        error: appointmentsError,
        refetch: refetchAppointments,
        isRefetching,
    } = useDoctorAppointments();
    const { data: chatRooms = [], refetch: refetchRooms } = useChatRooms();
    const { data: doctorProfileResponse, refetch: refetchDoctorProfile } = useDoctorProfile();
    const { data: earnings, refetch: refetchEarnings } = useDoctorEarnings();
    const cancelMutation = useCancelAppointment();

    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-dashboard');

    const insights = useMemo(
        () => buildDoctorInsights({ appointments, chatRooms, consultationFee: doctorProfileResponse?.data?.fee || 0 }),
        [appointments, chatRooms, doctorProfileResponse?.data?.fee]
    );
    const metrics = insights.metrics;
    const upcoming = useMemo(() => {
        const startOf = (item: Appointment) => slotMoment((item.slot as any)?.date, (item.slot as any)?.startTime);
        return [...insights.upcomingList].sort((a, b) => startOf(a) - startOf(b));
    }, [insights.upcomingList]);

    React.useEffect(() => {
        if (!user?.id || !appointments.length) return;

        appointments.forEach((appointment) => {
            if (CALENDAR_CLEAR_STATUSES.includes(appointment.status)) {
                void clearAppointmentCalendarSync({ syncKey: `doctor:${user.id}`, appointmentId: appointment._id || appointment.id });
                return;
            }
            if (!CALENDAR_SYNC_STATUSES.includes(appointment.status)) return;

            const slot = appointment.slot as any;
            if (!slot?.date || !slot?.startTime) {
                void clearAppointmentCalendarSync({ syncKey: `doctor:${user.id}`, appointmentId: appointment._id || appointment.id });
                return;
            }

            const patientName = buildDisplayName(appointment.patient?.firstName, appointment.patient?.lastName, 'Patient');
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
            await Promise.all([refetchAppointments(), refetchRooms(), refetchDoctorProfile(), refetchEarnings()]);
        } finally {
            setIsRefreshing(false);
        }
    };

    const openConsult = (item: Appointment, patientName: string) => {
        const patientId = item.patient?._id || item.patient?.id;
        if (!patientId) {
            Toast.show({ type: 'error', text1: 'Patient unavailable', text2: 'This patient profile is no longer available.' });
            return;
        }
        router.push({ pathname: '/chat-detail', params: { otherId: patientId, name: patientName } });
    };

    const openPdf = (item: Appointment) => {
        void openAiReport(item.aiReport?.pdf_url || '').catch((error) => {
            console.warn('Failed to open/download AI report PDF:', error);
            Toast.show({ type: 'error', text1: 'PDF unavailable', text2: 'Could not open the patient summary right now.' });
        });
    };

    const downloadPdf = (item: Appointment, patientName: string, when: string) => {
        const fileName = `cd4-summary-${sanitizeFileNamePart(patientName)}-${sanitizeFileNamePart(when)}.pdf`;
        void downloadAiReport(item.aiReport?.pdf_url || '', fileName)
            .then(() => Toast.show({ type: 'success', text1: 'Downloading PDF', text2: 'Patient summary download has started.' }))
            .catch(() => Toast.show({ type: 'error', text1: 'Download failed', text2: 'Could not download the summary right now.' }));
    };

    const handleCancel = async (item: Appointment, patientName: string) => {
        const ok = await confirmAction({
            title: 'Cancel this consultation?',
            message: `${patientName} will get a full refund and be told to book another slot. This time stays closed for new bookings.`,
            confirmText: 'Cancel consultation',
            cancelText: 'Keep it',
            destructive: true,
        });
        if (!ok) return;
        cancelMutation.mutate(
            { appointmentId: item._id || item.id, doctorId: user?.id || '' },
            {
                onSuccess: () => Toast.show({ type: 'success', text1: 'Consultation cancelled', text2: 'The patient has been told and refunded.' }),
                onError: (error: any) =>
                    Toast.show({
                        type: 'error',
                        text1: 'Could not cancel',
                        text2: error?.code === 'already_started' ? 'This consultation has already started.' : 'Please try again in a moment.',
                    }),
            }
        );
    };

    const renderAppointment = ({ item }: { item: Appointment }) => {
        const slot = item.slot as any;
        const patient = item.patient;
        const when = `${dayLabel(slot?.date)} · ${slot?.startTime ? formatClock(slot.startTime) : 'Time not set'}${slot?.endTime ? ` – ${formatClock(slot.endTime)}` : ''}`;
        const patientName = buildDisplayName(patient?.firstName, patient?.lastName, 'Patient');
        const summary = readableSummary(item.aiReport?.summary);
        const hasPdf = Boolean(item.aiReport?.pdf_url);
        const patientMeta = [patient?.age ? `${patient.age} years` : '', item.appointmentType === 'second_opinion' ? 'Second opinion' : ''].filter(Boolean).join(' · ');
        const patientAvailable = Boolean(patient?._id || patient?.id);
        const status = String(item.status || 'pending').toLowerCase();
        const statusTone = status === 'confirmed'
            ? { backgroundColor: theme.successLight, color: theme.success, label: 'Confirmed' }
            : status === 'completed'
                ? { backgroundColor: theme.primarySoft, color: theme.primary, label: 'Completed' }
                : status === 'cancelled'
                    ? { backgroundColor: theme.dangerSoft, color: theme.danger, label: 'Cancelled' }
                    : { backgroundColor: theme.warningSoft, color: theme.warning, label: 'Pending' };

        return (
            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                <View style={styles.row}>
                    <PersonInitial name={patientName} />
                    <View style={styles.flex}>
                        <Text style={[Typography.subheading, { color: theme.text }]} numberOfLines={1}>{patientName}</Text>
                        {patientMeta ? <Text style={[Typography.caption, { color: theme.textSecondary }]}>{patientMeta}</Text> : null}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusTone.backgroundColor }]}>
                        <Text style={[styles.statusBadgeText, { color: statusTone.color }]}>{statusTone.label}</Text>
                    </View>
                </View>

                <View style={[styles.when, { backgroundColor: theme.primarySoft }]}>
                    <Clock size={15} color={theme.primary} />
                    <Text style={[Typography.label, styles.flex, { color: theme.primary }]} numberOfLines={1}>{when}</Text>
                </View>

                {summary || hasPdf ? (
                    <View style={styles.summary}>
                        <View style={styles.row}>
                            <Bot size={14} color={theme.textSecondary} />
                            <Text style={[Typography.overline, styles.flex, { color: theme.textSecondary }]}>PATIENT SUMMARY</Text>
                        </View>
                        <Text style={[Typography.body, { color: theme.text }]} numberOfLines={3}>
                            {summary || 'A summary PDF is attached for this appointment.'}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.actions}>
                    <Pressable
                        onPress={() => openConsult(item, patientName)}
                        disabled={!patientAvailable}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !patientAvailable }}
                        style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }, !patientAvailable && { opacity: 0.55 }]}
                    >
                        <Video size={16} color="#FFFFFF" />
                        <Text style={styles.primaryActionText}>{patientAvailable ? 'Consult' : 'Unavailable'}</Text>
                    </Pressable>
                    {hasPdf ? (
                        <Pressable
                            onPress={() => openPdf(item)}
                            onLongPress={() => downloadPdf(item, patientName, when)}
                            delayLongPress={260}
                            accessibilityRole="button"
                            accessibilityHint="Long press to download"
                            style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.primaryBorder, backgroundColor: pressed ? theme.primaryBorder : theme.primarySoft }]}
                        >
                            <FileText size={15} color={theme.primary} />
                            <Text style={[Typography.label, { color: theme.primary }]}>PDF</Text>
                        </Pressable>
                    ) : null}
                    <Pressable
                        onPress={() => handleCancel(item, patientName)}
                        disabled={cancelMutation.isPending}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel consultation with ${patientName}`}
                        style={({ pressed }) => [styles.iconAction, { borderColor: theme.borderColor, backgroundColor: pressed ? theme.dangerSoft : theme.cardBackground }]}
                    >
                        <CalendarX size={17} color={theme.danger} />
                    </Pressable>
                </View>
            </View>
        );
    };

    const isFirstLoad = isLoading && appointments.length === 0 && !isRefetching;
    const doctorName = buildDisplayName(user?.firstName, user?.lastName, 'Doctor').replace(/^Dr\.?\s+/i, '');
    const todayCount = upcoming.filter((item) => dayLabel((item.slot as any)?.date) === 'Today').length;

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']} panHandlers={tabSwipeHandlers}>
            {isFirstLoad ? (
                <View style={styles.loader}>
                    <ActivityIndicator size="large" color={theme.primary} />
                </View>
            ) : (
                <FlatList
                    data={upcoming}
                    keyExtractor={(item) => item._id || item.id}
                    renderItem={renderAppointment}
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={[theme.primary]} tintColor={theme.primary} />}
                    ListHeaderComponent={
                        <View style={styles.header}>
                            <View>
                                <Text style={[Typography.body, { color: theme.textSecondary }]}>{greeting()},</Text>
                                <Text style={[Typography.title, { color: theme.text }]} numberOfLines={2}>Dr. {doctorName}</Text>
                                <Text style={[Typography.body, { color: theme.textSecondary }]}>
                                    {todayCount > 0
                                        ? `${todayCount} consultation${todayCount === 1 ? '' : 's'} today`
                                        : metrics.upcomingAppointments > 0
                                            ? 'No consultations today'
                                            : 'Your schedule is clear'}
                                </Text>
                            </View>

                            <View style={styles.tiles}>
                                <StatTile icon={Calendar} label="Upcoming" value={String(metrics.upcomingAppointments)} hint={`${metrics.totalAppointments} in total`} onPress={() => router.push('/doctor/slots')} />
                                <StatTile icon={Users} label="Patients" value={String(metrics.totalPatients)} hint={`${metrics.completedAppointments} consulted`} onPress={() => router.push('/doctor/patients')} />
                                <StatTile icon={Bot} label="Patient summaries" value={String(metrics.aiPdfCount)} hint="Ready to read" onPress={() => router.push('/doctor/patients')} />
                                <StatTile icon={MessageCircle} label="Chats" value={String(chatRooms.length)} hint="With your patients" onPress={() => router.push('/doctor/chats')} />
                            </View>

                            <Pressable
                                onPress={() => router.push('/doctor/transactions')}
                                accessibilityRole="button"
                                style={({ pressed }) => [styles.earnings, { backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}
                            >
                                <View style={styles.row}>
                                    <View style={[styles.earningsIcon, { backgroundColor: theme.primarySoft }]}>
                                        <IndianRupee size={18} color={theme.primary} />
                                    </View>
                                    <View style={styles.flex}>
                                        <Text style={[Typography.caption, { color: theme.textSecondary }]}>Your earnings</Text>
                                        <Text style={[Typography.title, { color: theme.text }]} numberOfLines={1}>{formatCurrency(earnings?.doctorPayout || 0)}</Text>
                                    </View>
                                    <ChevronRight size={20} color={theme.textTertiary} />
                                </View>
                                <View style={[styles.earningsRow, { borderTopColor: theme.divider }]}>
                                    <View style={styles.flex}>
                                        <Text style={[Typography.caption, { color: theme.textSecondary }]}>Paid to you</Text>
                                        <Text style={[Typography.bodyStrong, { color: theme.text }]}>{formatCurrency(earnings?.settledPayout || 0)}</Text>
                                    </View>
                                    <View style={styles.flex}>
                                        <Text style={[Typography.caption, { color: theme.textSecondary }]}>Pending</Text>
                                        <Text style={[Typography.bodyStrong, { color: theme.text }]}>{formatCurrency(earnings?.pendingPayout || 0)}</Text>
                                    </View>
                                    <View style={styles.flex}>
                                        <Text style={[Typography.caption, { color: theme.textSecondary }]}>Consultations</Text>
                                        <Text style={[Typography.bodyStrong, { color: theme.text }]}>{earnings?.paidConsultations || 0}</Text>
                                    </View>
                                </View>
                            </Pressable>

                            <Text style={[Typography.heading, { color: theme.text }]}>Upcoming consultations</Text>
                        </View>
                    }
                    ListEmptyComponent={
                        isAppointmentsError ? (
                            <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSoft || '#FEE2E2' }]}>
                                    <AlertCircle size={26} color={theme.danger} />
                                </View>
                                <Text style={[Typography.subheading, { color: theme.text }]}>Could not load consultations</Text>
                                <Text style={[Typography.body, styles.emptyText, { color: theme.textSecondary }]}>
                                    {appointmentsError?.message || 'Something went wrong while fetching your appointments.'}
                                </Text>
                                <Pressable
                                    onPress={() => {
                                        void refetchAppointments();
                                        void refetchEarnings();
                                    }}
                                    accessibilityRole="button"
                                    style={[styles.emptyCta, { backgroundColor: theme.buttonPrimary }]}
                                >
                                    <Text style={styles.primaryActionText}>Retry</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
                                    <Calendar size={26} color={theme.primary} />
                                </View>
                                <Text style={[Typography.subheading, { color: theme.text }]}>No upcoming consultations</Text>
                                <Text style={[Typography.body, styles.emptyText, { color: theme.textSecondary }]}>Add open slots so patients can book you.</Text>
                                <Pressable onPress={() => router.push('/doctor/slots')} accessibilityRole="button" style={[styles.emptyCta, { backgroundColor: theme.buttonPrimary }]}>
                                    <Text style={styles.primaryActionText}>Manage slots</Text>
                                </Pressable>
                            </View>
                        )
                    }
                />
            )}
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: Layout.screenGutter, paddingBottom: Spacing.xxxl, gap: Spacing.md, width: '100%', maxWidth: Layout.contentMaxWidth, alignSelf: 'center' },
    header: { paddingTop: Spacing.lg, gap: Spacing.lg },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    statusBadge: { borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
    statusBadgeText: { fontSize: 10, fontWeight: '800' },
    earnings: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
    earningsIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.xs },
    earningsRow: { flexDirection: 'row', gap: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: Spacing.md },
    card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
    when: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 38 },
    summary: { gap: Spacing.xs },
    actions: { flexDirection: 'row', gap: Spacing.sm },
    primaryAction: { flex: 1, height: 44, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    primaryActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    secondaryAction: { height: 44, paddingHorizontal: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    iconAction: { width: 44, height: 44, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
    emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
    emptyText: { textAlign: 'center' },
    emptyCta: { marginTop: Spacing.sm, height: 44, paddingHorizontal: Spacing.xl, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
