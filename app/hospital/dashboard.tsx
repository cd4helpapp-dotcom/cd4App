import React from 'react';
import {
    ActivityIndicator,
    Linking,
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
import { Building2, ClipboardList, Clock, ExternalLink, FileText, Mail, MapPin, Mic, MicOff, Phone, Settings, Sparkles, Stethoscope, Users, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useHospitalDoctors, useHospitalPatients, useHospitalProfile, useHospitalStats, useHospitalVoiceIntakes, useCreateHospitalVoiceIntake, useLinkHospitalDoctor, useLinkHospitalPatient } from '../../hooks/useHospital';
import { supabase } from '../../src/lib/supabase';
import { connectRealtimeVoice, type RealtimeVoiceHandle } from '../../src/services/realtimeVoice';

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

const formatStatus = (value?: string) =>
    (value || 'pending')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

// Dynamic Voice Triage uses the hospital-voice-intake AI endpoint.

export default function HospitalDashboard() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const isDarkTheme = colorScheme === 'dark';
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuthContext();

    const profileQuery = useHospitalProfile();
    const statsQuery = useHospitalStats();
    const doctorsQuery = useHospitalDoctors();
    const patientsQuery = useHospitalPatients();
    const voiceQuery = useHospitalVoiceIntakes();
    const createVoiceIntake = useCreateHospitalVoiceIntake();

    const doctors = doctorsQuery.data || [];
    const patients = patientsQuery.data || [];

    const isLoading = profileQuery.isLoading || statsQuery.isLoading;
    const isRefreshing =
        profileQuery.isRefetching ||
        statsQuery.isRefetching ||
        doctorsQuery.isRefetching ||
        patientsQuery.isRefetching ||
        voiceQuery.isRefetching;

    const linkDoctor = useLinkHospitalDoctor();
    const linkPatient = useLinkHospitalPatient();

    const [isVoiceModalVisible, setIsVoiceModalVisible] = React.useState(false);
    const [voiceTitle, setVoiceTitle] = React.useState('');
    const [transcript, setTranscript] = React.useState('');
    const [selectedPatientId, setSelectedPatientId] = React.useState<string | undefined>(undefined);
    const [selectedDoctorId, setSelectedDoctorId] = React.useState<string | undefined>(undefined);
    const [isListening, setIsListening] = React.useState(false);
    const [voiceStatus, setVoiceStatus] = React.useState('Tap mic to capture symptoms, visit context, and patient concerns.');

    const activeDoctor = React.useMemo(() => {
        return doctors.find((d) => d.doctorId === selectedDoctorId);
    }, [doctors, selectedDoctorId]);

    const activePatient = React.useMemo(() => {
        return patients.find((p) => p.patientId === selectedPatientId);
    }, [patients, selectedPatientId]);

    const greetingText = React.useMemo(() => {
        const docName = activeDoctor ? activeDoctor.name : '';
        const docSpec = activeDoctor ? activeDoctor.specialization || activeDoctor.department : '';
        const patName = activePatient ? activePatient.patientName : '';

        let msg = 'Hello!';
        if (patName) {
            msg += ` I will help record the history for patient ${patName}.`;
        } else {
            msg += ' I will help record the patient history.';
        }
        if (docName) {
            msg += ` This will prepare details for ${docName}${docSpec ? ` (${docSpec})` : ''}.`;
        }
        msg += ' What are the chief complaints or symptoms? (मुख्य लक्षण क्या हैं?)';
        return msg;
    }, [activeDoctor, activePatient]);

    const INITIAL_CHAT = React.useMemo(() => [
        {
            role: 'assistant' as const,
            content: greetingText,
        },
    ], [greetingText]);

    // Triage Assistant State
    const [isTriageActive, setIsTriageActive] = React.useState(true);
    const [triageStep, setTriageStep] = React.useState(0); // 0: Welcome, 1: Chatting, 2: Review/Save
    const [chatHistory, setChatHistory] = React.useState<Array<{ role: 'user' | 'assistant'; content: string }>>(INITIAL_CHAT);
    const [activeUserInput, setActiveUserInput] = React.useState('');
    const [isChatLoading, setIsChatLoading] = React.useState(false);
    const hospitalRealtimeRef = React.useRef<RealtimeVoiceHandle | null>(null);
    const hospitalRealtimeStartingRef = React.useRef(false);

    const triageStepRef = React.useRef(0);
    const isTriageActiveRef = React.useRef(true);

    React.useEffect(() => {
        triageStepRef.current = triageStep;
    }, [triageStep]);

    React.useEffect(() => {
        isTriageActiveRef.current = isTriageActive;
    }, [isTriageActive]);

    // Inline additions state
    const [isAddingDocInline, setIsAddingDocInline] = React.useState(false);
    const [inlineDocIdentifier, setInlineDocIdentifier] = React.useState('');
    const [inlineDocDept, setInlineDocDept] = React.useState('');

    const [isAddingPatInline, setIsAddingPatInline] = React.useState(false);
    const [inlinePatEmail, setInlinePatEmail] = React.useState('');
    const [inlinePatNotes, setInlinePatNotes] = React.useState('');

    // Search states for assignment dropdowns
    const [patientSearch, setPatientSearch] = React.useState('');
    const [doctorSearch, setDoctorSearch] = React.useState('');
    const [debouncedPatientSearch, setDebouncedPatientSearch] = React.useState('');
    const [debouncedDoctorSearch, setDebouncedDoctorSearch] = React.useState('');

    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedPatientSearch(patientSearch.trim().toLowerCase()), 220);
        return () => clearTimeout(timer);
    }, [patientSearch]);

    React.useEffect(() => {
        const timer = setTimeout(() => setDebouncedDoctorSearch(doctorSearch.trim().toLowerCase()), 220);
        return () => clearTimeout(timer);
    }, [doctorSearch]);

    const recentDoctors = (doctorsQuery.data || []).slice(0, 3);
    const recentPatients = (patientsQuery.data || []).slice(0, 3);
    const recentVoice = (voiceQuery.data || []).slice(0, 3);

    const filteredPatients = patients.filter((patient) => {
        const matchesSearch = patient.patientName.toLowerCase().includes(debouncedPatientSearch) ||
            patient.patientEmail.toLowerCase().includes(debouncedPatientSearch);
        const isSelected = selectedPatientId === patient.patientId;
        return matchesSearch || isSelected;
    });

    const filteredDoctors = doctors.filter((doctor) => {
        const matchesSearch = doctor.name.toLowerCase().includes(debouncedDoctorSearch) ||
            doctor.specialization.toLowerCase().includes(debouncedDoctorSearch) ||
            (doctor.department || '').toLowerCase().includes(debouncedDoctorSearch);
        const isSelected = selectedDoctorId === doctor.doctorId;
        return matchesSearch || isSelected;
    });

    const handleInlineAddDoctor = async () => {
        const cleanIdentifier = inlineDocIdentifier.trim();
        if (!cleanIdentifier) {
            Toast.show({ type: 'error', text1: 'Doctor detail required', text2: 'Enter doctor email or registration number.' });
            return;
        }

        try {
            await linkDoctor.mutateAsync({
                identifier: cleanIdentifier,
                department: inlineDocDept.trim() || undefined,
            });
            setInlineDocIdentifier('');
            setInlineDocDept('');
            setIsAddingDocInline(false);
            const updatedDoctors = await doctorsQuery.refetch();
            const freshList = updatedDoctors.data || [];
            const newDoc = freshList.find(d => d.email.toLowerCase() === cleanIdentifier.toLowerCase() || d.registrationNumber === cleanIdentifier);
            if (newDoc) {
                setSelectedDoctorId(newDoc.doctorId);
            }
            Toast.show({ type: 'success', text1: 'Doctor linked', text2: 'Doctor has been added and selected.' });
        } catch (error: any) {
            Toast.show({ type: 'error', text1: 'Could not link doctor', text2: error?.message || 'Check details and try again.' });
        }
    };

    const handleInlineAddPatient = async () => {
        const cleanEmail = inlinePatEmail.trim().toLowerCase();
        if (!cleanEmail) {
            Toast.show({ type: 'error', text1: 'Patient email required', text2: 'Enter patient CD4 email address.' });
            return;
        }

        try {
            await linkPatient.mutateAsync({
                email: cleanEmail,
                notes: inlinePatNotes.trim() || undefined,
            });
            setInlinePatEmail('');
            setInlinePatNotes('');
            setIsAddingPatInline(false);
            const updatedPatients = await patientsQuery.refetch();
            const freshList = updatedPatients.data || [];
            const newPat = freshList.find(p => p.patientEmail.toLowerCase() === cleanEmail.toLowerCase());
            if (newPat) {
                setSelectedPatientId(newPat.patientId);
            }
            Toast.show({ type: 'success', text1: 'Patient linked', text2: 'Patient has been added and selected.' });
        } catch (error: any) {
            Toast.show({ type: 'error', text1: 'Could not link patient', text2: error?.message || 'Check email and try again.' });
        }
    };

    const refreshAll = React.useCallback(() => {
        void profileQuery.refetch();
        void statsQuery.refetch();
        void doctorsQuery.refetch();
        void patientsQuery.refetch();
        void voiceQuery.refetch();
    }, [doctorsQuery, patientsQuery, profileQuery, statsQuery, voiceQuery]);

    React.useEffect(() => {
        if (!ExpoSpeechRecognitionModule?.addListener) return;

        const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
            const nextTranscript = extractTranscript(event);
            if (!nextTranscript) return;

            const activeStep = triageStepRef.current;
            const activeTriage = isTriageActiveRef.current;

            if (activeTriage && activeStep === 1) {
                setActiveUserInput((current) => {
                    if (!current.trim()) return nextTranscript;
                    if (current.toLowerCase().includes(nextTranscript.toLowerCase())) return current;
                    return `${current.trim()} ${nextTranscript}`;
                });
            } else {
                setTranscript((current) => {
                    if (!current.trim()) return nextTranscript;
                    if (current.toLowerCase().includes(nextTranscript.toLowerCase())) return current;
                    return `${current.trim()} ${nextTranscript}`;
                });
            }
        });

        const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
            setIsListening(false);
            const activeStep = triageStepRef.current;
            const activeTriage = isTriageActiveRef.current;
            if (activeTriage && activeStep === 1) {
                setVoiceStatus('Voice capture stopped. Review your response or type/edit before sending.');
            } else {
                setVoiceStatus('Voice capture stopped. Review the transcript before generating the doctor summary.');
            }
        });

        const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
            setIsListening(false);
            const activeTriage = isTriageActiveRef.current;
            if (activeTriage) {
                setVoiceStatus('Voice capture failed. You can type your response manually.');
            } else {
                setVoiceStatus('Voice capture failed. You can type the symptoms manually.');
            }
            if (__DEV__) console.warn('[HospitalVoice] recognition error:', event?.message || event);
        });

        return () => {
            resultSub?.remove?.();
            endSub?.remove?.();
            errorSub?.remove?.();
            ExpoSpeechRecognitionModule?.abort?.();
        };
    }, []);

    React.useEffect(() => {
        if (!isVoiceModalVisible) {
            void hospitalRealtimeRef.current?.close();
            hospitalRealtimeRef.current = null;
            hospitalRealtimeStartingRef.current = false;
            setPatientSearch('');
            setDoctorSearch('');
            setTriageStep(0);
            setSelectedPatientId(undefined);
            setSelectedDoctorId(undefined);
            setVoiceTitle('');
            setChatHistory(INITIAL_CHAT);
            setActiveUserInput('');
            setIsTriageActive(true);
        }
    }, [isVoiceModalVisible, INITIAL_CHAT]);

    const startHospitalRealtimeTriage = React.useCallback(async () => {
        if (hospitalRealtimeRef.current || hospitalRealtimeStartingRef.current) return;

        hospitalRealtimeStartingRef.current = true;
        setVoiceStatus('Connecting live clinical voice...');
        try {
            const realtime = await connectRealtimeVoice(supabase, {
                mode: 'hospital',
                autoStartResponse: true,
                concern: activeDoctor?.department || activeDoctor?.specialization || 'General medical intake',
                department: activeDoctor?.department || activeDoctor?.specialization || 'General Medicine',
                doctorSpecialty: activeDoctor?.specialization || activeDoctor?.department || 'General Medicine',
                hospitalName: profileQuery.data?.displayName || profileQuery.data?.registeredName || 'CD4 Partner Hospital',
                patientName: activePatient?.patientName || 'the patient',
                history: [],
            }, {
                onStatus: (status) => {
                    if (status === 'connecting') setVoiceStatus('Connecting live clinical voice...');
                    if (status === 'connected') setVoiceStatus('Live voice ready. I am listening for the patient history.');
                    if (status === 'speaking') {
                        setIsListening(false);
                        setVoiceStatus('AI is speaking. It will listen again after the question.');
                    }
                    if (status === 'listening') {
                        setIsListening(true);
                        setVoiceStatus('Listening for the next patient answer...');
                    }
                    if (status === 'closed') {
                        setIsListening(false);
                        setVoiceStatus('Live voice session closed.');
                    }
                },
                onInputTranscript: (text) => {
                    const clean = text.trim();
                    if (!clean) return;
                    setChatHistory((current) => [...current, { role: 'user', content: clean }]);
                    setActiveUserInput('');
                },
                onAssistantDone: (text) => {
                    const clean = text.trim();
                    if (!clean) return;
                    setChatHistory((current) => {
                        if (current.length === 1 && current[0]?.role === 'assistant' && current[0].content === INITIAL_CHAT[0]?.content) {
                            return [{ role: 'assistant', content: clean }];
                        }
                        return [...current, { role: 'assistant', content: clean }];
                    });
                    setIsChatLoading(false);
                    // Re-arm only after the complete answer has finished.
                    hospitalRealtimeRef.current?.setInputEnabled(true);
                },
                onAssistantInterrupted: () => {
                    setVoiceStatus('I heard the interruption. Please continue.');
                },
                onError: (error) => {
                    setIsListening(false);
                    setVoiceStatus('Live voice is unavailable. You can continue with text or the saved intake flow.');
                    if (__DEV__) console.warn('[HospitalRealtimeVoice]', error.message);
                },
            });
            hospitalRealtimeRef.current = realtime;
        } catch (error: any) {
            setVoiceStatus('Live voice could not start. You can use text or the existing voice capture.');
            Toast.show({ type: 'error', text1: 'Live voice unavailable', text2: error?.message || 'Please try again.' });
        } finally {
            hospitalRealtimeStartingRef.current = false;
        }
    }, [activeDoctor, activePatient, profileQuery.data]);

    const handleStepTransition = (nextStep: number) => {
        if (isListening) {
            ExpoSpeechRecognitionModule?.stop?.();
            setIsListening(false);
        }
        setTriageStep(nextStep);
        if (nextStep === 0) {
            setChatHistory(INITIAL_CHAT);
            setActiveUserInput('');
        } else if (nextStep === 1) {
            setChatHistory(INITIAL_CHAT);
            setActiveUserInput('');
            setVoiceStatus('Tap mic to describe chief complaints.');
            void startHospitalRealtimeTriage();
        } else if (nextStep === 2) {
            setVoiceStatus('Please review the compiled patient history below.');
            const compiled = chatHistory
                .map((msg) => `${msg.role === 'assistant' ? '[AI Assistant]' : '[User]'}: ${msg.content}`)
                .join('\n\n');
            setTranscript(compiled);
        }
    };

    const handleSendResponse = async () => {
        const cleanInput = activeUserInput.trim();
        if (!cleanInput) return;

        if (hospitalRealtimeRef.current) {
            setChatHistory((current) => [...current, { role: 'user', content: cleanInput }]);
            setActiveUserInput('');
            setIsChatLoading(true);
            hospitalRealtimeRef.current.sendText(cleanInput);
            return;
        }

        if (isListening) {
            ExpoSpeechRecognitionModule?.stop?.();
            setIsListening(false);
        }

        const userTurn = { role: 'user' as const, content: cleanInput };
        const updatedHistory = [...chatHistory, userTurn];
        setChatHistory(updatedHistory);
        setActiveUserInput('');
        setIsChatLoading(true);
        setVoiceStatus('AI is typing question...');

        try {
            const { data, error } = await supabase.functions.invoke('hospital-voice-intake', {
                body: {
                    isChat: true,
                    history: updatedHistory,
                    patientId: selectedPatientId || null,
                    doctorId: selectedDoctorId || null,
                },
            });

            if (error) throw error;
            if (!data?.success) {
                throw new Error(data?.message || 'Chat turn failed.');
            }

            const aiReply = String(data.reply || '').trim();

            if (aiReply.includes('THANK_YOU_INTAKE_COMPLETE')) {
                const cleanReply = aiReply.replace('THANK_YOU_INTAKE_COMPLETE', '').trim();
                const aiTurn = { role: 'assistant' as const, content: cleanReply || 'Intake is complete! Please review below.' };
                const finalHistory = [...updatedHistory, aiTurn];
                setChatHistory(finalHistory);

                const compiled = finalHistory
                    .map((msg) => `${msg.role === 'assistant' ? '[AI Assistant]' : '[User]'}: ${msg.content}`)
                    .join('\n\n');
                setTranscript(compiled);
                setTriageStep(2);
                setVoiceStatus('Clinical history capture complete. Please review the compilation below.');
            } else {
                const aiTurn = { role: 'assistant' as const, content: aiReply };
                setChatHistory([...updatedHistory, aiTurn]);
                setVoiceStatus('Tap mic to respond to the AI.');
            }
        } catch (err: any) {
            Toast.show({
                type: 'error',
                text1: 'Chat error',
                text2: err?.message || 'Could not get AI question.',
            });
            setVoiceStatus('Error connecting to AI. You can edit the history manually.');
        } finally {
            setIsChatLoading(false);
        }
    };

    const handleMicPress = async () => {
        if (hospitalRealtimeRef.current) {
            const nextEnabled = !isListening;
            hospitalRealtimeRef.current.setInputEnabled(nextEnabled);
            setIsListening(nextEnabled);
            setVoiceStatus(nextEnabled ? 'Listening for the patient answer...' : 'Microphone paused. Tap again to continue.');
            return;
        }
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
            const activeStep = triageStepRef.current;
            const activeTriage = isTriageActiveRef.current;
            if (activeTriage && activeStep === 1) {
                setVoiceStatus('Listening... respond to the AI question.');
            } else {
                setVoiceStatus('Listening... capture symptoms, duration, severity, and visit context.');
            }
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

    const handleSaveIntake = async () => {
        const cleanTranscript = transcript.trim();
        if (!cleanTranscript) {
            Toast.show({ type: 'error', text1: 'Transcript required', text2: 'Capture or type patient symptoms before saving.' });
            return;
        }

        try {
            const result = await createVoiceIntake.mutateAsync({
                title: voiceTitle,
                patientId: selectedPatientId,
                doctorId: selectedDoctorId,
                transcript: cleanTranscript,
                language: 'Hindi / English',
            });
            setTranscript('');
            setVoiceTitle('');
            setSelectedPatientId(undefined);
            setSelectedDoctorId(undefined);
            setIsVoiceModalVisible(false);
            void voiceQuery.refetch(); 
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

    const profile = profileQuery.data;
    const stats = statsQuery.data;

    const tonePalette = isDarkTheme ? {
        gradient: ['#12362A', '#0D2921'] as const,
        border: '#2E7057',
        badgeBg: '#214D3E',
        badgeText: '#BDEED7',
        title: '#E9FFF4',
        description: '#B6DDCC',
        ctaBg: '#1BB87C',
        ctaText: '#042519',
        placeholderBg: 'rgba(255, 255, 255, 0.08)',
        placeholderText: '#73D8AF',
    } : {
        gradient: ['#ECFDF3', '#DDF8E8'] as const,
        border: '#BFEBD3',
        badgeBg: '#CFF3DE',
        badgeText: '#0E6848',
        title: '#113C2C',
        description: '#2D5A49',
        ctaBg: '#11A36D',
        ctaText: '#FFFFFF',
        placeholderBg: 'rgba(17, 163, 109, 0.08)',
        placeholderText: '#2D5A49',
    };

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
            </View>

            <LinearGradient
                colors={tonePalette.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.voiceCard, { borderColor: tonePalette.border, borderWidth: 1 }]}
            >
                <View style={styles.voiceCardHeader}>
                    <Text style={[styles.voiceCardTitle, { color: tonePalette.title }]}>
                        Start patient history
                    </Text>
                    <View style={[styles.proBadge, { backgroundColor: tonePalette.badgeBg }]}>
                        <Text style={[styles.proBadgeText, { color: tonePalette.badgeText }]}>AI</Text>
                    </View>
                </View>
                <Text style={[styles.voiceCardSubtitle, { color: tonePalette.description }]}>
                    Select a patient and doctor, then let CD4 collect the clinical history one question at a time.
                </Text>
                <TouchableOpacity
                    style={[styles.voiceInputContainer, { backgroundColor: tonePalette.ctaBg }]}
                    onPress={() => setIsVoiceModalVisible(true)}
                    activeOpacity={0.86}
                >
                    <View style={styles.voicePrimaryIcon}>
                        <Mic size={18} color={tonePalette.ctaText} />
                    </View>
                    <Text style={[styles.voicePrimaryText, { color: tonePalette.ctaText }]}>Start live voice history</Text>
                    <Text style={[styles.voicePrimaryArrow, { color: tonePalette.ctaText }]}>›</Text>
                </TouchableOpacity>
            </LinearGradient>

            <Section title="Stats overview" action="" onPress={() => {}} theme={theme}>
                <View style={styles.statsRow}>
                    <StatCard title="Doctors" value={stats?.doctors || 0} icon={Stethoscope} theme={theme} />
                    <StatCard title="Patients" value={stats?.patients || 0} icon={Users} theme={theme} />
                    <StatCard title="Voice" value={stats?.voiceIntakes || 0} icon={Mic} theme={theme} />
                </View>
            </Section>

            <Section title="Recent doctors" action="Manage" onPress={() => router.push('/hospital/doctors')} theme={theme}>
                {recentDoctors.length ? (
                    recentDoctors.map((doctor) => (
                        <Row key={doctor.id} title={doctor.name} subtitle={`${doctor.specialization || 'Doctor'} • ${doctor.status}`} icon={Stethoscope} theme={theme} />
                    ))
                ) : (
                    <EmptyText text="No doctors linked yet." theme={theme} />
                )}
            </Section>

            <Section title="Recent patients" action="Manage" onPress={() => router.push('/hospital/patients')} theme={theme}>
                {recentPatients.length ? (
                    recentPatients.map((patient) => (
                        <Row
                            key={patient.id}
                            title={patient.patientName}
                            subtitle={`${patient.doctorName || 'Doctor not assigned'} • ${formatStatus(patient.status)}`}
                            icon={Users}
                            theme={theme}
                        />
                    ))
                ) : (
                    <EmptyText text="No patients assigned yet." theme={theme} />
                )}
            </Section>

            <Section title="Recent voice intakes" action="Open" onPress={() => router.push('/hospital/voice-intake')} theme={theme}>
                {recentVoice.length ? (
                    recentVoice.map((item) => (
                        <Row key={item.id} title={item.title} subtitle={formatStatus(item.status)} icon={Mic} theme={theme} />
                    ))
                ) : (
                    <EmptyText text="No voice intake sessions yet." theme={theme} />
                )}
            </Section>

            <Modal
                visible={isVoiceModalVisible}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setIsVoiceModalVisible(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setIsVoiceModalVisible(false)}>
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
                                <Sparkles size={19} color={theme.tint} />
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Patient Voice Intake</Text>
                            </View>
                            <TouchableOpacity onPress={() => setIsVoiceModalVisible(false)}>
                                <X size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>
                        <Text style={[styles.modalSubtitleText, { color: theme.textSecondary, marginBottom: 12 }]}>
                            Select the patient and doctor. CD4 will take the clinical history by voice.
                        </Text>

                        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                            <View style={styles.selectorLabelRow}>
                                <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>1. Patient</Text>
                                <TextInput
                                    value={patientSearch}
                                    onChangeText={setPatientSearch}
                                        placeholder="Search patient name or email..."
                                    placeholderTextColor={theme.textSecondary}
                                    autoCapitalize="none"
                                    style={[
                                        styles.miniSearchInput,
                                        { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }
                                    ]}
                                />
                            </View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                                {filteredPatients.map((patient) => {
                                    const selected = selectedPatientId === patient.patientId;
                                    return (
                                        <TouchableOpacity
                                            key={patient.id}
                                            style={[
                                                styles.chip,
                                                { borderColor: theme.borderColor, backgroundColor: selected ? theme.successLight : theme.background },
                                            ]}
                                            onPress={() => setSelectedPatientId(patient.patientId)}
                                        >
                                            <Text style={[styles.chipText, { color: selected ? theme.tint : theme.textSecondary }]}>{patient.patientName}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            {isAddingPatInline && (
                                <View style={[styles.inlineAddCard, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                    <Text style={[styles.inlineAddTitle, { color: theme.text }]}>Link Patient Account</Text>
                                    <TextInput
                                        value={inlinePatEmail}
                                        onChangeText={setInlinePatEmail}
                                        placeholder="Patient registered email"
                                        placeholderTextColor={theme.textSecondary}
                                        autoCapitalize="none"
                                        keyboardType="email-address"
                                        style={[styles.inlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                    />
                                    <TextInput
                                        value={inlinePatNotes}
                                        onChangeText={setInlinePatNotes}
                                        placeholder="Notes, UHID or Visit context (optional)"
                                        placeholderTextColor={theme.textSecondary}
                                        style={[styles.inlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                    />
                                    <View style={styles.inlineActionRow}>
                                        <TouchableOpacity style={[styles.inlineCancelBtn, { borderColor: theme.borderColor }]} onPress={() => setIsAddingPatInline(false)}>
                                            <Text style={[styles.inlineCancelBtnText, { color: theme.textSecondary }]}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.inlineSaveBtn, { backgroundColor: theme.tint }, linkPatient.isPending && styles.disabledButton]}
                                            onPress={handleInlineAddPatient}
                                            disabled={linkPatient.isPending}
                                        >
                                            {linkPatient.isPending ? (
                                                <ActivityIndicator color={theme.buttonText} size="small" />
                                            ) : (
                                                <Text style={[styles.inlineSaveBtnText, { color: theme.buttonText }]}>Link Patient</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            <View style={styles.selectorLabelRow}>
                                <Text style={[styles.smallLabel, { color: theme.textSecondary }]}>2. Doctor</Text>
                                <TextInput
                                    value={doctorSearch}
                                    onChangeText={setDoctorSearch}
                                    placeholder="Search doctor..."
                                    placeholderTextColor={theme.textSecondary}
                                    autoCapitalize="none"
                                    style={[
                                        styles.miniSearchInput,
                                        { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background }
                                    ]}
                                />
                            </View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                                {filteredDoctors.map((doctor) => {
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

                            {isAddingDocInline && (
                                <View style={[styles.inlineAddCard, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                    <Text style={[styles.inlineAddTitle, { color: theme.text }]}>Link Doctor Account</Text>
                                    <TextInput
                                        value={inlineDocIdentifier}
                                        onChangeText={setInlineDocIdentifier}
                                        placeholder="Doctor full name"
                                        placeholderTextColor={theme.textSecondary}
                                        autoCapitalize="none"
                                        style={[styles.inlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                    />
                                    <TextInput
                                        value={inlineDocDept}
                                        onChangeText={setInlineDocDept}
                                        placeholder="Department, e.g. Cardiology (optional)"
                                        placeholderTextColor={theme.textSecondary}
                                        style={[styles.inlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                    />
                                    <View style={styles.inlineActionRow}>
                                        <TouchableOpacity style={[styles.inlineCancelBtn, { borderColor: theme.borderColor }]} onPress={() => setIsAddingDocInline(false)}>
                                            <Text style={[styles.inlineCancelBtnText, { color: theme.textSecondary }]}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.inlineSaveBtn, { backgroundColor: theme.tint }, linkDoctor.isPending && styles.disabledButton]}
                                            onPress={handleInlineAddDoctor}
                                            disabled={linkDoctor.isPending}
                                        >
                                            {linkDoctor.isPending ? (
                                                <ActivityIndicator color={theme.buttonText} size="small" />
                                            ) : (
                                                <Text style={[styles.inlineSaveBtnText, { color: theme.buttonText }]}>Link Doctor</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            {isTriageActive ? (
                                <>
                                    {triageStep === 0 && (
                                        <View style={[styles.triageCard, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                            <Text style={[styles.triageCardTitle, { color: theme.text }]}>Ready for clinical history</Text>
                                            <Text style={[styles.triageCardDesc, { color: theme.textSecondary }]}>
                                                CD4 will ask one relevant question at a time based on the doctor's department and the patient's answers.
                                            </Text>
                                            {(!selectedPatientId || !selectedDoctorId) && (
                                                <Text style={[styles.selectionHint, { color: theme.textSecondary }]}>Select both a patient and a doctor to continue.</Text>
                                            )}
                                            <TouchableOpacity
                                                style={[styles.triageStartBtn, { backgroundColor: theme.tint }, (!selectedPatientId || !selectedDoctorId) && styles.disabledButton]}
                                                onPress={() => handleStepTransition(1)}
                                                disabled={!selectedPatientId || !selectedDoctorId}
                                            >
                                                <Mic size={16} color={theme.buttonText} />
                                                <Text style={[styles.triageStartBtnText, { color: theme.buttonText }]}>Start live history</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    {triageStep === 1 && (
                                        <>
                                            <ScrollView
                                                style={[styles.chatBubbleContainer, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                                                contentContainerStyle={{ gap: 8, paddingVertical: 10 }}
                                                nestedScrollEnabled
                                            >
                                                {chatHistory.map((msg, index) => {
                                                    const isAi = msg.role === 'assistant';
                                                    return (
                                                        <View
                                                            key={index}
                                                            style={[
                                                                styles.chatBubble,
                                                                isAi
                                                                    ? [styles.chatBubbleAi, { backgroundColor: theme.successLight, alignSelf: 'flex-start' }]
                                                                    : [styles.chatBubbleUser, { backgroundColor: theme.tint, alignSelf: 'flex-end' }],
                                                            ]}
                                                        >
                                                            {isAi && <Sparkles size={12} color={theme.tint} style={{ marginRight: 6, marginTop: 2 }} />}
                                                            <Text
                                                                style={[
                                                                    styles.chatBubbleText,
                                                                    { color: isAi ? theme.text : theme.buttonText },
                                                                ]}
                                                            >
                                                                {msg.content}
                                                            </Text>
                                                        </View>
                                                    );
                                                })}
                                                {isChatLoading && (
                                                    <View style={[styles.chatBubble, styles.chatBubbleAi, { backgroundColor: theme.successLight, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' }]}>
                                                        <ActivityIndicator size="small" color={theme.tint} style={{ marginRight: 6 }} />
                                                        <Text style={[styles.chatBubbleText, { color: theme.textSecondary }]}>AI is thinking...</Text>
                                                    </View>
                                                )}
                                            </ScrollView>

                                            <View style={[styles.voiceStatusBox, { backgroundColor: theme.successLight }]}>
                                                <Mic size={15} color={theme.tint} />
                                                <Text style={[styles.voiceStatusBoxText, { color: theme.text }]}>{voiceStatus}</Text>
                                            </View>

                                            <TextInput
                                                value={activeUserInput}
                                                onChangeText={setActiveUserInput}
                                                placeholder="Type or speak response..."
                                                placeholderTextColor={theme.textSecondary}
                                                multiline
                                                textAlignVertical="top"
                                                style={[
                                                    styles.transcriptTextArea,
                                                    { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background, minHeight: 80 },
                                                ]}
                                            />

                                            <View style={styles.triageActionRow}>
                                                <TouchableOpacity
                                                    style={[styles.triageBackBtn, { borderColor: theme.borderColor }]}
                                                    onPress={() => handleStepTransition(0)}
                                                >
                                                    <Text style={[styles.triageBackBtnText, { color: theme.textSecondary }]}>Back</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.voiceActionBtnCompact, { backgroundColor: isListening ? theme.error : theme.tint }]}
                                                    onPress={handleMicPress}
                                                >
                                                    {isListening ? <MicOff size={16} color={theme.buttonText} /> : <Mic size={16} color={theme.buttonText} />}
                                                    <Text style={{ color: theme.buttonText, fontWeight: '900', fontSize: 13 }}>
                                                        {isListening ? 'Stop' : 'Record'}
                                                    </Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.triageNextBtn, { backgroundColor: theme.tint }, (isChatLoading || !activeUserInput.trim()) && styles.disabledButton]}
                                                    onPress={handleSendResponse}
                                                    disabled={isChatLoading || !activeUserInput.trim()}
                                                >
                                                    <Text style={[styles.triageNextBtnText, { color: theme.buttonText }]}>Send</Text>
                                                </TouchableOpacity>
                                            </View>

                                            <TouchableOpacity
                                                onPress={() => handleStepTransition(2)}
                                                style={{ alignSelf: 'center', marginTop: 4, marginBottom: 10 }}
                                            >
                                                <Text style={{ color: theme.tint, fontSize: 12, fontWeight: '800' }}>
                                                    Skip to Review & Compile
                                                </Text>
                                            </TouchableOpacity>
                                        </>
                                    )}

                                    {triageStep === 2 && (
                                        <>
                                            <Text style={[styles.reviewHeader, { color: theme.text }]}>Review Compiled History</Text>
                                            <Text style={[styles.reviewSub, { color: theme.textSecondary }]}>
                                                Review and make final edits to the compiled history before saving:
                                            </Text>
                                            <TextInput
                                                value={transcript}
                                                onChangeText={setTranscript}
                                                multiline
                                                textAlignVertical="top"
                                                style={[
                                                    styles.transcriptTextArea,
                                                    { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background, minHeight: 200 },
                                                ]}
                                            />
                                            <View style={styles.triageActionRow}>
                                                <TouchableOpacity
                                                    style={[styles.triageBackBtn, { borderColor: theme.borderColor, flex: 0.8 }]}
                                                    onPress={() => setTriageStep(1)}
                                                >
                                                    <Text style={[styles.triageBackBtnText, { color: theme.textSecondary }]}>Resume Chat</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    style={[styles.saveActionBtn, { borderColor: theme.tint, flex: 1.2, height: 48, borderRadius: 15 }, createVoiceIntake.isPending && styles.disabledButton]}
                                                    onPress={handleSaveIntake}
                                                    disabled={createVoiceIntake.isPending}
                                                >
                                                    {createVoiceIntake.isPending ? <ActivityIndicator color={theme.tint} /> : <Sparkles size={16} color={theme.tint} />}
                                                    <Text style={[styles.saveActionBtnText, { color: theme.tint }]}>Generate AI PDF</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <View style={[styles.voiceStatusBox, { backgroundColor: theme.successLight }]}>
                                        <Mic size={15} color={theme.tint} />
                                        <Text style={[styles.voiceStatusBoxText, { color: theme.text }]}>{voiceStatus}</Text>
                                    </View>

                                    <TextInput
                                        value={transcript}
                                        onChangeText={setTranscript}
                                        placeholder="Voice transcript or typed symptoms"
                                        placeholderTextColor={theme.textSecondary}
                                        multiline
                                        textAlignVertical="top"
                                        style={[
                                            styles.transcriptTextArea,
                                            { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.background },
                                        ]}
                                    />

                                    <View style={styles.modalActionRow}>
                                        <TouchableOpacity
                                            style={[styles.voiceActionBtn, { backgroundColor: isListening ? theme.error : theme.tint }]}
                                            onPress={handleMicPress}
                                        >
                                            {isListening ? <MicOff size={16} color={theme.buttonText} /> : <Mic size={16} color={theme.buttonText} />}
                                            <Text style={[styles.voiceActionBtnText, { color: theme.buttonText }]}>{isListening ? 'Stop' : 'Start Voice'}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.saveActionBtn, { borderColor: theme.tint }, createVoiceIntake.isPending && styles.disabledButton]}
                                            onPress={handleSaveIntake}
                                            disabled={createVoiceIntake.isPending}
                                        >
                                            {createVoiceIntake.isPending ? <ActivityIndicator color={theme.tint} /> : <Sparkles size={16} color={theme.tint} />}
                                            <Text style={[styles.saveActionBtnText, { color: theme.tint }]}>Generate AI Summary</Text>
                                        </TouchableOpacity>
                                    </View>
                                </>
                            )}
                        </ScrollView>
                    </Pressable>
                </Pressable>
            </Modal>
        </ScrollView>
    );
}


function StatCard({ title, value, icon: Icon, theme }: { title: string; value: string | number; icon: any; theme: any }) {
    return (
        <View style={[styles.statCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={[styles.statIconWrap, { backgroundColor: theme.successLight }]}>
                <Icon size={16} color={theme.tint} />
            </View>
            <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>
                {value}
            </Text>
            <Text style={[styles.statTitle, { color: theme.textSecondary }]}>{title}</Text>
        </View>
    );
}

function QuickAction({ title, subtitle, icon: Icon, theme, onPress }: { title: string; subtitle: string; icon: any; theme: any; onPress: () => void }) {
    return (
        <TouchableOpacity style={[styles.quickCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]} onPress={onPress}>
            <View style={[styles.quickIconWrap, { backgroundColor: theme.successLight }]}>
                <Icon size={18} color={theme.tint} />
            </View>
            <Text style={[styles.quickTitle, { color: theme.text }]}>{title}</Text>
            <Text style={[styles.quickSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        </TouchableOpacity>
    );
}

function Section({ title, action, onPress, children, theme }: { title: string; action: string; onPress: () => void; children: React.ReactNode; theme: any }) {
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
                {action ? (
                    <TouchableOpacity onPress={onPress}>
                        <Text style={[styles.sectionAction, { color: theme.tint }]}>{action}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
            {children}
        </View>
    );
}

function Row({ title, subtitle, icon: Icon, theme }: { title: string; subtitle: string; icon?: any; theme: any }) {
    return (
        <View style={[styles.row, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            {Icon && (
                <View style={[styles.rowIconWrap, { backgroundColor: theme.successLight }]}>
                    <Icon size={16} color={theme.tint} />
                </View>
            )}
            <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
                <Text style={[styles.rowSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
            </View>
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
    statusCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
    statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    statusIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    statusTitle: { fontSize: 15, fontWeight: '800' },
    statusText: { marginTop: 4, fontSize: 12, fontWeight: '600' },
    voiceCard: { borderRadius: 22, padding: 18, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 4 },
    voiceCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    voiceCardTitle: { fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
    proBadge: { backgroundColor: '#FFFFFF2A', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    proBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
    voiceCardSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 12 },
    voiceInputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 2 },
    voicePrimaryIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)' },
    voicePrimaryText: { flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '900' },
    voicePrimaryArrow: { fontSize: 26, lineHeight: 28, fontWeight: '500', marginLeft: 8 },
    voiceBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
    voiceCardFooter: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
    statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4, marginBottom: 12 },
    statCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 12, alignItems: 'flex-start' },
    statValue: { marginTop: 6, fontSize: 22, fontWeight: '900' },
    statValueCompact: { fontSize: 17 },
    statTitle: { marginTop: 2, fontSize: 11, fontWeight: '700' },
    statIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
    quickGrid: { gap: 10, marginBottom: 20 },
    quickCard: { borderRadius: 18, borderWidth: 1, padding: 15 },
    quickTitle: { marginTop: 10, fontSize: 16, fontWeight: '900' },
    quickSubtitle: { marginTop: 3, fontSize: 12, fontWeight: '600' },
    quickIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    section: { marginTop: 12 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    sectionTitle: { fontSize: 18, fontWeight: '900' },
    sectionAction: { fontSize: 13, fontWeight: '800' },
    row: { borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { fontSize: 14, fontWeight: '900' },
    rowSubtitle: { marginTop: 4, fontSize: 12, fontWeight: '600' },
    rowIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    emptyText: { fontSize: 13, fontWeight: '600', paddingVertical: 8 },

    // Modal Specific Styles
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, paddingHorizontal: 20, paddingTop: 12, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.15, shadowRadius: 5, maxHeight: '90%' },
    modalGrabber: { width: 42, height: 5, borderRadius: 2.5, alignSelf: 'center', marginBottom: 14 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalTitle: { fontSize: 17, fontWeight: '900' },
    modalSubtitleText: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '600', marginBottom: 10 },
    smallLabel: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
    chipRow: { gap: 8, paddingVertical: 10 },
    chip: { maxWidth: 190, borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
    chipText: { fontSize: 12, fontWeight: '800' },
    voiceStatusBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, padding: 12, marginVertical: 8 },
    voiceStatusBoxText: { flex: 1, fontSize: 12, fontWeight: '800' },
    transcriptTextArea: { minHeight: 140, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    modalActionRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 10 },
    voiceActionBtn: { flex: 1, height: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    voiceActionBtnText: { fontSize: 14, fontWeight: '900' },
    saveActionBtn: { flex: 1.2, height: 48, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    saveActionBtnText: { fontSize: 14, fontWeight: '900' },
    inlineAddCard: {
        marginTop: 8,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        gap: 8,
        marginBottom: 10,
    },
    inlineAddTitle: {
        fontSize: 12,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 4,
    },
    inlineInput: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 13,
        fontWeight: '600',
    },
    inlineActionRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
        marginTop: 4,
    },
    inlineCancelBtn: {
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        justifyContent: 'center',
    },
    inlineCancelBtnText: {
        fontSize: 12,
        fontWeight: '800',
    },
    inlineSaveBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        justifyContent: 'center',
    },
    inlineSaveBtnText: {
        fontSize: 12,
        fontWeight: '900',
    },
    disabledButton: { opacity: 0.72 },
    selectorLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 14,
        marginBottom: -4,
    },
    miniSearchInput: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 4,
        fontSize: 12,
        fontWeight: '600',
        width: 150,
        height: 30,
    },
    modeToggleRow: {
        flexDirection: 'row',
        borderRadius: 12,
        padding: 4,
        marginVertical: 10,
    },
    modeToggleBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modeToggleText: {
        fontSize: 12,
        fontWeight: '800',
    },
    triageCard: {
        borderRadius: 18,
        borderWidth: 1,
        padding: 16,
        marginVertical: 8,
        gap: 12,
    },
    triageCardTitle: {
        fontSize: 16,
        fontWeight: '900',
    },
    triageCardDesc: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    selectionHint: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '700',
    },
    triageStepList: {
        gap: 6,
        paddingLeft: 4,
    },
    triageStepItem: {
        fontSize: 12,
        fontWeight: '700',
    },
    triageStartBtn: {
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        marginTop: 6,
    },
    triageStartBtnText: {
        fontSize: 13,
        fontWeight: '900',
    },
    progressBar: {
        flexDirection: 'row',
        gap: 6,
        marginTop: 14,
        marginBottom: 8,
    },
    progressSegment: {
        flex: 1,
        height: 5,
        borderRadius: 999,
    },
    progressText: {
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    assistantBubble: {
        flexDirection: 'row',
        gap: 10,
        borderRadius: 16,
        borderWidth: 1,
        padding: 12,
        marginBottom: 10,
        alignItems: 'flex-start',
    },
    assistantText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '700',
    },
    triageActionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
        marginBottom: 10,
    },
    triageBackBtn: {
        flex: 1,
        height: 48,
        borderRadius: 15,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    triageBackBtnText: {
        fontSize: 14,
        fontWeight: '900',
    },
    triageNextBtn: {
        flex: 1,
        height: 48,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    triageNextBtnText: {
        fontSize: 14,
        fontWeight: '900',
    },
    voiceActionBtnCompact: {
        flex: 1,
        height: 48,
        borderRadius: 15,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    reviewHeader: {
        fontSize: 15,
        fontWeight: '900',
        marginTop: 14,
    },
    reviewSub: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
        marginBottom: 10,
    },
    chatBubbleContainer: {
        maxHeight: 220,
        borderWidth: 1,
        borderRadius: 14,
        padding: 8,
        marginVertical: 10,
    },
    chatBubble: {
        maxWidth: '85%',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        marginVertical: 4,
    },
    chatBubbleAi: {
        borderBottomLeftRadius: 4,
        alignSelf: 'flex-start',
    },
    chatBubbleUser: {
        borderBottomRightRadius: 4,
        alignSelf: 'flex-end',
    },
    chatBubbleText: {
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
    },
});
