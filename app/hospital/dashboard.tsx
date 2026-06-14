import React from 'react';
import {
    ActivityIndicator,
    Linking,
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
import { Building2, ClipboardList, Clock, ExternalLink, Mail, MapPin, Mic, Phone, Settings, Stethoscope, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useHospitalDoctors, useHospitalPatients, useHospitalProfile, useHospitalStats, useHospitalVoiceIntakes } from '../../hooks/useHospital';

const formatStatus = (value?: string) =>
    (value || 'pending')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

const joinReadable = (items: Array<string | undefined>) => items.map((item) => item?.trim()).filter(Boolean).join(', ');

export default function HospitalDashboard() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuthContext();

    const profileQuery = useHospitalProfile();
    const statsQuery = useHospitalStats();
    const doctorsQuery = useHospitalDoctors();
    const patientsQuery = useHospitalPatients();
    const voiceQuery = useHospitalVoiceIntakes();

    const isLoading = profileQuery.isLoading || statsQuery.isLoading;
    const isRefreshing =
        profileQuery.isRefetching ||
        statsQuery.isRefetching ||
        doctorsQuery.isRefetching ||
        patientsQuery.isRefetching ||
        voiceQuery.isRefetching;

    const refreshAll = React.useCallback(() => {
        void profileQuery.refetch();
        void statsQuery.refetch();
        void doctorsQuery.refetch();
        void patientsQuery.refetch();
        void voiceQuery.refetch();
    }, [doctorsQuery, patientsQuery, profileQuery, statsQuery, voiceQuery]);

    const profile = profileQuery.data;
    const stats = statsQuery.data;
    const recentDoctors = (doctorsQuery.data || []).slice(0, 3);
    const recentVoice = (voiceQuery.data || []).slice(0, 3);
    const addressText = profile
        ? joinReadable([profile.fullAddress, profile.city, profile.state, profile.pinCode])
        : '';
    const serviceText =
        profile?.specialities?.length
            ? profile.specialities.slice(0, 4).join(', ')
            : profile?.facilities?.length
                ? profile.facilities.slice(0, 4).join(', ')
                : 'Services not updated';
    const contactText = profile?.mobileNumber || profile?.officialEmail || 'Contact not updated';

    const openMaps = React.useCallback(() => {
        if (!profile?.googleMapsLink) return;
        void Linking.openURL(profile.googleMapsLink);
    }, [profile?.googleMapsLink]);

    if (isLoading) {
        return (
            <View style={[styles.center, { backgroundColor: theme.background }]}>
                <ActivityIndicator color={theme.tint} size="large" />
            </View>
        );
    }

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} tintColor={theme.tint} />}
        >
            <View style={styles.header}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Panel</Text>
                    <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                        {profile?.displayName || profile?.registeredName || user?.firstName || 'Hospital'}
                    </Text>
                    <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                        {profile ? `${profile.city}, ${profile.state}` : 'Hospital account is active'}
                    </Text>
                </View>
                <TouchableOpacity
                    style={[styles.iconButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                    onPress={() => router.push('/hospital/settings')}
                >
                    <Settings size={20} color={theme.text} />
                </TouchableOpacity>
            </View>

            <View style={[styles.statusCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.statusLeft}>
                    <View style={[styles.statusIcon, { backgroundColor: theme.successLight }]}>
                        <Building2 size={20} color={theme.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.statusTitle, { color: theme.text }]}>Onboarding status</Text>
                        <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                            {formatStatus(profile?.status)} • App account {formatStatus(profile?.appAccountStatus)}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={[styles.profileCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.profileCardHeader}>
                    <View style={styles.profileTitleRow}>
                        <View style={[styles.statusIcon, { backgroundColor: theme.successLight }]}>
                            <MapPin size={20} color={theme.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.statusTitle, { color: theme.text }]}>Location and hospital profile</Text>
                            <Text style={[styles.statusText, { color: theme.textSecondary }]} numberOfLines={1}>
                                {profile?.facilityType || 'Facility type not set'}
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity onPress={() => router.push('/hospital/settings')}>
                        <Text style={[styles.sectionAction, { color: theme.tint }]}>Edit</Text>
                    </TouchableOpacity>
                </View>

                <Text style={[styles.addressText, { color: theme.text }]}>{addressText || 'Hospital address is not updated yet.'}</Text>

                <View style={styles.detailGrid}>
                    <DetailItem icon={Clock} label="OPD" value={profile?.opdTimings || 'Not updated'} theme={theme} />
                    <DetailItem icon={Phone} label="Contact" value={contactText} theme={theme} />
                    <DetailItem icon={Stethoscope} label="Services" value={serviceText} theme={theme} />
                    <DetailItem icon={Mail} label="Official email" value={profile?.officialEmail || 'Not updated'} theme={theme} />
                </View>

                {profile?.googleMapsLink ? (
                    <TouchableOpacity style={[styles.mapButton, { borderColor: theme.borderColor }]} onPress={openMaps}>
                        <ExternalLink size={16} color={theme.tint} />
                        <Text style={[styles.mapButtonText, { color: theme.tint }]}>Open Google Maps location</Text>
                    </TouchableOpacity>
                ) : null}
            </View>

            <View style={styles.statsGrid}>
                <StatCard title="Doctors" value={stats?.doctors || 0} icon={Stethoscope} theme={theme} />
                <StatCard title="Patients" value={stats?.patients || 0} icon={Users} theme={theme} />
                <StatCard title="Voice Intakes" value={stats?.voiceIntakes || 0} icon={Mic} theme={theme} />
                <StatCard title="Review" value={formatStatus(profile?.status)} icon={ClipboardList} theme={theme} compact />
            </View>

            <View style={styles.quickGrid}>
                <QuickAction
                    title="Add doctor"
                    subtitle="Link existing CD4 doctor"
                    icon={Stethoscope}
                    theme={theme}
                    onPress={() => router.push('/hospital/doctors')}
                />
                <QuickAction
                    title="Add patient"
                    subtitle="Assign patient to hospital"
                    icon={Users}
                    theme={theme}
                    onPress={() => router.push('/hospital/patients')}
                />
                <QuickAction
                    title="Voice intake"
                    subtitle="Capture patient symptoms"
                    icon={Mic}
                    theme={theme}
                    onPress={() => router.push('/hospital/voice-intake')}
                />
            </View>

            <Section title="Recent doctors" action="Manage" onPress={() => router.push('/hospital/doctors')} theme={theme}>
                {recentDoctors.length ? (
                    recentDoctors.map((doctor) => (
                        <Row key={doctor.id} title={doctor.name} subtitle={`${doctor.specialization || 'Doctor'} • ${doctor.status}`} theme={theme} />
                    ))
                ) : (
                    <EmptyText text="No doctors linked yet." theme={theme} />
                )}
            </Section>

            <Section title="Recent voice intakes" action="Open" onPress={() => router.push('/hospital/voice-intake')} theme={theme}>
                {recentVoice.length ? (
                    recentVoice.map((item) => (
                        <Row key={item.id} title={item.title} subtitle={formatStatus(item.status)} theme={theme} />
                    ))
                ) : (
                    <EmptyText text="No voice intake sessions yet." theme={theme} />
                )}
            </Section>
        </ScrollView>
    );
}

