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
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Building2, FileCheck2, Globe, LogOut, Mail, MapPin, Save, ShieldCheck, Stethoscope } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useLogout } from '../../hooks/useAuth';
import { HospitalProfile, useHospitalProfile, useUpdateHospitalProfile } from '../../hooks/useHospital';

type ProfileForm = {
    displayName: string;
    website: string;
    fullAddress: string;
    city: string;
    state: string;
    pinCode: string;
    googleMapsLink: string;
    authorizedPersonName: string;
    designation: string;
    mobileNumber: string;
    whatsappNumber: string;
    officialEmail: string;
    specialitiesText: string;
    facilitiesText: string;
    opdTimings: string;
};

const emptyForm: ProfileForm = {
    displayName: '',
    website: '',
    fullAddress: '',
    city: '',
    state: '',
    pinCode: '',
    googleMapsLink: '',
    authorizedPersonName: '',
    designation: '',
    mobileNumber: '',
    whatsappNumber: '',
    officialEmail: '',
    specialitiesText: '',
    facilitiesText: '',
    opdTimings: '',
};

const formatStatus = (value?: string) =>
    (value || 'pending')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

const joinList = (items: string[]) => items.filter(Boolean).join(', ');

const splitList = (value: string) =>
    value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

const buildFormFromProfile = (profile: HospitalProfile): ProfileForm => ({
    displayName: profile.displayName || '',
    website: profile.website || '',
    fullAddress: profile.fullAddress || '',
    city: profile.city || '',
    state: profile.state || '',
    pinCode: profile.pinCode || '',
    googleMapsLink: profile.googleMapsLink || '',
    authorizedPersonName: profile.authorizedPersonName || '',
    designation: profile.designation || '',
    mobileNumber: profile.mobileNumber || '',
    whatsappNumber: profile.whatsappNumber || '',
    officialEmail: profile.officialEmail || '',
    specialitiesText: joinList(profile.specialities),
    facilitiesText: joinList(profile.facilities),
    opdTimings: profile.opdTimings || '',
});

export default function HospitalSettingsScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user, refreshAuth } = useAuthContext();
    const logoutMutation = useLogout();
    const profileQuery = useHospitalProfile();
    const updateProfile = useUpdateHospitalProfile();
    const profile = profileQuery.data;
    const [form, setForm] = React.useState<ProfileForm>(emptyForm);

    React.useEffect(() => {
        if (profile) {
            setForm(buildFormFromProfile(profile));
        }
    }, [profile]);

    const updateField = (field: keyof ProfileForm, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    const handleSave = async () => {
        if (!form.fullAddress.trim() || !form.city.trim() || !form.state.trim() || !form.pinCode.trim()) {
            Toast.show({
                type: 'error',
                text1: 'Location incomplete',
                text2: 'Address, city, state, and PIN code are required.',
            });
            return;
        }

        if (!form.authorizedPersonName.trim() || !form.mobileNumber.trim() || !form.officialEmail.trim()) {
            Toast.show({
                type: 'error',
                text1: 'Contact incomplete',
                text2: 'Authorized person, mobile number, and official email are required.',
            });
            return;
        }

        try {
            await updateProfile.mutateAsync({
                displayName: form.displayName,
                website: form.website,
                fullAddress: form.fullAddress,
                city: form.city,
                state: form.state,
                pinCode: form.pinCode,
                googleMapsLink: form.googleMapsLink,
                authorizedPersonName: form.authorizedPersonName,
                designation: form.designation,
                mobileNumber: form.mobileNumber,
                whatsappNumber: form.whatsappNumber,
                officialEmail: form.officialEmail,
                specialities: splitList(form.specialitiesText),
                facilities: splitList(form.facilitiesText),
                opdTimings: form.opdTimings,
            });

            Toast.show({
                type: 'success',
                text1: 'Profile updated',
                text2: 'Hospital details were saved successfully.',
            });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Update failed',
                text2: error?.message || 'Please try again.',
            });
        }
    };

    const handleLogout = async () => {
        try {
            await logoutMutation.mutateAsync();
            await refreshAuth();
            Toast.show({ type: 'success', text1: 'Logged out' });
            router.replace('/auth/login');
        } catch {
            Toast.show({ type: 'error', text1: 'Logout failed', text2: 'Please try again.' });
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={profileQuery.isRefetching} onRefresh={profileQuery.refetch} tintColor={theme.tint} />}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Profile</Text>
            <Text style={[styles.title, { color: theme.text }]}>Review and update hospital details.</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Keep location, contact, departments, facilities, and OPD information updated for CD4 coordination.
            </Text>

            <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                {profileQuery.isLoading ? (
                    <ActivityIndicator color={theme.tint} />
                ) : (
                    <>
                        <InfoRow icon={Building2} label="Registered name" value={profile?.registeredName || user?.firstName || 'Hospital'} theme={theme} />
                        <InfoRow icon={FileCheck2} label="Registration number" value={profile?.registrationNumber || 'Not available'} theme={theme} />
                        <InfoRow icon={ShieldCheck} label="Verification status" value={formatStatus(profile?.status)} theme={theme} />
                        <InfoRow icon={Mail} label="Login email" value={user?.email || 'Not available'} theme={theme} />
                    </>
                )}
            </View>

            <EditableSection title="Public profile" icon={Globe} theme={theme}>
                <ProfileInput label="Display name" value={form.displayName} onChangeText={(value) => updateField('displayName', value)} theme={theme} />
                <ProfileInput label="Website or social profile" value={form.website} onChangeText={(value) => updateField('website', value)} theme={theme} autoCapitalize="none" />
            </EditableSection>

            <EditableSection title="Location" icon={MapPin} theme={theme}>
                <ProfileInput label="Full address" value={form.fullAddress} onChangeText={(value) => updateField('fullAddress', value)} theme={theme} multiline />
                <View style={styles.twoColumn}>
                    <ProfileInput label="City" value={form.city} onChangeText={(value) => updateField('city', value)} theme={theme} />
                    <ProfileInput label="State" value={form.state} onChangeText={(value) => updateField('state', value)} theme={theme} />
                </View>
                <View style={styles.twoColumn}>
                    <ProfileInput label="PIN code" value={form.pinCode} onChangeText={(value) => updateField('pinCode', value)} theme={theme} keyboardType="number-pad" />
                    <ProfileInput label="Google Maps link" value={form.googleMapsLink} onChangeText={(value) => updateField('googleMapsLink', value)} theme={theme} autoCapitalize="none" />
                </View>
            </EditableSection>

            <EditableSection title="Authorized contact" icon={Mail} theme={theme}>
                <ProfileInput label="Authorized person" value={form.authorizedPersonName} onChangeText={(value) => updateField('authorizedPersonName', value)} theme={theme} />
                <ProfileInput label="Designation" value={form.designation} onChangeText={(value) => updateField('designation', value)} theme={theme} />
                <View style={styles.twoColumn}>
                    <ProfileInput label="Mobile number" value={form.mobileNumber} onChangeText={(value) => updateField('mobileNumber', value)} theme={theme} keyboardType="phone-pad" />
                    <ProfileInput label="WhatsApp number" value={form.whatsappNumber} onChangeText={(value) => updateField('whatsappNumber', value)} theme={theme} keyboardType="phone-pad" />
                </View>
                <ProfileInput label="Official email" value={form.officialEmail} onChangeText={(value) => updateField('officialEmail', value)} theme={theme} autoCapitalize="none" keyboardType="email-address" />
            </EditableSection>

            <EditableSection title="Services and OPD" icon={Stethoscope} theme={theme}>
                <ProfileInput label="Departments / specialities" value={form.specialitiesText} onChangeText={(value) => updateField('specialitiesText', value)} theme={theme} multiline />
                <ProfileInput label="Facilities" value={form.facilitiesText} onChangeText={(value) => updateField('facilitiesText', value)} theme={theme} multiline />
                <ProfileInput label="OPD timings" value={form.opdTimings} onChangeText={(value) => updateField('opdTimings', value)} theme={theme} />
                <Text style={[styles.hint, { color: theme.textSecondary }]}>
                    Use comma-separated values for departments and facilities.
                </Text>
            </EditableSection>

            <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: theme.tint }, updateProfile.isPending && styles.disabledButton]}
                onPress={handleSave}
                disabled={updateProfile.isPending}
            >
                {updateProfile.isPending ? <ActivityIndicator color={theme.buttonText} /> : <Save size={18} color={theme.buttonText} />}
                <Text style={[styles.saveButtonText, { color: theme.buttonText }]}>Save hospital profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.logoutButton, { borderColor: theme.error }]}
                onPress={handleLogout}
                disabled={logoutMutation.isPending}
            >
                {logoutMutation.isPending ? <ActivityIndicator color={theme.error} /> : <LogOut size={18} color={theme.error} />}
                <Text style={[styles.logoutText, { color: theme.error }]}>Logout</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

