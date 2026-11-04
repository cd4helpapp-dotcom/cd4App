import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CheckCircle2, Save } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';

import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useDoctorProfile, useUpdateDoctorProfile } from '../../hooks/useDoctor';
import { useUpdateProfile, useUploadProfilePicture } from '../../hooks/useAuth';
import { needsDoctorProfileSetup } from '../../utils/profileSetup';
import { getImageUrl } from '../../constants/Config';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { syncPendingDoctorRegistration } from '../../services/doctorRegistrationSync';

type DoctorMandatoryProfileForm = {
    fullName: string;
    mobileNumber: string;
    city: string;
    degree: string;
    specialization: string;
    university: string;
    yearOfCompletion: string;
    registrationNumber: string;
    registrationCouncil: string;
    experienceYears: string;
    currentHospitalClinic: string;
    previousWorkDetails: string;
    areasOfExpertise: string;
    languagesSpoken: string;
    consultationFee: string;
    treatmentApproach: string;
};

const splitName = (value: string): { firstName: string; lastName: string } => {
    const cleaned = value.trim().replace(/\s+/g, ' ');
    if (!cleaned) return { firstName: '', lastName: '' };
    const tokens = cleaned.split(' ');
    return {
        firstName: tokens[0] || '',
        lastName: tokens.slice(1).join(' ').trim() || 'Doctor',
    };
};

const toCommaSeparated = (value: unknown): string => {
    if (!Array.isArray(value)) return '';
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
        .join(', ');
};

const parseCommaSeparated = (value: string): string[] =>
    value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

const sanitizeNumberInput = (value: string): string => value.replace(/[^\d]/g, '');

const parsePositiveInteger = (value: string): number | null => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
};

