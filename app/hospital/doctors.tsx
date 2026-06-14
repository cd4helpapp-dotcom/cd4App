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
import { MailPlus, Search, Stethoscope } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useHospitalDoctors, useLinkHospitalDoctor } from '../../hooks/useHospital';

export default function HospitalDoctorsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const doctorsQuery = useHospitalDoctors();
    const linkDoctor = useLinkHospitalDoctor();
    const [identifier, setIdentifier] = React.useState('');
    const [department, setDepartment] = React.useState('');

    const doctors = doctorsQuery.data || [];

    const handleLinkDoctor = async () => {
        const cleanIdentifier = identifier.trim();
        if (!cleanIdentifier) {
            Toast.show({ type: 'error', text1: 'Doctor detail required', text2: 'Enter doctor email or registration number.' });
            return;
        }

        try {
            await linkDoctor.mutateAsync({
                identifier: cleanIdentifier,
                department: department.trim() || undefined,
            });
            setIdentifier('');
            setDepartment('');
            Toast.show({ type: 'success', text1: 'Doctor linked', text2: 'Doctor is now available in this hospital panel.' });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Could not link doctor',
                text2: error?.message || 'Please check the doctor details and try again.',
            });
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={doctorsQuery.isRefetching} onRefresh={doctorsQuery.refetch} tintColor={theme.tint} />}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Doctors</Text>
            <Text style={[styles.title, { color: theme.text }]}>Manage doctors inside your hospital.</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Link doctors who already have a CD4 doctor account. Use their email or medical registration number.
            </Text>

            <View style={[styles.formCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.formHeader}>
                    <MailPlus size={19} color={theme.tint} />
                    <Text style={[styles.formTitle, { color: theme.text }]}>Link doctor</Text>
                </View>
                <TextInput
                    value={identifier}
                    onChangeText={setIdentifier}
                    placeholder="Doctor email or registration number"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />
                <TextInput
                    value={department}
                    onChangeText={setDepartment}
                    placeholder="Department, e.g. Cardiology"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />
                <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: theme.tint }, linkDoctor.isPending && styles.disabledButton]}
                    onPress={handleLinkDoctor}
                    disabled={linkDoctor.isPending}
                >
                    {linkDoctor.isPending ? <ActivityIndicator color={theme.buttonText} /> : <Search size={17} color={theme.buttonText} />}
                    <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>Add doctor</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Linked doctors</Text>
                <Text style={[styles.countText, { color: theme.textSecondary }]}>{doctors.length}</Text>
            </View>

            {doctorsQuery.isLoading ? (
                <ActivityIndicator color={theme.tint} style={{ marginTop: 24 }} />
            ) : doctors.length ? (
                doctors.map((doctor) => (
                    <View key={doctor.id} style={[styles.doctorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <View style={[styles.avatar, { backgroundColor: theme.successLight }]}>
                            <Stethoscope size={18} color={theme.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.doctorName, { color: theme.text }]}>{doctor.name}</Text>
                            <Text style={[styles.doctorMeta, { color: theme.textSecondary }]}>
                                {doctor.specialization || doctor.department || 'Doctor'} • {doctor.city || 'City not set'}
                            </Text>
                            <Text style={[styles.doctorMeta, { color: theme.textSecondary }]}>
                                {doctor.email || doctor.registrationNumber || 'No public contact'}
                            </Text>
                        </View>
                        <View style={[styles.statusPill, { borderColor: theme.borderColor }]}>
                            <Text style={[styles.statusText, { color: theme.tint }]}>{doctor.status}</Text>
                        </View>
                    </View>
                ))
            ) : (
                <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>No doctors linked yet</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Add your first doctor using their CD4 doctor account email or registration number.
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
    primaryButton: { height: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2 },
    disabledButton: { opacity: 0.72 },
    primaryButtonText: { fontSize: 14, fontWeight: '900' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
    sectionTitle: { fontSize: 19, fontWeight: '900' },
    countText: { fontSize: 13, fontWeight: '800' },
    doctorCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    doctorName: { fontSize: 15, fontWeight: '900' },
    doctorMeta: { marginTop: 3, fontSize: 12, fontWeight: '600' },
    statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
    statusText: { fontSize: 11, fontWeight: '900', textTransform: 'capitalize' },
    emptyCard: { borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '900' },
    emptyText: { marginTop: 6, fontSize: 13, lineHeight: 20, fontWeight: '600' },
});