function InfoRow({ icon: Icon, label, value, theme }: { icon: any; label: string; value: string; theme: any }) {
    return (
        <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: theme.successLight }]}>
                <Icon size={17} color={theme.tint} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>{value}</Text>
            </View>
        </View>
    );
}

function EditableSection({ title, icon: Icon, theme, children }: { title: string; icon: any; theme: any; children: React.ReactNode }) {
    return (
        <View style={[styles.editCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={styles.editHeader}>
                <Icon size={18} color={theme.tint} />
                <Text style={[styles.editTitle, { color: theme.text }]}>{title}</Text>
            </View>
            {children}
        </View>
    );
}

function ProfileInput({
    label,
    value,
    onChangeText,
    theme,
    multiline,
    keyboardType,
    autoCapitalize,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    theme: any;
    multiline?: boolean;
    keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
    return (
        <View style={styles.inputWrap}>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>{label}</Text>
            <TextInput
                value={value}
                onChangeText={onChangeText}
                placeholder={label}
                placeholderTextColor={theme.textSecondary}
                multiline={multiline}
                textAlignVertical={multiline ? 'top' : undefined}
                keyboardType={keyboardType}
                autoCapitalize={autoCapitalize}
                style={[
                    styles.input,
                    multiline && styles.inputMultiline,
                    { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 34 },
    kicker: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7 },
    title: { fontSize: 27, fontWeight: '900', lineHeight: 33 },
    subtitle: { marginTop: 8, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    card: { marginTop: 20, borderWidth: 1, borderRadius: 20, padding: 16, gap: 14 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    infoIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    infoLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
    infoValue: { marginTop: 3, fontSize: 15, fontWeight: '900' },
    editCard: { marginTop: 14, borderWidth: 1, borderRadius: 20, padding: 16 },
    editHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    editTitle: { fontSize: 17, fontWeight: '900' },
    twoColumn: { gap: 0 },
    inputWrap: { marginBottom: 11 },
    inputLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '700' },
    inputMultiline: { minHeight: 88, lineHeight: 20 },
    hint: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
    saveButton: { marginTop: 18, height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    saveButtonText: { fontSize: 15, fontWeight: '900' },
    disabledButton: { opacity: 0.72 },
    logoutButton: { marginTop: 12, height: 50, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    logoutText: { fontSize: 15, fontWeight: '900' },
});