function StatCard({ title, value, icon: Icon, theme, compact }: { title: string; value: string | number; icon: any; theme: any; compact?: boolean }) {
    return (
        <View style={[styles.statCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Icon size={18} color={theme.tint} />
            <Text style={[styles.statValue, compact && styles.statValueCompact, { color: theme.text }]} numberOfLines={1}>
                {value}
            </Text>
            <Text style={[styles.statTitle, { color: theme.textSecondary }]}>{title}</Text>
        </View>
    );
}

function QuickAction({ title, subtitle, icon: Icon, theme, onPress }: { title: string; subtitle: string; icon: any; theme: any; onPress: () => void }) {
    return (
        <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={onPress}>
            <Icon size={19} color={theme.tint} />
            <Text style={[styles.quickTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.quickSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        </TouchableOpacity>
    );
}

function DetailItem({ icon: Icon, label, value, theme }: { icon: any; label: string; value: string; theme: any }) {
    return (
        <View style={styles.detailItem}>
            <Icon size={15} color={theme.tint} />
            <View style={{ flex: 1 }}>
                <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{label}</Text>
                <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={2}>
                    {value}
                </Text>
            </View>
        </View>
    );
}

function Section({ title, action, onPress, children, theme }: { title: string; action: string; onPress: () => void; children: React.ReactNode; theme: any }) {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
                <TouchableOpacity onPress={onPress}>
                    <Text style={[styles.sectionAction, { color: theme.tint }]}>{action}</Text>
                </TouchableOpacity>
            </View>
            {children}
        </View>
    );
}

function Row({ title, subtitle, theme }: { title: string; subtitle: string; theme: any }) {
    return (
        <View style={[styles.row, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        </View>
    );
}

function EmptyText({ text, theme }: { text: string; theme: any }) {
    return <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{text}</Text>;
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 34 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 18 },
    kicker: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
    title: { fontSize: 28, fontWeight: '900', lineHeight: 34 },
    subtitle: { marginTop: 5, fontSize: 14, fontWeight: '600' },
    iconButton: { width: 44, height: 44, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    statusCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
    statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    statusIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    statusTitle: { fontSize: 15, fontWeight: '800' },
    statusText: { marginTop: 4, fontSize: 12, fontWeight: '600' },
    profileCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
    profileCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    profileTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    addressText: { fontSize: 14, lineHeight: 20, fontWeight: '800', marginBottom: 14 },
    detailGrid: { gap: 12 },
    detailItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
    detailLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7 },
    detailValue: { marginTop: 2, fontSize: 13, lineHeight: 18, fontWeight: '800' },
    mapButton: { height: 44, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
    mapButtonText: { fontSize: 13, fontWeight: '900' },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
    statCard: { width: '48.5%', borderRadius: 18, borderWidth: 1, padding: 14 },
    statValue: { marginTop: 12, fontSize: 26, fontWeight: '900' },
    statValueCompact: { fontSize: 17 },
    statTitle: { marginTop: 4, fontSize: 12, fontWeight: '700' },
    quickGrid: { gap: 10, marginBottom: 20 },
    quickCard: { borderRadius: 18, borderWidth: 1, padding: 15 },
    quickTitle: { marginTop: 10, fontSize: 16, fontWeight: '900' },
    quickSubtitle: { marginTop: 3, fontSize: 12, fontWeight: '600' },
    section: { marginTop: 12 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    sectionTitle: { fontSize: 18, fontWeight: '900' },
    sectionAction: { fontSize: 13, fontWeight: '800' },
    row: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 8 },
    rowTitle: { fontSize: 14, fontWeight: '900' },
    rowSubtitle: { marginTop: 4, fontSize: 12, fontWeight: '600' },
    emptyText: { fontSize: 13, fontWeight: '600', paddingVertical: 8 },
});
