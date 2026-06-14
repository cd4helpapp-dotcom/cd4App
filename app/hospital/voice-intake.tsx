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
import { ExternalLink, FileText, Mic, MicOff, Sparkles } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import {
    useCreateHospitalVoiceIntake,
    useHospitalDoctors,
    useHospitalPatients,
    useHospitalVoiceIntakes,
} from '../../hooks/useHospital';

type SpeechRecognitionModule = {
    addListener?: (eventName: 'result' | 'error' | 'end', listener: (event: any) => void) => { remove?: () => void };
    requestPermissionsAsync?: () => Promise<{ granted?: boolean; status?: string }>;
    isRecognitionAvailable?: () => boolean;
    start?: (options?: Record<string, unknown>) => void;
    stop?: () => void;
    abort?: () => void;
};

const loadSpeechRecognitionModule = (): SpeechRecognitionModule | null => {
    try {
        const speechRecognition = require('expo-speech-recognition') as {
            ExpoSpeechRecognitionModule?: SpeechRecognitionModule;
        };
        return speechRecognition.ExpoSpeechRecognitionModule ?? null;
    } catch {
        return null;
    }
};

const ExpoSpeechRecognitionModule = loadSpeechRecognitionModule();

const extractTranscript = (event: any): string => {
    const direct = typeof event?.transcript === 'string' ? event.transcript : '';
    const nested = Array.isArray(event?.results) ? event.results[0]?.transcript || event.results[0]?.[0]?.transcript : '';
    return String(direct || nested || '').trim();
};

export default function HospitalVoiceIntakeScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const doctorsQuery = useHospitalDoctors();
    const patientsQuery = useHospitalPatients();
    const voiceQuery = useHospitalVoiceIntakes();
    const createVoiceIntake = useCreateHospitalVoiceIntake();

    const [title, setTitle] = React.useState('Hospital voice intake');
    const [transcript, setTranscript] = React.useState('');
    const [selectedDoctorId, setSelectedDoctorId] = React.useState<string | undefined>(undefined);
    const [selectedPatientId, setSelectedPatientId] = React.useState<string | undefined>(undefined);
    const [isListening, setIsListening] = React.useState(false);
    const [voiceStatus, setVoiceStatus] = React.useState('Tap mic to capture symptoms, visit context, and patient concerns.');

    const doctors = doctorsQuery.data || [];
    const patients = patientsQuery.data || [];
    const voiceIntakes = voiceQuery.data || [];

    React.useEffect(() => {
        if (!ExpoSpeechRecognitionModule?.addListener) return;

        const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
            const nextTranscript = extractTranscript(event);
            if (!nextTranscript) return;
            setTranscript((current) => {
                if (!current.trim()) return nextTranscript;
                if (current.toLowerCase().includes(nextTranscript.toLowerCase())) return current;
                return `${current.trim()} ${nextTranscript}`;
            });
        });

        const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
            setIsListening(false);
            setVoiceStatus('Voice capture stopped. Review the transcript before generating the doctor summary.');
        });

        const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
            setIsListening(false);
            setVoiceStatus('Voice capture failed. You can type the symptoms manually.');
            if (__DEV__) console.warn('[HospitalVoice] recognition error:', event?.message || event);
        });

        return () => {
            resultSub?.remove?.();
            endSub?.remove?.();
            errorSub?.remove?.();
            ExpoSpeechRecognitionModule?.abort?.();
        };
    }, []);

    const handleMicPress = async () => {
        if (isListening) {
            ExpoSpeechRecognitionModule?.stop?.();
            setIsListening(false);
            setVoiceStatus('Finalizing voice capture...');
            return;
        }

        if (!ExpoSpeechRecognitionModule) {
            Toast.show({
                type: 'error',
                text1: 'Voice not available',
                text2: 'Use a dev/preview build with speech recognition enabled.',
            });
            setVoiceStatus('Voice is unavailable on this device. Type the intake manually.');
            return;
        }

        try {
            const available =
                typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function'
                    ? ExpoSpeechRecognitionModule.isRecognitionAvailable()
                    : true;
            if (!available) {
                throw new Error('Speech recognition is not available on this device.');
            }

            const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync?.();
            if (permission && permission.granted === false && permission.status !== 'granted') {
                throw new Error('Microphone permission denied.');
            }

            setIsListening(true);
            setVoiceStatus('Listening... capture symptoms, duration, severity, and visit context.');
            ExpoSpeechRecognitionModule.start?.({
                lang: 'en-IN',
                interimResults: true,
                continuous: true,
            });
        } catch (error: any) {
            setIsListening(false);
            setVoiceStatus('Voice could not start. Type the intake manually.');
            Toast.show({
                type: 'error',
                text1: 'Voice input error',
                text2: error?.message || 'Could not start microphone.',
            });
        }
    };

    const handleSave = async () => {
        const cleanTranscript = transcript.trim();
        if (!cleanTranscript) {
            Toast.show({ type: 'error', text1: 'Transcript required', text2: 'Capture or type patient symptoms before saving.' });
            return;
        }

        try {
            const result = await createVoiceIntake.mutateAsync({
                title,
                patientId: selectedPatientId,
                doctorId: selectedDoctorId,
                transcript: cleanTranscript,
                language: 'Hindi / English',
            });
            setTranscript('');
            setTitle('Hospital voice intake');
            Toast.show({
                type: 'success',
                text1: 'Doctor summary ready',
                text2: result.source === 'openai' ? 'AI summary saved for review.' : 'Summary saved for doctor review.',
            });
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Could not save intake',
                text2: error?.message || 'Please try again.',
            });
        }
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.background }]}
            contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
            refreshControl={<RefreshControl refreshing={voiceQuery.isRefetching} onRefresh={voiceQuery.refetch} tintColor={theme.tint} />}
            keyboardShouldPersistTaps="handled"
        >
            <Text style={[styles.kicker, { color: theme.tint }]}>Hospital Voice</Text>
            <Text style={[styles.title, { color: theme.text }]}>Create doctor-ready intake notes.</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Record or type the patient narration, assign it to a doctor or patient, and generate a structured review note.
            </Text>

            <View style={[styles.composerCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Intake title"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }]}
                />

                <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>Patient</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    <Chip label="Unassigned" selected={!selectedPatientId} onPress={() => setSelectedPatientId(undefined)} theme={theme} />
                    {patients.map((patient) => (
                        <Chip
                            key={patient.id}
                            label={patient.patientName}
                            selected={selectedPatientId === patient.patientId}
                            onPress={() => setSelectedPatientId(patient.patientId)}
                            theme={theme}
                        />
                    ))}
                </ScrollView>

                <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>Doctor</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                    <Chip label="Unassigned" selected={!selectedDoctorId} onPress={() => setSelectedDoctorId(undefined)} theme={theme} />
                    {doctors.map((doctor) => (
                        <Chip
                            key={doctor.id}
                            label={doctor.name}
                            selected={selectedDoctorId === doctor.doctorId}
                            onPress={() => setSelectedDoctorId(doctor.doctorId)}
                            theme={theme}
                        />
                    ))}
                </ScrollView>

                <View style={[styles.voiceStatus, { backgroundColor: theme.successLight }]}>
                    <Mic size={16} color={theme.tint} />
                    <Text style={[styles.voiceStatusText, { color: theme.text }]}>{voiceStatus}</Text>
                </View>

                <TextInput
                    value={transcript}
                    onChangeText={setTranscript}
                    placeholder="Voice transcript or typed symptoms"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    textAlignVertical="top"
                    style={[
                        styles.transcriptInput,
                        { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background },
                    ]}
                />

                <View style={styles.actionRow}>
                    <TouchableOpacity
                        style={[styles.voiceButton, { backgroundColor: isListening ? theme.error : theme.tint }]}
                        onPress={handleMicPress}
                    >
                        {isListening ? <MicOff size={18} color={theme.buttonText} /> : <Mic size={18} color={theme.buttonText} />}
                        <Text style={[styles.voiceButtonText, { color: theme.buttonText }]}>{isListening ? 'Stop' : 'Start voice'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.saveButton, { borderColor: theme.borderColor }, createVoiceIntake.isPending && styles.disabledButton]}
                        onPress={handleSave}
                        disabled={createVoiceIntake.isPending}
                    >
                        {createVoiceIntake.isPending ? <ActivityIndicator color={theme.tint} /> : <Sparkles size={18} color={theme.tint} />}
                        <Text style={[styles.saveButtonText, { color: theme.tint }]}>Generate summary</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Saved intakes</Text>
                <Text style={[styles.countText, { color: theme.textSecondary }]}>{voiceIntakes.length}</Text>
            </View>

            {voiceQuery.isLoading ? (
                <ActivityIndicator color={theme.tint} style={{ marginTop: 24 }} />
            ) : voiceIntakes.length ? (
                voiceIntakes.map((item) => (
                    <View key={item.id} style={[styles.intakeCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <FileText size={18} color={theme.tint} />
                        <View style={{ flex: 1 }}>
                            <View style={styles.intakeHeader}>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.intakeTitle, { color: theme.text }]}>{item.title}</Text>
                                    <Text style={[styles.intakeMeta, { color: theme.textSecondary }]}>
                                        {item.status.replace(/_/g, ' ')}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    style={[styles.pdfBadge, { borderColor: theme.borderColor, backgroundColor: theme.successLight }]}
                                    onPress={() =>
                                        router.push({
                                            pathname: '/hospital/voice-intake-report',
                                            params: { id: item.id },
                                        })
                                    }
                                >
                                    <FileText size={12} color={theme.tint} />
                                    <Text style={[styles.pdfBadgeText, { color: theme.tint }]}>PDF</Text>
                                    <ExternalLink size={10} color={theme.tint} />
                                </TouchableOpacity>
                            </View>
                            {item.aiSummary ? (
                                <Text style={[styles.intakeSummary, { color: theme.textSecondary }]} numberOfLines={2}>
                                    {item.aiSummary}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                ))
            ) : (
                <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>No voice intakes yet</Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        Start voice capture or type symptoms to create the first hospital intake.
                    </Text>
                </View>
            )}
        </ScrollView>
    );
}

function Chip({ label, selected, onPress, theme }: { label: string; selected: boolean; onPress: () => void; theme: any }) {
    return (
        <TouchableOpacity
            style={[
                styles.chip,
                { borderColor: theme.borderColor, backgroundColor: selected ? theme.successLight : theme.background },
            ]}
            onPress={onPress}
        >
            <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]} numberOfLines={1}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 34 },
    kicker: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7 },
    title: { fontSize: 27, fontWeight: '900', lineHeight: 33 },
    subtitle: { marginTop: 8, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    composerCard: { marginTop: 20, borderWidth: 1, borderRadius: 20, padding: 16 },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '600', marginBottom: 10 },
    smallLabel: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
    chipRow: { gap: 8, paddingVertical: 10 },
    chip: { maxWidth: 190, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
    chipText: { fontSize: 12, fontWeight: '800' },
    voiceStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, padding: 12, marginVertical: 8 },
    voiceStatusText: { flex: 1, fontSize: 12, fontWeight: '800' },
    transcriptInput: { minHeight: 140, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    voiceButton: { flex: 1, height: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    voiceButtonText: { fontSize: 14, fontWeight: '900' },
    saveButton: { flex: 1, height: 48, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    saveButtonText: { fontSize: 14, fontWeight: '900' },
    disabledButton: { opacity: 0.72 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
    sectionTitle: { fontSize: 19, fontWeight: '900' },
    countText: { fontSize: 13, fontWeight: '800' },
    intakeCard: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: 'row', gap: 12 },
    intakeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    intakeTitle: { fontSize: 15, fontWeight: '900' },
    intakeMeta: { marginTop: 3, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    intakeSummary: { marginTop: 7, fontSize: 12, lineHeight: 18, fontWeight: '600' },
    pdfBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
    pdfBadgeText: { fontSize: 11, fontWeight: '900' },
    emptyCard: { borderWidth: 1, borderRadius: 18, padding: 18, marginTop: 4 },
    emptyTitle: { fontSize: 16, fontWeight: '900' },
    emptyText: { marginTop: 6, fontSize: 13, lineHeight: 20, fontWeight: '600' },
});
