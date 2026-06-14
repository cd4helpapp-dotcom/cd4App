import React from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { UserPlus, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalDoctors, useHospitalPatients, useLinkHospitalPatient } from '../../hooks/useHospital';

export default function HospitalPatientsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const patientsQuery = useHospitalPatients();
    const doctorsQuery = useHospitalDoctors();
    const linkPatient = useLinkHospitalPatient();
    const [email, setEmail] = React.useState('');
    const [notes, setNotes] = React.useState('');
    const [selectedDoctorId, setSelectedDoctorId] = React.useState<string | undefined>(undefined);

    const patients = patientsQuery.data || [];
    const doctors = doctorsQuery.data || [];

    const handleLinkPatient = async () => {
        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) {
            Toast.show({ type: 'error', text1: 'Patient email required', text2: 'Enter patient CD4 account email.' });
            return;
        }

        try {
            await linkPatient.mutateAsync({
                email: cleanEmail,
                doctorId: selectedDoctorId,
                notes: notes.trim() || undefined,
            });
            setEmail('');
            setNotes('');
            Toast.show({ type: 'success', text1: 'Patient linked', text2: 'Patient is now visible in hospital panel.' });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Could not link patient',
                text2: error?.message || 'Please check patient email and try again.',
            });
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={patientsQuery.isRefetching} onRefresh={patientsQuery.refetch} tintColor={theme.tint} />}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Patients</Text>
            <Text style={[styles.title, { color: theme.text }]}>Map patients under your doctors.</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Link existing CD4 patient accounts to this hospital and optionally assign them to a hospital doctor.
            </Text>

            <View style={[styles.formCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.formHeader}>
                    <UserPlus size={19} color={theme.tint} />
                    <Text style={[styles.formTitle, { color: theme.text }]}>Link patient</Text>
                </View>
                <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Patient email"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />
                <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Notes, UHID, ward, or visit context"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />
                <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>Assign doctor</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    <TouchableOpacity
                        style={[
                            styles.chip,
                            { borderColor: theme.borderColor, backgroundColor: selectedDoctorId ? theme.background : theme.successLight },
                        ]}
                        onPress={() => setSelectedDoctorId(undefined)}
                    >
                        <Text style={[styles.chipText, { color: selectedDoctorId ? theme.textSecondary : theme.tint }]}>Unassigned</Text>
                    </TouchableOpacity>
                    {doctors.map((doctor) => {
                        const selected = selectedDoctorId === doctor.doctorId;
                        return (
                            <TouchableOpacity
                                key={doctor.id}
                                style={[
                                    styles.chip,
                                    { borderColor: theme.borderColor, backgroundColor: selected ? theme.successLight : theme.background },
                                ]}
                                onPress={() => setSelectedDoctorId(doctor.doctorId)}
                            >
                                <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]}>{doctor.name}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
                <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: theme.tint }, linkPatient.isPending && styles.disabledButton]}
                    onPress={handleLinkPatient}
                    disabled={linkPatient.isPending}
                >
                    {linkPatient.isPending ? <ActivityIndicator color={theme.buttonText} /> : <UserPlus size={17} color={theme.buttonText} />}
                    <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>Add patient</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Linked patients</Text>
                <Text style={[styles.countText, { color: theme.textSecondary }]}>{patients.length}</Text>
            </View>

            {patientsQuery.isLoading ? (
                <ActivityIndicator color={theme.tint} style={{ marginTop: 24 }} />
            ) : patients.length ? (
                patients.map((patient) => (
                    <View key={patient.id} style={[styles.patientCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <View style={[styles.avatar, { backgroundColor: theme.successLight }]}>
                            <Users size={18} color={theme.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.patientName, { color: theme.text }]}>{patient.patientName}</Text>
                            <Text style={[styles.patientMeta, { color: theme.textSecondary }]}>
                                {patient.patientEmail || patient.patientPhone || 'Contact not available'}
                            </Text>
                            <Text style={[styles.patientMeta, { color: theme.textSecondary }]}>
                                {patient.doctorName ? `Doctor: ${patient.doctorName}` : 'Doctor not assigned'}
                            </Text>
                        </View>
                    </View>
                ))
            ) : (
                <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>No patients linked yet</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Link patients after they have a CD4 patient account.
                    </Text>
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 34 },
    kicker: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7 },
    title: { fontSize: 27, fontWeight: '900', lineHeight: 33 },
    subtitle: { marginTop: 8, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    formCard: { marginTop: 20, borderWidth: 1, borderRadius: 20, padding: 16 },
    formHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    formTitle: { fontSize: 17, fontWeight: '900' },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '600', marginBottom: 10 },
    smallLabel: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
    chipRow: { gap: 8, paddingVertical: 10 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
    chipText: { fontSize: 12, fontWeight: '800' },
    primaryButton: { height: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
    disabledButton: { opacity: 0.72 },
    primaryButtonText: { fontSize: 14, fontWeight: '900' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
    sectionTitle: { fontSize: 19, fontWeight: '900' },
    countText: { fontSize: 13, fontWeight: '800' },
    patientCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    patientName: { fontSize: 15, fontWeight: '900' },
    patientMeta: { marginTop: 3, fontSize: 12, fontWeight: '600' },
    emptyCard: { borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '900' },
    emptyText: { marginTop: 6, fontSize: 13, lineHeight: 20, fontWeight: '600' },
});
