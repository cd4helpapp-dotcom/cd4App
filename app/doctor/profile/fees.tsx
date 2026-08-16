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
import { ChevronLeft, Banknote, Save, CheckCircle2 } from 'lucide-react-native';
import Colors from '../../../constants/Colors';
import { useDoctorProfile, useUpdateDoctorProfile } from '../../../hooks/useDoctor';
import Toast from 'react-native-toast-message';
import DoctorSafeScreen from '../../../ui/doctor/DoctorSafeScreen';

export default function ConsultationFeesScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [fee, setFee] = useState('');
    const { data: profileResponse, isLoading: loading } = useDoctorProfile();
    const updateProfileMutation = useUpdateDoctorProfile();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (profileResponse?.success && profileResponse.data) {
            // Assuming fee is stored as "₹500" or just "500"
            const feeValue = profileResponse.data.fee || '';
            setFee(feeValue.replace('₹', ''));
        }
    }, [profileResponse]);

    const handleSave = async () => {
        if (!fee.trim()) {
            Toast.show({
                type: 'error',
                text1: 'Invalid Input',
                text2: 'Please enter a valid consultation fee',
            });
            return;
        }

        setSaving(true);
        updateProfileMutation.mutate({ fee: `₹${fee.trim()}` }, {
            onSuccess: () => {
                Toast.show({
                    type: 'success',
                    text1: 'Success',
                    text2: 'Consultation fee updated successfully',
                });
                router.back();
            },
            onError: (error) => {
                console.error('Update fee error:', error);
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
            <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']}>
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: theme.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
            <View style={[styles.header, { paddingTop: 10 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <ChevronLeft size={24} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Consultation Fees</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={[styles.infoCard, { backgroundColor: theme.tint + '10', borderColor: theme.tint + '30' }]}>
                    <Banknote size={24} color={theme.tint} />
                    <View style={styles.infoTextContainer}>
                        <Text style={[styles.infoTitle, { color: theme.text }]}>Set Your Fee</Text>
                        <Text style={[styles.infoSubtitle, { color: theme.textSecondary }]}>
                            This fee will be displayed to patients when they book an appointment with you.
                        </Text>
                    </View>
                </View>

                <View style={styles.inputSection}>
                    <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>CONSULTATION FEE (INR)</Text>
                    <View style={[styles.inputContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.currencyPrefix, { color: theme.textSecondary }]}>₹</Text>
                        <TextInput
                            style={[styles.input, { color: theme.text }]}
                            value={fee}
                            onChangeText={setFee}
                            placeholder="e.g. 500"
                            placeholderTextColor={theme.tabIconDefault}
                            keyboardType="numeric"
                        />
                    </View>
                    <Text style={[styles.inputHint, { color: theme.textSecondary }]}>
                        Patients will pay this amount for a single consultation session.
                    </Text>
                </View>

                <View style={styles.perksContainer}>
                    <View style={styles.perkItem}>
                        <CheckCircle2 size={18} color={theme.success} />
                        <Text style={[styles.perkText, { color: theme.text }]}>Instant online payments</Text>
                    </View>
                    <View style={styles.perkItem}>
                        <CheckCircle2 size={18} color={theme.success} />
                        <Text style={[styles.perkText, { color: theme.text }]}>Transparent earnings tracking</Text>
                    </View>
                    <View style={styles.perkItem}>
                        <CheckCircle2 size={18} color={theme.success} />
                        <Text style={[styles.perkText, { color: theme.text }]}>Adjustable anytime</Text>
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
                            <Text style={styles.saveButtonText}>Save Changes</Text>
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
        marginBottom: 32,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 8,
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
    currencyPrefix: {
        fontSize: 20,
        fontWeight: '600',
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
    },
    inputHint: {
        fontSize: 12,
        marginTop: 8,
        fontStyle: 'italic',
    },
    perksContainer: {
        gap: 12,
    },
    perkItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    perkText: {
        fontSize: 14,
        marginLeft: 10,
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
