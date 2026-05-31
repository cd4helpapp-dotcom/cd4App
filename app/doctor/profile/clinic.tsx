import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    useColorScheme,
    KeyboardAvoidingView,
    Platform,
    ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, Building2, Save, GraduationCap, MapPin } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { useDoctorProfile, useUpdateDoctorProfile } from '../../../hooks/useDoctor';
import Toast from 'react-native-toast-message';
import DoctorSafeScreen from '../../../ui/doctor/DoctorSafeScreen';

export default function ClinicDetailsScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const { data: profileResponse, isLoading: loading } = useDoctorProfile();
    const updateProfileMutation = useUpdateDoctorProfile();
    const [saving, setSaving] = useState(false);

    const [formData, setFormData] = useState({
        city: '',
        specialization: '',
        experience: '',
    });

    useEffect(() => {
        if (profileResponse?.success && profileResponse.data) {
            const doc = profileResponse.data;
            setFormData({
                city: doc.city || '',
                specialization: doc.specialization || '',
                experience: doc.experience || '',
            });
        }
    }, [profileResponse]);

    const handleSave = async () => {
        const { city, specialization, experience } = formData;
        if (!city.trim() || !specialization.trim() || !experience.trim()) {
            Toast.show({
                type: 'error',
                text1: 'Missing Fields',
                text2: 'Please fill in all details',
            });
            return;
        }

        setSaving(true);
        updateProfileMutation.mutate(formData, {
            onSuccess: () => {
                Toast.show({
                    type: 'success',
                    text1: 'Success',
                    text2: 'Clinic details updated successfully',
                });
                router.back();
            },
            onError: (error) => {
                console.error('Update clinic error:', error);
                Toast.show({
                    type: 'error',
                    text1: 'Update Failed',
                    text2: 'Could not save changes. Please try again.',
                });
            },
            onSettled: () => {
                setSaving(false);
            }
        });
    };

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={theme.tint} />
            </View>
        );
    }

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['top', 'bottom']}>
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: theme.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
            <View style={[styles.header, { paddingTop: 10 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <ChevronLeft size={24} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Clinic & Experience</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={[styles.infoCard, { backgroundColor: theme.tint + '10', borderColor: theme.tint + '30' }]}>
                    <Building2 size={24} color={theme.tint} />
                    <View style={styles.infoTextContainer}>
                        <Text style={[styles.infoTitle, { color: theme.text }]}>Professional Details</Text>
                        <Text style={[styles.infoSubtitle, { color: theme.textSecondary }]}>
                            Update your practice location, specialization, and professional experience.
                        </Text>
                    </View>
                </View>

                {/* City */}
                <View style={styles.inputSection}>
                    <View style={styles.labelRow}>
                        <MapPin size={14} color={theme.textSecondary} />
                        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>PRACTICE CITY</Text>
                    </View>
                    <View style={[styles.inputContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <TextInput
                            style={[styles.input, { color: theme.text }]}
                            value={formData.city}
                            onChangeText={(val) => setFormData(prev => ({ ...prev, city: val }))}
                            placeholder="e.g. Mumbai, Maharashtra"
                            placeholderTextColor={theme.tabIconDefault}
                        />
                    </View>
                </View>

                {/* Specialization */}
                <View style={styles.inputSection}>
                    <View style={styles.labelRow}>
                        <Building2 size={14} color={theme.textSecondary} />
                        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>SPECIALIZATION</Text>
                    </View>
                    <View style={[styles.inputContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <TextInput
                            style={[styles.input, { color: theme.text }]}
                            value={formData.specialization}
                            onChangeText={(val) => setFormData(prev => ({ ...prev, specialization: val }))}
                            placeholder="e.g. Cardiologist"
                            placeholderTextColor={theme.tabIconDefault}
                        />
                    </View>
                </View>

                {/* Experience */}
                <View style={styles.inputSection}>
                    <View style={styles.labelRow}>
                        <GraduationCap size={14} color={theme.textSecondary} />
                        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>YEARS OF EXPERIENCE</Text>
                    </View>
                    <View style={[styles.inputContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <TextInput
                            style={[styles.input, { color: theme.text }]}
                            value={formData.experience}
                            onChangeText={(val) => setFormData(prev => ({ ...prev, experience: val }))}
                            placeholder="e.g. 10 Years"
                            placeholderTextColor={theme.tabIconDefault}
                        />
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: 20 }]}>
                <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: theme.tint }]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Save size={20} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.saveButtonText}>Save Details</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
            </KeyboardAvoidingView>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    content: {
        padding: 20,
    },
    infoCard: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 24,
        alignItems: 'center'
    },
    infoTextContainer: {
        marginLeft: 16,
        flex: 1,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 4,
    },
    infoSubtitle: {
        fontSize: 13,
        lineHeight: 18,
    },
    inputSection: {
        marginBottom: 24,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 6,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 16,
        height: 56,
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    footer: {
        padding: 20,
    },
    saveButton: {
        height: 56,
        borderRadius: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