const parseConsultationFee = (value: string): number | null => {
    const numeric = Number(value.replace(/[^\d]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
};

export default function DoctorCompleteProfileScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { user, isLoading, refreshAuth } = useAuthContext();
    const { data: doctorProfileResponse, isLoading: doctorProfileLoading } = useDoctorProfile();
    const updateProfileMutation = useUpdateProfile();
    const updateDoctorProfileMutation = useUpdateDoctorProfile();
    const uploadProfilePictureMutation = useUploadProfilePicture();

    const [saving, setSaving] = useState(false);
    const [profilePictureUrl, setProfilePictureUrl] = useState('');
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [showConsultationModePicker, setShowConsultationModePicker] = useState(false);
    const consultationModes = ['Audio', 'Video', 'Audio + Video'];
    const [form, setForm] = useState<DoctorMandatoryProfileForm>({
        fullName: '',
        mobileNumber: '',
        city: '',
        degree: '',
        specialization: '',
        university: '',
        yearOfCompletion: '',
        registrationNumber: '',
        registrationCouncil: '',
        experienceYears: '',
        currentHospitalClinic: '',
        previousWorkDetails: '',
        areasOfExpertise: '',
        languagesSpoken: '',
        consultationFee: '',
        treatmentApproach: consultationModes[2],
    });

    const initializedRef = useRef(false);

    const roleSlug = useMemo(() => {
        const roleValue = user?.role;
        if (typeof roleValue === 'string') return roleValue.trim().toLowerCase();
        return String((roleValue as any)?.name || '').trim().toLowerCase();
    }, [user?.role]);

    useEffect(() => {
        if (!user?.id) return;
        void syncPendingDoctorRegistration(user.id, user.email).catch(() => {});
    }, [user?.id, user?.email]);

    useEffect(() => {
        if (isLoading) return;
        if (!user) {
            router.replace('/auth/login');
            return;
        }
        if (roleSlug !== 'doctor') {
            router.replace('/(tabs)');
        }
    }, [isLoading, user, roleSlug, router]);

    useEffect(() => {
        if (!user || roleSlug !== 'doctor' || doctorProfileLoading || initializedRef.current) return;

        const doctor = doctorProfileResponse?.data;
        const initialMobile = user.phoneNumber || (user as any)?.phone || '';
        setForm({
            fullName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(),
            mobileNumber: initialMobile,
            city: doctor?.city || '',
            degree: doctor?.degree || '',
            specialization: doctor?.specialization || '',
            university: doctor?.university || '',
            yearOfCompletion: doctor?.yearOfCompletion ? String(doctor.yearOfCompletion) : '',
            registrationNumber: doctor?.registrationNumber || '',
            registrationCouncil: doctor?.registrationCouncil || '',
            experienceYears: doctor?.experience ? sanitizeNumberInput(doctor.experience) : '',
            currentHospitalClinic: doctor?.currentHospitalClinic || '',
            previousWorkDetails: doctor?.previousWorkDetails || '',
            areasOfExpertise: toCommaSeparated(doctor?.areasOfExpertise),
            languagesSpoken: toCommaSeparated(doctor?.languagesSpoken),
            consultationFee: doctor?.fee ? sanitizeNumberInput(doctor.fee) : '',
            treatmentApproach: doctor?.treatmentApproach || consultationModes[2],
        });
        if (!initialMobile) {
            void AsyncStorage.getItem('cd4_signup_pending_phone').then((pending) => {
                if (pending) setForm((prev) => ({ ...prev, mobileNumber: pending }));
            });
        }
        setProfilePictureUrl(getImageUrl(user?.profilePicture || doctor?.image || '') || '');
        initializedRef.current = true;
    }, [user, roleSlug, doctorProfileLoading, doctorProfileResponse?.data]);

    useEffect(() => {
        if (!user || roleSlug !== 'doctor' || doctorProfileLoading || !initializedRef.current) return;
        const doctor = doctorProfileResponse?.data || null;
        if (!needsDoctorProfileSetup(user, doctor)) {
            router.replace('/doctor/dashboard');
        }
    }, [user, roleSlug, doctorProfileLoading, doctorProfileResponse?.data, router]);

    const clearFormError = (field: string) => {
        setFormErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };

    const handleUpdateField = (field: keyof DoctorMandatoryProfileForm, value: string) => {
        setForm((previous) => ({ ...previous, [field]: value }));
        clearFormError(field);
    };

    const handlePickProfilePhoto = async () => {
        if (uploadProfilePictureMutation.isPending) return;

        if (Platform.OS !== 'web') {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Toast.show({
                    type: 'error',
                    text1: 'Permission required',
                    text2: 'Please allow gallery access to upload your photo.',
                });
                return;
            }
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.85,
            base64: true,
        });

        if (result.canceled || !result.assets?.[0]) return;

        try {
            const asset = result.assets[0];
            const uploadBody = new FormData();

            if (Platform.OS === 'web') {
                const response = await fetch(asset.uri);
                const blob = await response.blob();
                uploadBody.append('profilePicture', blob, 'doctor-profile.jpg');
            } else {
                uploadBody.append('profilePicture', {
                    uri: asset.uri,
                    name: 'doctor-profile.jpg',
                    type: asset.mimeType || 'image/jpeg',
                    base64: asset.base64 || undefined,
                } as any);
            }

            const updatedUser = await uploadProfilePictureMutation.mutateAsync(uploadBody);
            await refreshAuth();
            const uploadedUrl = getImageUrl((updatedUser as any)?.profilePicture || '');
            if (uploadedUrl) {
                setProfilePictureUrl(uploadedUrl);
            }

            Toast.show({
                type: 'success',
                text1: 'Profile photo updated',
                text2: 'Your photo has been saved.',
            });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Photo upload failed',
                text2: error?.message || 'Please try again.',
            });
        }
    };

    const handleSaveMandatoryProfile = async () => {
        const completionYear = Number(form.yearOfCompletion.trim());
        const experienceYears = parsePositiveInteger(form.experienceYears.trim());
        const consultationFee = parseConsultationFee(form.consultationFee.trim());
        const areas = parseCommaSeparated(form.areasOfExpertise);
        const languages = parseCommaSeparated(form.languagesSpoken);
        const sanitizedMobile = form.mobileNumber.trim();
        const currentYearUpperBound = new Date().getFullYear() + 1;

        const newErrors: Record<string, string> = {};
        if (!profilePictureUrl.trim()) newErrors.profilePicture = 'Please upload a profile photo.';
        if (!form.fullName.trim()) newErrors.fullName = 'Full name is required.';
        if (sanitizedMobile.replace(/\D/g, '').length < 10) newErrors.mobileNumber = 'Valid 10-digit phone number is required.';
        if (!form.city.trim()) newErrors.city = 'City/location is required.';
        if (!form.degree.trim()) newErrors.degree = 'Degree is required.';
        if (!form.specialization.trim()) newErrors.specialization = 'Specialization is required.';
        if (!form.university.trim()) newErrors.university = 'University/college is required.';
        if (!Number.isInteger(completionYear) || completionYear < 1950 || completionYear > currentYearUpperBound) {
            newErrors.yearOfCompletion = `Enter a 4-digit year between 1950 and ${currentYearUpperBound}.`;
        }
        if (!form.registrationNumber.trim()) newErrors.registrationNumber = 'Registration number is required.';
        if (!form.registrationCouncil.trim()) newErrors.registrationCouncil = 'Registration council is required.';
        if (!experienceYears) newErrors.experienceYears = 'Years of experience is required.';
        if (!form.currentHospitalClinic.trim()) newErrors.currentHospitalClinic = 'Hospital or clinic is required.';
        if (!form.previousWorkDetails.trim()) newErrors.previousWorkDetails = 'Previous work details are required.';
        if (areas.length === 0) newErrors.areasOfExpertise = 'Add at least one expertise area.';
        if (languages.length === 0) newErrors.languagesSpoken = 'Add at least one language.';
        if (!consultationFee) newErrors.consultationFee = 'Valid consultation fee is required.';
        if (!form.treatmentApproach.trim()) newErrors.treatmentApproach = 'Consultation mode is required.';

        const { firstName, lastName } = splitName(form.fullName);
        if (!firstName && !newErrors.fullName) {
            newErrors.fullName = 'Please enter your full name correctly.';
        }

        if (Object.keys(newErrors).length > 0) {
            setFormErrors(newErrors);
            const firstErrorMessage = Object.values(newErrors)[0];
            Toast.show({
                type: 'error',
                text1: 'Required Information',
                text2: firstErrorMessage,
            });
            return;
        }
        setFormErrors({});

        try {
            setSaving(true);

            await updateProfileMutation.mutateAsync({
                firstName,
                lastName,
                phoneNumber: sanitizedMobile,
                profileSetupCompleted: true,
            });

            await updateDoctorProfileMutation.mutateAsync({
                city: form.city.trim(),
                degree: form.degree.trim(),
                specialization: form.specialization.trim(),
                university: form.university.trim(),
                yearOfCompletion: completionYear,
                registrationNumber: form.registrationNumber.trim(),
                registrationCouncil: form.registrationCouncil.trim(),
                experience: `${experienceYears} Years`,
                currentHospitalClinic: form.currentHospitalClinic.trim(),
                previousWorkDetails: form.previousWorkDetails.trim(),
                areasOfExpertise: areas,
                languagesSpoken: languages,
                fee: `₹${consultationFee}`,
                treatmentApproach: form.treatmentApproach.trim(),
                profileCompletionDone: true,
                profileCompletionDoneAt: new Date().toISOString(),
            });

            await refreshAuth();

            Toast.show({
                type: 'success',
                text1: 'Profile completed',
                text2: 'Doctor onboarding details saved successfully.',
            });
            router.replace('/doctor/dashboard');
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Save failed',
                text2: error?.message || 'Could not save profile. Please try again.',
            });
        } finally {
            setSaving(false);
        }
    };

    if (isLoading || !user || roleSlug !== 'doctor' || (doctorProfileLoading && !initializedRef.current)) {
        return (
            <DoctorSafeScreen backgroundColor={theme.background} edges={['top', 'bottom']}>
                <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
                    <ActivityIndicator size="large" color={theme.tint} />
                </View>
            </DoctorSafeScreen>
        );
    }

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['top', 'bottom']}>
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: theme.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <View style={[styles.infoCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.title, { color: theme.text }]}>Complete Doctor Profile</Text>
                        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                            This one-time step is mandatory before you can access doctor dashboard and consultations.
                        </Text>
                    </View>

                    <View style={styles.photoSection}>
                        <TouchableOpacity
                            style={[
                                styles.photoButton,
                                {
                                    borderColor: formErrors.profilePicture ? (theme.danger || '#EF4444') : theme.borderColor,
                                    backgroundColor: theme.cardBackground,
                                    borderWidth: formErrors.profilePicture ? 2 : 1,
                                },
                            ]}
                            onPress={handlePickProfilePhoto}
                            activeOpacity={0.85}
                        >
                            {uploadProfilePictureMutation.isPending ? (
                                <ActivityIndicator color={theme.tint} />
                            ) : profilePictureUrl ? (
                                <Image source={{ uri: profilePictureUrl }} style={styles.photoImage} />
                            ) : (
                                <View style={styles.photoPlaceholder}>
                                    <Camera size={24} color={theme.textSecondary} />
                                    <Text style={[styles.photoPlaceholderText, { color: theme.textSecondary }]}>Upload profile photo</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                        {formErrors.profilePicture ? (
                            <Text style={[styles.errorText, { textAlign: 'center', marginTop: 8 }]}>{formErrors.profilePicture}</Text>
                        ) : null}
                    </View>

                    <View style={[styles.section, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Identity</Text>
                        <InputField
                            label="Full Name *"
                            value={form.fullName}
                            onChangeText={(value) => handleUpdateField('fullName', value)}
                            error={formErrors.fullName}
                            theme={theme}
                        />
                        <InputField
                            label="Mobile Number *"
                            value={form.mobileNumber}
                            onChangeText={(value) => handleUpdateField('mobileNumber', value)}
                            keyboardType="phone-pad"
                            error={formErrors.mobileNumber}
                            theme={theme}
                        />
                        <InputField
                            label="Email ID"
                            value={user.email}
                            editable={false}
                            theme={theme}
                        />
                        <InputField
                            label="City / Location *"
                            value={form.city}
                            onChangeText={(value) => handleUpdateField('city', value)}
                            error={formErrors.city}
                            theme={theme}
                        />
                    </View>

                    <View style={[styles.section, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Medical Credentials</Text>
                        <InputField
                            label="Degree (MBBS / MD / MS / BAMS) *"
                            value={form.degree}
                            onChangeText={(value) => handleUpdateField('degree', value)}
                            error={formErrors.degree}
                            theme={theme}
                        />
                        <InputField
                            label="Specialization *"
                            value={form.specialization}
                            onChangeText={(value) => handleUpdateField('specialization', value)}
                            error={formErrors.specialization}
                            theme={theme}
                        />
                        <InputField
                            label="University / College *"
                            value={form.university}
                            onChangeText={(value) => handleUpdateField('university', value)}
                            error={formErrors.university}
                            theme={theme}
                        />
                        <InputField
                            label="Year of Completion *"
                            value={form.yearOfCompletion}
                            onChangeText={(value) => handleUpdateField('yearOfCompletion', sanitizeNumberInput(value))}
                            keyboardType="number-pad"
                            error={formErrors.yearOfCompletion}
                            theme={theme}
                        />
                        <InputField
                            label="Medical Registration Number *"
                            value={form.registrationNumber}
                            onChangeText={(value) => handleUpdateField('registrationNumber', value)}
                            error={formErrors.registrationNumber}
                            theme={theme}
                        />
                        <InputField
                            label="Registration Council (State / NMC) *"
                            value={form.registrationCouncil}
                            onChangeText={(value) => handleUpdateField('registrationCouncil', value)}
                            error={formErrors.registrationCouncil}
                            theme={theme}
                        />
                    </View>

                    <View style={[styles.section, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Practice & Consultation</Text>
                        <InputField
                            label="Years of Experience *"
                            value={form.experienceYears}
                            onChangeText={(value) => handleUpdateField('experienceYears', sanitizeNumberInput(value))}
                            keyboardType="number-pad"
                            error={formErrors.experienceYears}
                            theme={theme}
                        />
                        <InputField
                            label="Current Hospital / Clinic *"
                            value={form.currentHospitalClinic}
                            onChangeText={(value) => handleUpdateField('currentHospitalClinic', value)}
                            error={formErrors.currentHospitalClinic}
                            theme={theme}
                        />
                        <InputField
                            label="Previous Work Details *"
                            value={form.previousWorkDetails}
                            onChangeText={(value) => handleUpdateField('previousWorkDetails', value)}
                            multiline
                            error={formErrors.previousWorkDetails}
                            theme={theme}
                        />
                        <InputField
                            label="Areas of Expertise * (comma separated)"
                            value={form.areasOfExpertise}
                            onChangeText={(value) => handleUpdateField('areasOfExpertise', value)}
                            error={formErrors.areasOfExpertise}
                            theme={theme}
                        />
                        <InputField
                            label="Languages Spoken * (comma separated)"
                            value={form.languagesSpoken}
                            onChangeText={(value) => handleUpdateField('languagesSpoken', value)}
                            error={formErrors.languagesSpoken}
                            theme={theme}
                        />
                        <InputField
                            label="Consultation Fees (INR) *"
                            value={form.consultationFee}
                            onChangeText={(value) => handleUpdateField('consultationFee', sanitizeNumberInput(value))}
                            keyboardType="number-pad"
                            error={formErrors.consultationFee}
                            theme={theme}
                        />
                        <InputField
                            label="Consultation Mode *"
                            value={form.treatmentApproach}
                            onPress={() => setShowConsultationModePicker((prev) => !prev)}
                            theme={theme}
                            isDropdown
                            error={formErrors.treatmentApproach}
                        />
                        {showConsultationModePicker && (
                            <View style={[styles.dropdownCard, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                                {consultationModes.map((mode) => (
                                    <TouchableOpacity
                                        key={mode}
                                        style={styles.dropdownItem}
                                        onPress={() => {
                                            handleUpdateField('treatmentApproach', mode);
                                            setShowConsultationModePicker(false);
                                        }}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={[styles.dropdownText, { color: theme.text }]}>{mode}</Text>
                                        {form.treatmentApproach === mode && <CheckCircle2 size={16} color={theme.tint} />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}
                    </View>

                    <TouchableOpacity
                        style={[styles.saveButton, { backgroundColor: theme.tint }, saving && styles.saveButtonDisabled]}
                        onPress={handleSaveMandatoryProfile}
                        disabled={saving}
                        activeOpacity={0.9}
                    >
                        {saving ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <View style={styles.saveButtonContent}>
                                <Save size={18} color="#fff" />
                                <Text style={styles.saveButtonText}>Save and Continue</Text>
                                <CheckCircle2 size={18} color="#fff" />
                            </View>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </DoctorSafeScreen>
    );
}

type InputFieldProps = {
    label: string;
    value: string;
    onChangeText?: (value: string) => void;
    onPress?: () => void;
    keyboardType?: 'default' | 'number-pad' | 'phone-pad' | 'email-address';
    editable?: boolean;
    multiline?: boolean;
    isDropdown?: boolean;
    error?: string;
    theme: typeof Colors.light;
};

const InputField = ({
    label,
    value,
    onChangeText,
    onPress,
    keyboardType = 'default',
    editable = true,
    multiline = false,
    isDropdown = false,
    error,
    theme,
}: InputFieldProps) => {
    return (
        <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>{label}</Text>
            {isDropdown ? (
                <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={onPress}
                    style={[
                        styles.input,
                        {
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderColor: error ? (theme.danger || '#EF4444') : theme.borderColor,
                            borderWidth: error ? 1.5 : 1,
                            backgroundColor: theme.background,
                        },
                    ]}
                >
                    <Text style={{ color: theme.text, fontWeight: '600' }}>{value || 'Select'}</Text>
                </TouchableOpacity>
            ) : (
                <TextInput
                    value={value}
                    onChangeText={onChangeText}
                    keyboardType={keyboardType}
                    editable={editable}
                    multiline={multiline}
                    style={[
                        styles.input,
                        multiline && styles.multilineInput,
                        {
                            color: theme.text,
                            borderColor: error ? (theme.danger || '#EF4444') : theme.borderColor,
                            borderWidth: error ? 1.5 : 1,
                            backgroundColor: editable ? theme.background : theme.borderColor + '33',
                        },
                    ]}
                    placeholderTextColor={theme.textSecondary}
                />
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    infoCard: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
    },
    title: {
        fontSize: 20,
        fontWeight: '800',
    },
    subtitle: {
        marginTop: 6,
        fontSize: 13,
        lineHeight: 18,
    },
    photoSection: {
        alignItems: 'center',
        marginTop: 14,
        marginBottom: 4,
    },
    photoButton: {
        width: 112,
        height: 112,
        borderRadius: 56,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    photoImage: {
        width: '100%',
        height: '100%',
    },
    photoPlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    photoPlaceholderText: {
        marginTop: 6,
        fontSize: 11,
        textAlign: 'center',
        fontWeight: '600',
    },
    section: {
        marginTop: 14,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '800',
        marginBottom: 6,
    },
    inputGroup: {
        marginTop: 10,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 6,
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        fontWeight: '500',
        minHeight: 44,
    },
    dropdownCard: {
        marginTop: 6,
        borderWidth: 1,
        borderRadius: 10,
    },
    dropdownItem: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    dropdownText: {
        fontSize: 14,
        fontWeight: '600',
    },
    multilineInput: {
        minHeight: 78,
        textAlignVertical: 'top',
    },
    saveButton: {
        marginTop: 18,
        borderRadius: 12,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
    },
    saveButtonDisabled: {
        opacity: 0.7,
    },
    saveButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
    },
    errorText: {
        marginTop: 4,
        marginLeft: 2,
        color: '#EF4444',
        fontSize: 12,
        fontWeight: '500',
    },
});
