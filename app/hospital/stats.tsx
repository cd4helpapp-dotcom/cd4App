import React from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Stethoscope, Users, Mic, BarChart3, TrendingUp, ChevronRight, CheckCircle2, Clipboard } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalDoctors, useHospitalPatients, useHospitalStats, useHospitalVoiceIntakes } from '../../hooks/useHospital';

export default function HospitalStatsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const statsQuery = useHospitalStats();
    const doctorsQuery = useHospitalDoctors();
    const patientsQuery = useHospitalPatients();
    const voiceQuery = useHospitalVoiceIntakes();

    const isLoading = statsQuery.isLoading || doctorsQuery.isLoading || patientsQuery.isLoading || voiceQuery.isLoading;
    const isRefreshing = statsQuery.isRefetching || doctorsQuery.isRefetching || patientsQuery.isRefetching || voiceQuery.isRefetching;

    const refreshAll = React.useCallback(() => {
        void statsQuery.refetch();
        void doctorsQuery.refetch();
        void patientsQuery.refetch();
        void voiceQuery.refetch();
    }, [statsQuery, doctorsQuery, patientsQuery, voiceQuery]);

    if (isLoading) {
        return (
            <View style={[styles.center, { backgroundColor: theme.background }]}>
                <ActivityIndicator color={theme.tint} size="large" />
            </View>
        );
    }

    const stats = statsQuery.data;
    const doctors = doctorsQuery.data || [];
    const patients = patientsQuery.data || [];
    const voiceIntakes = voiceQuery.data || [];

    // Calculate Specializations breakdown
    const specCounts: Record<string, number> = {};
    doctors.forEach((doc) => {
        const spec = doc.specialization?.trim() || 'General Practice';
        specCounts[spec] = (specCounts[spec] || 0) + 1;
    });
    const sortedSpecs = Object.entries(specCounts).sort((a, b) => b[1] - a[1]);

    // Calculate Voice Intake metrics
    const totalVoice = voiceIntakes.length;
    const completedVoice = voiceIntakes.filter((v) => v.status === 'completed' || v.status === 'ready').length;
    const pendingVoice = totalVoice - completedVoice;
    const completionRate = totalVoice > 0 ? Math.round((completedVoice / totalVoice) * 100) : 0;

    // Calculate Patient assignment stats
    const assignedPatients = patients.filter((p) => !!p.doctorId).length;
    const unassignedPatients = patients.length - assignedPatients;

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} tintColor={theme.tint} />}
        >
            <View style={styles.header}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Analytics</Text>
                    <Text style={[styles.title, { color: theme.text }]}>Stats</Text>
                </View>
            </View>
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginBottom: 20 }]}>
                Performance tracking and breakdown metrics for your facility.
            </Text>

            {/* Quick Metrics Cards */}
            <View style={styles.statsRow}>
                <StatCard title="Doctors" value={stats?.doctors ?? 0} icon={Stethoscope} theme={theme} onPress={() => router.push('/hospital/doctors')} />
                <StatCard title="Patients" value={stats?.patients ?? 0} icon={Users} theme={theme} onPress={() => router.push('/hospital/patients')} />
                <StatCard title="Voice Sessions" value={stats?.voiceIntakes ?? 0} icon={Mic} theme={theme} onPress={() => router.push('/hospital/dashboard')} />
            </View>

            {/* Voice Intake Summary Analytics */}
            <View style={[styles.analyticsCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.cardHeaderRow}>
                    <View style={[styles.iconBadge, { backgroundColor: theme.successLight }]}>
                        <TrendingUp size={18} color={theme.tint} />
                    </View>
                    <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>Voice Summary Metrics</Text>
                </View>

                <View style={styles.progressBarWrapper}>
                    <View style={styles.progressTextRow}>
                        <Text style={[styles.progressLabel, { color: theme.textSecondary }]}>AI Summaries Completed</Text>
                        <Text style={[styles.progressPercentage, { color: theme.tint }]}>{completionRate}%</Text>
                    </View>
                    <View style={[styles.progressBarBg, { backgroundColor: theme.borderColor }]}>
                        <View style={[styles.progressBarFill, { backgroundColor: theme.tint, width: `${completionRate}%` }]} />
                    </View>
                </View>

                <View style={styles.metricDetailsRow}>
                    <View style={styles.detailItem}>
                        <Text style={[styles.detailValue, { color: theme.text }]}>{completedVoice}</Text>
                        <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Completed</Text>
                    </View>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailItem}>
                        <Text style={[styles.detailValue, { color: theme.text }]}>{pendingVoice}</Text>
                        <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Pending / Draft</Text>
                    </View>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailItem}>
                        <Text style={[styles.detailValue, { color: theme.text }]}>{totalVoice}</Text>
                        <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Total Sessions</Text>
                    </View>
                </View>
            </View>

            {/* Doctor Specialization Breakdown */}
            <View style={[styles.analyticsCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.cardHeaderRow}>
                    <View style={[styles.iconBadge, { backgroundColor: theme.successLight }]}>
                        <BarChart3 size={18} color={theme.tint} />
                    </View>
                    <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>Doctors by Specialization</Text>
                </View>

                {sortedSpecs.length > 0 ? (
                    <View style={styles.specList}>
                        {sortedSpecs.map(([spec, count]) => (
                            <View key={spec} style={[styles.specRow, { borderBottomColor: theme.borderColor }]}>
                                <Text style={[styles.specName, { color: theme.text }]}>{spec}</Text>
                                <View style={[styles.specBadge, { backgroundColor: theme.successLight }]}>
                                    <Text style={[styles.specBadgeText, { color: theme.tint }]}>{count} linked</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No doctor specialization data available.</Text>
                )}
            </View>

            {/* Patient Assignment Analytics */}
            <View style={[styles.analyticsCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, marginBottom: 20 }]}>
                <View style={styles.cardHeaderRow}>
                    <View style={[styles.iconBadge, { backgroundColor: theme.successLight }]}>
                        <CheckCircle2 size={18} color={theme.tint} />
                    </View>
                    <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>Patient Assignment Rates</Text>
                </View>

                <View style={styles.assignmentStatRow}>
                    <View style={styles.assignmentStatItem}>
                        <View style={[styles.statDot, { backgroundColor: theme.tint }]} />
                        <Text style={[styles.assignmentLabel, { color: theme.text }]}>Assigned to Doctor</Text>
                        <Text style={[styles.assignmentValue, { color: theme.textSecondary }]}>{assignedPatients}</Text>
                    </View>
                    <View style={styles.assignmentStatItem}>
                        <View style={[styles.statDot, { backgroundColor: theme.textSecondary }]} />
                        <Text style={[styles.assignmentLabel, { color: theme.text }]}>Unassigned</Text>
                        <Text style={[styles.assignmentValue, { color: theme.textSecondary }]}>{unassignedPatients}</Text>
                    </View>
                </View>
            </View>
        </ScrollView>
    );
}

function StatCard({
    title,
    value,
    icon: Icon,
    theme,
    onPress,
}: {
    title: string;
    value: string | number;
    icon: any;
    theme: any;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.statCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={[styles.statIconWrap, { backgroundColor: theme.successLight }]}>
                <Icon size={16} color={theme.tint} />
            </View>
            <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>
                {value}
            </Text>
            <View style={styles.statFooter}>
                <Text style={[styles.statTitle, { color: theme.textSecondary }]}>{title}</Text>
                <ChevronRight size={12} color={theme.textSecondary} style={{ marginLeft: 2 }} />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 34 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 6 },
    kicker: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
    title: { fontSize: 28, fontWeight: '900', lineHeight: 34 },
    subtitle: { marginTop: 6, fontSize: 14, fontWeight: '600' },
    statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4, marginBottom: 20 },
    statCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 12, alignItems: 'flex-start' },
    statValue: { marginTop: 6, fontSize: 22, fontWeight: '900' },
    statTitle: { fontSize: 11, fontWeight: '700' },
    statIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
    statFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 2, width: '100%', justifyContent: 'space-between' },
    analyticsCard: { borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 16 },
    cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    iconBadge: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    cardHeaderTitle: { fontSize: 16, fontWeight: '900' },
    progressBarWrapper: { marginBottom: 18 },
    progressTextRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    progressLabel: { fontSize: 13, fontWeight: '700' },
    progressPercentage: { fontSize: 15, fontWeight: '900' },
    progressBarBg: { height: 8, borderRadius: 99, overflow: 'hidden' },
    progressBarFill: { height: '100%', borderRadius: 99 },
    metricDetailsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 8 },
    detailItem: { alignItems: 'center' },
    detailValue: { fontSize: 16, fontWeight: '900' },
    detailLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
    detailDivider: { width: 1, height: 24, backgroundColor: '#E2E8F0', opacity: 0.5 },
    specList: { marginTop: 4 },
    specRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderWidth: 0, borderBottomWidth: 1 },
    specName: { fontSize: 13, fontWeight: '800' },
    specBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    specBadgeText: { fontSize: 11, fontWeight: '800' },
    emptyText: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 12 },
    assignmentStatRow: { gap: 12, marginTop: 4 },
    assignmentStatItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statDot: { width: 8, height: 8, borderRadius: 4 },
    assignmentLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
    assignmentValue: { fontSize: 13, fontWeight: '800' },
});
