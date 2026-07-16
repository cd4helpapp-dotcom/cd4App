import React from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
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
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { UserPlus, Users, Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalDoctorSearch, useHospitalDoctors, useHospitalPatients, useLinkHospitalPatient } from '../../hooks/useHospital';
import type { HospitalDoctor } from '../../hooks/useHospital';

export default function HospitalPatientsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const patientsQuery = useHospitalPatients();
    const doctorsQuery = useHospitalDoctors();
    const linkPatient = useLinkHospitalPatient();
    const [name, setName] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [phone, setPhone] = React.useState('');
    const [notes, setNotes] = React.useState('');
    const [selectedDoctorId, setSelectedDoctorId] = React.useState<string | undefined>(undefined);
    const [doctorSearch, setDoctorSearch] = React.useState('');
    const [debouncedDoctorSearch, setDebouncedDoctorSearch] = React.useState('');
    const [isModalVisible, setIsModalVisible] = React.useState(false);

    const patients = patientsQuery.data || [];
    const doctors = doctorsQuery.data || [];
    const doctorSearchQuery = useHospitalDoctorSearch(debouncedDoctorSearch);
    const visibleDoctors: HospitalDoctor[] = debouncedDoctorSearch.length >= 3 && doctorSearchQuery.data
        ? doctorSearchQuery.data
        : doctors;

    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedDoctorSearch(doctorSearch.trim().toLowerCase()), 320);
        return () => clearTimeout(timer);
    }, [doctorSearch]);

    const handleLinkPatient = async () => {
        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = phone.trim();
        if (!cleanName || !cleanEmail || !cleanPhone) {
            Toast.show({ type: 'error', text1: 'Patient details required', text2: 'Enter the patient name, email, and phone number.' });
            return;
        }
        if (!selectedDoctorId) {
            Toast.show({ type: 'error', text1: 'Doctor assignment required', text2: 'Select the doctor responsible for this patient.' });
            return;
        }

        try {
            await linkPatient.mutateAsync({
                name: cleanName,
                email: cleanEmail,
                phone: cleanPhone,
                doctorId: selectedDoctorId,
                notes: notes.trim() || undefined,
            });
            setName('');
            setEmail('');
            setPhone('');
            setNotes('');
            setSelectedDoctorId(undefined);
            setDoctorSearch('');
            setDebouncedDoctorSearch('');
            setIsModalVisible(false);
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
            <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Patients</Text>
                    <Text style={[styles.title, { color: theme.text }]}>Patients</Text>
                </View>
                <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: theme.tint }]}
                    onPress={() => setIsModalVisible(true)}
                >
                    <Plus size={16} color={theme.buttonText} />
                    <Text style={[styles.addButtonText, { color: theme.buttonText }]}>Add Patient</Text>
                </TouchableOpacity>
            </View>
            <Text style={[styles.subtitle, { color: theme.textSecondary, marginBottom: 14 }]}>
                Manage and link patients under your hospital.
            </Text>

            <Modal
                visible={isModalVisible}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setIsModalVisible(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setIsModalVisible(false)}>
                    <Pressable
                        style={[
                            styles.modalCard,
                            {
                                backgroundColor: theme.cardBackground,
                                borderColor: theme.borderColor,
                                paddingBottom: Math.max(insets.bottom, 20),
                            },
                        ]}
                        onPress={() => {}}
                    >
                        <View style={[styles.modalGrabber, { backgroundColor: theme.borderColor }]} />
                        <View style={styles.modalHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <UserPlus size={19} color={theme.tint} />
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Link patient</Text>
                            </View>
                            <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                                <X size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>
                        <Text style={[styles.modalSubtitle, { color: theme.textSecondary, marginBottom: 16 }]}>
                            Link the patient and assign the responsible hospital doctor. This keeps history and reports connected correctly.
                        </Text>

                        <TextInput
                            value={name}
                            onChangeText={setName}
                            placeholder="Patient full name"
                            placeholderTextColor={theme.textSecondary}
                            autoCapitalize="words"
                            style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                        />
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
                            value={phone}
                            onChangeText={setPhone}
                            placeholder="Patient phone number"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="phone-pad"
                            style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                        />
                        <TextInput
                            value={notes}
                            onChangeText={setNotes}
                            placeholder="Notes, UHID, ward, or visit context"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                        />
                        <View style={styles.doctorLabelRow}>
                            <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>Assign responsible doctor (required)</Text>
                            <TextInput
                                value={doctorSearch}
                                onChangeText={setDoctorSearch}
                                placeholder="Search doctor"
                                placeholderTextColor={theme.textSecondary}
                                autoCapitalize="none"
                                style={[styles.doctorSearchInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                            />
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                            {doctorSearchQuery.isFetching ? (
                                <ActivityIndicator color={theme.tint} style={{ marginHorizontal: 12 }} />
                            ) : visibleDoctors.map((doctor) => {
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
                            style={[styles.primaryButton, { backgroundColor: theme.tint }, (linkPatient.isPending || !selectedDoctorId) && styles.disabledButton]}
                            onPress={handleLinkPatient}
                            disabled={linkPatient.isPending || !selectedDoctorId}
                        >
                            {linkPatient.isPending ? <ActivityIndicator color={theme.buttonText} /> : <Plus size={17} color={theme.buttonText} />}
                            <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>Link patient</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </Modal>

            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Linked patients</Text>
                <Text style={[styles.countText, { color: theme.textSecondary }]}>{patients.length}</Text>
            </View>

            {patientsQuery.isLoading ? (
                <ActivityIndicator color={theme.tint} style={{ marginTop: 24 }} />
            ) : patients.length ? (
                patients.map((patient) => (
                    <TouchableOpacity
                        key={patient.id}
                        style={[styles.patientCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        onPress={() => router.push({ pathname: '/hospital/patient-profile', params: { patientId: patient.patientId } })}
                        activeOpacity={0.82}
                    >
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
                    </TouchableOpacity>
                ))
            ) : (
                <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>No patients linked yet</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Link an existing CD4 patient account to this hospital.
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
    doctorLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    doctorSearchInput: { width: 132, height: 32, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 12, fontWeight: '600' },
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
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
    addButtonText: { fontSize: 13, fontWeight: '900' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 20, paddingTop: 12, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.15, shadowRadius: 5 },
    modalGrabber: { width: 42, height: 5, borderRadius: 2.5, alignSelf: 'center', marginBottom: 14 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalTitle: { fontSize: 17, fontWeight: '900' },
    modalSubtitle: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
