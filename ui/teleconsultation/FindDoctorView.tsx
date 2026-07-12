import React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image, ActivityIndicator, Modal, RefreshControl, Animated, Easing, useWindowDimensions, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { Theme } from '../../constants/Colors';
import { Star, MapPin, Mic, Send, Activity, Leaf, Pill, Stethoscope, SlidersHorizontal, Check, Search, ArrowLeft, X, Menu, CheckCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Toast from 'react-native-toast-message';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from 'react-native-markdown-display';
import { supabase } from '../../src/lib/supabase';
import { useAuthContext } from '../../context/AuthContext';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { getLocalizedDoctorName } from '../../src/i18n/nameLocalization';

type SpeechRecognitionEventName = 'start' | 'end' | 'result' | 'error';

type SpeechRecognitionResultEvent = {
    isFinal: boolean;
    results: Array<{ transcript?: string }>;
};

type SpeechRecognitionErrorEvent = {
    message?: string;
};

type SpeechRecognitionModule = {
    start: (options: {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        addsPunctuation: boolean;
    }) => void;
    stop: () => void;
    abort: () => void;
    requestPermissionsAsync: () => Promise<{ granted: boolean }>;
    isRecognitionAvailable: () => boolean;
    addListener?: (
        eventName: SpeechRecognitionEventName,
        listener: (event: unknown) => void
    ) => { remove?: () => void };
};

type AIDoctorPersona = 'female' | 'male';

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

function useSpeechRecognitionEventSafe<TEvent>(
    eventName: SpeechRecognitionEventName,
    listener: (event: TEvent) => void
) {
    React.useEffect(() => {
        if (!ExpoSpeechRecognitionModule?.addListener) {
            return;
        }

        const subscription = ExpoSpeechRecognitionModule.addListener(
            eventName,
            listener as (event: unknown) => void
        );

        return () => {
            subscription?.remove?.();
        };
    }, [eventName, listener]);
}

type Doctor3DIconProps = {
    size: number;
    accentColor: string;
    speaking: boolean;
    mouthScale: Animated.Value;
    mouthScaleY: Animated.AnimatedInterpolation<number>;
};

const DOCTOR_AVATAR_IMAGE = require('../../assets/images/female.jpeg');

function Doctor3DIcon({ size, accentColor, speaking, mouthScale, mouthScaleY }: Doctor3DIconProps) {
    const avatarSize = size * 0.96;
    const mouthWidth = Math.max(5, avatarSize * 0.2);
    const mouthHeight = Math.max(1.6, avatarSize * 0.055);
    const mouthTop = avatarSize * 0.64;

    return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <View
                style={{
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: avatarSize / 2,
                    overflow: 'hidden',
                    backgroundColor: '#F6FBFF',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Image
                    source={DOCTOR_AVATAR_IMAGE}
                    resizeMode="cover"
                    style={{
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: avatarSize / 2,
                    }}
                />
                <LinearGradient
                    colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.0)'] as const}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.7, y: 1 }}
                    style={{
                        position: 'absolute',
                        top: avatarSize * 0.08,
                        left: avatarSize * 0.12,
                        width: avatarSize * 0.34,
                        height: avatarSize * 0.2,
                        borderRadius: avatarSize * 0.1,
                    }}
                />
                <Animated.View
                    style={{
                        position: 'absolute',
                        top: mouthTop,
                        width: mouthWidth,
                        height: mouthHeight,
                        borderRadius: 999,
                        backgroundColor: '#D45C74',
                        borderWidth: Math.max(0.4, size * 0.012),
                        borderColor: 'rgba(84, 25, 42, 0.22)',
                        opacity: speaking ? 0.95 : 0.62,
                        transform: [{ scaleX: mouthScale }, { scaleY: mouthScaleY }],
                    }}
                />
                <View
                    style={{
                        position: 'absolute',
                        right: avatarSize * 0.04,
                        bottom: avatarSize * 0.06,
                        width: Math.max(7, avatarSize * 0.18),
                        height: Math.max(7, avatarSize * 0.18),
                        borderRadius: 999,
                        backgroundColor: 'rgba(255,255,255,0.92)',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <View
                        style={{
                            width: Math.max(1, size * 0.022),
                            height: Math.max(1, size * 0.07),
                            borderRadius: 99,
                            backgroundColor: accentColor,
                            position: 'absolute',
                        }}
                    />
                    <View
                        style={{
                            width: Math.max(1, size * 0.07),
                            height: Math.max(1, size * 0.022),
                            borderRadius: 99,
                            backgroundColor: accentColor,
                        }}
                    />
                </View>
            </View>
        </View>
    );
}

interface FindDoctorViewProps {
    theme: Theme;
}

interface Doctor {
    _id: string;
    firstName: string;
    lastName: string;
    city?: string;
    specialization: string;
    experience: string;
    fee: string;
    image?: string;
    rating: number;
}

type AgentRole = 'user' | 'ai';

interface AgentRecommendedDoctor {
    id: string;
    _id?: string;
    firstName: string;
    lastName: string;
    city?: string;
    specialization?: string;
    rating?: number;
    experience?: string;
    fee?: string;
    image?: string;
    isVerified?: boolean;
    is_verified?: boolean;
}

interface AgentDepartmentSuggestion {
    id: string;
    label: string;
}

interface AgentBookingSlotOption {
    id: string;
    label: string;
    date?: string;
    startTime?: string;
    endTime?: string;
}

type AgentToolStepStatus = 'success' | 'skipped' | 'error' | 'running';

interface AgentToolStep {
    id: string;
    name: string;
    label: string;
    status: AgentToolStepStatus;
    detail?: string;
}

interface VoiceLimitPromptState {
    blocked: boolean;
    isPro: boolean;
    retryAfterMs: number;
    burst: boolean;
}

interface AgentMessage {
    id: string;
    role: AgentRole;
    text: string;
    createdAt: string;
    recommendedDoctors?: AgentRecommendedDoctor[];
    recommendedDepartment?: AgentDepartmentSuggestion | null;
    bookingPrompt?: string;
    bookingSlotOptions?: AgentBookingSlotOption[];
    bookingConfirmationStatus?: string | null;
    bookingConfirmationMessage?: string | null;
    bookingConfirmationDoctorName?: string | null;
    bookingConfirmationSlotLabel?: string | null;
    consultRecommended?: boolean;
    agentSteps?: AgentToolStep[];
    rateLimit?: VoiceLimitPromptState | null;
}

import { useDoctors } from '../../hooks/useDoctor';
import { useQueryClient } from '@tanstack/react-query';
import { APPOINTMENT_QUERY_KEYS } from '../../hooks/useAppointment';
import { getImageUrl } from '../../constants/Config';
import ShimmerBlock from '../common/ShimmerSkeleton';
import { HomeTabSkeleton } from '../common/TabLoadingSkeletons';
import { getStoredLocationCity, syncLocationCityIfPermitted } from '../../services/locationPermission';
import { DOCTOR_SPECIALIZATION_OPTIONS } from '../../constants/DoctorOptions';

type IconComponent = React.ComponentType<{
    size?: number;
    color?: string;
    strokeWidth?: number;
}>;

const CONCERN_IMAGE_ASSETS = {
    diabetes: require('../../assets/concerns/diabetes_care_1777377906586.jpg'),
    pcos: require('../../assets/concerns/pcos_health_1777377967772.jpg'),
    heart: require('../../assets/concerns/heart_health_1777378053936.jpg'),
    skin: require('../../assets/concerns/skin_care_1777378482702.jpg'),
    assistant: require('../../assets/concerns/general_assistant_1777377591600.jpg'),
} as const;

const DEPARTMENT_IMAGE_ASSETS = {
    general: require('../../assets/concerns/general_assistant_1777377591600.jpg'),
    heart: require('../../assets/concerns/heart_health_1777378053936.jpg'),
    diabetes: require('../../assets/concerns/diabetes_care_1777377906586.jpg'),
    skin: require('../../assets/concerns/skin_care_1777378482702.jpg'),
    women: require('../../assets/concerns/pcos_health_1777377967772.jpg'),
} as const;

const resolveConcernImageSource = (label: string, id?: string): ImageSourcePropType | undefined => {
    const merged = `${normalizeText(label)} ${normalizeText(id)}`.replace(/[_-]+/g, ' ');
    if (merged.includes('diabet')) return CONCERN_IMAGE_ASSETS.diabetes;
    if (merged.includes('pcos')) return CONCERN_IMAGE_ASSETS.pcos;
    if (merged.includes('heart') || merged.includes('cardio') || merged.includes('chest')) return CONCERN_IMAGE_ASSETS.heart;
    if (merged.includes('skin') || merged.includes('acne') || merged.includes('eczema') || merged.includes('rash')) return CONCERN_IMAGE_ASSETS.skin;
    if (merged.includes('assistant')) return CONCERN_IMAGE_ASSETS.assistant;
    return undefined;
};

const resolveDepartmentImageSource = (label: string, id?: string): ImageSourcePropType | undefined => {
    const merged = `${normalizeText(label)} ${normalizeText(id)}`.replace(/[_-]+/g, ' ');
    if (merged.includes('cardio') || merged.includes('heart') || merged.includes('chest') || merged.includes('kidney')) return DEPARTMENT_IMAGE_ASSETS.heart;
    if (merged.includes('diab') || merged.includes('endo') || merged.includes('metab')) return DEPARTMENT_IMAGE_ASSETS.diabetes;
    if (merged.includes('derma') || merged.includes('skin')) return DEPARTMENT_IMAGE_ASSETS.skin;
    if (merged.includes('gyn') || merged.includes('pcos') || merged.includes('women')) return DEPARTMENT_IMAGE_ASSETS.women;
    return DEPARTMENT_IMAGE_ASSETS.general;
};

// Visual Config Mapping for Dynamic Categories
const CATEGORY_UI_DEFAULTS: Record<string, { Icon: IconComponent; iconBg: string; iconColor: string }> = {
    // Concerns
    'diabetes': { Icon: Activity, iconBg: '#EAF2FF', iconColor: '#4A7FE3' },
    'hypertension': { Icon: Pill, iconBg: '#FFEFF0', iconColor: '#E1555A' },
    'fever': { Icon: Stethoscope, iconBg: '#FFF4E7', iconColor: '#E38A35' },
    'skin': { Icon: Leaf, iconBg: '#E9F9EE', iconColor: '#2BB35A' },
    'pcos': { Icon: Pill, iconBg: '#FFEAF6', iconColor: '#D2478A' },
    // Specializations (matching DOCTOR_SPECIALIZATION_OPTIONS)
    'general physician': { Icon: Stethoscope, iconBg: '#EEF7FF', iconColor: '#4A7FE3' },
    'diabetologist': { Icon: Activity, iconBg: '#EAF2FF', iconColor: '#4A7FE3' },
    'cardiologist': { Icon: Activity, iconBg: '#FFEDEF', iconColor: '#D85C64' },
    'dermatologist': { Icon: Leaf, iconBg: '#E9F9EE', iconColor: '#2BB35A' },
    'endocrinologist': { Icon: Activity, iconBg: '#F0EDFF', iconColor: '#6B52D9' },
    'gastroenterologist': { Icon: Activity, iconBg: '#FFF1E8', iconColor: '#C36D37' },
    'neurologist': { Icon: Activity, iconBg: '#ECFBF6', iconColor: '#2FAF8A' },
    'pediatrician': { Icon: Pill, iconBg: '#EEF7FF', iconColor: '#4C7FE3' },
    'psychiatrist': { Icon: Activity, iconBg: '#ECFBF6', iconColor: '#2FAF8A' },
    'orthopedic surgeon': { Icon: Leaf, iconBg: '#F1F2F5', iconColor: '#697286' },
    'gynecologist': { Icon: Pill, iconBg: '#FFEAF6', iconColor: '#D2478A' },
    'pulmonologist': { Icon: Stethoscope, iconBg: '#EEF7F2', iconColor: '#2D9F6A' },
    'ent specialist': { Icon: Stethoscope, iconBg: '#EEF6FF', iconColor: '#3A78C9' },
    'urologist': { Icon: Pill, iconBg: '#EEF4FF', iconColor: '#4E72C9' },
    'nephrologist': { Icon: Pill, iconBg: '#F0EDFF', iconColor: '#6B52D9' },
    'oncologist': { Icon: Activity, iconBg: '#FFEFF0', iconColor: '#E1555A' },
    'ayurvedic practitioner': { Icon: Leaf, iconBg: '#E9F9EE', iconColor: '#2BB35A' },
    'homeopath': { Icon: Leaf, iconBg: '#EEF7F2', iconColor: '#2D9F6A' },
    'bams': { Icon: Leaf, iconBg: '#E9F9EE', iconColor: '#2BB35A' },
    'surgeon': { Icon: Stethoscope, iconBg: '#F1F2F5', iconColor: '#697286' },
    // Legacy keys for backwards compat
    'cardiology': { Icon: Activity, iconBg: '#FFEDEF', iconColor: '#D85C64' },
    'pediatrics': { Icon: Pill, iconBg: '#EEF7FF', iconColor: '#4C7FE3' },
    'orthopedic': { Icon: Leaf, iconBg: '#F1F2F5', iconColor: '#697286' },
    'kayachikitsa': { Icon: Stethoscope, iconBg: '#EAF2FF', iconColor: '#4A7FE3' },
    'dermatology': { Icon: Leaf, iconBg: '#E9F9EE', iconColor: '#2BB35A' },
    'gynecology': { Icon: Pill, iconBg: '#FFEAF6', iconColor: '#D2478A' },
    'psychiatry': { Icon: Activity, iconBg: '#ECFBF6', iconColor: '#2FAF8A' },
    'pulmonology': { Icon: Stethoscope, iconBg: '#EEF7F2', iconColor: '#2D9F6A' },
    'gastroenterology': { Icon: Activity, iconBg: '#FFF1E8', iconColor: '#C36D37' },
    'nephrology': { Icon: Pill, iconBg: '#F0EDFF', iconColor: '#6B52D9' },
    'ent': { Icon: Stethoscope, iconBg: '#EEF6FF', iconColor: '#3A78C9' },
    'urology': { Icon: Pill, iconBg: '#EEF4FF', iconColor: '#4E72C9' },
};

const getCategoryUI = (label: string): { Icon: IconComponent; iconBg: string; iconColor: string } => {
    const key = label.toLowerCase();
    return CATEGORY_UI_DEFAULTS[key] || { Icon: Stethoscope, iconBg: '#F1F2F5', iconColor: '#697286' };
};

interface Department {
    id: string;
    label: string;
    Icon: IconComponent;
    keywords: string[];
}

interface DynamicCategory {
    id: string;
    label: string;
    Icon: IconComponent;
    iconBg: string;
    iconColor: string;
    imageSource?: ImageSourcePropType;
    totalScore: number;
    dbCount?: number;
    personalCount?: number;
    doctorCount?: number;
}

type HomePromoCardTone = 'emerald' | 'sky' | 'amber';
type HomePromoCardAction = 'best_doctors' | 'best_doctors_global' | 'ai_chat' | 'voice_triage' | 'report_assistant';

type HomePromoToneSet = {
    gradient: readonly [string, string];
    border: string;
    badgeBg: string;
    badgeText: string;
    iconBg: string;
    iconColor: string;
    title: string;
    description: string;
    ctaBg: string;
    ctaText: string;
};

type HomePromoCard = {
    id: string;
    tag: string;
    title: string;
    description: string;
    cta: string;
    tone: HomePromoCardTone;
    Icon: IconComponent;
    action: HomePromoCardAction;
};

const HOME_PROMO_CARDS: HomePromoCard[] = [
    {
        id: 'best-doctors',
        tag: 'Best Doctors',
        title: 'Best doctors on this app',
        description: 'Top verified doctors based on rating and experience in your selected city.',
        cta: 'See Best Doctors',
        tone: 'emerald',
        Icon: Stethoscope,
        action: 'best_doctors',
    },
    {
        id: 'best-doctors-global',
        tag: 'All India',
        title: 'Top doctors across CD4',
        description: 'Highest rated and most trusted doctors from across the app.',
        cta: 'Consult Top Doctors',
        tone: 'emerald',
        Icon: Star,
        action: 'best_doctors_global',
    },
    {
        id: 'ai-chat-guidance',
        tag: 'AI Chat',
        title: 'Chat with AI before booking',
        description: 'Discuss symptoms in Hindi or English and get department-wise guidance instantly.',
        cta: 'Start AI Chat',
        tone: 'sky',
        Icon: Activity,
        action: 'ai_chat',
    },
    {
        id: 'voice-triage',
        tag: 'Voice Flow',
        title: 'Hands-free triage in 60 seconds',
        description: 'Use natural voice conversation to capture symptoms and move faster to consult.',
        cta: 'Try Voice Triage',
        tone: 'amber',
        Icon: Mic,
        action: 'voice_triage',
    },
    {
        id: 'ai-report',
        tag: 'Doctor Ready',
        title: 'Share AI report in one tap',
        description: 'Convert symptom chat into a concise doctor-facing summary before consultation.',
        cta: 'Open Reports',
        tone: 'emerald',
        Icon: CheckCircle,
        action: 'report_assistant',
    },
];
const HOME_NEARBY_PAGE_SIZE = 5;
const HOME_LOAD_MORE_SHIMMER_DELAY_MS = 320;

const HOME_PROMO_TONES: Record<HomePromoCardTone, { light: HomePromoToneSet; dark: HomePromoToneSet }> = {
    emerald: {
        light: {
            gradient: ['#ECFDF3', '#DDF8E8'],
            border: '#BFEBD3',
            badgeBg: '#CFF3DE',
            badgeText: '#0E6848',
            iconBg: '#D9F7E5',
            iconColor: '#0F8A5F',
            title: '#113C2C',
            description: '#2D5A49',
            ctaBg: '#11A36D',
            ctaText: '#FFFFFF',
        },
        dark: {
            gradient: ['#12362A', '#0D2921'],
            border: '#2E7057',
            badgeBg: '#214D3E',
            badgeText: '#BDEED7',
            iconBg: '#1A4A39',
            iconColor: '#73D8AF',
            title: '#E9FFF4',
            description: '#B6DDCC',
            ctaBg: '#1BB87C',
            ctaText: '#042519',
        },
    },
    sky: {
        light: {
            gradient: ['#EEF5FF', '#DEEBFF'],
            border: '#C9DBFD',
            badgeBg: '#DDE9FF',
            badgeText: '#315EAA',
            iconBg: '#E6F0FF',
            iconColor: '#3C72CF',
            title: '#163257',
            description: '#345176',
            ctaBg: '#3A79DA',
            ctaText: '#FFFFFF',
        },
        dark: {
            gradient: ['#142D47', '#102437'],
            border: '#355E8C',
            badgeBg: '#223B5A',
            badgeText: '#CBE2FF',
            iconBg: '#1D3C5F',
            iconColor: '#90BCFF',
            title: '#ECF5FF',
            description: '#BAD2EA',
            ctaBg: '#5596FF',
            ctaText: '#09203B',
        },
    },
    amber: {
        light: {
            gradient: ['#FFF8EA', '#FCEBCD'],
            border: '#F3D8A4',
            badgeBg: '#F8E6BE',
            badgeText: '#865C16',
            iconBg: '#FBEFCE',
            iconColor: '#C1841F',
            title: '#4A3718',
            description: '#6A542D',
            ctaBg: '#D99828',
            ctaText: '#FFFFFF',
        },
        dark: {
            gradient: ['#3B2D15', '#2D230F'],
            border: '#725A2B',
            badgeBg: '#4A3A1B',
            badgeText: '#F9E4B6',
            iconBg: '#554324',
            iconColor: '#FFD58A',
            title: '#FFF6E2',
            description: '#E7CEA2',
            ctaBg: '#E7AE4E',
            ctaText: '#2F220B',
        },
    },
};

interface TierConfig {
    label: string;
    color: string;
    shimmer: string;
    float: number;
    scale: number;
    iconSize: number;
}

const normalizeText = (value: string | null | undefined): string => value?.trim().toLowerCase() || '';

const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
    patna: { lat: 25.5941, lng: 85.1376 },
    samastipur: { lat: 25.8620, lng: 85.7810 },
    rosera: { lat: 25.7537, lng: 86.0255 },
    darbhanga: { lat: 26.1520, lng: 85.8970 },
    muzaffarpur: { lat: 26.1209, lng: 85.3647 },
    begusarai: { lat: 25.4167, lng: 86.1333 },
    gaya: { lat: 24.7914, lng: 85.0002 },
    bhagalpur: { lat: 25.2425, lng: 86.9842 },
    purnia: { lat: 25.7771, lng: 87.4753 },
    ranchi: { lat: 23.3441, lng: 85.3096 },
    kolkata: { lat: 22.5726, lng: 88.3639 },
    delhi: { lat: 28.6139, lng: 77.2090 },
    mumbai: { lat: 19.0760, lng: 72.8777 },
    bengaluru: { lat: 12.9716, lng: 77.5946 },
    ahmedabad: { lat: 23.0225, lng: 72.5714 },
    bhopal: { lat: 23.2599, lng: 77.4126 },
    chandigarh: { lat: 30.7333, lng: 76.7794 },
    bhubaneswar: { lat: 20.2961, lng: 85.8245 },
    visakhapatnam: { lat: 17.6868, lng: 83.2185 },
};

const CITY_ALIASES: Record<string, string> = {
    newdelhi: 'delhi',
    new_delhi: 'delhi',
    bengluru: 'bengaluru',
    bangalore: 'bengaluru',
    samastipurdistrict: 'samastipur',
};

const normalizeCityKey = (value: string | null | undefined): string => normalizeText(value).replace(/[^a-z]/g, '');

const resolveCityCoordinate = (city: string | null | undefined): { lat: number; lng: number } | null => {
    const rawKey = normalizeCityKey(city);
    if (!rawKey) return null;

    const canonical = CITY_ALIASES[rawKey] || rawKey;
    if (CITY_COORDINATES[canonical]) return CITY_COORDINATES[canonical];

    const matchedKey = Object.keys(CITY_COORDINATES).find((key) => rawKey.includes(key) || key.includes(rawKey));
    return matchedKey ? CITY_COORDINATES[matchedKey] : null;
};

const haversineKm = (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const doesDoctorMatchDepartment = (specialization: string | null | undefined, departmentId: string): boolean => {
    return normalizeText(specialization) === normalizeText(departmentId);
};

const isCityMatch = (doctorCity: string | null | undefined, selectedCity: string): boolean => {
    const doctorValue = normalizeText(doctorCity);
    const selectedValue = normalizeText(selectedCity);
    if (!doctorValue || !selectedValue) {
        return false;
    }

    if (doctorValue === selectedValue) {
        return true;
    }

    return doctorValue.includes(selectedValue) || selectedValue.includes(doctorValue);
};

const getEditDistance = (source: string, target: string): number => {
    if (source === target) return 0;
    if (!source.length) return target.length;
    if (!target.length) return source.length;

    const rows = source.length + 1;
    const cols = target.length + 1;
    const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
    for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = source[i - 1] === target[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[source.length][target.length];
};

const parseExperienceYears = (experience: string | null | undefined): number => {
    const value = experience?.trim();
    if (!value) {
        return 0;
    }

    const matched = value.match(/(\d+(\.\d+)?)/);
    if (!matched) {
        return 0;
    }

    return Number(matched[1]) || 0;
};

const parseNumericValue = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().replace(/,/g, '');
    const match = normalized.match(/-?\d+(\.\d+)?/);
    if (!match) {
        return null;
    }

    const numeric = Number(match[0]);
    return Number.isFinite(numeric) ? numeric : null;
};

const formatDoctorRatingLabel = (value: unknown): string => {
    const numeric = parseNumericValue(value);
    if (numeric === null || numeric <= 0 || numeric > 5) {
        return '4.5';
    }

    const rounded = Math.round(numeric * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
};

const formatDoctorFeeLabel = (value: unknown): string => {
    const numeric = parseNumericValue(value);
    if (numeric === null || numeric <= 0) {
        return '';
    }

    if (Math.abs(numeric % 1) < 0.000001) {
        return `₹${Math.trunc(numeric)}`;
    }

    return `₹${numeric.toFixed(2).replace(/\.?0+$/, '')}`;
};

const formatDoctorExperienceLabel = (value: unknown): string => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        return '0 yrs exp';
    }

    const years = parseExperienceYears(raw);
    if (years > 0) {
        const rounded = Number.isInteger(years) ? `${Math.trunc(years)}` : years.toFixed(1);
        return `${rounded} yrs exp`;
    }

    const normalized = raw.toLowerCase();
    if (normalized.includes('exp')) {
        return raw;
    }

    return `${raw} exp`;
};

const resolveDoctorCardMetrics = (
    doctor: Pick<Doctor, 'rating' | 'fee'>
): { ratingLabel: string; feeLabel: string } => {
    const ratingNumeric = parseNumericValue(doctor.rating);
    const ratingLooksLikeFee = ratingNumeric !== null && ratingNumeric > 5;
    const normalizedRating = ratingNumeric !== null && ratingNumeric > 0 && ratingNumeric <= 5 ? ratingNumeric : null;
    const feeLabel = formatDoctorFeeLabel(doctor.fee || (ratingLooksLikeFee ? ratingNumeric : null));
    const ratingLabel = formatDoctorRatingLabel(normalizedRating);
    return { ratingLabel, feeLabel };
};

const nowIso = (): string => new Date().toISOString();

const FUNCTIONS_BASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const HOME_VOICE_STREAM_MODE_RAW = (process.env.EXPO_PUBLIC_HOME_VOICE_STREAM_MODE || 'on').trim().toLowerCase();
const HOME_VOICE_STREAM_MODE: 'on' | 'off' | 'force' =
    HOME_VOICE_STREAM_MODE_RAW === 'off' || HOME_VOICE_STREAM_MODE_RAW === 'force'
        ? HOME_VOICE_STREAM_MODE_RAW
        : 'on';
const HOME_VOICE_WARMUP_ENABLED =
    (process.env.EXPO_PUBLIC_HOME_VOICE_WARMUP || (__DEV__ ? 'off' : 'on')).trim().toLowerCase() === 'on';
const HOME_VOICE_TTS_MODE: 'fast' | 'premium' =
    (process.env.EXPO_PUBLIC_HOME_VOICE_TTS_MODE || 'fast').trim().toLowerCase() === 'premium'
        ? 'premium'
        : 'fast';

type ParsedSseEvent = {
    event: string;
    data: any;
};

const hasReadableStreamSupport = (): boolean => {
    if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined' || typeof Response === 'undefined') {
        return false;
    }
    try {
        const probe = new Response(new ReadableStream({ start: (controller) => controller.close() }));
        return typeof (probe as any)?.body?.getReader === 'function';
    } catch {
        return false;
    }
};

const parseSseBuffer = (buffer: string): { events: ParsedSseEvent[]; rest: string } => {
    const normalized = buffer.replace(/\r\n/g, '\n');
    const events: ParsedSseEvent[] = [];
    let cursor = 0;

    while (true) {
        const boundary = normalized.indexOf('\n\n', cursor);
        if (boundary < 0) break;

        const block = normalized.slice(cursor, boundary).trim();
        cursor = boundary + 2;
        if (!block) continue;

        let eventName = 'message';
        const dataParts: string[] = [];

        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim() || 'message';
            } else if (line.startsWith('data:')) {
                dataParts.push(line.slice(5).trim());
            }
        }

        const rawData = dataParts.join('\n');
        if (!rawData) continue;

        let data: any = rawData;
        try {
            data = JSON.parse(rawData);
        } catch {
            // Keep raw string payload for non-JSON events.
        }

        events.push({ event: eventName, data });
    }

    return {
        events,
        rest: normalized.slice(cursor),
    };
};

const extractPayloadFromSseOrJsonText = (rawText: string): any => {
    const text = (rawText || '').trim();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        // Not plain JSON, continue.
    }

    const doneMatch = text.match(/event:\s*done[\s\S]*?data:\s*(\{[\s\S]*\})/i);
    if (doneMatch?.[1]) {
        try {
            return JSON.parse(doneMatch[1]);
        } catch {
            // ignore and continue
        }
    }

    return null;
};

const createInitialAgentMessages = (): AgentMessage[] => [
    {
        id: 'agent-welcome',
        role: 'ai',
        text: 'Hello, I am your CD4 AI Agent. Share your symptoms or ask for the best doctor, and I will guide you.',
        createdAt: nowIso(),
    },
];

const createClientConversationId = (): string =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const randomNibble = Math.floor(Math.random() * 16);
        const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
        return value.toString(16);
    });

const DEFAULT_AGENT_PROGRESS_HINTS = [
    'Analyzing symptoms...',
    'Checking medical context...',
    'Searching doctors if needed...',
    'Preparing guidance...',
];

const buildAgentProgressHints = (args: {
    userText: string;
    departmentLabel?: string | null;
}): string[] => {
    const text = (args.userText || '').toLowerCase();
    const department = (args.departmentLabel || '').trim();
    const doctorScope = department ? `${department} doctors` : 'verified doctors';
    const concernScope = department ? ` for ${department}` : '';
    const wantsSlotSearch = /\b(book|booking|appointment|slot|confirm|milna|schedule)\b/i.test(text);
    const wantsDoctorSearch =
        wantsSlotSearch ||
        /\b(doctor|doctors|specialist|physician|clinic|consult|near|best|show|find|suggest|recommend|dikh|dikhao)\b/i.test(text);

    if (wantsSlotSearch) {
        return [
            `Checking booking request${concernScope}...`,
            'Searching available slots...',
            'Matching the selected slot...',
            'Preparing booking confirmation...',
        ];
    }

    if (wantsDoctorSearch) {
        return [
            `Understanding your concern${concernScope}...`,
            `Searching ${doctorScope}...`,
            'Checking doctor profiles and availability...',
            'Preparing doctor recommendations...',
        ];
    }

    return [
        'Analyzing symptoms...',
        `Checking medical context${concernScope}...`,
        'Looking for suitable doctors if needed...',
        'Preparing guidance...',
    ];
};

const VOICE_AUTO_SUBMIT_DELAY_MS = 550;
const VOICE_END_AUTO_SUBMIT_DELAY_MS = 220;
const VOICE_END_MIN_SILENCE_MS = 900;
const VOICE_END_RESTART_COOLDOWN_MS = 450;
const VOICE_FINAL_FALLBACK_DELAY_MS = VOICE_END_MIN_SILENCE_MS + 260;
const VOICE_COUNTDOWN_TICK_MS = 100;
const DOCTOR_MOUTH_IDLE_SCALE = 0.55;
const DOCTOR_MOUTH_MIN_SCALE = 0.35;
const DOCTOR_MOUTH_MAX_SCALE = 1.95;
const AGENT_HISTORY_MAX_MESSAGES = 8;
const AGENT_HISTORY_MAX_CHARS = 280;
const QUICK_TEXT_AGENT_HISTORY_MAX_MESSAGES = 5;
const QUICK_TEXT_AGENT_HISTORY_MAX_CHARS = 220;
const VOICE_AGENT_HISTORY_MAX_MESSAGES = 8;
const VOICE_AGENT_HISTORY_MAX_CHARS = 220;
const SESSION_TOKEN_CACHE_WINDOW_MS = 45_000;
const PROMO_AUTOSCROLL_MS = 3800;
const DOCTOR_ORBIT_DOTS: Array<{
    key: string;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}> = [
    { key: 'dot-1', top: 7, left: 30 },
    { key: 'dot-2', top: 17, right: 8 },
    { key: 'dot-3', bottom: 10, right: 14 },
    { key: 'dot-4', bottom: 12, left: 12 },
    { key: 'dot-5', top: 22, left: 4 },
];

const clampNumber = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
};

const sanitizeSpeechText = (text: string): string =>
    (text || '')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\*|_|#/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();

const HINDI_ROMAN_SPEECH_PATTERN =
    /\b(kya|mujhe|mera|meri|mere|mai|main|haan|han|nahi|nahin|hai|hain|kar do|kardo|kr do|krdo|chahiye|batao|dikhao|aaj|kal|subah|shaam|raat|dard|bukhar|dawai|doctor se|slot|book kar)\b/i;

const isLikelyHindiSpeechText = (text: string): boolean => {
    const raw = (text || '').trim();
    if (!raw) return false;
    if (/[\u0900-\u097F]/.test(raw)) return true;
    return HINDI_ROMAN_SPEECH_PATTERN.test(raw.toLowerCase());
};

const getPreferredSpeechLocale = (text: string): string =>
    isLikelyHindiSpeechText(text) ? 'hi-IN' : 'en-IN';

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const splitIntoReadableSegments = (text: string): string[] => {
    const normalized = (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    if (!normalized) return [];

    const matches = normalized.match(/[^.!?\n]+[.!?]+|[^\n]+(?=\n)|[^\n]+$/g) || [normalized];
    return matches.map((segment) => segment.trim()).filter(Boolean);
};

const resolveSpeechPacing = (text: string): { rate: number; pauseMs: number } => {
    const clean = sanitizeSpeechText(text);
    const sentenceEndPause = /[.!?]$/.test(clean) ? 120 : 55;
    return {
        rate: isLikelyHindiSpeechText(clean) ? 0.94 : 1.0,
        pauseMs: sentenceEndPause,
    };
};

const normalizeVoiceSubmitFingerprint = (text: string): string =>
    (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const resolveMouthShapeForChunk = (chunk: string): number => {
    const normalized = (chunk || '').toLowerCase();
    if (!normalized.trim()) return DOCTOR_MOUTH_IDLE_SCALE;
    if (/[,.!?;:]/.test(normalized)) return 0.42;
    if (/a/.test(normalized)) return 1.86;
    if (/o/.test(normalized)) return 1.92;
    if (/u/.test(normalized)) return 1.72;
    if (/e/.test(normalized)) return 1.52;
    if (/i/.test(normalized)) return 1.3;
    if (/[mnbp]/.test(normalized)) return 0.75;
    if (/[fv]/.test(normalized)) return 0.93;
    if (/[tdkg]/.test(normalized)) return 1.05;
    if (/[0-9]/.test(normalized)) return 1.18;
    return 0.98;
};

const estimateSpeechDurationMs = (text: string): number => {
    const words = sanitizeSpeechText(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return 1200;
    }
    const punctuationPauseMs = ((text.match(/[,.!?;:]/g) || []).length) * 130;
    const baseMs = words.length * 360;
    return clampNumber(baseMs + punctuationPauseMs, 900, 18000);
};

const buildLipSyncFramesFromText = (text: string): number[] => {
    const cleaned = sanitizeSpeechText(text).toLowerCase();
    if (!cleaned) {
        return [DOCTOR_MOUTH_IDLE_SCALE, 0.84, DOCTOR_MOUTH_IDLE_SCALE];
    }

    const frames: number[] = [DOCTOR_MOUTH_IDLE_SCALE];
    for (const char of cleaned) {
        if (char === ' ') {
            frames.push(0.48);
            continue;
        }
        if (/[,.!?;:]/.test(char)) {
            frames.push(0.4, DOCTOR_MOUTH_IDLE_SCALE);
            continue;
        }

        const mouthOpen = resolveMouthShapeForChunk(char);
        frames.push(mouthOpen, mouthOpen > 1.35 ? 0.72 : 0.64);
    }

    const normalized = frames.slice(0, 240).map((value, index) => {
        const sway = index % 5 === 0 ? 0.05 : index % 7 === 0 ? -0.04 : 0;
        return clampNumber(value + sway, DOCTOR_MOUTH_MIN_SCALE, DOCTOR_MOUTH_MAX_SCALE);
    });

    if (normalized.length < 18) {
        const seed = [...normalized];
        while (normalized.length < 18) {
            normalized.push(seed[normalized.length % seed.length] ?? DOCTOR_MOUTH_IDLE_SCALE);
        }
    }

    return normalized;
};

const normalizeAIDoctorPersona = (value: unknown): AIDoctorPersona | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'male' || normalized === 'm') return 'male';
    if (normalized === 'female' || normalized === 'f') return 'female';
    return null;
};

const inferAIDoctorPersonaFromVoiceName = (value: unknown): AIDoctorPersona | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;

    if (['nova', 'shimmer', 'alloy', 'female', 'woman'].some((token) => normalized.includes(token))) {
        return 'female';
    }
    if (['onyx', 'echo', 'fable', 'male', 'man'].some((token) => normalized.includes(token))) {
        return 'male';
    }
    return null;
};

const hasVoiceToken = (haystack: string, token: string): boolean => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
};

const pickVoiceIdForPersona = (voices: any[], persona: AIDoctorPersona): string | undefined => {
    const personaKeywords = persona === 'male'
        ? ['male', 'man', 'onyx', 'echo', 'fable', 'daniel', 'rishi']
        : ['female', 'woman', 'nova', 'shimmer', 'alloy', 'samantha', 'karen', 'moira', 'tessa', 'veena', 'joanna'];
    const oppositeKeywords = persona === 'male'
        ? ['female', 'woman', 'nova', 'shimmer', 'samantha', 'karen', 'moira', 'tessa', 'veena', 'joanna']
        : ['male', 'man', 'onyx', 'echo', 'daniel', 'rishi'];
    const primaryLanguageKeywords = ['en-in', 'hi-in'];
    const fallbackLanguageKeywords = ['en-us', 'en-gb', 'english'];

    const scored = voices
        .map((voice) => {
            const identifier = String(voice?.identifier || '').toLowerCase();
            const name = String(voice?.name || '').toLowerCase();
            const language = String(voice?.language || '').toLowerCase();
            const haystack = `${identifier} ${name} ${language}`;

            let score = 0;
            if (personaKeywords.some((keyword) => hasVoiceToken(haystack, keyword))) score += 30;
            if (oppositeKeywords.some((keyword) => hasVoiceToken(haystack, keyword))) score -= 40;
            if (primaryLanguageKeywords.some((keyword) => haystack.includes(keyword))) score += 8;
            if (fallbackLanguageKeywords.some((keyword) => haystack.includes(keyword))) score += 4;
            if (haystack.includes('enhanced') || haystack.includes('premium') || haystack.includes('network')) score += 2;

            return {
                id: String(voice?.identifier || ''),
                score,
            };
        })
        .filter((item) => item.id);

    scored.sort((a, b) => b.score - a.score);
    return scored.find((item) => item.score > 0)?.id;
};

const getSpeechPitchForPersona = (persona: AIDoctorPersona): number =>
    persona === 'female' ? 1.08 : 0.98;

const toTitleCase = (value: string): string =>
    value
        .split(' ')
        .filter((token) => token.length > 0)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');

const getAgentToolLabel = (name: string): string => {
    const normalized = (name || '').trim().toLowerCase().replace(/-/g, '_');

    switch (normalized) {
        case 'detect_department':
            return 'Classifying concern';
        case 'query_medical_records':
            return 'Checking medical records';
        case 'get_vital_signs':
            return 'Checking vital signs';
        case 'search_doctors':
            return 'Searching doctors';
        case 'search_top_doctors':
            return 'Searching top doctors';
        case 'search_hospitals_doctors':
            return 'Searching hospitals and doctors';
        case 'prepare_booking':
            return 'Preparing booking';
        case 'confirm_and_book':
            return 'Confirming booking';
        case 'escalate_to_doctor':
            return 'Evaluating doctor escalation';
        default:
            return toTitleCase(normalized.replace(/_/g, ' '));
    }
};

const normalizeToolStepStatus = (value: unknown): AgentToolStepStatus => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'success' || normalized === 'skipped' || normalized === 'error') {
        return normalized;
    }
    return 'running';
};

const clipStepDetail = (value: string, max: number = 120): string => {
    const normalized = value.trim();
    if (normalized.length <= max) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, max - 1))}...`;
};

const getAgentToolDetail = (details: any, fallbackObservation?: unknown): string | undefined => {
    if (details && typeof details === 'object') {
        const message = typeof details.message === 'string' ? details.message.trim() : '';
        if (message) {
            return clipStepDetail(message);
        }

        if (typeof details.count === 'number' && Number.isFinite(details.count)) {
            const count = Math.max(0, Math.round(details.count));
            const department = typeof details.department === 'string' ? details.department.trim() : '';
            return department ? `Found ${count} result(s) in ${department}.` : `Found ${count} result(s).`;
        }

        const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
        if (reason) {
            return clipStepDetail(`Skipped: ${reason.replace(/_/g, ' ')}`);
        }

        const observation = typeof details.observation === 'string' ? details.observation.trim() : '';
        if (observation) {
            return clipStepDetail(observation);
        }
    }

    const fallback = typeof fallbackObservation === 'string' ? fallbackObservation.trim() : '';
    return fallback ? clipStepDetail(fallback) : undefined;
};

const normalizeAgentToolSteps = (toolsExecuted: any, autonomousToolSteps: any): AgentToolStep[] => {
    const steps: AgentToolStep[] = [];
    const seen = new Set<string>();

    const pushStep = (rawName: unknown, rawStatus: unknown, detail?: string) => {
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) {
            return;
        }

        const status = normalizeToolStepStatus(rawStatus);
        const key = `${name}|${status}|${detail || ''}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        steps.push({
            id: `${steps.length + 1}-${name}`,
            name,
            label: getAgentToolLabel(name),
            status,
            detail,
        });
    };

    if (Array.isArray(toolsExecuted)) {
        for (const item of toolsExecuted) {
            const detail = getAgentToolDetail(item?.details);
            pushStep(item?.name ?? item?.action, item?.status, detail);
        }
    }

    if (Array.isArray(autonomousToolSteps)) {
        for (const item of autonomousToolSteps) {
            const detail = getAgentToolDetail(undefined, item?.observation);
            pushStep(item?.action ?? item?.name, item?.status, detail);
        }
    }

    return steps.slice(0, 8);
};

const getAgentToolStatusVisual = (status: AgentToolStepStatus): {
    label: string;
    dotColor: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
} => {
    if (status === 'success') {
        return {
            label: 'Done',
            dotColor: '#3BD18A',
            badgeBg: '#1A483A',
            badgeBorder: '#2D6B57',
            badgeText: '#B8F1DA',
        };
    }

    if (status === 'error') {
        return {
            label: 'Error',
            dotColor: '#F26F6F',
            badgeBg: '#4A2020',
            badgeBorder: '#6C3030',
            badgeText: '#F9CECE',
        };
    }

    if (status === 'skipped') {
        return {
            label: 'Skipped',
            dotColor: '#A9B8B3',
            badgeBg: '#1A2F29',
            badgeBorder: '#2C4A41',
            badgeText: '#C9D8D2',
        };
    }

    return {
        label: 'Running',
        dotColor: '#69B0FF',
        badgeBg: '#143553',
        badgeBorder: '#2B5172',
        badgeText: '#CDE6FF',
    };
};

const isBenignSpeechRecognitionError = (message?: string): boolean => {
    const normalizedMessage = message?.trim().toLowerCase() || '';
    if (!normalizedMessage) {
        return false;
    }

    return (
        normalizedMessage.includes('aborted') ||
        normalizedMessage.includes('cancelled') ||
        normalizedMessage.includes('canceled') ||
        normalizedMessage.includes('no speech') ||
        normalizedMessage.includes('no-speech')
    );
};

const normalizeAgentRecommendedDoctors = (value: any): AgentRecommendedDoctor[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item: any) => {
            const id = typeof item?.id === 'string'
                ? item.id
                : typeof item?._id === 'string'
                    ? item._id
                    : '';
            if (!id) {
                return null;
            }

            const ratingValue = typeof item?.rating === 'number' ? item.rating : Number(item?.rating || 0);
            const rawExperience = typeof item?.experience === 'string'
                ? item.experience
                : typeof item?.experience === 'number'
                    ? `${item.experience} Years`
                    : '';
            const rawFee = typeof item?.fee === 'string' || typeof item?.fee === 'number'
                ? String(item.fee)
                : '';
            const profilePayload = item?.profiles;
            const profile = Array.isArray(profilePayload) ? profilePayload[0] : profilePayload;
            return {
                id,
                _id: typeof item?._id === 'string' ? item._id : undefined,
                firstName: typeof item?.firstName === 'string'
                    ? item.firstName
                    : typeof item?.first_name === 'string'
                        ? item.first_name
                        : typeof profile?.first_name === 'string'
                            ? profile.first_name
                            : '',
                lastName: typeof item?.lastName === 'string'
                    ? item.lastName
                    : typeof item?.last_name === 'string'
                        ? item.last_name
                        : typeof profile?.last_name === 'string'
                            ? profile.last_name
                            : '',
                city: typeof item?.city === 'string'
                    ? item.city
                    : typeof item?.location === 'string'
                        ? item.location
                        : '',
                specialization: typeof item?.specialization === 'string'
                    ? item.specialization
                    : typeof item?.specialty === 'string'
                        ? item.specialty
                        : '',
                rating: Number.isFinite(ratingValue) ? ratingValue : 0,
                experience: rawExperience,
                fee: rawFee,
                image: typeof item?.image === 'string'
                    ? item.image
                    : typeof profile?.profile_picture === 'string'
                        ? profile.profile_picture
                        : '',
                isVerified: Boolean(item?.isVerified || item?.is_verified),
                is_verified: Boolean(item?.is_verified || item?.isVerified),
            } as AgentRecommendedDoctor;
        })
        .filter((doctor: AgentRecommendedDoctor | null): doctor is AgentRecommendedDoctor => Boolean(doctor))
        .slice(0, 10);
};

const normalizeAgentBookingSlotOptions = (value: any): AgentBookingSlotOption[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item: any) => {
            const id = typeof item?.id === 'string'
                ? item.id.trim()
                : typeof item?._id === 'string'
                    ? item._id.trim()
                    : '';
            if (!id) {
                return null;
            }

            const label = typeof item?.label === 'string' && item.label.trim()
                ? item.label.trim()
                : [
                    typeof item?.date === 'string' ? item.date.trim() : '',
                    typeof item?.startTime === 'string' ? item.startTime.trim() : '',
                ].filter(Boolean).join(' ');

            if (!label) {
                return null;
            }

            return {
                id,
                label,
                date: typeof item?.date === 'string' ? item.date : undefined,
                startTime: typeof item?.startTime === 'string' ? item.startTime : undefined,
                endTime: typeof item?.endTime === 'string' ? item.endTime : undefined,
            } as AgentBookingSlotOption;
        })
        .filter((slot: AgentBookingSlotOption | null): slot is AgentBookingSlotOption => Boolean(slot))
        .slice(0, 6);
};

const extractAgentBookingSlotOptions = (responseData: any): AgentBookingSlotOption[] => {
    const candidates = [
        responseData?.bookingPreparation?.slotOptions,
        responseData?.bookingPreparation?.proposal?.slotOptions,
        responseData?.bookingSlotOptions,
        responseData?.slotOptions,
    ];

    for (const candidate of candidates) {
        const normalized = normalizeAgentBookingSlotOptions(candidate);
        if (normalized.length > 0) {
            return normalized;
        }
    }

    return [];
};

const ensureReplyIncludesBookingSlots = (
    replyText: string,
    slotOptions: AgentBookingSlotOption[]
): string => {
    const cleanReply = (replyText || '').trim();
    if (!cleanReply || slotOptions.length === 0) {
        return cleanReply;
    }

    const lowerReply = cleanReply.toLowerCase();
    const alreadyListsSlots =
        lowerReply.includes('available slots') ||
        slotOptions.some((slot) => slot.label && lowerReply.includes(slot.label.toLowerCase()));

    if (alreadyListsSlots) {
        return cleanReply;
    }

    const slotLines = slotOptions.map((slot, index) => `${index + 1}. ${slot.label}`);
    return `${cleanReply}\n\n### Available Slots\n${slotLines.join('\n')}\n\nTell me the slot number or time you want to book.`;
};

const BOOKING_SUCCESS_CLAIM_REGEX =
    /\b(booked|booking done|booking confirmed|appointment confirmed|appointment booked|slot booked|book ho g(ya|yi)|book kar diya|appointment ho g(ya|yi))\b/i;

const sanitizeBookingReplyForUi = (args: {
    replyText: string;
    bookingStatus?: string | null;
    bookingMessage?: string | null;
    slotOptions?: AgentBookingSlotOption[];
}): string => {
    const rawReply = (args.replyText || '').trim();
    if (!rawReply) return rawReply;

    const bookingStatus = (args.bookingStatus || '').toLowerCase();
    if (bookingStatus === 'confirmed') {
        return rawReply;
    }

    if (!BOOKING_SUCCESS_CLAIM_REGEX.test(rawReply.toLowerCase())) {
        return rawReply;
    }

    const reason =
        typeof args.bookingMessage === 'string' && args.bookingMessage.trim().length > 0
            ? args.bookingMessage.trim()
            : 'Booking abhi database me confirm nahi hui hai.';
    const hasSlots = Array.isArray(args.slotOptions) && args.slotOptions.length > 0;
    const nextStep = hasSlots
        ? 'Available slots me se ek slot choose karke bolo: "is slot ko book karo".'
        : 'Please dobara booking try karein.';

    return `Booking abhi confirm nahi hui hai. ${reason} ${nextStep}`.trim();
};

const normalizeAgentDepartmentSuggestion = (value: any): AgentDepartmentSuggestion | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    if (!id || !label) {
        return null;
    }

    return { id, label };
};

const buildAgentHistoryForApi = (
    messages: AgentMessage[],
    options?: {
        includeDoctorRecommendations?: boolean;
        includeBookingSlotOptions?: boolean;
        maxMessages?: number;
        maxChars?: number;
    }
) => {
    const maxChars = clampNumber(options?.maxChars ?? AGENT_HISTORY_MAX_CHARS, 120, 420);
    const maxMessages = Math.round(clampNumber(options?.maxMessages ?? AGENT_HISTORY_MAX_MESSAGES, 3, 16));
    return messages
        .map((message) => {
            const compactContent = message.text
                .trim()
                .replace(/\s+/g, ' ')
                .slice(0, maxChars);
            const payload: any = {
                role: message.role === 'ai' ? 'assistant' : 'user',
                content: compactContent,
            };

            // Preserve doctor list context so booking follow-ups can resolve "first doctor" reliably.
            if (
                options?.includeDoctorRecommendations !== false &&
                message.role === 'ai' &&
                Array.isArray(message.recommendedDoctors) &&
                message.recommendedDoctors.length > 0
            ) {
                payload.doctorRecommendations = message.recommendedDoctors
                    .slice(0, 5)
                    .map((doctor) => ({
                        id: doctor.id || doctor._id,
                        firstName: doctor.firstName || '',
                        lastName: doctor.lastName || '',
                        city: doctor.city || '',
                        specialization: doctor.specialization || '',
                    }));
            }

            if (
                options?.includeBookingSlotOptions !== false &&
                message.role === 'ai' &&
                Array.isArray(message.bookingSlotOptions) &&
                message.bookingSlotOptions.length > 0
            ) {
                payload.bookingSlotOptions = message.bookingSlotOptions
                    .slice(0, 6)
                    .map((slot) => ({
                        id: slot.id,
                        label: slot.label,
                        date: slot.date || null,
                        startTime: slot.startTime || null,
                        endTime: slot.endTime || null,
                    }));
            }

            if (message.role === 'ai' && message.recommendedDepartment?.id && message.recommendedDepartment?.label) {
                payload.departmentSuggestion = {
                    id: message.recommendedDepartment.id,
                    label: message.recommendedDepartment.label,
                };
            }

            if (message.role === 'ai' && message.consultRecommended) {
                payload.consultRecommended = true;
            }

            if (message.role === 'ai' && typeof message.bookingPrompt === 'string' && message.bookingPrompt.trim().length > 0) {
                payload.bookingPrompt = message.bookingPrompt.trim().slice(0, maxChars);
            }

            return payload;
        })
        .filter((message) => message.content.length > 0)
        .slice(-maxMessages);
};

export default function FindDoctorView({ theme }: FindDoctorViewProps) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const { user } = useAuthContext();
    const { t, language } = useAppLanguage();
    const userFirstName = React.useMemo(() => {
        const firstName = typeof user?.firstName === 'string' ? user.firstName.trim() : '';
        if (!firstName) return '';
        return firstName.split(/\s+/)[0] || '';
    }, [user?.firstName]);
    const aiTitleNameSuffix = userFirstName ? `, ${userFirstName}` : '';
    const queryClient = useQueryClient();
    const {
        data: doctorsData = [] as Doctor[],
        isLoading: loading,
        isFetching: isDoctorsFetching,
        refetch,
    } = useDoctors();
    const [isPullRefreshing, setIsPullRefreshing] = React.useState(false);
    const [locationCity, setLocationCity] = React.useState<string | null>(null);
    const [loadingCity, setLoadingCity] = React.useState(true);
    const [selectedCity, setSelectedCity] = React.useState<string | null>(null);
    const [hasUserSelectedCity, setHasUserSelectedCity] = React.useState(false);
    const [isCityPickerVisible, setIsCityPickerVisible] = React.useState(false);
    const [citySearchQuery, setCitySearchQuery] = React.useState('');
    const [debouncedCitySearchQuery, setDebouncedCitySearchQuery] = React.useState('');
    const [selectedDepartmentId, setSelectedDepartmentId] = React.useState<string | null>(null);
    const [isDepartmentListVisible, setIsDepartmentListVisible] = React.useState(false);
    const [departmentSearchQuery, setDepartmentSearchQuery] = React.useState('');
    const [isConcernListVisible, setIsConcernListVisible] = React.useState(false);
    const [concernSearchQuery, setConcernSearchQuery] = React.useState('');
    const [symptomInput, setSymptomInput] = React.useState('');
    const [isListening, setIsListening] = React.useState(false);
    const [isVoiceSessionActive, setIsVoiceSessionActive] = React.useState(false);
    const [isVoiceReplyPlaying, setIsVoiceReplyPlaying] = React.useState(false);
    const [voiceStatusText, setVoiceStatusText] = React.useState('Tap mic to start continuous voice');
    const [, setVoiceLiveTranscript] = React.useState('');
    const [isAgentConversationVisible, setIsAgentConversationVisible] = React.useState(false);
    const [isAgentSending, setIsAgentSending] = React.useState(false);
    const [showProPlanModal, setShowProPlanModal] = React.useState(false);
    const [voiceLimitPrompt, setVoiceLimitPrompt] = React.useState<VoiceLimitPromptState | null>(null);
    const [isBookingConfirmedOverlay, setIsBookingConfirmedOverlay] = React.useState(false);
    const [nearbyVisibleCount, setNearbyVisibleCount] = React.useState(HOME_NEARBY_PAGE_SIZE);
    const [isLoadingMoreNearbyDoctors, setIsLoadingMoreNearbyDoctors] = React.useState(false);
    const [agentProgressIndex, setAgentProgressIndex] = React.useState(0);
    const [agentProgressHints, setAgentProgressHints] = React.useState(DEFAULT_AGENT_PROGRESS_HINTS);
    const [agentCustomHint, setAgentCustomHint] = React.useState<string | null>(null);
    const [modalTextInput, setModalTextInput] = React.useState('');
    const [isChatInputActive, setIsChatInputActive] = React.useState(false);
    const [aiDoctorPersona, setAiDoctorPersona] = React.useState<AIDoctorPersona>('female');
    const [voiceSilenceCountdownMs, setVoiceSilenceCountdownMs] = React.useState<number | null>(null);
    const [isAgentVoiceLiveStreaming, setIsAgentVoiceLiveStreaming] = React.useState(false);
    const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);
    const [keyboardHeight, setKeyboardHeight] = React.useState(0);
    const [nativeVoiceIdByPersona, setNativeVoiceIdByPersona] = React.useState<Partial<Record<AIDoctorPersona, string>>>({});
    const [agentMessages, setAgentMessages] = React.useState<AgentMessage[]>(() => createInitialAgentMessages());
    const agentMessagesRef = React.useRef<AgentMessage[]>(agentMessages);
    const agentMessageCounterRef = React.useRef(0);
    const agentScrollRef = React.useRef<ScrollView | null>(null);
    const promoCarouselRef = React.useRef<ScrollView | null>(null);
    const promoAutoScrollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const promoAutoScrollIndexRef = React.useRef(0);
    const autoSubmitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoSubmitCountdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const finalSubmitFallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeVoiceSoundRef = React.useRef<Audio.Sound | null>(null);
    const activeWebAudioRef = React.useRef<any | null>(null);
    const hasReceivedServerAudioChunksRef = React.useRef<boolean>(false);
    const serverAudioChunksMapRef = React.useRef<Map<number, { audio: string; text: string }>>(new Map());
    const nextExpectedAudioIndexRef = React.useRef<number>(0);
    const isPlayingServerAudioRef = React.useRef<boolean>(false);
    const voiceSilenceInitialDelayRef = React.useRef<number>(2000);
    const agentStreamAbortControllerRef = React.useRef<AbortController | null>(null);
    const isHomeAgentSendingRef = React.useRef<boolean>(false);
    const activeSpeechRef = React.useRef<boolean>(false);
    const homeVoiceLiveSpeechQueueRef = React.useRef<string[]>([]);
    const homeVoiceLiveSpeechBusyRef = React.useRef(false);
    const homeVoiceLiveSpokenCharsRef = React.useRef(0);
    const homeVoiceLiveSpeechRunIdRef = React.useRef(0);
    const activeAgentRequestTokenRef = React.useRef<string | null>(null);
    const agentRequestCounterRef = React.useRef(0);
    const agentConversationIdRef = React.useRef<string>(createClientConversationId());
    const cachedSessionTokenRef = React.useRef<string | null>(null);
    const cachedSessionTokenAtRef = React.useRef(0);
    const homeVoiceStreamCapabilityRef = React.useRef<'unknown' | 'supported' | 'unsupported'>('unknown');
    const agentStreamingDraftMessageIdRef = React.useRef<string | null>(null);
    const lastVoiceWarmupAtRef = React.useRef(0);
    const lastAgentUserIdRef = React.useRef<string | null>(user?.id || null);
    const hasSpeechPermissionRef = React.useRef(false);
    const nearbyLoadMoreThrottleRef = React.useRef(0);
    const nearbyLoadMoreTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const voiceSessionActiveRef = React.useRef(false);
    const voiceLiveTranscriptRef = React.useRef('');
    const lastVoiceSubmitRef = React.useRef<{ text: string; at: number }>({ text: '', at: 0 });
    const lastVoiceResultAtRef = React.useRef(0);
    const lastVoiceEndRestartAtRef = React.useRef(0);
    const voiceSubmitInProgressRef = React.useRef(false);
    const voicePulse = React.useRef(new Animated.Value(1)).current;
    const premiumWaitPulse = React.useRef(new Animated.Value(0)).current;
    const doctorMouthScale = React.useRef(new Animated.Value(DOCTOR_MOUTH_IDLE_SCALE)).current;
    const doctorOrbSpin = React.useRef(new Animated.Value(0)).current;
    const doctorHaloDrift = React.useRef(new Animated.Value(0)).current;
    const bookingPulse = React.useRef(new Animated.Value(1)).current;
    const lipSyncFramesRef = React.useRef<number[]>([]);
    const lipSyncIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const lipSyncFallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lipSyncBoundaryHitRef = React.useRef(false);
    const lipSyncDriveGateRef = React.useRef(0);
    const ambientMouthLoopRef = React.useRef<Animated.CompositeAnimation | null>(null);
    const clearVoiceAutoSubmitTimers = React.useCallback(() => {
        if (autoSubmitTimerRef.current) {
            clearTimeout(autoSubmitTimerRef.current);
            autoSubmitTimerRef.current = null;
        }
        if (autoSubmitCountdownRef.current) {
            clearInterval(autoSubmitCountdownRef.current);
            autoSubmitCountdownRef.current = null;
        }
        if (finalSubmitFallbackTimerRef.current) {
            clearTimeout(finalSubmitFallbackTimerRef.current);
            finalSubmitFallbackTimerRef.current = null;
        }
        setVoiceSilenceCountdownMs(null);
    }, []);
    React.useEffect(() => {
        if (isAgentConversationVisible && isChatInputActive) {
            return;
        }

        Keyboard.dismiss();
    }, [isAgentConversationVisible, isChatInputActive]);
    const activeAgentProgressHint =
        agentCustomHint ||
        agentProgressHints[agentProgressIndex % Math.max(1, agentProgressHints.length)] ||
        DEFAULT_AGENT_PROGRESS_HINTS[0];
    const isWebPlatform = Platform.OS === 'web';
    const useNativeAnimationDriver = Platform.OS !== 'web';
    const shouldShowVoiceDoctorCard = isVoiceSessionActive || isListening || isVoiceReplyPlaying;
    const shouldAnimateVoiceDoctor = isVoiceSessionActive || isListening || isVoiceReplyPlaying || isAgentSending;

    React.useEffect(() => {
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            cachedSessionTokenRef.current = nextSession?.access_token || null;
            cachedSessionTokenAtRef.current = nextSession?.access_token ? Date.now() : 0;
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    React.useEffect(() => {
        if (!HOME_VOICE_WARMUP_ENABLED) return;
        if (!user?.id) return;
        let isMounted = true;
        const WARMUP_INTERVAL_MS = 3 * 60 * 1000;

        const runWarmup = async () => {
            const now = Date.now();
            if (now - lastVoiceWarmupAtRef.current < WARMUP_INTERVAL_MS - 15000) {
                return;
            }
            try {
                const token = await ensureSessionToken();
                if (!token || !isMounted) return;
                supabase.functions.setAuth(token);
                await supabase.functions.invoke('voice-chat', {
                    body: { warmup: true, ttsMode: HOME_VOICE_TTS_MODE },
                });
                lastVoiceWarmupAtRef.current = Date.now();
            } catch {
                // Warmup is best-effort; ignore failures.
            }
        };

        void runWarmup();
        const id = setInterval(() => {
            void runWarmup();
        }, WARMUP_INTERVAL_MS);

        return () => {
            isMounted = false;
            clearInterval(id);
        };
    }, [user?.id]);

    React.useEffect(() => {
        const nextUserId = user?.id || null;
        if (lastAgentUserIdRef.current === nextUserId) {
            return;
        }

        lastAgentUserIdRef.current = nextUserId;
        cachedSessionTokenRef.current = null;
        cachedSessionTokenAtRef.current = 0;
        activeAgentRequestTokenRef.current = null;
        agentRequestCounterRef.current = 0;
        agentMessageCounterRef.current = 0;
        agentConversationIdRef.current = createClientConversationId();
        lastVoiceSubmitRef.current = { text: '', at: 0 };
        setAgentProgressHints(DEFAULT_AGENT_PROGRESS_HINTS);

        const initialMessages = createInitialAgentMessages();
        agentMessagesRef.current = initialMessages;
        setAgentMessages(initialMessages);
        setAgentCustomHint(null);
        setModalTextInput('');
        setShowProPlanModal(false);
        setIsAgentSending(false);
    }, [user?.id]);

    const doctorMouthScaleY = doctorMouthScale.interpolate({
        inputRange: [0.35, 1.9],
        outputRange: [0.55, 1.45],
        extrapolate: 'clamp',
    });
    const robotBarScaleA = doctorMouthScale.interpolate({
        inputRange: [0.35, 1.9],
        outputRange: [0.65, 1.45],
        extrapolate: 'clamp',
    });
    const robotBarScaleB = doctorMouthScale.interpolate({
        inputRange: [0.35, 1.9],
        outputRange: [1.35, 0.7],
        extrapolate: 'clamp',
    });
    const doctorOrbRotate = doctorOrbSpin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });
    const doctorOrbReverseRotate = doctorOrbSpin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '-360deg'],
    });
    const doctorHaloLift = doctorHaloDrift.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -3.5],
    });
    const doctorHaloOpacity = doctorHaloDrift.interpolate({
        inputRange: [0, 1],
        outputRange: [0.48, 0.94],
    });
    const doctorScanTranslate = doctorHaloDrift.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 37],
    });
    const doctorCoreShadowScale = doctorMouthScale.interpolate({
        inputRange: [DOCTOR_MOUTH_MIN_SCALE, DOCTOR_MOUTH_MAX_SCALE],
        outputRange: [0.92, 1.06],
        extrapolate: 'clamp',
    });
    const doctorSparkleScale = doctorMouthScale.interpolate({
        inputRange: [DOCTOR_MOUTH_MIN_SCALE, DOCTOR_MOUTH_MAX_SCALE],
        outputRange: [0.78, 1.18],
        extrapolate: 'clamp',
    });
    const doctorSparkleOpacity = doctorMouthScale.interpolate({
        inputRange: [DOCTOR_MOUTH_MIN_SCALE, 1.05, DOCTOR_MOUTH_MAX_SCALE],
        outputRange: [0.35, 0.6, 0.96],
        extrapolate: 'clamp',
    });
    const clearLipSyncTicker = React.useCallback(() => {
        if (lipSyncIntervalRef.current) {
            clearInterval(lipSyncIntervalRef.current);
            lipSyncIntervalRef.current = null;
        }
    }, []);
    const clearLipSyncFallbackTimer = React.useCallback(() => {
        if (lipSyncFallbackTimerRef.current) {
            clearTimeout(lipSyncFallbackTimerRef.current);
            lipSyncFallbackTimerRef.current = null;
        }
    }, []);
    const stopAmbientMouthLoop = React.useCallback(() => {
        if (ambientMouthLoopRef.current) {
            ambientMouthLoopRef.current.stop();
            ambientMouthLoopRef.current = null;
        }
    }, []);
    const animateDoctorMouthTo = React.useCallback(
        (targetValue: number, duration: number = 80) => {
            const nextScale = clampNumber(targetValue, DOCTOR_MOUTH_MIN_SCALE, DOCTOR_MOUTH_MAX_SCALE);
            doctorMouthScale.stopAnimation();
            Animated.timing(doctorMouthScale, {
                toValue: nextScale,
                duration: clampNumber(duration, 45, 180),
                easing: Easing.out(Easing.cubic),
                useNativeDriver: useNativeAnimationDriver,
            }).start();
        },
        [doctorMouthScale, useNativeAnimationDriver]
    );
    const stopLipSyncAnimation = React.useCallback(
        (resetMouth: boolean = true) => {
            clearLipSyncFallbackTimer();
            clearLipSyncTicker();
            lipSyncFramesRef.current = [];
            lipSyncBoundaryHitRef.current = false;
            lipSyncDriveGateRef.current = 0;
            if (resetMouth) {
                doctorMouthScale.stopAnimation();
                doctorMouthScale.setValue(DOCTOR_MOUTH_IDLE_SCALE);
            }
        },
        [clearLipSyncFallbackTimer, clearLipSyncTicker, doctorMouthScale]
    );
    const startTimedLipSync = React.useCallback(
        (speechText: string, estimatedDurationMs: number) => {
            const frames = buildLipSyncFramesFromText(speechText);
            if (frames.length === 0) return;

            clearLipSyncTicker();
            lipSyncFramesRef.current = frames;
            let frameIndex = 0;
            const intervalMs = Math.round(
                clampNumber(
                    estimatedDurationMs / Math.max(1, Math.min(frames.length, 120)),
                    55,
                    120
                )
            );
            animateDoctorMouthTo(frames[0], Math.max(50, Math.round(intervalMs * 0.75)));
            lipSyncIntervalRef.current = setInterval(() => {
                const nextFrame = frames[frameIndex % frames.length];
                frameIndex += 1;
                animateDoctorMouthTo(nextFrame, Math.max(45, Math.round(intervalMs * 0.72)));
            }, intervalMs);
        },
        [animateDoctorMouthTo, clearLipSyncTicker]
    );
    const applyBoundaryLipSync = React.useCallback(
        (speechText: string, charIndex: number, charLength: number) => {
            if (!speechText) return;
            const startIndex = Math.floor(clampNumber(charIndex, 0, Math.max(0, speechText.length - 1)));
            const boundaryLength = Math.max(1, charLength || 1);
            const chunk = speechText.slice(startIndex, startIndex + boundaryLength);
            const target = resolveMouthShapeForChunk(chunk);
            animateDoctorMouthTo(target, 70);
        },
        [animateDoctorMouthTo]
    );
    const driveLipSyncFromAudioProgress = React.useCallback(
        (positionMillis: number, durationMillis: number) => {
            const frames = lipSyncFramesRef.current;
            if (!frames.length || durationMillis <= 0) return;

            const now = Date.now();
            if (now - lipSyncDriveGateRef.current < 45) {
                return;
            }
            lipSyncDriveGateRef.current = now;

            const progress = clampNumber(positionMillis / durationMillis, 0, 1);
            const frameIndex = Math.min(frames.length - 1, Math.floor(progress * frames.length));
            const target = frames[frameIndex] ?? DOCTOR_MOUTH_IDLE_SCALE;
            animateDoctorMouthTo(target, 65);
        },
        [animateDoctorMouthTo]
    );

    React.useEffect(() => {
        if (!shouldAnimateVoiceDoctor) {
            voicePulse.setValue(1);
            return;
        }

        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(voicePulse, {
                    toValue: 1.22,
                    duration: 950,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
                Animated.timing(voicePulse, {
                    toValue: 1,
                    duration: 950,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
            ])
        );

        pulseLoop.start();
        return () => {
            pulseLoop.stop();
        };
    }, [shouldAnimateVoiceDoctor, voicePulse, useNativeAnimationDriver]);

    React.useEffect(() => {
        if (!isAgentSending) {
            premiumWaitPulse.setValue(0);
            return;
        }
        Animated.loop(
            Animated.sequence([
                Animated.timing(premiumWaitPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
                Animated.timing(premiumWaitPulse, { toValue: 0, duration: 700, useNativeDriver: true }),
            ])
        ).start();
    }, [isAgentSending, premiumWaitPulse]);

    React.useEffect(() => {
        if (!shouldAnimateVoiceDoctor) {
            doctorOrbSpin.setValue(0);
            doctorHaloDrift.setValue(0);
            return;
        }

        const spinLoop = Animated.loop(
            Animated.timing(doctorOrbSpin, {
                toValue: 1,
                duration: isVoiceReplyPlaying ? 3400 : isListening ? 4800 : 6200,
                easing: Easing.linear,
                useNativeDriver: useNativeAnimationDriver,
            })
        );
        const driftLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(doctorHaloDrift, {
                    toValue: 1,
                    duration: 650,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
                Animated.timing(doctorHaloDrift, {
                    toValue: 0,
                    duration: 690,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
            ])
        );

        spinLoop.start();
        driftLoop.start();
        return () => {
            spinLoop.stop();
            driftLoop.stop();
        };
    }, [
        doctorHaloDrift,
        doctorOrbSpin,
        isListening,
        isVoiceReplyPlaying,
        shouldAnimateVoiceDoctor,
        useNativeAnimationDriver,
    ]);

    React.useEffect(() => {
        stopAmbientMouthLoop();

        if (isVoiceReplyPlaying) {
            return;
        }

        if (!shouldAnimateVoiceDoctor) {
            doctorMouthScale.stopAnimation();
            doctorMouthScale.setValue(DOCTOR_MOUTH_IDLE_SCALE);
            return;
        }

        const minScale = isListening ? 0.82 : 0.6;
        const maxScale = isListening ? 1.06 : 0.78;
        const upDuration = isListening ? 220 : 420;
        const downDuration = isListening ? 200 : 470;

        const ambientLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(doctorMouthScale, {
                    toValue: maxScale,
                    duration: upDuration,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: useNativeAnimationDriver,
                }),
                Animated.timing(doctorMouthScale, {
                    toValue: minScale,
                    duration: downDuration,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: useNativeAnimationDriver,
                }),
            ])
        );

        ambientMouthLoopRef.current = ambientLoop;
        ambientLoop.start();
        return () => {
            stopAmbientMouthLoop();
        };
    }, [
        doctorMouthScale,
        isListening,
        isVoiceReplyPlaying,
        shouldAnimateVoiceDoctor,
        stopAmbientMouthLoop,
        useNativeAnimationDriver,
    ]);

    React.useEffect(() => {
        let isMounted = true;
        if (typeof Speech.getAvailableVoicesAsync !== 'function') {
            return;
        }

        const loadNativeVoices = async () => {
            try {
                const voices = await Speech.getAvailableVoicesAsync();
                if (!isMounted || !Array.isArray(voices) || voices.length === 0) {
                    return;
                }
                setNativeVoiceIdByPersona({
                    female: pickVoiceIdForPersona(voices, 'female'),
                });
            } catch (error) {
                console.warn('Could not read native TTS voices:', error);
            }
        };

        void loadNativeVoices();
        return () => {
            isMounted = false;
        };
    }, []);

    React.useEffect(() => {
        if (!isBookingConfirmedOverlay) {
            bookingPulse.setValue(1);
            return;
        }

        const bookingLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(bookingPulse, {
                    toValue: 1.15,
                    duration: 800,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
                Animated.timing(bookingPulse, {
                    toValue: 1,
                    duration: 800,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: useNativeAnimationDriver,
                }),
            ])
        );

        bookingLoop.start();
        return () => {
            bookingLoop.stop();
        };
    }, [isBookingConfirmedOverlay, bookingPulse, useNativeAnimationDriver]);

    React.useEffect(() => {
        let isMounted = true;

        const loadCity = async () => {
            try {
                const storedCity = await getStoredLocationCity();
                if (isMounted) {
                    setLocationCity(storedCity);
                }

                const syncedCity = await syncLocationCityIfPermitted();
                if (isMounted && syncedCity) {
                    setLocationCity(syncedCity);
                }
            } finally {
                if (isMounted) {
                    setLoadingCity(false);
                }
            }
        };

        void loadCity();

        return () => {
            isMounted = false;
        };
    }, []);

    React.useEffect(() => {
        if (hasUserSelectedCity) {
            return;
        }

        if (locationCity) {
            setSelectedCity(locationCity);
            return;
        }

        setSelectedCity(null);
    }, [locationCity, hasUserSelectedCity]);

    React.useEffect(() => {
        if (!isAgentConversationVisible) {
            return;
        }

        const timer = setTimeout(() => {
            agentScrollRef.current?.scrollToEnd({ animated: true });
        }, 90);

        return () => clearTimeout(timer);
    }, [agentMessages, isAgentConversationVisible]);

    React.useEffect(() => {
        if (!isAgentSending) {
            setAgentProgressIndex(0);
            return;
        }

        const interval = setInterval(() => {
            setAgentProgressIndex((previous) => (previous + 1) % Math.max(1, agentProgressHints.length));
        }, 1400);

        return () => clearInterval(interval);
    }, [agentProgressHints.length, isAgentSending]);

    React.useEffect(() => {
        agentMessagesRef.current = agentMessages;
    }, [agentMessages]);

    React.useEffect(() => {
        voiceSessionActiveRef.current = isVoiceSessionActive;
    }, [isVoiceSessionActive]);

    React.useEffect(() => {
        if (!isAgentConversationVisible || !isChatInputActive || !isKeyboardVisible) return;
        const timer = setTimeout(() => {
            agentScrollRef.current?.scrollToEnd({ animated: true });
        }, 40);
        return () => clearTimeout(timer);
    }, [isAgentConversationVisible, isChatInputActive, isKeyboardVisible]);

    React.useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (event: any) => {
            const height = Number(event?.endCoordinates?.height || 0);
            setKeyboardHeight(Math.max(0, height));
            setIsKeyboardVisible(height > 0);
        });

        const hideSub = Keyboard.addListener(hideEvent, () => {
            setKeyboardHeight(0);
            setIsKeyboardVisible(false);
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    const cityOptions = React.useMemo(() => {
        const cityMap = new Map<string, string>();
        doctorsData.forEach((doctor) => {
            const city = doctor.city?.trim();
            if (!city) {
                return;
            }

            const cityKey = normalizeText(city);
            if (!cityKey || cityMap.has(cityKey)) {
                return;
            }

            cityMap.set(cityKey, city);
        });

        const doctorCities = Array.from(cityMap.values()).sort((a, b) => a.localeCompare(b));
        if (locationCity) {
            const locationKey = normalizeText(locationCity);
            if (locationKey && !cityMap.has(locationKey)) {
                return [locationCity, ...doctorCities];
            }
        }

        return doctorCities;
    }, [doctorsData, locationCity]);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedCitySearchQuery(citySearchQuery);
        }, 220);
        return () => clearTimeout(timer);
    }, [citySearchQuery]);

    React.useEffect(() => {
        if (!isCityPickerVisible) {
            setCitySearchQuery('');
            setDebouncedCitySearchQuery('');
        }
    }, [isCityPickerVisible]);

    const filteredCityOptions = React.useMemo(() => {
        const query = normalizeText(citySearchQuery);
        if (!query) return cityOptions;
        return cityOptions.filter((city) => normalizeText(city).includes(query));
    }, [cityOptions, citySearchQuery]);



    type DepartmentWithCount = { id: string; label: string; Icon: IconComponent; doctorCount: number };

    const allDepartments = React.useMemo<DepartmentWithCount[]>(() => {
        const specMap = new Map<string, DepartmentWithCount>();

        // 1. Seed with ALL specializations from signup options
        DOCTOR_SPECIALIZATION_OPTIONS.forEach((spec) => {
            const normId = normalizeText(spec);
            if (!normId || specMap.has(normId)) return;
            const ui = getCategoryUI(spec);
            specMap.set(normId, {
                id: normId,
                label: toTitleCase(spec),
                Icon: ui.Icon,
                doctorCount: 0,
            });
        });

        // 2. Count doctors + add any extra specializations from DB
        (doctorsData as Doctor[]).forEach((doctor) => {
            const spec = doctor.specialization?.trim();
            if (!spec) return;
            const normId = normalizeText(spec);
            if (!specMap.has(normId)) {
                const ui = getCategoryUI(spec);
                specMap.set(normId, {
                    id: normId,
                    label: toTitleCase(spec),
                    Icon: ui.Icon,
                    doctorCount: 0,
                });
            }
            specMap.get(normId)!.doctorCount++;
        });

        return Array.from(specMap.values()).sort((a, b) => {
            if (b.doctorCount !== a.doctorCount) return b.doctorCount - a.doctorCount;
            return a.label.localeCompare(b.label);
        });
    }, [doctorsData]);


    const selectedDepartment = React.useMemo(
        () => allDepartments.find((department) => department.id === selectedDepartmentId) || null,
        [allDepartments, selectedDepartmentId]
    );

    const nearbyDoctors = React.useMemo(() => {
        let filtered = [...(doctorsData as Doctor[])];
        if (selectedCity) {
            filtered = filtered.filter((doctor: Doctor) => isCityMatch(doctor.city, selectedCity));
        }

        if (selectedDepartmentId) {
            const selectedDepartmentConfig = allDepartments.find((department) => department.id === selectedDepartmentId);
            if (selectedDepartmentConfig) {
                filtered = filtered.filter((doctor) =>
                    doesDoctorMatchDepartment(doctor.specialization, selectedDepartmentConfig.id)
                );
            }
        }

        return filtered;
    }, [doctorsData, selectedCity, selectedDepartmentId]);
    const visibleNearbyDoctors = React.useMemo(
        () => nearbyDoctors.slice(0, nearbyVisibleCount),
        [nearbyDoctors, nearbyVisibleCount]
    );
    const canLoadMoreNearbyDoctors = nearbyVisibleCount < nearbyDoctors.length;

    React.useEffect(() => {
        if (nearbyLoadMoreTimerRef.current) {
            clearTimeout(nearbyLoadMoreTimerRef.current);
            nearbyLoadMoreTimerRef.current = null;
        }
        setIsLoadingMoreNearbyDoctors(false);
        setNearbyVisibleCount(HOME_NEARBY_PAGE_SIZE);
    }, [selectedCity, selectedDepartmentId]);

    React.useEffect(() => {
        return () => {
            if (nearbyLoadMoreTimerRef.current) {
                clearTimeout(nearbyLoadMoreTimerRef.current);
                nearbyLoadMoreTimerRef.current = null;
            }
        };
    }, []);

    const departmentDoctorsAllCities = React.useMemo(() => {
        if (!selectedDepartmentId) {
            return [];
        }

        const selectedDepartmentConfig = allDepartments.find((department) => department.id === selectedDepartmentId);
        if (!selectedDepartmentConfig) {
            return [];
        }

        return (doctorsData as Doctor[]).filter((doctor) =>
            doesDoctorMatchDepartment(doctor.specialization, selectedDepartmentConfig.id)
        );
    }, [doctorsData, selectedDepartmentId]);

    const recommendedDepartmentDoctors = React.useMemo(() => {
        if (departmentDoctorsAllCities.length === 0) {
            return [];
        }

        return [...departmentDoctorsAllCities]
            .sort((a, b) => {
                const ratingDiff = (Number(b.rating) || 0) - (Number(a.rating) || 0);
                if (ratingDiff !== 0) {
                    return ratingDiff;
                }

                const expDiff = parseExperienceYears(b.experience) - parseExperienceYears(a.experience);
                if (expDiff !== 0) {
                    return expDiff;
                }

                return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
            })
            .slice(0, 10);
    }, [departmentDoctorsAllCities]);

    const recommendedDoctor = recommendedDepartmentDoctors[0] || null;
    const secondaryRecommendedDoctors = recommendedDepartmentDoctors.slice(1);
    const recommendedDoctorMetrics = React.useMemo(
        () => (recommendedDoctor ? resolveDoctorCardMetrics(recommendedDoctor) : { ratingLabel: '4.5', feeLabel: '' }),
        [recommendedDoctor]
    );

    const [userInterests, setUserInterests] = React.useState<Record<string, number>>({});
    const [globalPopularity, setGlobalPopularity] = React.useState<Record<string, number>>({});
    const [appointmentDoctorIds, setAppointmentDoctorIds] = React.useState<string[]>([]);
    const [deptPopularity, setDeptPopularity] = React.useState<Record<string, number>>({});

    React.useEffect(() => {
        let isMounted = true;

        const loadTrendData = async () => {
            try {
                const storedLocal = await AsyncStorage.getItem('cd4_concern_interests');
                if (isMounted && storedLocal) {
                    setUserInterests(JSON.parse(storedLocal));
                }

                const { data: globalData } = await supabase.from('ai_triage_reports').select('concern').limit(2000);
                if (isMounted && globalData) {
                    const counts: Record<string, number> = {};
                    globalData.forEach((row: any) => {
                        const concern = typeof row?.concern === 'string' ? row.concern.trim() : '';
                        if (!concern) return;
                        counts[concern] = (counts[concern] || 0) + 1;
                    });
                    setGlobalPopularity(counts);
                }

                const { data: appData } = await supabase.from('appointments').select('doctor_id');
                if (isMounted && appData) {
                    const ids = appData
                        .map((row: any) => (typeof row?.doctor_id === 'string' ? row.doctor_id : ''))
                        .filter((id: string) => id.length > 0);
                    setAppointmentDoctorIds(ids);
                }
            } catch (e) {
                console.error('Error loading trends', e);
            }
        };

        void loadTrendData();
        return () => {
            isMounted = false;
        };
    }, []);

    React.useEffect(() => {
        if (appointmentDoctorIds.length === 0 || doctorsData.length === 0) {
            setDeptPopularity({});
            return;
        }

        const specializationByDoctorId = new Map<string, string>();
        (doctorsData as Doctor[]).forEach((doctor) => {
            const doctorId = typeof doctor?._id === 'string' ? doctor._id : '';
            const specialization = typeof doctor?.specialization === 'string' ? doctor.specialization.trim() : '';
            if (!doctorId || !specialization) return;
            specializationByDoctorId.set(doctorId, specialization);
        });

        const counts: Record<string, number> = {};
        appointmentDoctorIds.forEach((doctorId) => {
            const specialization = specializationByDoctorId.get(doctorId);
            if (!specialization) return;
            counts[specialization] = (counts[specialization] || 0) + 1;
        });
        setDeptPopularity(counts);
    }, [appointmentDoctorIds, doctorsData]);

    const trackConcernInterest = async (concernId: string) => {
        try {
            const updated = { ...userInterests, [concernId]: (userInterests[concernId] || 0) + 1 };
            setUserInterests(updated);
            await AsyncStorage.setItem('cd4_concern_interests', JSON.stringify(updated));
        } catch (e) { console.error('Error saving interest', e); }
    };

    const dynamicConcerns = React.useMemo(() => {
        // Build a unique list of all concerns ever mentioned in triage + initial seed
        const dbLabels = Object.keys(globalPopularity);
        const personalLabels = Object.keys(userInterests);
        const seedLabels = [
            'Diabetes', 'PCOS', 'Heart Health', 'Skin Issues', 'Weight Management',
            'Fever', 'Cough', 'Cold & Flu', 'Headache', 'Migraine',
            'Stomach Ache', 'Acidity', 'Constipation', 'Diarrhea', 'Food Poisoning',
            'Joint Pain', 'Back Pain', 'Knee Pain', 'Muscle Cramps', 'Arthritis',
            'Hair Fall', 'Acne', 'Skin Rash', 'Dandruff', 'Eczema',
            'Anxiety', 'Stress', 'Depression', 'Insomnia', 'Panic Attacks',
            'Asthma', 'Breathing Difficulty', 'Allergies', 'Bronchitis',
            'High Blood Pressure', 'Low Blood Pressure', 'Chest Pain', 'Palpitations',
            'Thyroid', 'Hormonal Imbalance', 'Irregular Periods', 'Pregnancy',
            'Eye Infection', 'Vision Problems', 'Dry Eyes',
            'Toothache', 'Bleeding Gums', 'Dental Cavity',
            'Ear Pain', 'Hearing Loss', 'Tinnitus',
            'Sore Throat', 'Tonsils', 'Sinus',
            'Weight Gain', 'Weight Loss', 'Fatigue', 'Weakness', 'Anemia',
            'Urinary Infection', 'Kidney Stones', 'Liver Issues', 'Jaundice',
            'Piles', 'Cholesterol', 'Diabetes Type 1', 'Diabetes Type 2',
            'Vertigo', 'Dizziness', 'Nausea', 'Vomiting'
        ];

        const mergedConcerns = new Map<string, { label: string; dbCount: number; personalCount: number }>();

        [...dbLabels, ...personalLabels, ...seedLabels].forEach(label => {
            const id = label.toLowerCase().replace(/\s/g, '-');
            const existing = mergedConcerns.get(id);
            const dbCount = globalPopularity[label] || 0;
            const personalCount = userInterests[label] || 0;

            if (existing) {
                existing.dbCount += dbCount;
                existing.personalCount += personalCount;
            } else {
                mergedConcerns.set(id, { label, dbCount, personalCount });
            }
        });

        return Array.from(mergedConcerns.entries()).map(([id, data]) => ({
            id,
            label: data.label,
            ...getCategoryUI(data.label),
            imageSource: resolveConcernImageSource(data.label, id),
            dbCount: data.dbCount,
            personalCount: data.personalCount
        }));
    }, [globalPopularity, userInterests]);

    const concernCards = React.useMemo<DynamicCategory[]>(() => {
        return dynamicConcerns
            .map((c, i) => {
                const baseScore = (c.dbCount * 2) + (c.personalCount * 5);
                const contextBias = i === 1 ? 5 : i === 2 ? 3 : 0;
                return {
                    ...c,
                    totalScore: baseScore + contextBias
                };
            })
            .sort((a, b) => b.totalScore - a.totalScore)
            .slice(0, 4);
    }, [dynamicConcerns]);

    const getConcernDisplayLabel = React.useCallback((label: string): string => {
        const normalized = normalizeText(label).replace(/[_-]+/g, ' ').trim();
        if (!normalized) return label;

        if (normalized === 'diabetes' || normalized.includes('diabet')) return t('concern.diabetes');
        if (normalized === 'pcos') return t('concern.pcos');
        if (normalized === 'eczema') return t('concern.eczema');
        if (normalized === 'dizziness' || normalized === 'vertigo') return t('concern.dizziness');
        if (normalized === 'heart health') return t('concern.heartHealth');
        if (
            normalized === 'general assistant' ||
            normalized === 'assistant' ||
            normalized === 'general-asistant' ||
            normalized === 'general asistant'
        ) {
            return t('concern.generalAssistant');
        }
        return label;
    }, [t]);

    const departmentCards = React.useMemo<DynamicCategory[]>(() => {
        return allDepartments.map((department) => {
            const appCount = deptPopularity[department.label] || deptPopularity[department.id] || 0;
            const staffCount = department.doctorCount;
            return {
                id: department.id,
                label: department.label,
                iconBg: getCategoryUI(department.label).iconBg,
                iconColor: getCategoryUI(department.label).iconColor,
                Icon: department.Icon,
                imageSource: resolveDepartmentImageSource(department.label, department.id),
                totalScore: (appCount * 50) + (staffCount * 5),
                doctorCount: staffCount
            } as DynamicCategory;
        })
            .sort((a, b) => b.totalScore - a.totalScore)
            .slice(0, 8);
    }, [allDepartments, deptPopularity]);

    const AnimatedDepartmentCard = ({ item, theme, index, onPress, isSelected }: { item: DynamicCategory; theme: Theme; index: number; onPress: () => void; isSelected: boolean }) => {
        const scaleValue = React.useRef(new Animated.Value(1)).current;
        const handlePressIn = () => Animated.spring(scaleValue, { toValue: 0.95, useNativeDriver: true }).start();
        const handlePressOut = () => Animated.spring(scaleValue, { toValue: 1, useNativeDriver: true }).start();
        const cardBackground = isSelected ? theme.successLight : theme.cardBackground;
        const cardBorder = isSelected ? theme.successBorder : theme.borderColor;
        const iconBackground = isSelected ? theme.cardBackground : theme.successLight;
        const labelColor = isSelected ? theme.text : theme.textSecondary;

        return (
            <Animated.View style={{ transform: [{ scale: scaleValue }], marginRight: 10 }}>
                <TouchableOpacity
                    onPress={onPress}
                    onPressIn={handlePressIn}
                    onPressOut={handlePressOut}
                    activeOpacity={0.8}
                    style={{
                        width: 138,
                        minHeight: 116,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: cardBackground,
                        borderRadius: 10,
                        paddingVertical: 12,
                        paddingHorizontal: 10,
                        borderWidth: isSelected ? 1.5 : 1,
                        borderColor: cardBorder,
                        shadowColor: theme.text,
                        shadowOpacity: 0.08,
                        shadowRadius: 4,
                        elevation: 1,
                    }}
                >
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: iconBackground, justifyContent: 'center', alignItems: 'center', marginBottom: 8, overflow: 'hidden' }}>
                        {item.imageSource ? (
                            <Image source={item.imageSource} style={{ width: '82%', height: '82%', borderRadius: 999 }} resizeMode="contain" />
                        ) : (
                            <item.Icon size={18} color={item.iconColor} />
                        )}
                    </View>
                    <Text style={{ color: labelColor, fontSize: 12, fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>
                        {item.label}
                    </Text>
                </TouchableOpacity>
            </Animated.View>
        );
    };

    const AnimatedConcernCard = ({ concern, theme, index, onPress }: { concern: DynamicCategory; theme: Theme; index: number; onPress: () => void }) => {
        const animatedValue = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
        const hoverValue = React.useRef(new Animated.Value(0)).current;
        const shimmerValue = React.useRef(new Animated.Value(0)).current;
        const showTrendDecor = false;

        const tierConfig: TierConfig = showTrendDecor
            ? (
                [
                    { label: 'HOT', color: theme.tint, shimmer: '#FFF', float: -12, scale: 1.1, iconSize: 22 },
                    { label: 'MATCH', color: '#00D4FF', shimmer: '#00D4FF', float: -10, scale: 1.08, iconSize: 20 },
                    { label: 'RISING', color: '#8A2BE2', shimmer: '#8A2BE2', float: -8, scale: 1.05, iconSize: 18 },
                    { label: 'TRENDY', color: '#00FA9A', shimmer: '#00FA9A', float: -4, scale: 1.02, iconSize: 18 },
                ][index] || { label: 'POPULAR', color: theme.success, shimmer: '#FFF', float: 0, scale: 1.0, iconSize: 16 }
            )
            : { label: '', color: theme.borderColor, shimmer: theme.borderColor, float: 0, scale: 1, iconSize: 18 };

        React.useEffect(() => {
            const floatDur = 2000 + (index * 200);
            Animated.loop(
                Animated.sequence([
                    Animated.timing(hoverValue, { toValue: 1, duration: floatDur, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
                    Animated.timing(hoverValue, { toValue: 0, duration: floatDur, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
                ])
            ).start();

            if (showTrendDecor && index < 4) {
                Animated.loop(
                    Animated.timing(shimmerValue, { toValue: 1, duration: 3000 + (index * 1000), useNativeDriver: true, easing: Easing.linear })
                ).start();
            }
        }, [index, showTrendDecor, shimmerValue, hoverValue]);

        const translateY = hoverValue.interpolate({ inputRange: [0, 1], outputRange: [0, tierConfig.float] });
        const shimmerTranslate = shimmerValue.interpolate({ inputRange: [0, 1], outputRange: [-120, 240] });
        const rotateX = animatedValue.y.interpolate({ inputRange: [-1, 1], outputRange: ['12deg', '-12deg'] });
        const rotateY = animatedValue.x.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] });

        const handlePressIn = () => {
            Animated.spring(animatedValue, { toValue: { x: 0, y: -0.5 }, useNativeDriver: true, bounciness: 12 }).start();
        };

        const handlePressOut = () => {
            Animated.spring(animatedValue, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 10 }).start();
        };

        return (
            <Animated.View
                style={[
                    styles.concernCard,
                    {
                        backgroundColor: theme.cardBackground,
                        borderColor: showTrendDecor && index < 4 ? tierConfig.color : theme.borderColor,
                        borderWidth: showTrendDecor && index < 4 ? 1.8 : 1,
                        // transform: [
                        //     // { perspective: 1200 },
                        //     // { rotateX },
                        //     // { rotateY },
                        //     { translateY },
                        //     { scale: animatedValue.y.interpolate({ inputRange: [-1, 0, 1], outputRange: [tierConfig.scale, 1, 1] }) },
                        // ],
                        shadowColor: showTrendDecor && index < 4 ? tierConfig.color : '#000',
                        shadowOpacity: showTrendDecor && index < 4 ? 0.35 : 0.05,
                        shadowRadius: showTrendDecor && index < 4 ? 18 : 6,
                        elevation: showTrendDecor && index < 4 ? 12 : 2,
                    },
                ]}
            >
                {showTrendDecor && index < 4 && (
                    <Animated.View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                backgroundColor: tierConfig.color,
                                opacity: hoverValue.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.12] }),
                                borderRadius: 16,
                            }
                        ]}
                    />
                )}
                <TouchableOpacity
                    onPress={onPress}
                    onPressIn={handlePressIn}
                    onPressOut={handlePressOut}
                    activeOpacity={0.9}
                    style={styles.concernCardInner}
                >
                    {/* {index < 4 && (
                        <Animated.View 
                            style={[
                                styles.shimmerLine, 
                                { backgroundColor: tierConfig.shimmer, opacity: index === 0 ? 0.5 : 0.3 }
                            ]} 
                        />
                    )} */}
                    {showTrendDecor && (
                        <View style={[styles.trendingBadge, { backgroundColor: tierConfig.color }]}>
                            <Text style={styles.trendingBadgeText}>{tierConfig.label}</Text>
                        </View>
                    )}
                    <View style={[styles.concernIcon, { backgroundColor: concern.iconBg }]}>
                        {concern.imageSource ? (
                            <Image source={concern.imageSource} style={styles.concernImage} resizeMode="contain" />
                        ) : (
                            <concern.Icon size={tierConfig.iconSize} color={concern.iconColor} />
                        )}
                    </View>
                    <Text style={[styles.concernLabel, { color: theme.text, fontSize: index === 0 ? 14 : 13 }]} numberOfLines={1}>
                        {getConcernDisplayLabel(concern.label)}
                    </Text>
                    <Text style={[styles.activityHint, { color: theme.textSecondary }]} numberOfLines={1}>
                        {showTrendDecor ? (index === 0 ? 'Top Global Search' : index === 1 ? 'Rising in Traffic' : 'Popular Trend') : t('home.tapToStartTriage')}
                    </Text>
                </TouchableOpacity>
            </Animated.View>
        );
    };

    const handleConcernPress = (concernLabel: string) => {
        const targetConcern = dynamicConcerns.find(c => c.label === concernLabel);
        if (targetConcern) {
            trackConcernInterest(targetConcern.id);
        }

        if (voiceSessionActiveRef.current) {
            void stopContinuousVoiceSession(false);
        }
        setIsAgentConversationVisible(false);
        router.push({
            pathname: '/ai-guidance',
            params: {
                concern: concernLabel,
                variant: 'guided',
                voice: 'false',
            },
        });
    };

    const handleViewAllConcernsPress = () => {
        setConcernSearchQuery('');
        setIsConcernListVisible(true);
    };

    const handleViewAllDepartmentsPress = () => {
        setDepartmentSearchQuery('');
        setIsDepartmentListVisible(true);
    };

    const handleDepartmentCardPress = (departmentId: string) => {
        setSelectedDepartmentId((prev) => (prev === departmentId ? null : departmentId));
    };

    const filteredConcerns = React.useMemo(() => {
        if (!concernSearchQuery.trim()) return dynamicConcerns;
        const q = concernSearchQuery.toLowerCase();
        return dynamicConcerns.filter(c => c.label.toLowerCase().includes(q));
    }, [dynamicConcerns, concernSearchQuery]);

    const filteredDepartments = React.useMemo(() => {
        if (!departmentSearchQuery.trim()) return allDepartments;
        const q = departmentSearchQuery.toLowerCase();
        return allDepartments.filter((d: DepartmentWithCount) =>
            d.label.toLowerCase().includes(q)
        );
    }, [allDepartments, departmentSearchQuery]);

    const handleSelectConcernFromList = (concernLabel: string) => {
        setIsConcernListVisible(false);
        handleConcernPress(concernLabel);
    };

    const handleDepartmentSelect = (departmentId: string | null) => {
        setIsDepartmentListVisible(false);
        setSelectedDepartmentId(departmentId);
    };

    const handleCityFilterPress = (city: string | null) => {
        setSelectedCity(city);
        setHasUserSelectedCity(true);
        setIsCityPickerVisible(false);
    };

    const handleUseCurrentLocation = async () => {
        if (locationCity) {
            handleCityFilterPress(locationCity);
            return;
        }

        try {
            const syncedCity = await syncLocationCityIfPermitted();
            if (syncedCity) {
                setLocationCity(syncedCity);
                handleCityFilterPress(syncedCity);
                return;
            }
            Toast.show({
                type: 'info',
                text1: 'Location unavailable',
                text2: 'Please enable location permission to use this option.',
            });
        } catch (error) {
            console.warn('Use location failed:', error);
            Toast.show({
                type: 'error',
                text1: 'Could not detect location',
                text2: 'Try again or select a city manually.',
            });
        }
    };

    const handleOpenUpgradeToPro = React.useCallback(() => {
        setShowProPlanModal(false);
        router.push('/upgrade-pro');
    }, [router]);

    const nextAgentMessageId = (prefix: 'u' | 'a') => {
        agentMessageCounterRef.current += 1;
        return `${prefix}-${Date.now()}-${agentMessageCounterRef.current}`;
    };

    const upsertAgentDraftMessage = React.useCallback((messageId: string, text: string, createdAt?: string) => {
        setAgentMessages((prev) => {
            const index = prev.findIndex((message) => message.id === messageId);
            if (index >= 0) {
                const next = [...prev];
                next[index] = { ...next[index], text };
                agentMessagesRef.current = next;
                return next;
            }
            const next = [
                ...prev,
                {
                    id: messageId,
                    role: 'ai' as const,
                    text,
                    createdAt: createdAt || nowIso(),
                },
            ];
            agentMessagesRef.current = next;
            return next;
        });
    }, []);

    const ensureSessionToken = async (): Promise<string | null> => {
        const now = Date.now();
        if (
            cachedSessionTokenRef.current &&
            now - cachedSessionTokenAtRef.current < SESSION_TOKEN_CACHE_WINDOW_MS
        ) {
            return cachedSessionTokenRef.current;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
            console.error('Failed to read auth session for home agent:', error);
            return null;
        }
        const accessToken = data.session?.access_token || null;
        cachedSessionTokenRef.current = accessToken;
        cachedSessionTokenAtRef.current = now;
        return accessToken;
    };

    const stopActiveVoicePlayback = React.useCallback(async () => {
        setIsVoiceReplyPlaying(false);
        stopLipSyncAnimation(true);
        homeVoiceLiveSpeechRunIdRef.current += 1;
        homeVoiceLiveSpeechQueueRef.current = [];
        homeVoiceLiveSpokenCharsRef.current = 0;
        serverAudioChunksMapRef.current.clear();
        nextExpectedAudioIndexRef.current = 0;
        isPlayingServerAudioRef.current = false;
        hasReceivedServerAudioChunksRef.current = false;
        if (activeWebAudioRef.current) {
            try {
                activeWebAudioRef.current.pause?.();
                activeWebAudioRef.current.src = '';
                activeWebAudioRef.current.load?.();
            } catch (err) {
                console.warn('Error stopping web voice audio:', err);
            }
            activeWebAudioRef.current = null;
        }
        if (activeVoiceSoundRef.current) {
            try {
                const sound = activeVoiceSoundRef.current;
                activeVoiceSoundRef.current = null;
                await sound.stopAsync();
                await sound.unloadAsync();
            } catch (err) {
                console.warn('Error stopping voice sound:', err);
            }
        }
        if (activeSpeechRef.current) {
            try {
                await Speech.stop();
            } catch (err) {
                console.warn('Error stopping speech:', err);
            }
            activeSpeechRef.current = false;
        }
    }, [stopLipSyncAnimation]);

    const speakText = async (
        text: string,
        audioBase64?: string,
        audioMimeType?: string,
        personaOverride?: AIDoctorPersona,
        allowNativeFallback: boolean = true
    ) => {
        await stopActiveVoicePlayback();
        const cleanText = sanitizeSpeechText(text);
        setIsVoiceReplyPlaying(true);
        setVoiceStatusText('Doctor is speaking...');

        const playedBackendAudio = audioBase64
            ? await playVoiceAudioBase64(audioBase64, audioMimeType, cleanText || text)
            : false;
        if (playedBackendAudio) {
            return;
        }

        if (!allowNativeFallback) {
            setIsVoiceReplyPlaying(false);
            stopLipSyncAnimation(true);
            setVoiceStatusText('Backend voice unavailable. Tap mic to retry.');
            return;
        }

        if (!cleanText) {
            setIsVoiceReplyPlaying(false);
            stopLipSyncAnimation(true);
            return;
        }

        activeSpeechRef.current = true;
        lipSyncBoundaryHitRef.current = false;
        const personaForPlayback = personaOverride || aiDoctorPersona;
        const preferredVoiceId = nativeVoiceIdByPersona[personaForPlayback];
        if (personaForPlayback === 'female' && !preferredVoiceId) {
            setIsVoiceReplyPlaying(false);
            stopLipSyncAnimation(true);
            setVoiceStatusText('Nova voice playback failed. Tap mic to retry.');
            return;
        }
        const preferredLocale = getPreferredSpeechLocale(cleanText);
        const estimatedDurationMs = estimateSpeechDurationMs(cleanText);

        clearLipSyncFallbackTimer();
        clearLipSyncTicker();
        animateDoctorMouthTo(0.9, 70);
        lipSyncFallbackTimerRef.current = setTimeout(() => {
            if (!lipSyncBoundaryHitRef.current) {
                startTimedLipSync(cleanText, estimatedDurationMs);
            }
        }, 280);

        const finalizeSpeechLipSync = () => {
            clearLipSyncFallbackTimer();
            clearLipSyncTicker();
            setIsVoiceReplyPlaying(false);
            activeSpeechRef.current = false;
            stopLipSyncAnimation(true);
        };

        Speech.speak(cleanText, {
            language: preferredLocale,
            pitch: getSpeechPitchForPersona(personaForPlayback),
            rate: 1.0,
            voice: preferredVoiceId,
            onBoundary: (event: any) => {
                const charIndex = typeof event?.charIndex === 'number' ? event.charIndex : 0;
                const charLength = typeof event?.charLength === 'number' ? event.charLength : 1;
                lipSyncBoundaryHitRef.current = true;
                clearLipSyncFallbackTimer();
                clearLipSyncTicker();
                applyBoundaryLipSync(cleanText, charIndex, charLength);
            },
            onDone: finalizeSpeechLipSync,
            onStopped: finalizeSpeechLipSync,
            onError: finalizeSpeechLipSync,
        });
    };

    const playNextServerAudioChunk = React.useCallback(async () => {
        if (isPlayingServerAudioRef.current) return;
        
        const nextIdx = nextExpectedAudioIndexRef.current;
        const chunk = serverAudioChunksMapRef.current.get(nextIdx);
        if (!chunk) {
            isPlayingServerAudioRef.current = false;
            return;
        }

        isPlayingServerAudioRef.current = true;
        serverAudioChunksMapRef.current.delete(nextIdx);
        nextExpectedAudioIndexRef.current = nextIdx + 1;

        try {
            setIsVoiceReplyPlaying(true);
            setVoiceStatusText('Doctor is speaking...');
            
            const cleanedSpeechText = sanitizeSpeechText(chunk.text);
            const durationMs = estimateSpeechDurationMs(cleanedSpeechText);
            clearLipSyncTicker();
            clearLipSyncFallbackTimer();
            if (cleanedSpeechText) {
                startTimedLipSync(cleanedSpeechText, durationMs);
            }

            const sourceUri = `data:audio/mpeg;base64,${chunk.audio}`;
            
            if (Platform.OS === 'web') {
                const WebAudioCtor = (globalThis as any)?.Audio;
                if (typeof WebAudioCtor === 'function') {
                    const webAudio = new WebAudioCtor(sourceUri);
                    activeWebAudioRef.current = webAudio;
                    webAudio.preload = 'auto';

                    await new Promise<void>((resolve, reject) => {
                        let settled = false;
                        const finish = () => {
                            if (settled) return;
                            settled = true;
                            resolve();
                        };
                        const fail = () => {
                            if (settled) return;
                            settled = true;
                            reject(new Error('web_audio_playback_failed'));
                        };

                        webAudio.onended = finish;
                        webAudio.onerror = fail;
                        const playResult = webAudio.play?.();
                        if (playResult && typeof playResult.then === 'function') {
                            playResult.catch(fail);
                        }
                    });
                    return;
                }
            }

            const { sound } = await Audio.Sound.createAsync(
                { uri: sourceUri },
                { shouldPlay: true },
                undefined,
                false
            );

            activeVoiceSoundRef.current = sound;
            await sound.setProgressUpdateIntervalAsync(65);

            await new Promise<void>((resolve) => {
                let finished = false;
                sound.setOnPlaybackStatusUpdate((status) => {
                    if (!status.isLoaded) {
                        if (!finished) {
                            finished = true;
                            resolve();
                        }
                        return;
                    }
                    if (status.didJustFinish) {
                        if (!finished) {
                            finished = true;
                            resolve();
                        }
                    }
                });
            });

            if (activeVoiceSoundRef.current === sound) {
                activeVoiceSoundRef.current = null;
            }
            try {
                await sound.unloadAsync();
            } catch {
                // ignore
            }
        } catch (error) {
            console.warn('[Home Voice] Server audio chunk playback failed:', error);
        } finally {
            isPlayingServerAudioRef.current = false;
            stopLipSyncAnimation(true);
            void playNextServerAudioChunk();
        }
    }, [stopLipSyncAnimation, startTimedLipSync, clearLipSyncTicker, clearLipSyncFallbackTimer]);

    const handleServerAudioChunk = React.useCallback((audioBase64: string, text: string, index: number) => {
        hasReceivedServerAudioChunksRef.current = true;
        serverAudioChunksMapRef.current.set(index, { audio: audioBase64, text });
        void playNextServerAudioChunk();
    }, [playNextServerAudioChunk]);

    const playVoiceAudioBase64 = React.useCallback(
        async (audioBase64: string, audioMimeType?: string, speechText?: string): Promise<boolean> => {
            const normalized = (audioBase64 || '').trim();
            if (!normalized) {
                return false;
            }

            try {
                setIsVoiceReplyPlaying(true);
                setVoiceStatusText('AI is speaking...');
                const cleanedSpeechText = sanitizeSpeechText(speechText || '');
                const fallbackDurationMs = estimateSpeechDurationMs(cleanedSpeechText);
                lipSyncFramesRef.current = buildLipSyncFramesFromText(cleanedSpeechText);
                clearLipSyncTicker();
                clearLipSyncFallbackTimer();
                if (cleanedSpeechText) {
                    lipSyncFallbackTimerRef.current = setTimeout(() => {
                        if (activeVoiceSoundRef.current) {
                            startTimedLipSync(cleanedSpeechText, fallbackDurationMs);
                        }
                    }, 420);
                }

                const mimeType = (audioMimeType || 'audio/wav').trim() || 'audio/wav';
                const sourceUri = `data:${mimeType};base64,${normalized}`;
                if (Platform.OS === 'web') {
                    const WebAudioCtor = (globalThis as any)?.Audio;
                    if (typeof WebAudioCtor === 'function') {
                        const webAudio = new WebAudioCtor(sourceUri);
                        activeWebAudioRef.current = webAudio;
                        webAudio.preload = 'auto';

                        await new Promise<void>((resolve, reject) => {
                            let settled = false;
                            const cleanup = () => {
                                webAudio.onended = null;
                                webAudio.onerror = null;
                            };
                            const finish = () => {
                                if (settled) return;
                                settled = true;
                                cleanup();
                                resolve();
                            };
                            const fail = () => {
                                if (settled) return;
                                settled = true;
                                cleanup();
                                reject(new Error('web_audio_playback_failed'));
                            };

                            webAudio.onended = finish;
                            webAudio.onerror = fail;
                            const playResult = webAudio.play?.();
                            if (playResult && typeof playResult.then === 'function') {
                                playResult.catch(fail);
                            }
                        });
                        return true;
                    }
                }

                const { sound } = await Audio.Sound.createAsync(
                    { uri: sourceUri },
                    { shouldPlay: true },
                    undefined,
                    false
                );
                activeVoiceSoundRef.current = sound;
                await sound.setProgressUpdateIntervalAsync(65);

                await new Promise<void>((resolve) => {
                    let hasResolved = false;
                    const resolveOnce = () => {
                        if (hasResolved) return;
                        hasResolved = true;
                        resolve();
                    };

                    sound.setOnPlaybackStatusUpdate((status) => {
                        if (!status.isLoaded) {
                            resolveOnce();
                            return;
                        }
                        const durationMillis = typeof status.durationMillis === 'number' ? status.durationMillis : 0;
                        const positionMillis = typeof status.positionMillis === 'number' ? status.positionMillis : 0;
                        if (durationMillis > 0) {
                            clearLipSyncFallbackTimer();
                            clearLipSyncTicker();
                            driveLipSyncFromAudioProgress(positionMillis, durationMillis);
                        }

                        if (status.didJustFinish) {
                            resolveOnce();
                        }
                    });
                });
                return true;
            } catch (error) {
                console.warn('Home voice playback failed:', error);
                return false;
            } finally {
                setIsVoiceReplyPlaying(false);
                stopLipSyncAnimation(true);
                if (activeWebAudioRef.current) {
                    try {
                        activeWebAudioRef.current.pause?.();
                        activeWebAudioRef.current.src = '';
                        activeWebAudioRef.current.load?.();
                    } catch {
                        // best-effort cleanup
                    }
                    activeWebAudioRef.current = null;
                }
                if (activeVoiceSoundRef.current) {
                    try {
                        await activeVoiceSoundRef.current.unloadAsync();
                    } catch {
                        // best-effort unload
                    }
                    activeVoiceSoundRef.current = null;
                }
            }
        },
        [
            clearLipSyncFallbackTimer,
            clearLipSyncTicker,
            driveLipSyncFromAudioProgress,
            startTimedLipSync,
            stopLipSyncAnimation,
        ]
    );

    const processHomeVoiceLiveSpeechQueue = React.useCallback(async () => {
        if (homeVoiceLiveSpeechBusyRef.current) return;

        const runId = homeVoiceLiveSpeechRunIdRef.current;
        const femaleVoiceId = nativeVoiceIdByPersona.female;
        if (!femaleVoiceId) {
            homeVoiceLiveSpeechQueueRef.current = [];
            return;
        }
        homeVoiceLiveSpeechBusyRef.current = true;

        try {
            while (
                homeVoiceLiveSpeechQueueRef.current.length > 0 &&
                homeVoiceLiveSpeechRunIdRef.current === runId
            ) {
                const cleanText = sanitizeSpeechText(homeVoiceLiveSpeechQueueRef.current.shift() || '');
                if (!cleanText) continue;

                setIsVoiceReplyPlaying(true);
                setVoiceStatusText('Doctor is speaking...');
                activeSpeechRef.current = true;
                lipSyncBoundaryHitRef.current = false;

                const personaForPlayback: AIDoctorPersona = 'female';
                const preferredVoiceId = femaleVoiceId;
                const preferredLocale = getPreferredSpeechLocale(cleanText);
                const estimatedDurationMs = estimateSpeechDurationMs(cleanText);
                const pacing = resolveSpeechPacing(cleanText);

                clearLipSyncFallbackTimer();
                clearLipSyncTicker();
                animateDoctorMouthTo(0.9, 70);
                lipSyncFallbackTimerRef.current = setTimeout(() => {
                    if (!lipSyncBoundaryHitRef.current && homeVoiceLiveSpeechRunIdRef.current === runId) {
                        startTimedLipSync(cleanText, estimatedDurationMs);
                    }
                }, 260);

                await new Promise<void>((resolve) => {
                    let resolved = false;
                    const finish = () => {
                        if (resolved) return;
                        resolved = true;
                        clearLipSyncFallbackTimer();
                        clearLipSyncTicker();
                        activeSpeechRef.current = false;
                        stopLipSyncAnimation(true);
                        resolve();
                    };

                    Speech.speak(cleanText, {
                        language: preferredLocale,
                        pitch: getSpeechPitchForPersona(personaForPlayback),
                        rate: pacing.rate,
                        voice: preferredVoiceId,
                        onBoundary: (event: any) => {
                            if (homeVoiceLiveSpeechRunIdRef.current !== runId) return;
                            const charIndex = typeof event?.charIndex === 'number' ? event.charIndex : 0;
                            const charLength = typeof event?.charLength === 'number' ? event.charLength : 1;
                            lipSyncBoundaryHitRef.current = true;
                            clearLipSyncFallbackTimer();
                            clearLipSyncTicker();
                            applyBoundaryLipSync(cleanText, charIndex, charLength);
                        },
                        onDone: finish,
                        onStopped: finish,
                        onError: finish,
                    });
                });

                if (pacing.pauseMs > 0 && homeVoiceLiveSpeechRunIdRef.current === runId) {
                    await sleepFor(pacing.pauseMs);
                }
            }
        } finally {
            const shouldContinue =
                homeVoiceLiveSpeechRunIdRef.current === runId &&
                homeVoiceLiveSpeechQueueRef.current.length > 0;
            homeVoiceLiveSpeechBusyRef.current = false;
            if (shouldContinue) {
                setTimeout(() => {
                    void processHomeVoiceLiveSpeechQueue();
                }, 0);
                return;
            }
            if (homeVoiceLiveSpeechRunIdRef.current === runId) {
                setIsVoiceReplyPlaying(false);
                activeSpeechRef.current = false;
                stopLipSyncAnimation(true);
                setVoiceStatusText(
                    voiceSessionActiveRef.current ? 'Waiting for your voice...' : 'Tap mic to start continuous voice'
                );
            }
        }
    }, [
        animateDoctorMouthTo,
        applyBoundaryLipSync,
        clearLipSyncFallbackTimer,
        clearLipSyncTicker,
        nativeVoiceIdByPersona,
        startTimedLipSync,
        stopLipSyncAnimation,
    ]);

    const startContinuousListening = React.useCallback(async (): Promise<boolean> => {
        if (isExpoGo) {
            Toast.show({
                type: 'error',
                text1: 'Voice not supported in Expo Go',
                text2: 'Install preview/dev-client build to use voice assistant.',
            });
            setVoiceStatusText('Voice unavailable in Expo Go. Use preview build.');
            return false;
        }

        if (!ExpoSpeechRecognitionModule) {
            Toast.show({
                type: 'error',
                text1: 'Voice not available',
                text2: 'Speech recognition is not available or native module missing.',
            });
            setVoiceStatusText('Voice is not available on this device');
            return false;
        }

        try {
            const recognitionAvailable =
                typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function'
                    ? ExpoSpeechRecognitionModule.isRecognitionAvailable()
                    : true;
            if (!recognitionAvailable) {
                // Some Android release devices return false here despite a working recognizer.
                // Continue and let start() decide, instead of hard-blocking voice UX.
                console.warn('Speech recognition reported unavailable; attempting fallback start.');
            }

            clearVoiceAutoSubmitTimers();
            if (!hasSpeechPermissionRef.current) {
                const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                hasSpeechPermissionRef.current = Boolean(permission.granted);
                if (!permission.granted) {
                    Toast.show({
                        type: 'error',
                        text1: 'Microphone permission denied',
                        text2: 'Enable microphone access to use voice assistant.',
                    });
                    setVoiceStatusText('Microphone permission denied');
                    return false;
                }
            }

            setVoiceStatusText('Speak now. Pause briefly to auto-send.');
            ExpoSpeechRecognitionModule.start({
                lang: 'en-IN',
                interimResults: true,
                continuous: true,
                addsPunctuation: true,
            });
            return true;
        } catch (error) {
            Toast.show({
                type: 'error',
                text1: 'Voice input error',
                text2: 'Could not start voice recognition.',
            });
            setVoiceStatusText('Could not start listening');
            return false;
        }
    }, [clearVoiceAutoSubmitTimers, isExpoGo]);

    const stopContinuousVoiceSession = React.useCallback(async (showToast: boolean = false) => {
        activeAgentRequestTokenRef.current = `stopped-${Date.now()}`;
        voiceSubmitInProgressRef.current = false;
        if (agentStreamAbortControllerRef.current) {
            try {
                const activeAbortController = agentStreamAbortControllerRef.current as any;
                activeAbortController?.abort?.();
            } catch {
                // no-op
            }
            agentStreamAbortControllerRef.current = null;
        }
        agentStreamingDraftMessageIdRef.current = null;
        setIsAgentVoiceLiveStreaming(false);
        setIsAgentSending(false);
        voiceSessionActiveRef.current = false;
        setIsVoiceSessionActive(false);
        setIsListening(false);
        clearVoiceAutoSubmitTimers();
        setVoiceLiveTranscript('');
        voiceLiveTranscriptRef.current = '';
        lastVoiceResultAtRef.current = 0;
        lastVoiceEndRestartAtRef.current = 0;
        setVoiceStatusText('Voice assistant stopped');

        try {
            ExpoSpeechRecognitionModule?.abort();
        } catch (error) {
            console.warn('Speech recognition abort failed:', error);
        }

        await stopActiveVoicePlayback();

        if (showToast) {
            Toast.show({
                type: 'info',
                text1: 'Voice assistant stopped',
                text2: 'You can continue typing or start voice again.',
            });
        }
    }, [clearVoiceAutoSubmitTimers, stopActiveVoicePlayback]);

    const callHomeAgent = async (
        userText: string,
        options?: { replyInVoice?: boolean }
    ): Promise<boolean> => {
        if (!user?.id) {
            Toast.show({
                type: 'error',
                text1: 'Session required',
                text2: 'Please login again to talk with AI agent.',
            });
            return false;
        }

        if (isHomeAgentSendingRef.current) {
            console.warn('[Home Agent] callHomeAgent already in progress, ignoring duplicate call');
            return false;
        }
        isHomeAgentSendingRef.current = true;

        const requestToken = `agent-${Date.now()}-${agentRequestCounterRef.current + 1}`;
        agentRequestCounterRef.current += 1;
        activeAgentRequestTokenRef.current = requestToken;
        if (agentStreamAbortControllerRef.current) {
            try {
                const activeAbortController = agentStreamAbortControllerRef.current as any;
                activeAbortController?.abort?.();
            } catch {
                // no-op
            }
            agentStreamAbortControllerRef.current = null;
        }

        const userMessage: AgentMessage = {
            id: nextAgentMessageId('u'),
            role: 'user',
            text: userText,
            createdAt: nowIso(),
        };

        const historyWithUser = [...agentMessagesRef.current, userMessage];
        setAgentMessages(historyWithUser);
        agentMessagesRef.current = historyWithUser;

        const progressHints = buildAgentProgressHints({
            userText,
            departmentLabel: selectedDepartment?.label || null,
        });
        const initialProgressHint = progressHints[0] || DEFAULT_AGENT_PROGRESS_HINTS[0];
        setAgentProgressHints(progressHints);
        setAgentProgressIndex(0);
        setAgentCustomHint(null);

        const voiceModeRequested = Boolean(options?.replyInVoice);
        if (voiceModeRequested) {
            setAiDoctorPersona('female');
        }
        const aiDraftId = voiceModeRequested ? nextAgentMessageId('a') : null;
        const aiDraftCreatedAt = voiceModeRequested ? nowIso() : null;
        agentStreamingDraftMessageIdRef.current = aiDraftId;
        setIsAgentVoiceLiveStreaming(false);
        if (aiDraftId) {
            upsertAgentDraftMessage(aiDraftId, initialProgressHint, aiDraftCreatedAt || nowIso());
        }

        setIsAgentSending(true);
        let sendingClearedAfterResponse = false;

        try {
            const token = await ensureSessionToken();
            if (!token) {
                const authFallback: AgentMessage = {
                    id: aiDraftId || nextAgentMessageId('a'),
                    role: 'ai',
                    text: 'Please login again to continue AI agent conversation.',
                    createdAt: aiDraftCreatedAt || nowIso(),
                };
                if (activeAgentRequestTokenRef.current === requestToken) {
                    setIsAgentVoiceLiveStreaming(false);
                    setAgentMessages((prev) => {
                        const existingIndex = prev.findIndex((message) => message.id === authFallback.id);
                        let next: AgentMessage[];
                        if (existingIndex >= 0) {
                            next = [...prev];
                            next[existingIndex] = { ...next[existingIndex], ...authFallback };
                        } else {
                            next = [...prev, authFallback];
                        }
                        agentMessagesRef.current = next;
                        return next;
                    });
                }
                return false;
            }

            const functionsClient = supabase.functions;
            functionsClient.setAuth(token);
            const manuallySelectedCity = hasUserSelectedCity ? selectedCity : null;
            // Premium-quality mode: use dedicated voice endpoint for natural TTS audio.
            const useVoiceEndpoint = Boolean(options?.replyInVoice);
            const voiceMode = Boolean(options?.replyInVoice);
            const ttsMode: 'fast' | 'premium' = HOME_VOICE_TTS_MODE;
            // Keep backend TTS voice consistent across turns.
            const preferLocalVoicePlayback = false;
            const quickTextMode = !voiceMode;
            const selectedDepartmentLabel = selectedDepartment?.label || null;
            const selectedDepartmentKey = selectedDepartment?.id || null;
            const historyPayload = buildAgentHistoryForApi(historyWithUser, {
                includeDoctorRecommendations: true,
                includeBookingSlotOptions: true,
                maxMessages: voiceMode
                    ? VOICE_AGENT_HISTORY_MAX_MESSAGES
                    : QUICK_TEXT_AGENT_HISTORY_MAX_MESSAGES,
                maxChars: voiceMode
                    ? VOICE_AGENT_HISTORY_MAX_CHARS
                    : QUICK_TEXT_AGENT_HISTORY_MAX_CHARS,
            });
            const invokeBody = useVoiceEndpoint
                ? {
                    text: userText,
                    concern: 'General Assistant',
                    mode: 'assistant',
                    conversationId: agentConversationIdRef.current,
                    voicePersona: 'female',
                    history: historyPayload,
                    locationCity,
                    searchAreaCity: manuallySelectedCity || locationCity,
                    preferredCity: manuallySelectedCity || locationCity,
                    departmentId: selectedDepartmentKey,
                    departmentLabel: selectedDepartmentLabel,
                    fastResponse: true,
                    preferLocalPlayback: preferLocalVoicePlayback,
                    ttsMode,
                }
                : {
                    message: userText,
                    concern: 'General Assistant',
                    mode: 'assistant',
                    conversationId: agentConversationIdRef.current,
                    voicePersona: 'female',
                    history: historyPayload,
                    locationCity,
                    searchAreaCity: manuallySelectedCity || locationCity,
                    preferredCity: manuallySelectedCity || locationCity,
                    departmentId: selectedDepartmentKey,
                    departmentLabel: selectedDepartmentLabel,
                    replyInVoice: Boolean(options?.replyInVoice),
                    fastResponse: quickTextMode,
                    quick: quickTextMode,
                };
            const compactVoiceInvokeBody = useVoiceEndpoint
                ? { ...invokeBody, fastResponse: true }
                : invokeBody;

            const invokeStartAt = Date.now();
            const isHomeVoiceStreamForced = HOME_VOICE_STREAM_MODE === 'force';
            const canAttemptVoiceStreaming =
                useVoiceEndpoint &&
                HOME_VOICE_STREAM_MODE !== 'off' &&
                Boolean(FUNCTIONS_BASE_URL) &&
                Boolean(SUPABASE_ANON_KEY) &&
                hasReadableStreamSupport() &&
                homeVoiceStreamCapabilityRef.current !== 'unsupported';

            if (useVoiceEndpoint && isHomeVoiceStreamForced && !canAttemptVoiceStreaming) {
                const reasons: string[] = [];
                if (!FUNCTIONS_BASE_URL) reasons.push('SUPABASE_URL missing');
                if (!SUPABASE_ANON_KEY) reasons.push('SUPABASE_ANON_KEY missing');
                if (!hasReadableStreamSupport()) reasons.push('ReadableStream unsupported on this runtime');
                if (homeVoiceStreamCapabilityRef.current === 'unsupported') reasons.push('Streaming previously marked unsupported');
                throw new Error(`[Home Voice] stream is forced, but unavailable: ${reasons.join(', ') || 'unknown reason'}`);
            }

            let voiceStreamedText = '';
            let voiceLiveSpokenViaDelta = false;
            homeVoiceLiveSpeechRunIdRef.current += 1;
            homeVoiceLiveSpeechQueueRef.current = [];
            homeVoiceLiveSpokenCharsRef.current = 0;

            const buildVoiceRateLimitResponse = (payload: any, fallbackMessage: string): any | null => {
                const rateLimitPayload = payload?.rateLimit || payload?.data?.rateLimit;
                if (!rateLimitPayload?.blocked) {
                    return null;
                }
                const message =
                    typeof payload?.message === 'string' && payload.message.trim().length > 0
                        ? payload.message.trim()
                        : typeof payload?.data?.reply === 'string' && payload.data.reply.trim().length > 0
                            ? payload.data.reply.trim()
                            : fallbackMessage;

                return {
                    success: true,
                    data: {
                        reply: message,
                        text: message,
                        rateLimit: rateLimitPayload,
                    },
                };
            };

            const invokeVoiceEndpointStream = async (requestBody: any = invokeBody): Promise<any> => {
                if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) {
                    throw new Error('Voice stream endpoint is not configured.');
                }

                const controller = new AbortController();
                agentStreamAbortControllerRef.current = controller;
                try {
                    const response = await fetch(`${FUNCTIONS_BASE_URL}/functions/v1/voice-chat`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            apikey: SUPABASE_ANON_KEY,
                            'Content-Type': 'application/json',
                            Accept: 'text/event-stream',
                        },
                        body: JSON.stringify({ ...requestBody, stream: true }),
                        signal: controller.signal,
                    });

                    if (!response.ok) {
                        const errorText = await response.text().catch(() => '');
                        let parsedMessage = `Voice stream request failed (${response.status})`;
                        let parsedPayload: any = null;
                        if (errorText) {
                            try {
                                parsedPayload = JSON.parse(errorText);
                                parsedMessage = parsedPayload?.message || parsedMessage;
                            } catch {
                                parsedMessage = errorText;
                            }
                        }
                        const rateLimitResponse = buildVoiceRateLimitResponse(parsedPayload, parsedMessage);
                        if (rateLimitResponse) {
                            return rateLimitResponse;
                        }
                        throw new Error(parsedMessage);
                    }
                    const responseContentType = (response.headers.get('content-type') || '').toLowerCase();
                    if (isHomeVoiceStreamForced && !responseContentType.includes('text/event-stream')) {
                        throw new Error(
                            `[Home Voice] stream is forced; expected text/event-stream but got ${responseContentType || 'unknown'}.`
                        );
                    }

                    const reader = (response as any)?.body?.getReader?.();
                    if (!reader) {
                        homeVoiceStreamCapabilityRef.current = 'unsupported';
                        const fallbackText = await response.text().catch(() => '');
                        const recoveredPayload = extractPayloadFromSseOrJsonText(fallbackText);
                        if (recoveredPayload) return recoveredPayload;
                        throw new Error('STREAM_UNSUPPORTED: Streaming reader is unavailable on this device.');
                    }
                    homeVoiceStreamCapabilityRef.current = 'supported';

                    const decoder = new TextDecoder();
                    let buffer = '';
                    let finalPayload: any = null;
                    let deltaCount = 0;
                    let shouldStopReading = false;
                    const handleVoiceDelta = (textDelta: string) => {
                        if (!textDelta) return;
                        deltaCount += 1;
                        setIsAgentVoiceLiveStreaming(true);
                        voiceStreamedText += textDelta;
                        if (aiDraftId && activeAgentRequestTokenRef.current === requestToken) {
                            upsertAgentDraftMessage(aiDraftId, voiceStreamedText, aiDraftCreatedAt || nowIso());
                        }

                        if (hasReceivedServerAudioChunksRef.current) {
                            return;
                        }

                        if (!nativeVoiceIdByPersona.female) {
                            return;
                        }

                        const speakableText = voiceStreamedText.slice(homeVoiceLiveSpokenCharsRef.current);
                        const segments = splitIntoReadableSegments(speakableText);
                        if (segments.length <= 1) return;

                        const completeSegments = segments.slice(0, -1);
                        if (completeSegments.length < 1) return;

                        const spokenNow = completeSegments.join(' ').trim();
                        if (!spokenNow) return;

                        voiceLiveSpokenViaDelta = true;
                        homeVoiceLiveSpokenCharsRef.current += spokenNow.length + 1;
                        homeVoiceLiveSpeechQueueRef.current.push(...completeSegments);
                        void processHomeVoiceLiveSpeechQueue();
                    };

                    while (!shouldStopReading) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const parsed = parseSseBuffer(buffer);
                        buffer = parsed.rest;

                        for (const event of parsed.events) {
                            if (event.event === 'delta') {
                                const textDelta =
                                    typeof event.data?.text === 'string'
                                        ? event.data.text
                                        : typeof event.data === 'string'
                                            ? event.data
                                            : '';
                                handleVoiceDelta(textDelta);
                                continue;
                            }

                            if (event.event === 'audio-chunk') {
                                const audioChunk = event.data;
                                if (audioChunk && typeof audioChunk.audio === 'string') {
                                    handleServerAudioChunk(audioChunk.audio, audioChunk.text || '', typeof audioChunk.index === 'number' ? audioChunk.index : 0);
                                }
                                continue;
                            }

                            if (event.event === 'error') {
                                const message =
                                    typeof event.data?.message === 'string' && event.data.message.trim()
                                        ? event.data.message.trim()
                                        : 'Voice streaming failed.';
                                throw new Error(message);
                            }

                            if (event.event === 'done') {
                                finalPayload = event.data;
                                shouldStopReading = true;
                                break;
                            }

                            if (event.event === 'message') {
                                const messagePayload = event.data;
                                const isStructuredPayload =
                                    messagePayload &&
                                    typeof messagePayload === 'object' &&
                                    (
                                        messagePayload.success === true ||
                                        typeof messagePayload?.data?.reply === 'string' ||
                                        typeof messagePayload?.data?.text === 'string'
                                    );
                                if (isStructuredPayload) {
                                    finalPayload = messagePayload;
                                    shouldStopReading = true;
                                    break;
                                }
                            }
                        }
                    }

                    const tail = decoder.decode();
                    if (tail) {
                        buffer += tail;
                        const parsed = parseSseBuffer(buffer);
                        for (const event of parsed.events) {
                            if (event.event === 'delta') {
                                const textDelta =
                                    typeof event.data?.text === 'string'
                                        ? event.data.text
                                        : typeof event.data === 'string'
                                            ? event.data
                                            : '';
                                handleVoiceDelta(textDelta);
                                continue;
                            }
                            if (event.event === 'audio-chunk') {
                                const audioChunk = event.data;
                                if (audioChunk && typeof audioChunk.audio === 'string') {
                                    handleServerAudioChunk(audioChunk.audio, audioChunk.text || '', typeof audioChunk.index === 'number' ? audioChunk.index : 0);
                                }
                                continue;
                            }
                            if (event.event === 'done') {
                                finalPayload = event.data;
                                break;
                            }
                            if (event.event === 'message') {
                                const messagePayload = event.data;
                                const isStructuredPayload =
                                    messagePayload &&
                                    typeof messagePayload === 'object' &&
                                    (
                                        messagePayload.success === true ||
                                        typeof messagePayload?.data?.reply === 'string' ||
                                        typeof messagePayload?.data?.text === 'string'
                                    );
                                if (isStructuredPayload) {
                                    finalPayload = messagePayload;
                                    break;
                                }
                            }
                        }
                    }

                    if (!finalPayload) {
                        if (voiceStreamedText.trim()) {
                            finalPayload = {
                                success: true,
                                data: {
                                    reply: voiceStreamedText.trim(),
                                    text: voiceStreamedText.trim(),
                                    source: 'stream',
                                },
                            };
                        } else {
                            throw new Error('Voice stream completed without payload.');
                        }
                    }
                    if (isHomeVoiceStreamForced && deltaCount < 1) {
                        throw new Error('[Home Voice] stream is forced but no delta events were received.');
                    }

                    return finalPayload;
                } finally {
                    if (agentStreamAbortControllerRef.current === controller) {
                        agentStreamAbortControllerRef.current = null;
                    }
                }
            };

            const invokeVoiceEndpointJson = async (requestBody: any = invokeBody): Promise<any> => {
                if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) {
                    const { data, error } = await functionsClient.invoke('voice-chat', {
                        body: { ...requestBody, stream: false },
                    });
                    if (error) {
                        throw error;
                    }
                    return data as any;
                }

                const response = await fetch(`${FUNCTIONS_BASE_URL}/functions/v1/voice-chat`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        apikey: SUPABASE_ANON_KEY,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    body: JSON.stringify({ ...requestBody, stream: false }),
                });
                const responseText = await response.text().catch(() => '');
                let parsedPayload: any = null;
                if (responseText) {
                    try {
                        parsedPayload = JSON.parse(responseText);
                    } catch {
                        parsedPayload = null;
                    }
                }

                if (!response.ok) {
                    const fallbackMessage =
                        (parsedPayload && typeof parsedPayload?.message === 'string' && parsedPayload.message.trim()) ||
                        responseText ||
                        `Voice request failed (${response.status})`;
                    const rateLimitResponse = buildVoiceRateLimitResponse(parsedPayload, fallbackMessage);
                    if (rateLimitResponse) {
                        return rateLimitResponse;
                    }
                    throw new Error(fallbackMessage);
                }

                return parsedPayload;
            };

            let response: any = null;
            let usedCompactVoiceRetry = false;
            let lastStreamErrorMessage = '';
            if (canAttemptVoiceStreaming) {
                try {
                    response = await invokeVoiceEndpointStream();
                } catch (streamError: any) {
                    const streamMessage =
                        typeof streamError?.message === 'string' ? streamError.message : 'Voice stream failed.';
                    lastStreamErrorMessage = streamMessage;
                    if (/streaming reader is unavailable|stream unsupported|unsupported stream/i.test(streamMessage.toLowerCase())) {
                        homeVoiceStreamCapabilityRef.current = 'unsupported';
                    }
                    if (__DEV__) {
                        console.warn('[Home Voice] stream failed, falling back to JSON:', streamMessage);
                    }
                    const looksLikeTimeout = /voice_chat_timeout|timeout/i.test(streamMessage.toLowerCase());
                    if (!response && useVoiceEndpoint && looksLikeTimeout && !usedCompactVoiceRetry) {
                        usedCompactVoiceRetry = true;
                        setVoiceStatusText('Network slow. Retrying with compact voice response...');
                        try {
                            response = await invokeVoiceEndpointStream(compactVoiceInvokeBody);
                        } catch (retryError: any) {
                            const retryMessage =
                                typeof retryError?.message === 'string'
                                    ? retryError.message
                                    : 'Voice stream retry failed.';
                            lastStreamErrorMessage = `${streamMessage}; retry: ${retryMessage}`;
                            if (__DEV__) {
                                console.warn('[Home Voice] compact stream retry failed:', retryMessage);
                            }
                        }
                    }
                    if (isHomeVoiceStreamForced) {
                        if (!response) {
                            throw new Error(`[Home Voice] stream is forced and failed: ${lastStreamErrorMessage || streamMessage}`);
                        }
                    }
                }
            }

            if (!response) {
                const shouldUseCompactVoiceFallback =
                    useVoiceEndpoint &&
                    (usedCompactVoiceRetry || /voice_chat_timeout|timeout/i.test((lastStreamErrorMessage || '').toLowerCase()));
                const fallbackInvokeBody = shouldUseCompactVoiceFallback ? compactVoiceInvokeBody : invokeBody;
                if (useVoiceEndpoint) {
                    response = await invokeVoiceEndpointJson(fallbackInvokeBody);
                } else {
                    const { data, error } = await functionsClient.invoke('chat-ai', {
                        body: fallbackInvokeBody,
                    });
                    if (error) {
                        throw error;
                    }
                    response = data as any;
                }
            }

            if (__DEV__) {
                console.log(`[AI Agent] ${useVoiceEndpoint ? 'voice-chat' : 'chat-ai'} latency: ${Date.now() - invokeStartAt}ms`);
            }

            const responseData = response?.data || {};
            if (__DEV__ && useVoiceEndpoint && responseData?.perf) {
                console.log('[VoiceChat Perf]', responseData.perf);
            }
            setAiDoctorPersona('female');
            const replyTextRaw = typeof responseData?.reply === 'string'
                ? responseData.reply
                : typeof responseData?.text === 'string'
                    ? responseData.text
                    : '';
            const replyTextCandidate = replyTextRaw.trim();
            if (!response?.success || !replyTextCandidate) {
                throw new Error(response?.message || 'No AI response');
            }

            if (activeAgentRequestTokenRef.current !== requestToken) {
                return false;
            }

            // Response arrived: hide "waiting for response" animation immediately.
            // Voice playback state is handled separately by `isVoiceReplyPlaying`.
            setIsAgentSending(false);
            sendingClearedAfterResponse = true;

            const recommendedDoctors = normalizeAgentRecommendedDoctors(responseData?.doctorRecommendations).slice(0, 6);
            const recommendedDepartment = normalizeAgentDepartmentSuggestion(responseData?.departmentSuggestion);
            const agentSteps = normalizeAgentToolSteps(
                responseData?.orchestrator?.toolsExecuted,
                responseData?.orchestrator?.autonomousToolSteps
            );
            const bookingPrompt =
                typeof responseData?.bookingPrompt === 'string' && responseData.bookingPrompt.trim().length > 0
                    ? responseData.bookingPrompt.trim()
                    : undefined;
            const bookingSlotOptions = extractAgentBookingSlotOptions(responseData);
            const bookingStatus = typeof responseData?.bookingConfirmation?.status === 'string'
                ? responseData.bookingConfirmation.status
                : null;
            const bookingMessage = typeof responseData?.bookingConfirmation?.message === 'string'
                ? responseData.bookingConfirmation.message
                : null;
            const bookingConfirmationDoctorName =
                typeof responseData?.bookingConfirmation?.doctorName === 'string'
                    ? responseData.bookingConfirmation.doctorName
                    : null;
            const bookingConfirmationSlotLabel =
                typeof responseData?.bookingConfirmation?.slotLabel === 'string'
                    ? responseData.bookingConfirmation.slotLabel
                    : null;
            const replyText = sanitizeBookingReplyForUi({
                replyText: replyTextCandidate,
                bookingStatus,
                bookingMessage,
                slotOptions: bookingSlotOptions,
            });
            const displayReplyText = ensureReplyIncludesBookingSlots(replyText, bookingSlotOptions);
            const consultRecommended = Boolean(responseData?.consultRecommended);

            if (recommendedDepartment?.id) {
                setSelectedDepartmentId((previous) => (previous === recommendedDepartment.id ? previous : recommendedDepartment.id));
            }

            const rateLimitObj = responseData?.rateLimit;
            const aiMessage: AgentMessage = {
                id: aiDraftId || nextAgentMessageId('a'),
                role: 'ai',
                text: displayReplyText,
                createdAt: aiDraftCreatedAt || nowIso(),
                recommendedDoctors,
                recommendedDepartment,
                bookingPrompt,
                bookingSlotOptions,
                bookingConfirmationStatus: bookingStatus,
                bookingConfirmationMessage: bookingMessage,
                bookingConfirmationDoctorName,
                bookingConfirmationSlotLabel,
                consultRecommended,
                agentSteps,
                rateLimit: rateLimitObj ? {
                    blocked: Boolean(rateLimitObj.blocked),
                    isPro: Boolean(rateLimitObj.isPro),
                    retryAfterMs: Math.max(0, Number(rateLimitObj.retryAfterMs || 0)),
                    burst: Boolean(rateLimitObj.burst),
                } : null,
            };
            if (activeAgentRequestTokenRef.current === requestToken) {
                setAgentCustomHint(null);
                setAgentMessages((prev) => {
                    const existingIndex = prev.findIndex((message) => message.id === aiMessage.id);
                    let next: AgentMessage[];
                    if (existingIndex >= 0) {
                        next = [...prev];
                        next[existingIndex] = { ...next[existingIndex], ...aiMessage };
                    } else {
                        next = [...prev, aiMessage];
                    }
                    agentMessagesRef.current = next;
                    return next;
                });

                // Show success toast for real booking
                if (responseData?.bookingConfirmation?.status === 'confirmed') {
                    const docName = getDoctorDisplayName(
                        { fullName: responseData.bookingConfirmation.doctorName },
                        { includePrefix: true, fallbackName: 'Doctor' }
                    );
                    const time = responseData.bookingConfirmation.slotLabel || '';
                    const confirmationToastMessage = time
                        ? `Your appointment with ${docName} is confirmed for ${time}.`
                        : `Your appointment with ${docName} is confirmed.`;

                    // Trigger Premium Animation Sequence
                    setIsBookingConfirmedOverlay(true);

                    // Refresh relevant data
                    if (user?.id) {
                        void queryClient.invalidateQueries({ queryKey: APPOINTMENT_QUERY_KEYS.myAppointments(user.id) });
                    }

                    // Hide overlay after animation duration
                    setTimeout(() => {
                        setIsBookingConfirmedOverlay(false);
                        Toast.show({
                            type: 'success',
                            text1: 'Appointment Confirmed',
                            text2: confirmationToastMessage,
                            visibilityTime: 5500
                        });
                    }, 2200);
                }
            }

            const aiAudio = typeof responseData?.audio === 'string' ? responseData.audio : '';
            const aiAudioMimeType = typeof responseData?.audioMimeType === 'string' ? responseData.audioMimeType : undefined;
            const spokenReplyText = typeof responseData?.spokenText === 'string' && responseData.spokenText.trim().length > 0
                ? responseData.spokenText.trim()
                : displayReplyText;

            const rateLimit = responseData?.rateLimit;
            const isDailyVoiceLimitBlocked = Boolean(rateLimit?.blocked && !rateLimit?.burst);
            const normalizedVoiceLimitPrompt = isDailyVoiceLimitBlocked
                ? {
                    blocked: true,
                    isPro: Boolean(rateLimit?.isPro),
                    retryAfterMs: Math.max(0, Number(rateLimit?.retryAfterMs || 0)),
                    burst: Boolean(rateLimit?.burst),
                }
                : null;
            if (options?.replyInVoice || normalizedVoiceLimitPrompt) {
                setVoiceLimitPrompt(normalizedVoiceLimitPrompt);
            }
            if (rateLimit?.blocked) {
                const blockedOnProTier = Boolean(rateLimit?.isPro) || isProUser;
                if (rateLimit?.burst) {
                    setVoiceStatusText('Too many rapid voice requests. Please wait and try again.');
                    Toast.show({
                        type: 'info',
                        text1: 'Voice is cooling down',
                        text2: 'Please wait a moment and try again.',
                    });
                } else if (blockedOnProTier) {
                    Toast.show({
                        type: 'info',
                        text1: 'Daily Pro limit reached',
                        text2: 'Please take a short break and try again later.',
                    });
                } else {
                    setVoiceStatusText('Daily voice limit reached. Upgrade to Pro to continue.');
                    setShowProPlanModal(true);
                }
            }

            const remainingLiveVoiceTail = voiceStreamedText
                .slice(homeVoiceLiveSpokenCharsRef.current)
                .trim();
            if (remainingLiveVoiceTail && nativeVoiceIdByPersona.female) {
                voiceLiveSpokenViaDelta = true;
                homeVoiceLiveSpeechQueueRef.current.push(remainingLiveVoiceTail);
                void processHomeVoiceLiveSpeechQueue();
            }

            if (
                options?.replyInVoice &&
                activeAgentRequestTokenRef.current === requestToken &&
                !voiceLiveSpokenViaDelta &&
                !rateLimit?.blocked
            ) {
                // Text is already rendered; play audio asynchronously so UX feels instant.
                void speakText(spokenReplyText, aiAudio, aiAudioMimeType, 'female', true);
            }
            setIsAgentVoiceLiveStreaming(false);
            return !rateLimit?.blocked;
        } catch (error: any) {
            setAgentCustomHint(null);
            if (activeAgentRequestTokenRef.current !== requestToken) {
                return false;
            }
            console.error('Home AI agent call failed:', error);
            const errMsg = error?.message || 'Unknown error';
            const fallbackMessage: AgentMessage = {
                id: aiDraftId || nextAgentMessageId('a'),
                role: 'ai',
                text: `I am unable to process this right now. (Error: ${errMsg}). Please try again.`,
                createdAt: aiDraftCreatedAt || nowIso(),
            };
            setIsAgentVoiceLiveStreaming(false);
            setAgentMessages((prev) => {
                const existingIndex = prev.findIndex((message) => message.id === fallbackMessage.id);
                let next: AgentMessage[];
                if (existingIndex >= 0) {
                    next = [...prev];
                    next[existingIndex] = { ...next[existingIndex], ...fallbackMessage };
                } else {
                    next = [...prev, fallbackMessage];
                }
                agentMessagesRef.current = next;
                return next;
            });
            if (options?.replyInVoice) {
                setVoiceStatusText('Voice response failed. Tap mic to retry.');
            }
            return false;
        } finally {
            isHomeAgentSendingRef.current = false;
            setIsAgentVoiceLiveStreaming(false);
            agentStreamingDraftMessageIdRef.current = null;
            if (agentStreamAbortControllerRef.current) {
                try {
                    const activeAbortController = agentStreamAbortControllerRef.current as any;
                    activeAbortController?.abort?.();
                } catch {
                    // no-op
                }
                agentStreamAbortControllerRef.current = null;
            }
            if (activeAgentRequestTokenRef.current === requestToken) {
                activeAgentRequestTokenRef.current = null;
                if (!sendingClearedAfterResponse) {
                    setIsAgentSending(false);
                }
            }
        }
    };

    const queueVoiceAutoSubmit = React.useCallback(
        (rawTranscript: string, delayMs: number, reason: 'final' | 'end') => {
            const transcript = rawTranscript.trim();
            if (!transcript || isAgentSending) {
                return;
            }

            clearVoiceAutoSubmitTimers();
            
            let adaptiveDelayMs = delayMs;
            const words = transcript.split(/\s+/).filter(Boolean);
            const wordCount = words.length;
            const lowerTranscript = transcript.toLowerCase();
            
            const quickResponseTerms = [
                'yes', 'no', 'confirm', 'first slot', 'slot', 'book', 'haan', 'han', 'theek', 'thik', 'sahi', 'okay', 'ok',
                'first', 'second', 'third', 'last', 'wahi', 'done', 'appointment'
            ];
            const hasQuickResponseTerm = quickResponseTerms.some(term => lowerTranscript.includes(term));
            
            const symptomTerms = [
                'pain', 'fever', 'vomit', 'cough', 'cold', 'headache', 'rash', 'infection', 'breathing', 'period', 'pregnancy',
                'sugar', 'bp', 'diabetes', 'bukhar', 'dard', 'khansi', 'sardard', 'chot', 'blood', 'khoon'
            ];
            const hasSymptomTerm = symptomTerms.some(term => lowerTranscript.includes(term));

            if (wordCount <= 4 || hasQuickResponseTerm) {
                adaptiveDelayMs = 1100;
            } else if (wordCount >= 8 || hasSymptomTerm) {
                adaptiveDelayMs = 2800;
            } else {
                adaptiveDelayMs = 1800;
            }

            const safeDelay = Math.max(150, adaptiveDelayMs);
            voiceSilenceInitialDelayRef.current = safeDelay;
            const countdownStartedAt = Date.now();
            setVoiceSilenceCountdownMs(safeDelay);
            setVoiceStatusText(reason === 'end' ? 'Pause detected. Sending now...' : 'Pause detected. Sending shortly...');

            autoSubmitCountdownRef.current = setInterval(() => {
                const elapsed = Date.now() - countdownStartedAt;
                const remaining = Math.max(0, safeDelay - elapsed);
                setVoiceSilenceCountdownMs(remaining);
                if (remaining <= 0 && autoSubmitCountdownRef.current) {
                    clearInterval(autoSubmitCountdownRef.current);
                    autoSubmitCountdownRef.current = null;
                }
            }, VOICE_COUNTDOWN_TICK_MS);

            autoSubmitTimerRef.current = setTimeout(() => {
                clearVoiceAutoSubmitTimers();
                const normalized = transcript.trim();
                if (!normalized || isAgentSending) {
                    return;
                }

                voiceSubmitInProgressRef.current = true;
                voiceSessionActiveRef.current = false;
                setIsVoiceSessionActive(false);
                setIsListening(false);

                try {
                    ExpoSpeechRecognitionModule?.stop();
                } catch (error) {
                    console.warn('Speech recognition stop failed:', error);
                }

                const voiceFingerprint = normalizeVoiceSubmitFingerprint(normalized);
                if (!voiceFingerprint) {
                    voiceSubmitInProgressRef.current = false;
                    return;
                }

                const now = Date.now();
                const duplicateVoiceSubmit =
                    lastVoiceSubmitRef.current.text === voiceFingerprint &&
                    now - lastVoiceSubmitRef.current.at < 4200;
                if (duplicateVoiceSubmit) {
                    voiceSubmitInProgressRef.current = false;
                    return;
                }

                lastVoiceSubmitRef.current = {
                    text: voiceFingerprint,
                    at: now,
                };

                setVoiceLiveTranscript('');
                voiceLiveTranscriptRef.current = '';
                lastVoiceResultAtRef.current = 0;
                setVoiceStatusText('Processing your question...');

                void (async () => {
                    try {
                        const completed = await callHomeAgent(normalized, { replyInVoice: true });
                        if (completed) {
                            setVoiceStatusText('Reply delivered. Tap mic to ask another question.');
                        }
                    } finally {
                        voiceSubmitInProgressRef.current = false;
                    }
                })();
            }, safeDelay);
        },
        [callHomeAgent, clearVoiceAutoSubmitTimers, isAgentSending]
    );

    const handleSymptomSubmit = (rawSymptom?: string) => {
        const symptom = (rawSymptom ?? symptomInput).trim();
        if (isAgentSending) {
            Toast.show({
                type: 'info',
                text1: 'Please wait',
                text2: 'AI is processing your previous message.',
            });
            return;
        }
        if (!symptom) {
            Toast.show({
                type: 'info',
                text1: 'Add symptoms',
                text2: 'Type your symptoms to start AI triage.',
            });
            return;
        }

        // If user typed text and submitted, open assistant directly in text mode.
        setIsChatInputActive(true);
        setIsAgentConversationVisible(true);
        Keyboard.dismiss();
        if (agentMessagesRef.current.length >= 41) { // 20 user + 20 AI = 40 messages total? Or exactly 21st user attempt?
            // Actually let's check the rate limit returned from backend later, 
            // but for immediate UI feel, we can check message count or wait for backend.
        }
        void callHomeAgent(symptom, { replyInVoice: false });
        setSymptomInput('');
    };

    const handleModalTextSubmit = () => {
        const text = modalTextInput.trim();
        if (!text || isAgentSending) {
            return;
        }

        if (voiceSessionActiveRef.current) {
            void stopContinuousVoiceSession(false);
        }

        setModalTextInput('');
        void callHomeAgent(text, { replyInVoice: false });
    };

    useSpeechRecognitionEventSafe<null>('start', (_event) => {
        setIsListening(true);
        clearVoiceAutoSubmitTimers();
        if (voiceSessionActiveRef.current) {
            setVoiceStatusText('Speak now. Pause briefly to auto-send.');
        }
    });

    useSpeechRecognitionEventSafe<null>('end', (_event) => {
        setIsListening(false);
        if (voiceSubmitInProgressRef.current) {
            return;
        }
        const latestTranscript = voiceLiveTranscriptRef.current.trim();
        const elapsedSinceLastResult = Date.now() - lastVoiceResultAtRef.current;
        const shouldRecoverContinuousSession =
            voiceSessionActiveRef.current &&
            !isAgentSending &&
            !voiceSubmitInProgressRef.current &&
            latestTranscript.length > 0 &&
            elapsedSinceLastResult >= 0 &&
            elapsedSinceLastResult < VOICE_END_MIN_SILENCE_MS;

        if (shouldRecoverContinuousSession && !autoSubmitTimerRef.current) {
            const now = Date.now();
            if (now - lastVoiceEndRestartAtRef.current > VOICE_END_RESTART_COOLDOWN_MS) {
                lastVoiceEndRestartAtRef.current = now;
                setVoiceStatusText('Listening...');
                void startContinuousListening();
            }
            return;
        }

        if (voiceSessionActiveRef.current && !isAgentSending && latestTranscript && !autoSubmitTimerRef.current) {
            queueVoiceAutoSubmit(latestTranscript, VOICE_END_AUTO_SUBMIT_DELAY_MS, 'end');
            return;
        }
        if (voiceSessionActiveRef.current && !isAgentSending && voiceSilenceCountdownMs === null) {
            setVoiceStatusText(isVoiceReplyPlaying ? 'AI is speaking...' : 'Waiting for your voice...');
        }
    });

    useSpeechRecognitionEventSafe<SpeechRecognitionResultEvent>('result', (event) => {
        if (voiceSubmitInProgressRef.current) {
            return;
        }
        const transcript = event.results[0]?.transcript?.trim();
        if (!transcript) {
            return;
        }
        lastVoiceResultAtRef.current = Date.now();

        if (voiceSessionActiveRef.current) {
            setVoiceLiveTranscript(transcript);
            voiceLiveTranscriptRef.current = transcript;

            if (finalSubmitFallbackTimerRef.current) {
                clearTimeout(finalSubmitFallbackTimerRef.current);
                finalSubmitFallbackTimerRef.current = null;
            }

            // Continuous auto-submit: clears and schedules submit timer dynamically on every word spoken
            queueVoiceAutoSubmit(transcript, VOICE_END_AUTO_SUBMIT_DELAY_MS, 'end');
        } else {
            setSymptomInput(transcript);
            if (event.isFinal) {
                handleSymptomSubmit(transcript);
            }
        }
    });

    useSpeechRecognitionEventSafe<SpeechRecognitionErrorEvent>('error', (event) => {
        setIsListening(false);
        clearVoiceAutoSubmitTimers();
        if (voiceSessionActiveRef.current) {
            setVoiceStatusText('Voice capture failed. Tap mic to retry.');
        }

        if (isBenignSpeechRecognitionError(event.message)) {
            return;
        }

        Toast.show({
            type: 'error',
            text1: 'Voice input error',
            text2: event.message || 'Could not capture voice input.',
        });
    });

    React.useEffect(() => {
        return () => {
            clearVoiceAutoSubmitTimers();

            try {
                if (ExpoSpeechRecognitionModule) {
                    ExpoSpeechRecognitionModule.abort();
                }
            } catch (e) {
                console.warn('Speech recognition abort failed:', e);
            }
            void stopActiveVoicePlayback();
        };
    }, [clearVoiceAutoSubmitTimers, stopActiveVoicePlayback]);

    const handleMicPress = async (forceVoiceCapture: boolean = false) => {
        if (shouldShowVoiceUpgradePrompt) {
            clearVoiceAutoSubmitTimers();
            setIsAgentConversationVisible(true);
            setIsChatInputActive(false);
            setVoiceStatusText('Daily voice limit reached. Upgrade to Pro to continue.');
            setShowProPlanModal(true);
            return;
        }

        if (isAgentSending || isVoiceReplyPlaying) {
            activeAgentRequestTokenRef.current = `interrupted-${Date.now()}`;
            setIsAgentSending(false);
            clearVoiceAutoSubmitTimers();
            await stopActiveVoicePlayback();
            setVoiceLiveTranscript('');
            voiceLiveTranscriptRef.current = '';
            voiceSessionActiveRef.current = true;
            setVoiceStatusText('Speak now. Pause briefly to auto-send.');
            setIsAgentConversationVisible(true);
            setIsChatInputActive(false);
            setIsVoiceSessionActive(true);
            const restarted = await startContinuousListening();
            if (!restarted) {
                await stopContinuousVoiceSession();
            }
            return;
        }

        if (isVoiceSessionActive) {
            await stopContinuousVoiceSession(true);
            return;
        }

        if (isListening) {
            ExpoSpeechRecognitionModule?.stop();
            return;
        }

        if (!forceVoiceCapture && symptomInput.trim()) {
            handleSymptomSubmit();
            return;
        }

        setIsAgentConversationVisible(true);
        setIsChatInputActive(false);
        setVoiceLiveTranscript('');
        voiceLiveTranscriptRef.current = '';
        voiceSessionActiveRef.current = true;
        setIsVoiceSessionActive(true);
        setVoiceStatusText('Speak now. Pause briefly to auto-send.');

        const started = await startContinuousListening();
        if (!started) {
            voiceSessionActiveRef.current = false;
            setIsVoiceSessionActive(false);
            setVoiceStatusText('Voice unavailable. Use text chat.');
        }
    };

    const handleCloseAgentPanel = () => {
        if (voiceSessionActiveRef.current) {
            void stopContinuousVoiceSession(false);
        }
        Keyboard.dismiss();
        setIsAgentConversationVisible(false);
        setVoiceLiveTranscript('');
        setModalTextInput('');
        setIsChatInputActive(false);
    };

    const resolveDoctorId = (doctor: { _id?: string; id?: string } | null | undefined): string | undefined => {
        const value = typeof doctor?._id === 'string' && doctor._id.trim()
            ? doctor._id.trim()
            : typeof doctor?.id === 'string' && doctor.id.trim()
                ? doctor.id.trim()
                : '';
        return value || undefined;
    };

    const handleConsultDoctor = (doctorId?: string) => {
        router.push({
            pathname: '/(tabs)/appointments',
            params: doctorId ? { doctorId } : undefined,
        });
    };

    const handleOpenDoctorProfile = (doctorId?: string) => {
        if (!doctorId) return;
        router.push({
            pathname: '/user/[id]',
            params: { id: doctorId },
        } as any);
    };

    const handleAgentBookDoctor = (doctor: AgentRecommendedDoctor, departmentLabel?: string) => {
        router.push({
            pathname: '/(tabs)/appointments',
            params: {
                doctorId: doctor.id,
                concern: departmentLabel || selectedDepartment?.label || 'General',
            },
        });
    };

    const handleOpenAppointmentsFromAgent = (departmentLabel?: string, doctorId?: string) => {
        router.push({
            pathname: '/(tabs)/appointments',
            params: {
                concern: departmentLabel || selectedDepartment?.label || 'General',
                ...(doctorId ? { doctorId } : {}),
            },
        });
    };

    const handlePromoCardAction = React.useCallback((action: HomePromoCardAction) => {
        if (action === 'voice_triage') {
            setIsAgentConversationVisible(true);
            setIsChatInputActive(false);
            setModalTextInput('');

            if (!isVoiceSessionActive && !isListening && !isVoiceReplyPlaying) {
                void handleMicPress(true);
            }
            return;
        }

        if (voiceSessionActiveRef.current) {
            void stopContinuousVoiceSession(false);
        }

        setIsAgentConversationVisible(false);

        if (action === 'best_doctors') {
            handleConsultDoctor();
            return;
        }

        if (action === 'best_doctors_global') {
            const globalTopDoctor = [...(doctorsData as Doctor[])]
                .sort((a, b) => {
                    const ratingDiff = (Number(b.rating) || 0) - (Number(a.rating) || 0);
                    if (ratingDiff !== 0) {
                        return ratingDiff;
                    }

                    const expDiff = parseExperienceYears(b.experience) - parseExperienceYears(a.experience);
                    if (expDiff !== 0) {
                        return expDiff;
                    }

                    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
                })
                [0];

            handleConsultDoctor(globalTopDoctor?._id);
            return;
        }

        if (action === 'ai_chat') {
            router.push({
                pathname: '/ai-guidance',
                params: {
                    concern: 'General Assistant',
                    variant: 'assistant',
                    voice: 'false',
                },
            });
            return;
        }

        if (action === 'report_assistant') {
            router.push('/(tabs)/records');
            return;
        }

    }, [
        doctorsData,
        handleConsultDoctor,
        handleMicPress,
        isListening,
        isVoiceReplyPlaying,
        isVoiceSessionActive,
        router,
        stopContinuousVoiceSession,
    ]);

    const cityLabel = locationCity || 'your area';
    const selectedCityLabel = selectedCity || 'All cities';
    const showNearbyDoctorSkeleton = loading && doctorsData.length === 0 && !isPullRefreshing;
    const isDarkTheme = theme.background.toLowerCase() === '#121212' || theme.cardBackground.toLowerCase() === '#1e1e1e';
    const skeletonBaseColor = isDarkTheme ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)';
    const skeletonGlowColor = isDarkTheme ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.72)';

    const handleManualRefresh = React.useCallback(async () => {
        if (isPullRefreshing) return;
        setIsPullRefreshing(true);
        try {
            await refetch();
        } finally {
            setIsPullRefreshing(false);
        }
    }, [isPullRefreshing, refetch]);
    const loadMoreNearbyDoctors = React.useCallback(() => {
        if (!canLoadMoreNearbyDoctors || isLoadingMoreNearbyDoctors) return;

        const now = Date.now();
        if (now - nearbyLoadMoreThrottleRef.current < 220) {
            return;
        }
        nearbyLoadMoreThrottleRef.current = now;
        setIsLoadingMoreNearbyDoctors(true);
        nearbyLoadMoreTimerRef.current = setTimeout(() => {
            setNearbyVisibleCount((current) => Math.min(current + HOME_NEARBY_PAGE_SIZE, nearbyDoctors.length));
            setIsLoadingMoreNearbyDoctors(false);
            nearbyLoadMoreTimerRef.current = null;
        }, HOME_LOAD_MORE_SHIMMER_DELAY_MS);
    }, [canLoadMoreNearbyDoctors, isLoadingMoreNearbyDoctors, nearbyDoctors.length]);
    const handleHomeScroll = React.useCallback((event: any) => {
        const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent || {};
        if (!layoutMeasurement || !contentOffset || !contentSize) return;
        if (contentSize.height <= layoutMeasurement.height + 24) return;

        const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 220;
        if (nearBottom) {
            loadMoreNearbyDoctors();
        }
    }, [loadMoreNearbyDoctors]);

    const voiceSilenceCountdownSeconds = voiceSilenceCountdownMs !== null
        ? Math.max(0, voiceSilenceCountdownMs / 1000)
        : null;
    const isVoiceAutoSending = voiceSilenceCountdownMs !== null;
    const voicePanelStatusText = isVoiceAutoSending && voiceSilenceCountdownSeconds !== null
        ? `Silence detected. Sending in ${voiceSilenceCountdownSeconds.toFixed(1)}s...`
        : isListening
            ? 'Listening...'
        : isVoiceReplyPlaying
            ? 'AI is speaking...'
        : isVoiceSessionActive
            ? 'Waiting for your voice...'
            : voiceStatusText;
    const bottomVoiceTitle = isListening
        ? 'Listening...'
        : isVoiceAutoSending
            ? 'Sending...'
            : isAgentSending
                ? 'Processing...'
                : isVoiceReplyPlaying
                    ? 'Doctor speaking...'
                    : isVoiceSessionActive
                        ? 'Voice ready'
                        : 'Tap to speak';
    const subscriptionStatus = String(user?.subscription?.status || '').toLowerCase();
    const subscriptionExpiryMs =
        typeof user?.subscription?.expiresAt === 'string' && user.subscription.expiresAt.trim().length > 0
            ? new Date(user.subscription.expiresAt).getTime()
            : null;
    const hasValidProWindow = subscriptionExpiryMs === null || (Number.isFinite(subscriptionExpiryMs) && subscriptionExpiryMs > Date.now());
    const isProUser = ['active', 'trialing', 'grace'].includes(subscriptionStatus) && hasValidProWindow;
    const shouldShowVoiceUpgradePrompt = Boolean(voiceLimitPrompt?.blocked && !voiceLimitPrompt?.isPro && !isProUser);
    const isLargeScreen = windowWidth > 768;
    const isCompactDoctorCard = windowWidth <= 390;
    const promoCardGap = 10;
    const promoCardWidth = Math.round(
        isLargeScreen
            ? Math.min(430, Math.max(300, windowWidth - 80))
            : Math.min(320, Math.max(260, windowWidth - 64))
    );
    const promoTopDoctorContext = React.useMemo(() => {
        const candidates = [...(doctorsData as Doctor[])];
        const requestedCity = selectedCity || locationCity || null;

        const rankedByQuality = (list: Doctor[]) => (
            list.sort((a, b) => {
                const ratingDiff = (Number(b.rating) || 0) - (Number(a.rating) || 0);
                if (ratingDiff !== 0) {
                    return ratingDiff;
                }

                const expDiff = parseExperienceYears(b.experience) - parseExperienceYears(a.experience);
                if (expDiff !== 0) {
                    return expDiff;
                }

                return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
            })
        );

        if (!requestedCity) {
            return {
                doctors: rankedByQuality(candidates).slice(0, 2),
                requestedCity: null as string | null,
                matchedCity: null as string | null,
                usedNearestFallback: false,
            };
        }

        const exactScoped = candidates.filter((doctor) => isCityMatch(doctor.city, requestedCity));
        if (exactScoped.length > 0) {
            return {
                doctors: rankedByQuality(exactScoped).slice(0, 2),
                requestedCity,
                matchedCity: requestedCity,
                usedNearestFallback: false,
            };
        }

        const uniqueCities = Array.from(
            new Map(
                candidates
                    .map((doctor) => doctor.city?.trim())
                    .filter((city): city is string => Boolean(city && city.trim()))
                    .map((city) => [normalizeText(city), city] as const)
            ).values()
        );

        const targetKey = normalizeText(requestedCity);
        const requestedCoord = resolveCityCoordinate(requestedCity);
        if (requestedCoord) {
            let nearestGeoCity: string | null = null;
            let nearestGeoDistance = Number.POSITIVE_INFINITY;

            uniqueCities.forEach((city) => {
                const cityCoord = resolveCityCoordinate(city);
                if (!cityCoord) return;
                const distance = haversineKm(requestedCoord, cityCoord);
                if (distance < nearestGeoDistance) {
                    nearestGeoDistance = distance;
                    nearestGeoCity = city;
                }
            });

            if (nearestGeoCity) {
                const nearestScopedByGeo = candidates.filter((doctor) => isCityMatch(doctor.city, nearestGeoCity as string));
                if (nearestScopedByGeo.length > 0) {
                    return {
                        doctors: rankedByQuality(nearestScopedByGeo).slice(0, 2),
                        requestedCity,
                        matchedCity: nearestGeoCity,
                        usedNearestFallback: true,
                    };
                }
            }
        }

        let nearestCity: string | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;

        uniqueCities.forEach((city) => {
            const distance = getEditDistance(normalizeText(city), targetKey);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestCity = city;
            }
        });

        const nearestScoped = nearestCity
            ? candidates.filter((doctor) => isCityMatch(doctor.city, nearestCity as string))
            : candidates;

        return {
            doctors: rankedByQuality(nearestScoped).slice(0, 2),
            requestedCity,
            matchedCity: nearestCity,
            usedNearestFallback: Boolean(nearestCity),
        };
    }, [doctorsData, selectedCity, locationCity]);
    const promoTopDoctors = promoTopDoctorContext.doctors;
    const promoGlobalTopDoctors = React.useMemo(() => (
        [...(doctorsData as Doctor[])]
            .sort((a, b) => {
                const ratingDiff = (Number(b.rating) || 0) - (Number(a.rating) || 0);
                if (ratingDiff !== 0) {
                    return ratingDiff;
                }

                const expDiff = parseExperienceYears(b.experience) - parseExperienceYears(a.experience);
                if (expDiff !== 0) {
                    return expDiff;
                }

                return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
            })
            .slice(0, 3)
    ), [doctorsData]);
    const getDoctorDisplayName = React.useCallback(
        (
            doctorLike: { firstName?: string | null; lastName?: string | null; fullName?: string | null },
            options: { includePrefix?: boolean; fallbackName?: string } = {}
        ) =>
            getLocalizedDoctorName(
                {
                    firstName: doctorLike.firstName,
                    lastName: doctorLike.lastName,
                    fullName: doctorLike.fullName,
                },
                language,
                options
            ),
        [language]
    );
    const promoBestDoctorDescription = React.useMemo(() => {
        if (promoTopDoctors.length === 0) {
            return 'Verified specialists, real ratings, and quick appointment access in your city.';
        }

        const topDoctorSnippets = promoTopDoctors.map((doctor) => {
            const doctorName = getDoctorDisplayName(doctor, { includePrefix: true, fallbackName: 'Top Specialist' });
            const rating = formatDoctorRatingLabel(doctor.rating);
            return `${doctorName} (${rating})`;
        });

        const locationLabel = promoTopDoctorContext.matchedCity || promoTopDoctorContext.requestedCity || promoTopDoctors[0]?.city || 'your area';
        return `Top picks in ${locationLabel}: ${topDoctorSnippets.join(' • ')}.`;
    }, [getDoctorDisplayName, promoTopDoctors, promoTopDoctorContext]);
    const promoGlobalDoctorDescription = React.useMemo(() => {
        if (promoGlobalTopDoctors.length === 0) {
            return 'Top rated doctors across CD4, trusted by patients for fast consultations.';
        }

        const topDoctorSnippets = promoGlobalTopDoctors.map((doctor) => {
            const doctorName = getDoctorDisplayName(doctor, { includePrefix: true, fallbackName: 'Top Specialist' });
            const rating = formatDoctorRatingLabel(doctor.rating);
            return `${doctorName} (${rating})`;
        });

        return `Across CD4: ${topDoctorSnippets.join(' • ')}.`;
    }, [getDoctorDisplayName, promoGlobalTopDoctors]);
    const promoCards = React.useMemo<HomePromoCard[]>(() => (
        HOME_PROMO_CARDS.map((card) => {
            if (card.action === 'best_doctors') {
                const requestedLabel = promoTopDoctorContext.requestedCity;
                const fallbackLabel = promoTopDoctorContext.matchedCity || requestedLabel;
                const computedTitle = fallbackLabel
                    ? promoTopDoctorContext.usedNearestFallback
                        ? `Top doctors near ${requestedLabel}`
                        : `Top doctors in ${fallbackLabel}`
                    : card.title;
                return {
                    ...card,
                    title: computedTitle,
                    description: promoBestDoctorDescription,
                };
            }

            if (card.action === 'best_doctors_global') {
                return {
                    ...card,
                    description: promoGlobalDoctorDescription,
                };
            }

            return card;
        })
    ), [promoBestDoctorDescription, promoGlobalDoctorDescription, promoTopDoctorContext]);
    const promoDoctorsByAction = React.useMemo<Record<HomePromoCardAction, Doctor[]>>(() => ({
        best_doctors: promoTopDoctors.slice(0, 2),
        best_doctors_global: promoGlobalTopDoctors.slice(0, 2),
        ai_chat: [],
        voice_triage: [],
        report_assistant: [],
    }), [promoTopDoctors, promoGlobalTopDoctors]);
    const promoLoopCards = React.useMemo<HomePromoCard[]>(() => (
        promoCards.length > 1 ? [...promoCards, ...promoCards] : promoCards
    ), [promoCards]);
    const promoScrollStep = promoCardWidth + promoCardGap;
    const clearPromoAutoScrollTimer = React.useCallback(() => {
        if (promoAutoScrollTimerRef.current) {
            clearInterval(promoAutoScrollTimerRef.current);
            promoAutoScrollTimerRef.current = null;
        }
    }, []);
    const normalizePromoAutoScrollOffset = React.useCallback((rawIndex: number) => {
        const cardCount = promoCards.length;
        if (cardCount <= 1) return 0;
        const normalizedIndex = ((rawIndex % cardCount) + cardCount) % cardCount;
        promoAutoScrollIndexRef.current = normalizedIndex;
        promoCarouselRef.current?.scrollTo({
            x: normalizedIndex * promoScrollStep,
            animated: false,
        });
        return normalizedIndex;
    }, [promoCards.length, promoScrollStep]);
    const startPromoAutoScroll = React.useCallback(() => {
        clearPromoAutoScrollTimer();
        if (promoCards.length <= 1) return;

        promoAutoScrollTimerRef.current = setInterval(() => {
            if (!promoCarouselRef.current) return;

            if (promoAutoScrollIndexRef.current >= promoCards.length) {
                normalizePromoAutoScrollOffset(promoAutoScrollIndexRef.current);
            }

            const nextIndex = promoAutoScrollIndexRef.current + 1;
            promoAutoScrollIndexRef.current = nextIndex;
            promoCarouselRef.current.scrollTo({
                x: nextIndex * promoScrollStep,
                animated: true,
            });
        }, PROMO_AUTOSCROLL_MS);
    }, [clearPromoAutoScrollTimer, normalizePromoAutoScrollOffset, promoCards.length, promoScrollStep]);
    const handlePromoScrollBeginDrag = React.useCallback(() => {
        clearPromoAutoScrollTimer();
    }, [clearPromoAutoScrollTimer]);
    const handlePromoMomentumEnd = React.useCallback((event: any) => {
        const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
        const rawIndex = Math.max(0, Math.round(offsetX / Math.max(1, promoScrollStep)));

        if (promoCards.length > 1 && rawIndex >= promoCards.length) {
            requestAnimationFrame(() => {
                normalizePromoAutoScrollOffset(rawIndex);
            });
        } else {
            promoAutoScrollIndexRef.current = rawIndex;
        }

        startPromoAutoScroll();
    }, [normalizePromoAutoScrollOffset, promoCards.length, promoScrollStep, startPromoAutoScroll]);
    React.useEffect(() => {
        promoAutoScrollIndexRef.current = 0;
        promoCarouselRef.current?.scrollTo({ x: 0, animated: false });
        startPromoAutoScroll();
        return clearPromoAutoScrollTimer;
    }, [clearPromoAutoScrollTimer, promoCards.length, promoScrollStep, startPromoAutoScroll]);
    const agentSheetHeight = isLargeScreen 
        ? 620 
        : Math.min(
            Math.max(windowHeight * 0.72, 580),
            Math.min(windowHeight - (insets.top || 20) - 60, 1000)
        );
    const agentSheetStatusLabel = isAgentSending
        ? isChatInputActive
            ? 'Analyzing your message'
            : 'Assessing symptoms'
        : isListening || isVoiceSessionActive
            ? 'Voice session live'
            : isVoiceReplyPlaying
                ? 'AI speaking'
                : agentMessages.length > 1
                    ? 'Conversation ready'
                    : 'Private AI triage';
    const agentSheetStatusColor = isAgentSending || isListening || isVoiceSessionActive || isVoiceReplyPlaying
        ? theme.tint
        : theme.textSecondary;
    const showAgentTypingBubble = isAgentSending;
    const isVoiceAwaitingResponse = isVoiceSessionActive && isAgentSending && !isListening && !isVoiceReplyPlaying;
    const isTextAwaitingResponse = isChatInputActive && isAgentSending && !isVoiceReplyPlaying;
    const isAssistantAwaitingResponse = isVoiceAwaitingResponse || isTextAwaitingResponse;
    const shouldShowVoiceOnlyPanel = !isChatInputActive;
    const doctorVoiceAccent = shouldShowVoiceUpgradePrompt ? theme.tint : isVoiceReplyPlaying ? '#1FCB70' : isListening ? '#35B677' : isAssistantAwaitingResponse ? theme.tint : '#7B8E99';
    const doctorVoiceAura = shouldShowVoiceUpgradePrompt ? `${theme.tint}22` : isVoiceReplyPlaying ? '#1FCB7028' : isListening ? '#35B67724' : isAssistantAwaitingResponse ? `${theme.tint}22` : '#7B8E9920';
    const doctorVoicePrimaryBar = shouldShowVoiceUpgradePrompt ? theme.tint : isVoiceReplyPlaying ? '#1FCB70' : isListening ? '#44BC84' : isAssistantAwaitingResponse ? theme.tint : '#97A9B3';
    const doctorVoiceSecondaryBar = shouldShowVoiceUpgradePrompt ? `${theme.tint}` : isVoiceReplyPlaying ? '#159A53' : isListening ? '#2E9768' : isAssistantAwaitingResponse ? `${theme.tint}` : '#B1BEC5';
    const doctorHaloGradient = (
        isVoiceReplyPlaying
            ? ['rgba(24, 203, 112, 0.35)', 'rgba(13, 56, 33, 0.10)']
                : isListening
                    ? ['rgba(53, 182, 119, 0.26)', 'rgba(20, 70, 45, 0.10)']
                    : isAssistantAwaitingResponse
                        ? ['rgba(56, 189, 248, 0.24)', 'rgba(23, 65, 98, 0.10)']
                        : ['rgba(123, 142, 153, 0.23)', 'rgba(55, 67, 73, 0.10)']
    ) as readonly [string, string];
    const doctorCoreGradient = (
        isVoiceReplyPlaying
            ? ['#F6FFFA', '#DDF9EB']
                : isListening
                    ? ['#F8FFFC', '#E1FAEF']
                    : isAssistantAwaitingResponse
                        ? ['#F6FBFF', '#E6F3FF']
                        : ['#F8FBFD', '#EAF1F5']
    ) as readonly [string, string];
    const doctorDotColor = isVoiceReplyPlaying ? '#52F1A0' : isListening ? '#67E2AB' : isAssistantAwaitingResponse ? '#6CC9FF' : '#A8B6BF';
    const doctorScanColor = isVoiceReplyPlaying ? 'rgba(48, 224, 133, 0.28)' : isAssistantAwaitingResponse ? 'rgba(98, 181, 234, 0.24)' : 'rgba(117, 201, 161, 0.22)';
    const isDoctorVoiceEngaged = isVoiceReplyPlaying || isListening || isAssistantAwaitingResponse;
    const voiceAutoSendProgress = voiceSilenceCountdownMs === null
        ? 0
        : Math.max(0, Math.min(1, voiceSilenceCountdownMs / voiceSilenceInitialDelayRef.current));
    const voiceRobotWaveLabel = shouldShowVoiceUpgradePrompt
            ? 'Upgrade to Pro to continue voice chat.'
        : isVoiceReplyPlaying
            ? 'AI Doctor speaking with live lipsync...'
        : isListening
            ? 'Listening to your voice...'
        : isVoiceAutoSending && voiceSilenceCountdownSeconds !== null
            ? `Auto-sending in ${voiceSilenceCountdownSeconds.toFixed(1)}s`
            : isAssistantAwaitingResponse
                ? 'Preparing AI response...'
                : 'Voice session active';
    const hasTypedSymptom = symptomInput.trim().length > 0;
    const shouldEmphasizeVoiceCta = !hasTypedSymptom;
    const shouldPulseMicButton = isListening || (isVoiceSessionActive && shouldEmphasizeVoiceCta);
    const latestVoiceBookingConfirmation = React.useMemo(
        () =>
            [...agentMessages]
                .reverse()
                .find(
                    (message) =>
                        message.role === 'ai' &&
                        message.bookingConfirmationStatus === 'confirmed'
                ) || null,
        [agentMessages]
    );
    const latestAgentVisualMessage = React.useMemo(() => {
        const reversed = [...agentMessages].reverse();
        const latestDoctorMessage =
            reversed.find(
                (message) => message.role === 'ai' && (message.recommendedDoctors?.length || 0) > 0
            ) || null;
        const latestSlotMessage =
            reversed.find(
                (message) => message.role === 'ai' && (message.bookingSlotOptions?.length || 0) > 0
            ) || null;

        if (!latestDoctorMessage && !latestSlotMessage) {
            return null;
        }

        return {
            ...(latestDoctorMessage || latestSlotMessage),
            ...(latestSlotMessage || {}),
            recommendedDoctors:
                latestSlotMessage?.recommendedDoctors && latestSlotMessage.recommendedDoctors.length > 0
                    ? latestSlotMessage.recommendedDoctors
                    : latestDoctorMessage?.recommendedDoctors || [],
            bookingSlotOptions:
                latestSlotMessage?.bookingSlotOptions && latestSlotMessage.bookingSlotOptions.length > 0
                    ? latestSlotMessage.bookingSlotOptions
                    : latestDoctorMessage?.bookingSlotOptions || [],
            bookingPrompt: latestSlotMessage?.bookingPrompt || latestDoctorMessage?.bookingPrompt,
        } as AgentMessage;
    }, [agentMessages]);
    const handleAgentSlotPress = React.useCallback((slot: AgentBookingSlotOption, index: number, sourceMessage?: AgentMessage | null) => {
        const source = sourceMessage || latestAgentVisualMessage;
        const doctor = source?.recommendedDoctors?.[0] || null;
        const doctorId = typeof doctor?.id === 'string' ? doctor.id.trim() : '';

        if (
            doctorId &&
            isVoiceSessionActive &&
            slot.id &&
            slot.label
        ) {
            const doctorFirstName = doctor?.firstName || '';
            const doctorLastName = doctor?.lastName || '';
            const doctorName = getDoctorDisplayName(
                {
                    firstName: doctorFirstName,
                    lastName: doctorLastName,
                    fullName: `${doctorFirstName} ${doctorLastName}`.trim(),
                },
                { includePrefix: true, fallbackName: 'Doctor' }
            );
            router.push({
                pathname: '/confirm-consultation',
                params: {
                    doctorId,
                    slotId: slot.id,
                    doctorName,
                    doctorSpecialization: doctor?.specialization || source?.recommendedDepartment?.label || '',
                    doctorCity: doctor?.city || '',
                    doctorFee: doctor?.fee || '500',
                    concern: source?.recommendedDepartment?.label || 'General Assistant',
                    slotDate: slot.date || '',
                    slotStartTime: slot.startTime || '',
                    slotEndTime: slot.endTime || '',
                    conversationId: agentConversationIdRef.current || '',
                },
            });
            return;
        }

        void callHomeAgent(`Confirm this exact slot (ID: ${slot.id}): ${slot.label}`, {
            replyInVoice: isVoiceSessionActive,
        });
    }, [callHomeAgent, isVoiceSessionActive, latestAgentVisualMessage, router]);
    const showInitialHomeSkeleton = loading && doctorsData.length === 0;
    const agentSheetBottomPadding = Math.max(insets.bottom + 12, 16);
    const agentSheetEffectiveBottomPadding = isKeyboardVisible ? 0 : agentSheetBottomPadding;
    const keyboardComposerGap = 24;
    const androidKeyboardLift = Platform.OS === 'android' && isChatInputActive && isKeyboardVisible
        ? Math.max(0, keyboardHeight - insets.bottom + keyboardComposerGap)
        : 0;

    if (showInitialHomeSkeleton) {
        return (
            <ScrollView
                contentContainerStyle={styles.container}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isPullRefreshing}
                        onRefresh={handleManualRefresh}
                        colors={[theme.tint]}
                        tintColor={theme.tint}
                    />
                }
            >
                <HomeTabSkeleton theme={theme} />
            </ScrollView>
        );
    }

    const AgentSheetWrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
    const agentSheetWrapperProps =
        Platform.OS === 'ios'
            ? { behavior: 'padding' as const, keyboardVerticalOffset: Math.max(0, insets.top - 2) }
            : {};

    return (
        <ScrollView
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            onScroll={handleHomeScroll}
            scrollEventThrottle={16}
            refreshControl={
                <RefreshControl
                    refreshing={isPullRefreshing}
                    onRefresh={handleManualRefresh}
                    colors={[theme.tint]}
                    tintColor={theme.tint}
                />
            }
        >

            <View style={[styles.aiCard, { shadowColor: '#0C2E22' }]}>
                <View style={styles.aiHeaderRow}>
                    <View style={styles.aiHeadingBlock}>
                        <Text style={styles.aiTitle}>{t('home.aiTitle', { name: aiTitleNameSuffix })}</Text>
                        <Text style={styles.aiSubtitle}>{t('home.aiSubtitle')}</Text>
                    </View>
                    {isProUser ? (
                        <View style={styles.aiProBadge}>
                            <Text style={styles.aiProBadgeText}>PRO</Text>
                        </View>
                    ) : (
                        <TouchableOpacity style={styles.aiUpgradeButton} activeOpacity={0.86} onPress={handleOpenUpgradeToPro}>
                            <Text style={styles.aiUpgradeButtonText}>{t('home.upgrade')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <View
                    style={[
                        styles.aiInputWrap,
                        isListening && styles.aiInputWrapListening,
                    ]}
                >
                    <TextInput
                        style={styles.aiInput}
                        placeholder={t('home.symptomPlaceholder')}
                        placeholderTextColor="#8EA79A"
                        value={symptomInput}
                        onChangeText={setSymptomInput}
                        onSubmitEditing={() => handleSymptomSubmit()}
                        returnKeyType="send"
                    />
                    <Animated.View
                        style={[
                            styles.micButtonPulseWrap,
                            shouldPulseMicButton && { transform: [{ scale: voicePulse }] },
                        ]}
                    >
                        <TouchableOpacity
                            style={[
                                styles.micButton,
                                shouldEmphasizeVoiceCta ? styles.micButtonVoice : styles.micButtonSend,
                                isListening
                                    ? styles.micButtonListening
                                    : { backgroundColor: theme.tint },
                            ]}
                            onPress={() => {
                                void handleMicPress();
                            }}
                            activeOpacity={0.9}
                        >
                            {shouldEmphasizeVoiceCta ? (
                                <View style={styles.micButtonVoiceContent}>
                                    <Mic size={20} color="#fff" />
                                    <Text style={styles.micButtonVoiceText}>
                                        {isListening ? t('home.listening') : t('home.voice')}
                                    </Text>
                                </View>
                            ) : (
                                <Send size={20} color="#fff" />
                            )}
                        </TouchableOpacity>
                    </Animated.View>
                </View>
                <Text style={styles.aiAssistHint}>
                    {t('home.aiAssistHint')}
                </Text>
                {shouldShowVoiceDoctorCard ? (
                    <View style={[styles.voiceLiveCard, { borderColor: theme.successBorder, backgroundColor: theme.cardBackground }]}>
                        <View style={styles.voiceLiveHeader}>
                            <View style={styles.voiceLiveDoctorWrap}>
                                <Animated.View
                                    style={[
                                        styles.voiceLiveDoctorPulse,
                                        { backgroundColor: theme.tint + '30', transform: [{ scale: voicePulse }] },
                                    ]}
                                />
                                <View
                                    style={[
                                        styles.voiceLiveDoctorAvatar,
                                        { backgroundColor: 'transparent' },
                                    ]}
                                >
                                    <Doctor3DIcon
                                        size={34}
                                        accentColor={isListening || isVoiceReplyPlaying || isVoiceAwaitingResponse ? theme.tint : '#7B8E99'}
                                        speaking={isVoiceReplyPlaying}
                                        mouthScale={doctorMouthScale}
                                        mouthScaleY={doctorMouthScaleY}
                                    />
                                </View>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.voiceLiveTitle, { color: theme.text }]}>
                                    Voice Assistant
                                </Text>
                                <Text style={[styles.voiceLiveSubtitle, { color: theme.textSecondary }]}>
                                    {isListening
                                        ? 'Listening now...'
                                        : isVoiceAwaitingResponse
                                            ? 'Processing your query and generating voice response...'
                                        : isVoiceReplyPlaying
                                            ? 'AI is replying in voice...'
                                            : voiceStatusText}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={[
                                    styles.voiceLiveActionBtn,
                                    { backgroundColor: isVoiceSessionActive ? '#E0565B' : theme.tint },
                                ]}
                                onPress={() => {
                                    void handleMicPress(true);
                                }}
                                activeOpacity={0.88}
                            >
                                <Text style={styles.voiceLiveActionBtnText}>{isVoiceSessionActive ? 'Stop' : 'Start'}</Text>
                            </TouchableOpacity>
                        </View>
                        {isVoiceAwaitingResponse ? (
                            <View style={[styles.voiceLiveThinkingRow, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                                <ActivityIndicator size="small" color={theme.tint} />
                                <Text style={[styles.voiceLiveThinkingText, { color: theme.textSecondary }]}>
                                    AI doctor is thinking...
                                </Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </View>

            <Modal
                visible={isAgentConversationVisible}
                animationType="slide"
                transparent={false}
                presentationStyle="fullScreen"
                statusBarTranslucent={false}
                onRequestClose={handleCloseAgentPanel}
            >
                <AgentSheetWrapper
                    style={styles.fullScreenAgentWrap}
                    {...agentSheetWrapperProps}
                >
                    <View
                        style={[
                            styles.bottomSheetContainer,
                            styles.bottomSheetContainerFullScreen,
                            {
                                backgroundColor: theme.cardBackground,
                                borderColor: theme.borderColor,
                                height: '100%',
                                paddingTop: Math.max(insets.top, 8),
                                paddingBottom: agentSheetEffectiveBottomPadding,
                                marginBottom: androidKeyboardLift,
                                marginHorizontal: 0,
                                maxWidth: undefined,
                            },
                        ]}
                    >


                        {/* Header */}
                        <View style={[styles.bottomSheetHeader, { borderBottomColor: theme.borderColor }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.bottomSheetTitle, { color: theme.text }]}>AI Voice Assistant</Text>
                                <Text style={[styles.bottomSheetSubtitle, { color: theme.textSecondary }]}>
                                    Share symptoms naturally and get guided voice support
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={[styles.bottomSheetCloseBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                                onPress={handleCloseAgentPanel}
                                activeOpacity={0.85}
                            >
                                <X size={16} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {isAgentSending ? (
                            <View style={[styles.premiumWaitCard, { backgroundColor: theme.background, borderColor: theme.successBorder }]}>
                                <View style={styles.premiumWaitRow}>
                                    <Text style={[styles.premiumWaitTitle, { color: theme.text }]}>AI Doctor is preparing your response</Text>
                                    <View style={styles.premiumWaitDots}>
                                        <Animated.View style={[styles.premiumWaitDot, { backgroundColor: theme.tint, opacity: premiumWaitPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />
                                        <Animated.View style={[styles.premiumWaitDot, { backgroundColor: theme.tint, opacity: premiumWaitPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }]} />
                                        <Animated.View style={[styles.premiumWaitDot, { backgroundColor: theme.tint, opacity: premiumWaitPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />
                                    </View>
                                </View>
                                <View style={[styles.premiumWaitTrack, { backgroundColor: theme.borderColor }]}>
                                    <Animated.View
                                        style={[
                                            styles.premiumWaitFill,
                                            {
                                                backgroundColor: theme.tint,
                                                transform: [
                                                    {
                                                        scaleX: premiumWaitPulse.interpolate({
                                                            inputRange: [0, 1],
                                                            outputRange: [0.35, 1],
                                                        }),
                                                    },
                                                ],
                                            },
                                        ]}
                                    />
                                </View>
                            </View>
                        ) : null}



                        {/* Scrollable Messages */}
                        <ScrollView
                            ref={agentScrollRef}
                            style={styles.bottomSheetScroll}
                            contentContainerStyle={[
                                styles.bottomSheetScrollContent,
                                isChatInputActive && isKeyboardVisible
                                    ? { paddingBottom: 28 }
                                    : null,
                            ]}
                            showsVerticalScrollIndicator={true}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                            onScrollBeginDrag={() => {
                                if (isChatInputActive) {
                                    Keyboard.dismiss();
                                }
                            }}
                        >
                            {shouldShowVoiceOnlyPanel ? (
                                <>
                                <LinearGradient
                                    colors={[theme.background, theme.cardBackground, theme.background]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={[styles.voiceListeningCard, { borderColor: theme.successBorder }]}
                                >
                                    <View style={[styles.voiceListeningBadge, { backgroundColor: doctorVoiceAura, borderColor: doctorVoiceAccent + '55' }]}>
                                        <View style={[styles.voiceListeningBadgeDot, { backgroundColor: doctorVoiceAccent }]} />
                                        <Text style={[styles.voiceListeningBadgeText, { color: doctorVoiceAccent }]}>
                                            {isListening ? 'Listening' : isVoiceReplyPlaying ? 'Speaking' : 'Voice Assistant'}
                                        </Text>
                                    </View>
                                    <View style={[styles.voiceListeningPromptCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                        <Text style={[styles.voiceListeningPromptText, { color: theme.text }]}>
                                            {isListening
                                                ? "I'm listening. Tell me what's bothering you."
                                                : isVoiceReplyPlaying
                                                    ? 'AI doctor is replying now.'
                                                    : 'Speak naturally. I will guide you like a doctor.'}
                                        </Text>
                                    </View>

                                    <View style={styles.voiceListeningCenter}>
                                        <View style={styles.voiceRobotAvatarWrap}>
                                            <View style={[styles.voiceRobotAvatar, { borderColor: doctorVoiceAccent, backgroundColor: theme.cardBackground }]}>
                                                <View style={styles.voiceDoctorImageFrame}>
                                                    <Doctor3DIcon
                                                        size={60}
                                                        accentColor={doctorVoiceAccent}
                                                        speaking={isVoiceReplyPlaying}
                                                        mouthScale={doctorMouthScale}
                                                        mouthScaleY={doctorMouthScaleY}
                                                    />
                                                    <Animated.View
                                                        style={[
                                                            styles.voiceDoctorScanLine,
                                                            {
                                                                backgroundColor: doctorScanColor,
                                                                opacity: doctorHaloOpacity,
                                                                transform: [{ translateY: doctorScanTranslate }],
                                                            },
                                                        ]}
                                                    />
                                                    <Animated.View
                                                        style={[
                                                            styles.voiceDoctorSpecular,
                                                            {
                                                                opacity: doctorSparkleOpacity,
                                                                transform: [{ scale: doctorSparkleScale }],
                                                            },
                                                        ]}
                                                    />
                                                </View>
                                                <Animated.View
                                                    style={[
                                                        styles.voiceDoctorSparkleDot,
                                                        {
                                                            backgroundColor: doctorDotColor,
                                                            opacity: doctorSparkleOpacity,
                                                            transform: [{ scale: doctorSparkleScale }],
                                                        },
                                                    ]}
                                                />
                                            </View>
                                        </View>

                                        <Text style={[styles.voiceRobotTitle, { color: theme.text, textAlign: 'center' }]}>Doctor Voice Mode</Text>
                                        <Text style={[styles.voiceRobotSubtitle, { color: theme.textSecondary, textAlign: 'center' }]}>
                                            {voiceRobotWaveLabel}
                                        </Text>

                                        <View
                                            style={[
                                                styles.voiceRobotBarsRow,
                                                {
                                                    opacity: isDoctorVoiceEngaged ? 1 : 0.45,
                                                    justifyContent: 'center',
                                                },
                                            ]}
                                        >
                                            <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                            <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoiceSecondaryBar, transform: [{ scaleY: robotBarScaleB }] }]} />
                                            <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                            <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoiceSecondaryBar, transform: [{ scaleY: robotBarScaleB }] }]} />
                                            <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                        </View>

                                        <View style={styles.voiceListeningStatusRow}>
                                            <View style={[styles.voiceRobotWaveDot, { backgroundColor: doctorVoiceAccent, opacity: isDoctorVoiceEngaged ? 1 : 0.55 }]} />
                                            <Text style={[styles.voiceRobotWaveStatusText, { color: doctorVoiceAccent }]}>
                                                {shouldShowVoiceUpgradePrompt
                                                    ? 'Voice limit reached'
                                                    : isVoiceReplyPlaying
                                                        ? 'Speaking now'
                                                        : isListening
                                                            ? 'Live listening'
                                                            : isVoiceAwaitingResponse
                                                                ? 'Generating response'
                                                                : isVoiceAutoSending
                                                                    ? 'Sending your message...'
                                                                    : 'Standby'}
                                            </Text>
                                        </View>

                                        {isVoiceAwaitingResponse ? (
                                            <View style={[styles.voicePendingResponseRow, { borderColor: doctorVoiceAccent + '55', backgroundColor: doctorVoiceAura }]}>
                                                <ActivityIndicator size="small" color={doctorVoiceAccent} />
                                                <Text style={[styles.voicePendingResponseText, { color: doctorVoiceAccent }]}>
                                                    Generating smart medical response...
                                                </Text>
                                            </View>
                                        ) : null}

                                        <Text style={[styles.voiceRobotHint, { color: theme.textSecondary, textAlign: 'center' }]}>
                                            Tap Text to view full chat history.
                                        </Text>
                                    </View>

                                    <View style={styles.voiceListeningActionRow}>
                                        <TouchableOpacity
                                            style={[styles.voiceListeningActionBtn, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                            onPress={() => {
                                                if (voiceSessionActiveRef.current) {
                                                    void stopContinuousVoiceSession(false);
                                                }
                                                setIsChatInputActive(true);
                                            }}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={[styles.voiceListeningActionBtnText, { color: theme.textSecondary }]}>Text</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.voiceListeningMicBtn,
                                                { backgroundColor: isVoiceSessionActive ? theme.error : theme.tint },
                                            ]}
                                            onPress={() => {
                                                void handleMicPress(true);
                                            }}
                                            activeOpacity={0.88}
                                        >
                                            <Mic size={22} color="#fff" />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.voiceListeningActionBtn, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                            onPress={handleCloseAgentPanel}
                                            activeOpacity={0.8}
                                        >
                                            <X size={16} color={theme.textSecondary} />
                                        </TouchableOpacity>
                                    </View>

                                    {shouldShowVoiceUpgradePrompt ? (
                                        <View style={[styles.voiceLimitCard, { backgroundColor: theme.tint + '16', borderColor: theme.tint + '66' }]}>
                                            <View style={styles.voiceLimitHeaderRow}>
                                                <View style={[styles.voiceLimitBadge, { backgroundColor: theme.tint + '24', borderColor: theme.tint + '77' }]}>
                                                    <Text style={[styles.voiceLimitBadgeText, { color: theme.tint }]}>PRO</Text>
                                                </View>
                                                <Text style={[styles.voiceLimitTitle, { color: theme.text }]}>Daily voice limit reached</Text>
                                            </View>
                                            <Text style={[styles.voiceLimitText, { color: theme.textSecondary }]}>
                                                Upgrade to Pro to continue natural voice chat and faster AI guidance.
                                            </Text>
                                            <TouchableOpacity
                                                style={[styles.voiceLimitButton, { backgroundColor: theme.tint }]}
                                                activeOpacity={0.88}
                                                onPress={handleOpenUpgradeToPro}
                                            >
                                                <Text style={styles.voiceLimitButtonText}>Upgrade to Pro</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : null}
                                    {latestVoiceBookingConfirmation ? (
                                        <View style={[styles.voiceBookingConfirmationCard, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                                            <Text style={[styles.voiceBookingConfirmationTitle, { color: theme.success }]}>
                                                Appointment confirmed
                                            </Text>
                                            <Text style={[styles.voiceBookingConfirmationText, { color: theme.text }]}>
                                                {latestVoiceBookingConfirmation.bookingConfirmationDoctorName
                                                    ? `Doctor: ${latestVoiceBookingConfirmation.bookingConfirmationDoctorName}`
                                                    : 'Doctor confirmed'}
                                            </Text>
                                            {latestVoiceBookingConfirmation.bookingConfirmationSlotLabel ? (
                                                <Text style={[styles.voiceBookingConfirmationSubText, { color: theme.textSecondary }]}>
                                                    {latestVoiceBookingConfirmation.bookingConfirmationSlotLabel}
                                                </Text>
                                            ) : null}
                                        </View>
                                    ) : null}
                                </LinearGradient>
                                {latestAgentVisualMessage?.recommendedDoctors && latestAgentVisualMessage.recommendedDoctors.length > 0 ? (
                                    <>
                                        <Text style={[styles.voiceRobotCardsTitle, { color: theme.textSecondary }]}>
                                            Live doctor recommendations
                                        </Text>
                                        <ScrollView
                                            horizontal
                                            showsHorizontalScrollIndicator={false}
                                            style={styles.agentDoctorCardsScroll}
                                            contentContainerStyle={styles.agentDoctorCardsContent}
                                            snapToInterval={(isLargeScreen ? 320 : windowWidth * 0.78) + 12}
                                            decelerationRate="fast"
                                        >
                                            {latestAgentVisualMessage.recommendedDoctors.map((doc: any, index: number) => (
                                                <View
                                                    key={String(doc._id || doc.id || `agent-doc-${index}`)}
                                                    style={[
                                                        styles.agentDoctorCard,
                                                        {
                                                            backgroundColor: theme.background,
                                                            borderColor: theme.borderColor,
                                                            width: isLargeScreen ? 320 : windowWidth * 0.78,
                                                        },
                                                    ]}
                                                >
                                                    <View style={styles.agentDoctorCardTop}>
                                                        <Image
                                                            source={{ uri: getImageUrl(doc.image || doc.profiles?.profile_picture) || 'https://i.pravatar.cc/100?img=11' }}
                                                            style={styles.agentDoctorCardImage}
                                                        />
                                                        <View style={styles.agentDoctorCardInfo}>
                                                            <View style={styles.agentDoctorCardNameRow}>
                                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                                    <Text style={[styles.agentDoctorCardName, { color: theme.text }]} numberOfLines={1}>
                                                                        {getDoctorDisplayName(doc, { includePrefix: true, fallbackName: 'Specialist' })}
                                                                    </Text>
                                                                    {(doc.is_verified || doc.isVerified) && (
                                                                        <CheckCircle size={12} color={theme.success} fill={theme.success + '20'} />
                                                                    )}
                                                                </View>
                                                                <View style={[styles.agentDoctorCardRating, { backgroundColor: theme.successLight }]}>
                                                                    <Star size={10} color={theme.success} fill={theme.success} />
                                                                    <Text style={[styles.agentDoctorCardRatingText, { color: theme.success }]}>{doc.rating || '4.5'}</Text>
                                                                </View>
                                                            </View>
                                                            <Text style={[styles.agentDoctorCardSpec, { color: theme.textSecondary }]} numberOfLines={1}>
                                                                {doc.specialization || doc.specialty || 'Specialist'}
                                                            </Text>
                                                            <View style={styles.agentDoctorCardMetaRow}>
                                                                <Text style={[styles.agentDoctorCardMeta, { color: theme.textSecondary }]}>{doc.experience || '3+ Years'} Exp.</Text>
                                                                <Text style={[styles.agentDoctorCardMeta, { color: theme.textSecondary }]}>{doc.city || 'India'}</Text>
                                                            </View>
                                                        </View>
                                                    </View>
                                                    <TouchableOpacity
                                                        style={[styles.agentDoctorCardBtn, { backgroundColor: theme.tint }]}
                                                        onPress={() => {
                                                            setIsAgentConversationVisible(false);
                                                            handleConsultDoctor(doc._id || doc.id);
                                                        }}
                                                        activeOpacity={0.8}
                                                    >
                                                        <Text style={styles.agentDoctorCardBtnText}>{t('home.consultNow')}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ))}
                                        </ScrollView>
                                    </>
                                ) : null}
                                {latestAgentVisualMessage?.bookingSlotOptions && latestAgentVisualMessage.bookingSlotOptions.length > 0 ? (
                                    <View style={[styles.agentSlotListWrap, styles.voiceRobotSlotListWrap, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                        <Text style={[styles.agentSlotListTitle, { color: theme.text }]}>Available slots</Text>
                                        {latestAgentVisualMessage.bookingPrompt ? (
                                            <Text style={[styles.agentSlotListHint, { color: theme.textSecondary }]}>{latestAgentVisualMessage.bookingPrompt}</Text>
                                        ) : null}
                                        {latestAgentVisualMessage.bookingSlotOptions.map((slot, index) => (
                                                <TouchableOpacity
                                                    key={String(slot.id || `slot-${index}`)}
                                                    style={[styles.agentSlotItem, { borderColor: theme.borderColor }]}
                                                    activeOpacity={0.82}
                                                    disabled={isAgentSending}
                                                    onPress={() => handleAgentSlotPress(slot, index, latestAgentVisualMessage)}
                                                >
                                                <View style={styles.agentSlotHeaderRow}>
                                                    <Text style={[styles.agentSlotIndexPill, { color: theme.tint, backgroundColor: theme.successLight }]}>
                                                        Slot {index + 1}
                                                    </Text>
                                                    <Text style={[styles.agentSlotTapHint, { color: theme.textSecondary }]}>
                                                        Tap to book
                                                    </Text>
                                                </View>
                                                <Text style={[styles.agentSlotLabel, { color: theme.text }]} numberOfLines={2}>
                                                    {slot.label}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : null}
                                </>
                            ) : (
                                <>
                                    <View style={[styles.bottomSheetIntroCard, { backgroundColor: theme.background, borderColor: theme.successBorder, marginTop: 10, marginBottom: 20, marginHorizontal: 2 }]}>
                                        <View
                                            style={[
                                                styles.bottomSheetStatusPill,
                                                {
                                                    backgroundColor: isAgentSending || isListening || isVoiceSessionActive || isVoiceReplyPlaying
                                                        ? theme.successLight
                                                        : theme.cardBackground,
                                                    borderColor: isAgentSending || isListening || isVoiceSessionActive || isVoiceReplyPlaying
                                                        ? theme.successBorder
                                                        : theme.borderColor,
                                                },
                                            ]}
                                        >
                                            <Activity size={13} color={agentSheetStatusColor} />
                                            <Text style={[styles.bottomSheetStatusText, { color: agentSheetStatusColor }]}>
                                                {agentSheetStatusLabel}
                                            </Text>
                                        </View>
                                        <Text style={[styles.bottomSheetIntroTitle, { color: theme.text }]}>
                                            Speak naturally in Hindi or English for faster AI assistance.
                                        </Text>
                                        <Text style={[styles.bottomSheetIntroSubtitle, { color: theme.textSecondary }]}>
                                            CD4 AI listens, analyzes your condition, and recommends the best verified doctors near you.
                                        </Text>
                                    </View>

                                    {isTextAwaitingResponse ? (
                                        <View style={[styles.voiceRobotStageCard, { backgroundColor: theme.background, borderColor: theme.successBorder, marginBottom: 18 }]}>
                                            <View style={styles.voiceRobotTopRow}>
                                                <View style={styles.voiceRobotAvatarWrap}>
                                                    <View style={[styles.voiceRobotAvatar, { borderColor: doctorVoiceAccent, backgroundColor: theme.cardBackground }]}>
                                                        <View style={styles.voiceDoctorImageFrame}>
                                                            <Doctor3DIcon
                                                                size={66}
                                                                accentColor={doctorVoiceAccent}
                                                                speaking={false}
                                                                mouthScale={doctorMouthScale}
                                                                mouthScaleY={doctorMouthScaleY}
                                                            />
                                                            <Animated.View
                                                                style={[
                                                                    styles.voiceDoctorScanLine,
                                                                    {
                                                                        backgroundColor: doctorScanColor,
                                                                        opacity: doctorHaloOpacity,
                                                                        transform: [{ translateY: doctorScanTranslate }],
                                                                    },
                                                                ]}
                                                            />
                                                            <Animated.View
                                                                style={[
                                                                    styles.voiceDoctorSpecular,
                                                                    {
                                                                        opacity: doctorSparkleOpacity,
                                                                        transform: [{ scale: doctorSparkleScale }],
                                                                    },
                                                                ]}
                                                            />
                                                        </View>
                                                    </View>
                                                </View>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={[styles.voiceRobotTitle, { color: theme.text }]}>AI Doctor Reviewing</Text>
                                                    <View style={[styles.voiceRobotStatusPill, { borderColor: doctorVoiceAccent, backgroundColor: doctorVoiceAura }]}>
                                                        <View style={[styles.voiceRobotStatusDot, { backgroundColor: doctorVoiceAccent }]} />
                                                        <Text style={[styles.voiceRobotStatusText, { color: doctorVoiceAccent }]}>
                                                            Preparing medical response
                                                        </Text>
                                                    </View>
                                                    <Text style={[styles.voiceRobotSubtitle, { color: theme.textSecondary }]}>{activeAgentProgressHint}</Text>
                                                </View>
                                            </View>
                                            <View
                                                style={[
                                                    styles.voiceRobotBarsRow,
                                                    {
                                                        opacity: 1,
                                                    },
                                                ]}
                                            >
                                                <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                                <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoiceSecondaryBar, transform: [{ scaleY: robotBarScaleB }] }]} />
                                                <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                                <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoiceSecondaryBar, transform: [{ scaleY: robotBarScaleB }] }]} />
                                                <Animated.View style={[styles.voiceRobotBar, { backgroundColor: doctorVoicePrimaryBar, transform: [{ scaleY: robotBarScaleA }] }]} />
                                            </View>
                                            <View style={styles.voiceRobotWaveStatusRow}>
                                                <View style={[styles.voiceRobotWaveDot, { backgroundColor: doctorVoiceAccent, opacity: 1 }]} />
                                                <Text style={[styles.voiceRobotWaveStatusText, { color: doctorVoiceAccent }]}>
                                                    Analyzing your typed message...
                                                </Text>
                                            </View>
                                        </View>
                                    ) : null}

                                    {agentMessages.map((message) => {
                                        const isVoiceStreamLiveMessage =
                                            message.role === 'ai' &&
                                            isAgentVoiceLiveStreaming &&
                                            Boolean(agentStreamingDraftMessageIdRef.current) &&
                                            agentStreamingDraftMessageIdRef.current === message.id;

                                        return (
                                        <View key={message.id}>
                                            <View
                                                style={[
                                                    styles.agentMessageRow,
                                                    message.role === 'user' ? styles.agentUserRow : styles.agentAiRow,
                                                ]}
                                            >
                                                <View
                                                    style={[
                                                        styles.agentMessageBubble,
                                                        message.role === 'user'
                                                            ? [styles.agentUserBubble, { backgroundColor: theme.tint }]
                                                            : [styles.agentAiBubble, { backgroundColor: theme.background, borderColor: theme.borderColor }],
                                                    ]}
                                                >
                                                    {message.role === 'user' ? (
                                                        <Text
                                                            style={[
                                                                styles.agentMessageText,
                                                                { color: '#FFFFFF' },
                                                            ]}
                                                        >
                                                            {message.text}
                                                        </Text>
                                                    ) : (
                                                        <>
                                                            {isVoiceStreamLiveMessage ? (
                                                                <View style={[styles.agentLiveBadge, { backgroundColor: theme.tint + '1F', borderColor: theme.tint + '55' }]}>
                                                                    <Text style={[styles.agentLiveBadgeText, { color: theme.tint }]}>LIVE</Text>
                                                                </View>
                                                            ) : null}
                                                            <Markdown
                                                                style={{
                                                                    body: { ...styles.agentMessageText, color: theme.text, lineHeight: 22 },
                                                                    paragraph: { marginBottom: 8 },
                                                                    strong: { color: theme.tint, fontWeight: '800' },
                                                                    bullet_list: { marginTop: 4 },
                                                                    list_item: { marginTop: 4 },
                                                                    table: { borderColor: theme.borderColor, borderWidth: 1, borderRadius: 8, marginVertical: 8 },
                                                                    tr: { borderBottomWidth: 1, borderBottomColor: theme.borderColor },
                                                                    td: { padding: 6 }
                                                                }}
                                                            >
                                                                {message.text}
                                                            </Markdown>
                                                            {message.role === 'ai' && (message.text.includes('Usage limit reached') || message.rateLimit?.blocked) && !message.rateLimit?.isPro && (
                                                                <TouchableOpacity
                                                                    style={[styles.chatUpgradeButton, { backgroundColor: theme.tint }]}
                                                                    activeOpacity={0.88}
                                                                    onPress={handleOpenUpgradeToPro}
                                                                >
                                                                    <Text style={styles.chatUpgradeButtonText}>Upgrade to Pro</Text>
                                                                </TouchableOpacity>
                                                            )}
                                                        </>
                                                    )}
                                                </View>
                                            </View>

                                            {message.role === 'ai' && message.bookingPrompt ? (
                                                <Text style={[styles.agentBookingPromptText, { color: theme.textSecondary }]}>{message.bookingPrompt}</Text>
                                            ) : null}

                                            {message.role === 'ai' && message.recommendedDoctors && message.recommendedDoctors.length > 0 && (
                                                <ScrollView
                                                    horizontal
                                                    showsHorizontalScrollIndicator={false}
                                                    style={styles.agentDoctorCardsScroll}
                                                    contentContainerStyle={styles.agentDoctorCardsContent}
                                                    snapToInterval={(isLargeScreen ? 320 : windowWidth * 0.78) + 12}
                                                    decelerationRate="fast"
                                                >
                                                    {message.recommendedDoctors.map((doc: any, index: number) => (
                                                        <View
                                                            key={String(doc._id || doc.id || `msg-doc-${message.id}-${index}`)}
                                                            style={[
                                                                styles.agentDoctorCard,
                                                                {
                                                                    backgroundColor: theme.background,
                                                                    borderColor: theme.borderColor,
                                                                    width: isLargeScreen ? 320 : windowWidth * 0.78
                                                                }
                                                            ]}
                                                        >
                                                            <View style={styles.agentDoctorCardTop}>
                                                                <Image
                                                                    source={{ uri: getImageUrl(doc.image || doc.profiles?.profile_picture) || 'https://i.pravatar.cc/100?img=11' }}
                                                                    style={styles.agentDoctorCardImage}
                                                                />
                                                                <View style={styles.agentDoctorCardInfo}>
                                                                    <View style={styles.agentDoctorCardNameRow}>
                                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                                            <Text style={[styles.agentDoctorCardName, { color: theme.text }]} numberOfLines={1}>
                                                                                {getDoctorDisplayName(doc, { includePrefix: true, fallbackName: 'Specialist' })}
                                                                            </Text>
                                                                            {doc.is_verified && (
                                                                                <CheckCircle size={12} color={theme.success} fill={theme.success + '20'} />
                                                                            )}
                                                                        </View>
                                                                        <View style={[styles.agentDoctorCardRating, { backgroundColor: theme.successLight }]}>
                                                                            <Star size={10} color={theme.success} fill={theme.success} />
                                                                            <Text style={[styles.agentDoctorCardRatingText, { color: theme.success }]}>{doc.rating || '4.5'}</Text>
                                                                        </View>
                                                                    </View>
                                                                    <Text style={[styles.agentDoctorCardSpec, { color: theme.textSecondary }]} numberOfLines={1}>
                                                                        {doc.specialization || doc.specialty || 'Specialist'}
                                                                    </Text>
                                                                    <View style={styles.agentDoctorCardMetaRow}>
                                                                        <Text style={[styles.agentDoctorCardMeta, { color: theme.textSecondary }]}>{doc.experience || '3+ Years'} Exp.</Text>
                                                                        <Text style={[styles.agentDoctorCardMeta, { color: theme.textSecondary }]}>{doc.city || 'India'}</Text>
                                                                    </View>
                                                                </View>
                                                            </View>
                                                            <TouchableOpacity
                                                                style={[styles.agentDoctorCardBtn, { backgroundColor: theme.tint }]}
                                                                onPress={() => {
                                                                    setIsAgentConversationVisible(false);
                                                                    handleConsultDoctor(doc._id || doc.id);
                                                                }}
                                                                activeOpacity={0.8}
                                                            >
                                                                <Text style={styles.agentDoctorCardBtnText}>{t('home.consultNow')}</Text>
                                                            </TouchableOpacity>
                                                        </View>
                                                    ))}
                                                </ScrollView>
                                            )}
                                            {message.role === 'ai' && message.bookingSlotOptions && message.bookingSlotOptions.length > 0 && (
                                                <View style={[styles.agentSlotListWrap, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                                    <Text style={[styles.agentSlotListTitle, { color: theme.text }]}>Available slots</Text>
                                                    {message.bookingSlotOptions.map((slot, index) => (
                                                        <TouchableOpacity
                                                            key={String(slot.id || `msg-slot-${message.id}-${index}`)}
                                                            style={[styles.agentSlotItem, { borderColor: theme.borderColor }]}
                                                            activeOpacity={0.82}
                                                            disabled={isAgentSending}
                                                            onPress={() => handleAgentSlotPress(slot, index, message)}
                                                        >
                                                            <View style={styles.agentSlotHeaderRow}>
                                                                <Text style={[styles.agentSlotIndexPill, { color: theme.tint, backgroundColor: theme.successLight }]}>
                                                                    Slot {index + 1}
                                                                </Text>
                                                                <Text style={[styles.agentSlotTapHint, { color: theme.textSecondary }]}>
                                                                    Tap to book
                                                                </Text>
                                                            </View>
                                                            <Text style={[styles.agentSlotLabel, { color: theme.text }]} numberOfLines={2}>
                                                                {slot.label}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    );
                                    })}

                                    {showAgentTypingBubble ? (
                                        <View style={[styles.agentMessageRow, styles.agentAiRow]}>
                                            <View style={[styles.agentMessageBubble, styles.agentAiBubble, styles.agentTypingBubble, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                                <ActivityIndicator size="small" color={theme.tint} />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={[styles.agentTypingText, { color: theme.textSecondary }]}>AI Agent is working...</Text>
                                                    <Text style={[styles.agentTypingSubText, { color: theme.textSecondary }]}>{activeAgentProgressHint}</Text>
                                                </View>
                                            </View>
                                        </View>
                                    ) : null}
                                </>
                            )}
                        </ScrollView>

                        {/* Bottom Voice/Chat Bar */}
                        <View
                            style={[
                                styles.bottomSheetVoiceBar,
                                { borderColor: theme.borderColor, backgroundColor: theme.background },
                                isChatInputActive && isKeyboardVisible
                                    ? { marginBottom: 12 }
                                    : null,
                            ]}
                        >
                            {!isChatInputActive ? (
                                shouldShowVoiceUpgradePrompt ? (
                                    <TouchableOpacity
                                        style={[styles.bottomSheetUpgradeButton, { backgroundColor: theme.tint }]}
                                        activeOpacity={0.88}
                                        onPress={handleOpenUpgradeToPro}
                                    >
                                        <View style={styles.bottomSheetUpgradeTextWrap}>
                                            <Text style={styles.bottomSheetUpgradeTitle}>Upgrade to Pro</Text>
                                            <Text style={styles.bottomSheetUpgradeSubtitle}>Continue voice chat</Text>
                                        </View>
                                    </TouchableOpacity>
                                ) : (
                                <>
                                    <TouchableOpacity
                                        style={[styles.bottomSheetMicBtn, { backgroundColor: isVoiceSessionActive ? theme.error : theme.tint }]}
                                        onPress={() => {
                                            void handleMicPress(true);
                                        }}
                                        activeOpacity={0.85}
                                    >
                                        <Mic size={20} color="#fff" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[
                                            styles.bottomSheetVoiceMetaCard,
                                            { backgroundColor: theme.cardBackground, borderColor: theme.borderColor },
                                        ]}
                                        onPress={() => {
                                            if (voiceSessionActiveRef.current) {
                                                void stopContinuousVoiceSession(false);
                                            }
                                            setIsChatInputActive(true);
                                        }}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.bottomSheetVoiceMetaTopRow}>
                                            <Text style={[styles.bottomSheetVoiceTitle, { color: theme.text }]}>
                                                {bottomVoiceTitle}
                                            </Text>
                                            <Text style={[styles.bottomSheetTextModeHint, { color: theme.tint }]}>
                                                Tap for text
                                            </Text>
                                        </View>
                                        <Text style={[styles.bottomSheetVoiceHint, { color: theme.textSecondary }]}>
                                            {isListening ? 'Speak now, I am listening...' : voicePanelStatusText}
                                        </Text>
                                        <View style={styles.bottomSheetMiniWaveRow}>
                                            <Animated.View style={[styles.bottomSheetMiniWaveBar, { backgroundColor: theme.tint, transform: [{ scaleY: robotBarScaleA }] }]} />
                                            <Animated.View style={[styles.bottomSheetMiniWaveBar, { backgroundColor: theme.tint, transform: [{ scaleY: robotBarScaleB }] }]} />
                                            <Animated.View style={[styles.bottomSheetMiniWaveBar, { backgroundColor: theme.tint, transform: [{ scaleY: robotBarScaleA }] }]} />
                                        </View>
                                        {isVoiceReplyPlaying ? (
                                            <View style={styles.bottomDoctorSpeakingRow}>
                                                <View style={styles.bottomDoctorWrap}>
                                                    <Animated.View
                                                        style={[
                                                            styles.bottomDoctorPulse,
                                                            { backgroundColor: theme.tint + '30', transform: [{ scale: voicePulse }] },
                                                        ]}
                                                    />
                                                    <View style={[styles.bottomDoctorAvatar, { backgroundColor: 'transparent' }]}>
                                                        <Doctor3DIcon
                                                            size={24}
                                                            accentColor={theme.tint}
                                                            speaking={isVoiceReplyPlaying}
                                                            mouthScale={doctorMouthScale}
                                                            mouthScaleY={doctorMouthScaleY}
                                                        />
                                                    </View>
                                                </View>
                                                <Text style={[styles.bottomDoctorSpeakingText, { color: theme.textSecondary }]}>
                                                    Doctor is speaking...
                                                </Text>
                                            </View>
                                        ) : null}
                                    </TouchableOpacity>
                                </>
                                )
                            ) : (
                                <View style={[styles.bottomSheetComposerCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                    <View style={styles.bottomSheetComposerHeader}>
                                        <View style={styles.bottomSheetComposerTitleWrap}>
                                            <Text style={[styles.bottomSheetComposerTitle, { color: theme.text }]}>Chat with AI Doctor</Text>
                                            <Text style={[styles.bottomSheetComposerSubtitle, { color: theme.textSecondary }]}>
                                                Describe symptoms naturally or ask for the next step.
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.bottomSheetComposerModeBtn, { borderColor: theme.borderColor }]}
                                            onPress={() => {
                                                Keyboard.dismiss();
                                                setIsChatInputActive(false);
                                            }}
                                            activeOpacity={0.75}
                                        >
                                            <X size={14} color={theme.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.bottomSheetComposerRow}>
                                        <View style={[styles.bottomSheetTextInputWrap, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                            <TextInput
                                                style={[styles.bottomSheetTextInput, { color: theme.text }]}
                                                placeholder="Type symptoms, doctor name, city..."
                                                placeholderTextColor={theme.textSecondary}
                                                value={modalTextInput}
                                                onChangeText={setModalTextInput}
                                                onSubmitEditing={handleModalTextSubmit}
                                                returnKeyType="send"
                                                autoFocus
                                                multiline
                                            />
                                        </View>
                                        <TouchableOpacity
                                            style={[
                                                styles.bottomSheetMicBtn,
                                                {
                                                    backgroundColor: modalTextInput.trim() ? theme.tint : theme.background,
                                                    borderColor: theme.borderColor,
                                                    borderWidth: modalTextInput.trim() ? 0 : 1,
                                                },
                                            ]}
                                            onPress={() => {
                                                if (modalTextInput.trim()) {
                                                    handleModalTextSubmit();
                                                    return;
                                                }
                                                Keyboard.dismiss();
                                                setIsChatInputActive(false);
                                            }}
                                            activeOpacity={0.85}
                                        >
                                            {modalTextInput.trim() ? (
                                                <Send size={18} color="#fff" />
                                            ) : (
                                                <Mic size={20} color={theme.textSecondary} />
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                </AgentSheetWrapper>
            </Modal>

            <View style={styles.sectionHeader}>
                <Text style={[styles.heading, { color: theme.text }]}>{t('home.chooseConcern')}</Text>
                <TouchableOpacity onPress={handleViewAllConcernsPress}>
                    <Text style={[styles.viewAll, { color: theme.tint }]}>{t('common.viewAll')}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.concernGrid}>
                {concernCards.map((concern, index) => (
                    <AnimatedConcernCard
                        key={concern.id}
                        concern={concern}
                        theme={theme}
                        index={index}
                        onPress={() => handleConcernPress(concern.label)}
                    />
                ))}
            </View>

            <View style={[styles.urgentCard, { backgroundColor: theme.cardBackground, borderColor: theme.successBorder, marginBottom: 24 }]}>
                <View>
                    <Text style={[styles.urgentTitle, { color: theme.text }]}>{t('home.urgentTitle')}</Text>
                    <Text style={[styles.urgentSubTitle, { color: theme.textSecondary }]}>{t('home.urgentSubtitle')}</Text>
                </View>
                <TouchableOpacity
                    style={[
                        styles.urgentButton,
                        { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                    ]}
                    onPress={() => handleConsultDoctor()}
                >
                    <Text style={[styles.urgentButtonText, { color: theme.tint }]}>{t('home.consultNow')}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.promoCarouselWrap}>
                <ScrollView
                    ref={promoCarouselRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    alwaysBounceHorizontal={false}
                    overScrollMode="never"
                    decelerationRate="normal"
                    directionalLockEnabled
                    nestedScrollEnabled
                    scrollEventThrottle={16}
                    style={styles.promoCarouselScroll}
                    contentContainerStyle={styles.promoCarouselContent}
                    onScrollBeginDrag={handlePromoScrollBeginDrag}
                    onMomentumScrollEnd={handlePromoMomentumEnd}
                    onScrollEndDrag={handlePromoMomentumEnd}
                >
                    {promoLoopCards.map((card, index) => {
                        const tonePalette = HOME_PROMO_TONES[card.tone][isDarkTheme ? 'dark' : 'light'];
                        const miniCardBg = isDarkTheme ? 'rgba(8, 21, 17, 0.72)' : 'rgba(255, 255, 255, 0.92)';
                        const miniCardRatingBg = isDarkTheme ? 'rgba(22, 66, 52, 0.62)' : 'rgba(255, 255, 255, 0.95)';
                        const previewDoctors = promoDoctorsByAction[card.action] || [];
                        const isDoctorPromoCard = card.action === 'best_doctors' || card.action === 'best_doctors_global';
                        const shouldShowDoctorPromoShimmer =
                            isDoctorPromoCard && (loading || isDoctorsFetching) && previewDoctors.length === 0;
                        const shouldHideDescriptionForDoctorCards =
                            isDoctorPromoCard;
                        const shouldHideDoctorCardCta =
                            isDoctorPromoCard;
                        return (
                            <TouchableOpacity
                                key={`${card.id}-${index}`}
                                activeOpacity={0.92}
                                onPress={() => handlePromoCardAction(card.action)}
                                style={[
                                    styles.promoCardTouch,
                                    {
                                        width: promoCardWidth,
                                        marginRight: index === promoLoopCards.length - 1 ? 0 : promoCardGap,
                                    },
                                ]}
                            >
                                <LinearGradient
                                    colors={tonePalette.gradient}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={[styles.promoCardSurface, { borderColor: tonePalette.border }]}
                                >
                                    <View style={styles.promoCardTopRow}>
                                        <View style={[styles.promoCardTag, { backgroundColor: tonePalette.badgeBg }]}>
                                            <Text style={[styles.promoCardTagText, { color: tonePalette.badgeText }]}>{card.tag}</Text>
                                        </View>
                                        <View style={[styles.promoCardIconWrap, { backgroundColor: tonePalette.iconBg }]}>
                                            <card.Icon size={18} color={tonePalette.iconColor} />
                                        </View>
                                    </View>
                                    <Text numberOfLines={2} style={[styles.promoCardTitle, { color: tonePalette.title }]}>{card.title}</Text>
                                    {!shouldHideDescriptionForDoctorCards ? (
                                        <Text numberOfLines={3} style={[styles.promoCardDescription, { color: tonePalette.description }]}>{card.description}</Text>
                                    ) : null}
                                    {previewDoctors.length > 0 ? (
                                        <View style={styles.promoDoctorPreviewRow}>
                                            {previewDoctors.map((doctor, doctorIndex) => {
                                                const doctorId = String(doctor._id || resolveDoctorId(doctor) || `${card.id}-${doctorIndex}`);
                                                const doctorName = getDoctorDisplayName(doctor, { includePrefix: true, fallbackName: 'Specialist' });
                                                const ratingLabel = formatDoctorRatingLabel(doctor.rating);
                                                return (
                                                    <TouchableOpacity
                                                        key={doctorId}
                                                        activeOpacity={0.82}
                                                        onPress={() => handleOpenDoctorProfile(resolveDoctorId(doctor))}
                                                        style={[
                                                            styles.promoDoctorMiniCard,
                                                            { borderColor: `${tonePalette.border}CC`, backgroundColor: miniCardBg },
                                                        ]}
                                                    >
                                                        <Image
                                                            source={{ uri: getImageUrl(doctor.image) || 'https://i.pravatar.cc/100?img=11' }}
                                                            style={styles.promoDoctorMiniAvatar}
                                                        />
                                                        <View style={styles.promoDoctorMiniInfo}>
                                                            <Text numberOfLines={1} style={[styles.promoDoctorMiniName, { color: tonePalette.title }]}>
                                                                {doctorName}
                                                            </Text>
                                                            <Text numberOfLines={1} style={[styles.promoDoctorMiniMeta, { color: tonePalette.description }]}>
                                                                {doctor.specialization || 'Specialist'} • {doctor.city || 'India'}
                                                            </Text>
                                                        </View>
                                                        <View style={[styles.promoDoctorMiniRating, { backgroundColor: miniCardRatingBg }]}>
                                                            <Star size={10} color={tonePalette.iconColor} fill={tonePalette.iconColor} />
                                                            <Text style={[styles.promoDoctorMiniRatingText, { color: tonePalette.title }]}>{ratingLabel}</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    ) : shouldShowDoctorPromoShimmer ? (
                                        <View style={styles.promoDoctorPreviewRow}>
                                            {Array.from({ length: 2 }).map((_, shimmerIndex) => (
                                                <View
                                                    key={`${card.id}-doctor-shimmer-${shimmerIndex}`}
                                                    style={[
                                                        styles.promoDoctorMiniCard,
                                                        styles.promoDoctorMiniSkeletonCard,
                                                        { borderColor: `${tonePalette.border}CC`, backgroundColor: miniCardBg },
                                                    ]}
                                                >
                                                    <ShimmerBlock height={34} width={34} borderRadius={17} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                                    <View style={styles.promoDoctorMiniSkeletonInfo}>
                                                        <ShimmerBlock height={10} width="72%" borderRadius={7} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                                        <View style={{ height: 6 }} />
                                                        <ShimmerBlock height={8} width="56%" borderRadius={6} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                                    </View>
                                                    <ShimmerBlock height={18} width={42} borderRadius={9} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                                </View>
                                            ))}
                                        </View>
                                    ) : null}
                                    {!shouldHideDoctorCardCta ? (
                                        <View style={[styles.promoCardCta, { backgroundColor: tonePalette.ctaBg }]}>
                                            <Text style={[styles.promoCardCtaText, { color: tonePalette.ctaText }]}>{card.cta}</Text>
                                        </View>
                                    ) : null}
                                </LinearGradient>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {isBookingConfirmedOverlay && (
                <View style={styles.bookingOverlay}>
                    <View style={styles.bookingContent}>
                        <Animated.View style={[styles.bookingPulseIcon, { transform: [{ scale: bookingPulse }] }]}>
                            <View style={[styles.bookingIconWrap, { backgroundColor: theme.successLight }]}>
                                <Check size={42} color={theme.tint} strokeWidth={3} />
                            </View>
                        </Animated.View>
                        <Text style={[styles.bookingStatusText, { color: '#FFFFFF' }]}>Securing your slot...</Text>
                        <Text style={[styles.bookingSubStatus, { color: 'rgba(255,255,255,0.7)' }]}>Preparing your consultation details</Text>
                    </View>
                </View>
            )}

            <View style={styles.sectionHeader}>
                <Text style={[styles.heading, { color: theme.text }]}>{t('home.chooseDepartment')}</Text>
                <TouchableOpacity onPress={handleViewAllDepartmentsPress}>
                    <Text style={[styles.viewAll, { color: theme.tint }]}>{t('common.viewAll')}</Text>
                </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 4 }}>
                {departmentCards.map((item, index) => (
                    <AnimatedDepartmentCard
                        key={item.id}
                        item={item}
                        theme={theme}
                        index={index}
                        isSelected={selectedDepartmentId === item.id}
                        onPress={() => handleDepartmentCardPress(item.id)}
                    />
                ))}
            </ScrollView>

            {selectedDepartment && (
                <View style={styles.activeFiltersRow}>
                    <TouchableOpacity
                        style={[
                            styles.departmentFilterChip,
                            { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                        ]}
                        onPress={() => setSelectedDepartmentId(null)}
                        activeOpacity={0.82}
                    >
                        <Text style={[styles.departmentFilterChipText, { color: theme.tint }]}>
                            Department: {selectedDepartment.label} • Clear
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            {selectedDepartment && recommendedDoctor && (
                <View style={[styles.recommendedSectionCard, { backgroundColor: theme.cardBackground, borderColor: theme.successBorder }]}>
                    <View style={styles.recommendedHeaderRow}>
                        <View>
                            <Text style={[styles.recommendedTitle, { color: theme.text }]}>
                                Recommended Best in {selectedDepartment.label}
                            </Text>
                            <Text style={[styles.recommendedSubtitle, { color: theme.textSecondary }]}>
                                Top rated specialist available for consult
                            </Text>
                        </View>
                        <View style={[styles.recommendedTag, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                            <Text style={[styles.recommendedTagText, { color: theme.tint }]}>All India</Text>
                        </View>
                    </View>

                    <View style={styles.recommendedDoctorRow}>
                        <TouchableOpacity
                            style={styles.recommendedDoctorRowTap}
                            onPress={() => handleOpenDoctorProfile(resolveDoctorId(recommendedDoctor))}
                            activeOpacity={0.82}
                        >
                            <Image
                                source={{ uri: getImageUrl(recommendedDoctor.image) || 'https://i.pravatar.cc/100?img=11' }}
                                style={styles.recommendedDoctorImage}
                            />
                            <View style={styles.recommendedDoctorInfo}>
                                <View style={styles.recommendedDoctorTopRow}>
                                    <Text style={[styles.recommendedDoctorName, { color: theme.text }]}>
                                        {getDoctorDisplayName(recommendedDoctor, { fallbackName: 'Specialist' })}
                                    </Text>
                                    <View style={[styles.ratingBadge, { backgroundColor: theme.successLight }]}>
                                        <Star size={12} color={theme.success} fill={theme.success} />
                                        <Text style={[styles.ratingText, { color: theme.success }]}>{recommendedDoctorMetrics.ratingLabel}</Text>
                                    </View>
                                </View>
                                <Text style={[styles.recommendedDoctorSpecialty, { color: theme.textSecondary }]}>
                                    {recommendedDoctor.specialization}
                                </Text>
                                <View style={styles.recommendedDoctorMetaRow}>
                                    <Text style={[styles.recommendedDoctorMeta, { color: theme.textSecondary }]}>
                                        {formatDoctorExperienceLabel(recommendedDoctor.experience)}
                                    </Text>
                                    <Text style={[styles.recommendedDoctorMeta, { color: theme.textSecondary, textTransform: 'capitalize' }]}>
                                        {recommendedDoctor.city || 'India'}
                                    </Text>
                                    {recommendedDoctorMetrics.feeLabel ? (
                                        <Text style={[styles.recommendedDoctorMeta, { color: theme.text }]}>
                                            {recommendedDoctorMetrics.feeLabel}
                                        </Text>
                                    ) : null}
                                </View>
                            </View>
                        </TouchableOpacity>
                    </View>

                    <Text style={[styles.recommendedHint, { color: theme.textSecondary }]}>
                        {selectedCity && recommendedDoctor.city && !isCityMatch(recommendedDoctor.city, selectedCity)
                            ? `No problem if you are in ${selectedCity}. You can still consult this top doctor from ${recommendedDoctor.city}.`
                            : 'You can consult this doctor from anywhere.'}
                    </Text>

                    <TouchableOpacity
                        style={[styles.recommendedConsultButton, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}
                        onPress={() => handleConsultDoctor(resolveDoctorId(recommendedDoctor))}
                        activeOpacity={0.86}
                    >
                        <Text style={[styles.recommendedConsultText, { color: theme.tint }]}>Consult Recommended Doctor</Text>
                    </TouchableOpacity>

                    {secondaryRecommendedDoctors.length > 0 && (
                        <View style={{ marginTop: 16, gap: 12 }}>
                            {secondaryRecommendedDoctors.map((doctor, index) => {
                                const { ratingLabel, feeLabel } = resolveDoctorCardMetrics(doctor);
                                const doctorKey = String(doctor._id || `${doctor.firstName || 'doctor'}-${doctor.lastName || ''}-${index}`);
                                return (
                                    <View key={doctorKey} style={[styles.card, { backgroundColor: theme.cardBackground, marginBottom: 0 }]}>
                                        <View style={{ flexDirection: 'row' }}>
                                            <TouchableOpacity
                                                style={styles.secondaryDoctorTap}
                                                onPress={() => handleOpenDoctorProfile(resolveDoctorId(doctor))}
                                                activeOpacity={0.82}
                                            >
                                                <Image source={{ uri: getImageUrl(doctor.image) || 'https://i.pravatar.cc/100?img=11' }} style={styles.image} />
                                                <View style={{ flex: 1, marginLeft: 16 }}>
                                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <View>
                                                            <Text style={[styles.name, { color: theme.text }]}>
                                                                {getDoctorDisplayName(doctor, { fallbackName: 'Specialist' })}
                                                            </Text>
                                                            <Text style={[styles.specialty, { color: theme.textSecondary }]}>{doctor.specialization}</Text>
                                                        </View>
                                                        <View style={[styles.ratingBadge, { backgroundColor: theme.successLight }]}>
                                                            <Star size={12} color={theme.success} fill={theme.success} />
                                                            <Text style={[styles.ratingText, { color: theme.success }]}>{ratingLabel}</Text>
                                                        </View>
                                                    </View>
                                                    <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'center' }}>
                                                        <Text style={{ fontSize: 12, color: theme.textSecondary, marginRight: 16 }}>{formatDoctorExperienceLabel(doctor.experience)}</Text>
                                                        <Text style={{ fontSize: 12, color: theme.textSecondary, textTransform: 'capitalize' }}>{doctor.city || 'India'}</Text>
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                            <View style={styles.secondaryDoctorActionRow}>
                                                {feeLabel ? (
                                                    <Text style={[styles.secondaryDoctorFee, { color: theme.text }]}>{feeLabel}</Text>
                                                ) : null}
                                                <TouchableOpacity
                                                    style={{ backgroundColor: theme.tint, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                                                    onPress={() => handleConsultDoctor(resolveDoctorId(doctor))}
                                                    activeOpacity={0.8}
                                                >
                                                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Consult</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}

                </View>
            )}



            <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                <Text style={[styles.heading, { color: theme.text }]}>{t('home.nearbyDoctors')}</Text>
                <View style={styles.filterHeaderActions}>
                    <Text style={[styles.cityCaption, { color: theme.textSecondary }]}>
                        {loadingCity
                            ? 'Fetching location...'
                            : `${selectedCityLabel}${selectedDepartment ? ` • ${selectedDepartment.label}` : ''}`}
                    </Text>
                    <TouchableOpacity
                        style={[styles.funnelButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        onPress={() => setIsCityPickerVisible(true)}
                        activeOpacity={0.8}
                    >
                        <SlidersHorizontal size={14} color={theme.tint} />
                    </TouchableOpacity>
                </View>
            </View>

            {showNearbyDoctorSkeleton ? (
                <View style={styles.loaderSkeletonWrap}>
                    {Array.from({ length: 3 }).map((_, index) => (
                        <View
                            key={`nearby-doctor-skeleton-${index}`}
                            style={[styles.loaderSkeletonCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        >
                            <ShimmerBlock height={74} width={74} borderRadius={14} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                            <View style={styles.loaderSkeletonContent}>
                                <ShimmerBlock height={13} width="54%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 8 }} />
                                <ShimmerBlock height={11} width="44%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 10 }} />
                                <ShimmerBlock height={11} width="36%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 14 }} />
                                <ShimmerBlock height={38} width="100%" borderRadius={10} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                            </View>
                        </View>
                    ))}
                </View>
            ) : nearbyDoctors.length === 0 ? (
                <View style={styles.loaderWrap}>
                    <Text style={[styles.loaderText, { color: theme.textSecondary }]}>
                        No doctors found{selectedDepartment ? ` in ${selectedDepartment.label}` : ''} near {selectedCityLabel}.
                    </Text>
                    <Text style={[styles.emptyHintText, { color: theme.textSecondary }]}>
                        {selectedDepartment && recommendedDoctor
                            ? 'Use the recommended doctor above, or try another city filter.'
                            : 'Try another city or department filter.'}
                    </Text>
                </View>
            ) : visibleNearbyDoctors.map((doctor, index) => {
                const { ratingLabel, feeLabel } = resolveDoctorCardMetrics(doctor);
                return (
                    <View key={String(doctor._id || `nearby-doc-${index}`)} style={[styles.card, { backgroundColor: theme.cardBackground }]}>
                        <View style={{ flexDirection: 'row' }}>
                            <TouchableOpacity
                                style={styles.nearbyDoctorTap}
                                onPress={() => handleOpenDoctorProfile(resolveDoctorId(doctor))}
                                activeOpacity={0.82}
                            >
                                <Image source={{ uri: getImageUrl(doctor.image) || 'https://i.pravatar.cc/100?img=11' }} style={styles.image} />
                                <View style={styles.nearbyDoctorInfo}>
                                    <View>
                                        <Text numberOfLines={2} style={[styles.nearbyDoctorName, { color: theme.text }]}>
                                            {getDoctorDisplayName(doctor, { fallbackName: 'Specialist' })}
                                        </Text>
                                        <Text numberOfLines={1} style={[styles.nearbyDoctorSpecialty, { color: theme.textSecondary }]}>
                                            {doctor.specialization}
                                        </Text>
                                    </View>

                                    <View style={styles.nearbyDoctorMetaRow}>
                                        <Text numberOfLines={1} style={[styles.nearbyDoctorMetaText, styles.nearbyDoctorMetaExperience, { color: theme.textSecondary }]}>
                                            {formatDoctorExperienceLabel(doctor.experience)}
                                        </Text>
                                        <Text numberOfLines={1} style={[styles.nearbyDoctorMetaText, styles.nearbyDoctorMetaCity, { color: theme.textSecondary, textTransform: 'capitalize' }]}>
                                            {doctor.city || cityLabel}
                                        </Text>
                                    </View>
                                </View>
                            </TouchableOpacity>

                            <View style={[styles.nearbyDoctorActionRow, isCompactDoctorCard && styles.nearbyDoctorActionRowCompact]}>
                                <View style={[styles.feePill, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                                    <Text numberOfLines={1} style={[styles.feePillText, isCompactDoctorCard && styles.feePillTextCompact, { color: theme.text }]}>
                                        {feeLabel || 'Fee on request'}
                                    </Text>
                                </View>
                                <View style={[styles.ratingBadge, styles.nearbyDoctorActionRating, { backgroundColor: theme.successLight }]}>
                                    <Star size={12} color={theme.success} fill={theme.success} />
                                    <Text style={[styles.ratingText, { color: theme.success }]}>{ratingLabel}</Text>
                                </View>
                                <TouchableOpacity
                                    style={[
                                        styles.consultButton,
                                        isCompactDoctorCard && styles.nearbyConsultButtonCompact,
                                        { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                                    ]}
                                    onPress={() => handleConsultDoctor(resolveDoctorId(doctor))}
                                >
                                    <Text style={[styles.consultButtonText, isCompactDoctorCard && styles.consultButtonTextCompact, { color: theme.tint }]}>
                                        {t('home.consultNow')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                );
            })}
            {!showNearbyDoctorSkeleton && isLoadingMoreNearbyDoctors ? (
                <View style={styles.loaderSkeletonWrap}>
                    {Array.from({ length: 2 }).map((_, index) => (
                        <View
                            key={`nearby-load-more-skeleton-${index}`}
                            style={[styles.loaderSkeletonCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        >
                            <ShimmerBlock height={74} width={74} borderRadius={14} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                            <View style={styles.loaderSkeletonContent}>
                                <ShimmerBlock height={13} width="54%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 8 }} />
                                <ShimmerBlock height={11} width="44%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 10 }} />
                                <ShimmerBlock height={11} width="36%" borderRadius={8} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                                <View style={{ height: 14 }} />
                                <ShimmerBlock height={38} width="100%" borderRadius={10} baseColor={skeletonBaseColor} highlightColor={skeletonGlowColor} />
                            </View>
                        </View>
                    ))}
                </View>
            ) : null}
            {!showNearbyDoctorSkeleton && nearbyDoctors.length > 0 && canLoadMoreNearbyDoctors && !isLoadingMoreNearbyDoctors ? (
                <View style={styles.loadMoreHintWrap}>
                    <Text style={[styles.loadMoreHintText, { color: theme.textSecondary }]}>
                        Scroll down to load more doctors
                    </Text>
                </View>
            ) : null}

            <Modal
                visible={showProPlanModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowProPlanModal(false)}
            >
                <View style={styles.proPlanModalOverlay}>
                    <TouchableOpacity
                        style={styles.proPlanModalBackdrop}
                        activeOpacity={1}
                        onPress={() => setShowProPlanModal(false)}
                    />
                    <View style={[styles.proPlanModalCard, { backgroundColor: theme.cardBackground, borderColor: theme.successBorder }]}>
                        <TouchableOpacity
                            style={[styles.proPlanModalClose, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                            onPress={() => setShowProPlanModal(false)}
                            hitSlop={6}
                        >
                            <X size={16} color={theme.textSecondary} />
                        </TouchableOpacity>

                        <View style={[styles.proPlanModalBadge, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
                            <Star size={12} color={theme.tint} fill={theme.tint} />
                            <Text style={[styles.proPlanModalBadgeText, { color: theme.tint }]}>Pro Access</Text>
                        </View>

                        <Text style={[styles.proPlanModalTitle, { color: theme.text }]}>Daily AI voice limit reached</Text>
                        <Text style={[styles.proPlanModalSubtitle, { color: theme.textSecondary }]}>
                            Upgrade to Pro to continue smooth natural voice chat, faster AI responses, and richer doctor-ready summaries.
                        </Text>

                        <View style={styles.proPlanModalFeatureList}>
                            <View style={styles.proPlanModalFeatureRow}>
                                <CheckCircle size={16} color={theme.tint} />
                                <Text style={[styles.proPlanModalFeatureText, { color: theme.textSecondary }]}>Higher AI and voice limits</Text>
                            </View>
                            <View style={styles.proPlanModalFeatureRow}>
                                <CheckCircle size={16} color={theme.tint} />
                                <Text style={[styles.proPlanModalFeatureText, { color: theme.textSecondary }]}>More natural voice experience</Text>
                            </View>
                            <View style={styles.proPlanModalFeatureRow}>
                                <CheckCircle size={16} color={theme.tint} />
                                <Text style={[styles.proPlanModalFeatureText, { color: theme.textSecondary }]}>Priority booking summary assistance</Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={[styles.proPlanModalPrimaryButton, { backgroundColor: theme.tint }]}
                            activeOpacity={0.88}
                            onPress={handleOpenUpgradeToPro}
                        >
                            <Text style={styles.proPlanModalPrimaryText}>View Pro Plans</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.proPlanModalSecondaryButton}
                            activeOpacity={0.8}
                            onPress={() => setShowProPlanModal(false)}
                        >
                            <Text style={[styles.proPlanModalSecondaryText, { color: theme.textSecondary }]}>Maybe later</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={isConcernListVisible}
                animationType="slide"
                onRequestClose={() => setIsConcernListVisible(false)}
            >
                <SafeAreaView style={[styles.concernModalContainer, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
                    <View style={[styles.concernModalHeader, { borderBottomColor: theme.borderColor }]}>
                        <TouchableOpacity
                            style={styles.concernBackButton}
                            onPress={() => setIsConcernListVisible(false)}
                            hitSlop={8}
                        >
                            <ArrowLeft size={20} color={theme.text} />
                        </TouchableOpacity>
                        <Text style={[styles.concernModalTitle, { color: theme.text }]}>{t('home.allConcerns')}</Text>
                        <View style={{ width: 28 }} />
                    </View>

                    <View style={[styles.concernSearchWrap, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                        <Search size={14} color={theme.textSecondary} />
                        <TextInput
                            style={[styles.concernSearchInput, { color: theme.text }]}
                            placeholder={t('home.searchConcern')}
                            placeholderTextColor={theme.textSecondary}
                            value={concernSearchQuery}
                            onChangeText={setConcernSearchQuery}
                        />
                    </View>

                    <Text style={[styles.concernCountText, { color: theme.textSecondary }]}>
                        {t('home.concernsCount', { count: filteredConcerns.length })}
                    </Text>

                    <ScrollView
                        style={styles.concernList}
                        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 12, 18) }}
                        showsVerticalScrollIndicator={false}
                    >
                        {filteredConcerns.map((concern) => (
                            <TouchableOpacity
                                key={concern.id}
                                style={[styles.concernListItem, { borderBottomColor: theme.borderColor }]}
                                activeOpacity={0.85}
                                onPress={() => handleSelectConcernFromList(concern.label)}
                            >
                                <View style={[styles.concernListIcon, { backgroundColor: concern.iconBg }]}>
                                    {concern.imageSource ? (
                                        <Image source={concern.imageSource} style={styles.concernListImage} resizeMode="cover" />
                                    ) : (
                                        <concern.Icon size={16} color={concern.iconColor} />
                                    )}
                                </View>
                                <View style={styles.concernListTextWrap}>
                                    <Text style={[styles.concernListTitle, { color: theme.text }]}>{getConcernDisplayLabel(concern.label)}</Text>
                                    <Text style={[styles.concernListSubtitle, { color: theme.textSecondary }]}>
                                        {t('home.tapToStartTriage')}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        ))}

                        {filteredConcerns.length === 0 && (
                            <View style={styles.loaderWrap}>
                                <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{t('home.noConcernsFound')}</Text>
                            </View>
                        )}
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            <Modal
                visible={isDepartmentListVisible}
                animationType="slide"
                onRequestClose={() => setIsDepartmentListVisible(false)}
            >
                <SafeAreaView style={[styles.concernModalContainer, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
                    <View style={[styles.concernModalHeader, { borderBottomColor: theme.borderColor }]}>
                        <TouchableOpacity
                            style={styles.concernBackButton}
                            onPress={() => setIsDepartmentListVisible(false)}
                            hitSlop={8}
                        >
                            <ArrowLeft size={20} color={theme.text} />
                        </TouchableOpacity>
                        <Text style={[styles.concernModalTitle, { color: theme.text }]}>{t('home.allDepartments')}</Text>
                        <View style={{ width: 28 }} />
                    </View>

                    <View style={[styles.concernSearchWrap, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                        <Search size={14} color={theme.textSecondary} />
                        <TextInput
                            style={[styles.concernSearchInput, { color: theme.text }]}
                            placeholder={t('home.searchDepartment')}
                            placeholderTextColor={theme.textSecondary}
                            value={departmentSearchQuery}
                            onChangeText={setDepartmentSearchQuery}
                        />
                    </View>

                    <Text style={[styles.concernCountText, { color: theme.textSecondary }]}>
                        {t('home.departmentsCount', { count: filteredDepartments.length })}
                    </Text>

                    <ScrollView
                        style={styles.concernList}
                        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 12, 18) }}
                        showsVerticalScrollIndicator={false}
                    >
                        <TouchableOpacity
                            style={[styles.concernListItem, { borderBottomColor: theme.borderColor }]}
                            activeOpacity={0.85}
                            onPress={() => handleDepartmentSelect(null)}
                        >
                            <View style={[styles.concernListIcon, { backgroundColor: theme.successLight }]}>
                                <Stethoscope size={16} color={theme.tint} />
                            </View>
                            <View style={styles.concernListTextWrap}>
                                <Text style={[styles.concernListTitle, { color: theme.text }]}>{t('home.allDepartments')}</Text>
                                <Text style={[styles.concernListSubtitle, { color: theme.textSecondary }]}>
                                    {t('home.showDoctorsEveryDepartment')}
                                </Text>
                            </View>
                            {!selectedDepartmentId && <Check size={16} color={theme.tint} />}
                        </TouchableOpacity>

                        {filteredDepartments.map((department) => {
                            const isSelected = selectedDepartmentId === department.id;
                            return (
                                <TouchableOpacity
                                    key={department.id}
                                    style={[styles.concernListItem, { borderBottomColor: theme.borderColor }]}
                                    activeOpacity={0.85}
                                    onPress={() => handleDepartmentSelect(department.id)}
                                >
                                    <View style={[styles.concernListIcon, { backgroundColor: theme.cardBackground }]}>
                                        <department.Icon size={16} color={theme.tint} />
                                    </View>
                                    <View style={styles.concernListTextWrap}>
                                        <Text style={[styles.concernListTitle, { color: theme.text }]}>{department.label}</Text>
                                        <Text style={[styles.concernListSubtitle, { color: theme.textSecondary }]}>
                                            {t('home.doctorsAvailable', { count: department.doctorCount })}
                                        </Text>
                                    </View>
                                    {isSelected && <Check size={16} color={theme.tint} />}
                                </TouchableOpacity>
                            );
                        })}

                        {filteredDepartments.length === 0 && (
                            <View style={styles.loaderWrap}>
                                <Text style={[styles.loaderText, { color: theme.textSecondary }]}>{t('home.noDepartmentsFound')}</Text>
                            </View>
                        )}
                    </ScrollView>
                </SafeAreaView>
            </Modal>

            <Modal
                visible={isCityPickerVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setIsCityPickerVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    enabled={Platform.OS === 'ios'}
                    style={[
                        styles.modalOverlay,
                        {
                            paddingBottom: Platform.OS === 'android'
                                ? Math.max(insets.bottom + 12, keyboardHeight > 0 ? keyboardHeight + 12 : 12)
                                : insets.bottom + 12,
                        },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.modalBackdrop}
                        activeOpacity={1}
                        onPress={() => setIsCityPickerVisible(false)}
                    />
                    <View
                        style={[
                            styles.modalSheet,
                            {
                                backgroundColor: theme.cardBackground,
                                borderColor: theme.borderColor,
                                maxHeight: keyboardHeight > 0 ? '64%' : '72%',
                            },
                        ]}
                    >
                        <View style={[styles.modalHandle, { backgroundColor: theme.borderColor }]} />

                        <View style={styles.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Filter by city</Text>
                                <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                                    Choose a city to refine nearby doctor results
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.modalAction}
                                onPress={() => {
                                    setHasUserSelectedCity(true);
                                    setSelectedCity(null);
                                }}
                                hitSlop={6}
                            >
                                <Text style={[styles.modalReset, { color: theme.textSecondary }]}>Reset</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.modalAction} onPress={() => setIsCityPickerVisible(false)} hitSlop={6}>
                                <Text style={[styles.modalDone, { color: theme.tint }]}>Done</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modalQuickActions}>
                            <TouchableOpacity
                                style={[
                                    styles.locationQuickButton,
                                    { borderColor: theme.successBorder, backgroundColor: theme.successLight },
                                    !locationCity && styles.locationQuickButtonDisabled,
                                ]}
                                onPress={handleUseCurrentLocation}
                                activeOpacity={0.85}
                            >
                                <MapPin size={13} color={locationCity ? theme.tint : theme.textSecondary} />
                                <Text
                                    style={[
                                        styles.locationQuickText,
                                        { color: locationCity ? theme.tint : theme.textSecondary },
                                    ]}
                                >
                                    {locationCity ? `Use my location (${locationCity})` : 'Location unavailable'}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.citySearchWrap, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                            <Search size={14} color={theme.textSecondary} />
                            <TextInput
                                style={[styles.citySearchInput, { color: theme.text }]}
                                placeholder="Search city"
                                placeholderTextColor={theme.textSecondary}
                                value={citySearchQuery}
                                onChangeText={setCitySearchQuery}
                            />
                        </View>

                        <Text style={[styles.cityListTitle, { color: theme.textSecondary }]}>Available cities</Text>
                        <ScrollView
                            style={styles.modalList}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            <TouchableOpacity
                                style={[
                                    styles.cityOptionRow,
                                    { borderColor: theme.borderColor },
                                    !selectedCity && { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                                ]}
                                onPress={() => handleCityFilterPress(null)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.cityOptionText, { color: !selectedCity ? theme.tint : theme.text }]}>
                                    All cities
                                </Text>
                                {!selectedCity && <Check size={16} color={theme.tint} />}
                            </TouchableOpacity>

                            {filteredCityOptions.map((city) => {
                                const isSelected = normalizeText(city) === normalizeText(selectedCity);
                                return (
                                    <TouchableOpacity
                                        key={city}
                                        style={[
                                            styles.cityOptionRow,
                                            { borderColor: theme.borderColor },
                                            isSelected && { backgroundColor: theme.successLight, borderColor: theme.successBorder },
                                        ]}
                                        onPress={() => handleCityFilterPress(city)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.cityOptionText, { color: isSelected ? theme.tint : theme.text }]}>
                                            {city}
                                        </Text>
                                        {isSelected && <Check size={16} color={theme.tint} />}
                                    </TouchableOpacity>
                                );
                            })}
                            {filteredCityOptions.length === 0 ? (
                                <View style={styles.loaderWrap}>
                                    <Text style={[styles.loaderText, { color: theme.textSecondary }]}>No city found for "{citySearchQuery.trim()}"</Text>
                                </View>
                            ) : null}
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    chatUpgradeButton: {
        marginTop: 10,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
    },
    chatUpgradeButtonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 14,
    },
    container: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 100 },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    brandRow: { flexDirection: 'row', alignItems: 'center' },
    brandIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    brandText: { fontSize: 22, fontWeight: '700' },
    profileAvatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    agentDoctorCardsScroll: {
        marginTop: 10,
        marginHorizontal: -12, // Bleed out to show it's scrollable
    },
    agentDoctorCardsContent: {
        paddingHorizontal: 16,
        gap: 12,
        paddingBottom: 4,
    },
    agentDoctorCard: {
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    agentDoctorCardTop: { flexDirection: 'row', marginBottom: 10 },
    agentDoctorCardImage: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
    agentDoctorCardInfo: { flex: 1 },
    agentDoctorCardNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    agentDoctorCardName: { fontSize: 13, fontWeight: '700' },
    agentDoctorCardRating: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, gap: 4 },
    agentDoctorCardRatingText: { fontSize: 10, fontWeight: '700' },
    agentDoctorCardSpec: { fontSize: 11, marginBottom: 4 },
    agentDoctorCardMetaRow: { flexDirection: 'row', gap: 12 },
    agentDoctorCardMeta: { fontSize: 10 },
    agentDoctorCardBtn: { height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    agentDoctorCardBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    profileInitial: { fontSize: 12, fontWeight: '700' },
    nearMeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
    },
    cityPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    topMenuButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cityPillText: { marginLeft: 6, fontSize: 12, fontWeight: '500' },
    cityPillValue: { fontWeight: '700', textTransform: 'capitalize' },
    aiCard: {
        backgroundColor: '#0F3E2E',
        borderRadius: 22,
        padding: 18,
        marginBottom: 18,
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 14,
        elevation: 7,
    },
    aiHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    aiHeadingBlock: {
        flex: 1,
        paddingRight: 10,
    },
    aiTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 4 },
    aiSubtitle: { color: '#BBD2C8', fontSize: 12, marginBottom: 12 },
    aiUpgradeButton: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(112, 247, 196, 0.65)',
        backgroundColor: 'rgba(11, 84, 62, 0.65)',
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    aiUpgradeButtonText: {
        color: '#D8FAEC',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    aiProBadge: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255, 228, 162, 0.78)',
        backgroundColor: 'rgba(147, 107, 20, 0.42)',
        paddingHorizontal: 11,
        paddingVertical: 5,
    },
    aiProBadgeText: {
        color: '#FFE7AF',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.35,
    },
    aiInputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        paddingLeft: 12,
        paddingRight: 6,
        height: 48,
    },
    aiInputWrapListening: {
        borderColor: 'rgba(74, 232, 169, 0.9)',
        backgroundColor: 'rgba(10, 63, 45, 0.72)',
    },
    aiInput: {
        flex: 1,
        color: '#fff',
        fontSize: 14,
        paddingVertical: 0,
    },
    aiAssistHint: { color: '#D2E3DC', fontSize: 11, marginTop: 10, lineHeight: 16, fontWeight: '500' },
    micButtonPulseWrap: {
        borderRadius: 18,
    },
    micButton: {
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 12,
        shadowColor: '#061811',
        shadowOpacity: 0.2,
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 6,
        elevation: 4,
    },
    micButtonVoice: {
        minWidth: 98,
    },
    micButtonSend: {
        width: 40,
        paddingHorizontal: 0,
    },
    micButtonListening: {
        backgroundColor: '#F15B5B',
    },
    micButtonVoiceContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    micButtonVoiceText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    heading: { fontSize: 18, fontWeight: 'bold' },
    viewAll: { fontSize: 13, fontWeight: '600' },
    concernGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 },
    concernCard: {
        width: '48%',
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 12,
    },
    concernCardInner: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 18,
        paddingHorizontal: 8,
        minHeight: 108,
    },
    trendingBadge: {
        position: 'absolute',
        top: -10,
        right: -10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        zIndex: 10,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 5,
    },
    trendingBadgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.6,
    },
    concernIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 10, overflow: 'hidden' },
    concernImage: { width: '78%', height: '78%', borderRadius: 12 },
    concernLabel: { fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
    shimmerLine: {
        position: 'absolute',
        top: 0,
        left: 0,
        height: '100%',
        width: 30,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        zIndex: 5,
    },
    activityHint: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: '#BBD2C8', marginTop: 4, opacity: 0.8, textAlign: 'center' },
    departmentCardInner: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 20,
        paddingHorizontal: 8,
    },
    departmentGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 2, marginBottom: 16 },
    departmentCard: {
        width: '48%',
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 8,
        borderWidth: 1,
        alignItems: 'center',
        marginBottom: 12,
    },
    departmentIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    departmentLabel: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
    activeFiltersRow: { marginBottom: 8 },
    departmentFilterChip: {
        borderWidth: 1,
        borderRadius: 14,
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    departmentFilterChipText: { fontSize: 12, fontWeight: '700' },
    recommendedSectionCard: {
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 14,
        marginBottom: 14,
    },
    recommendedHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    recommendedTitle: {
        fontSize: 15,
        fontWeight: '800',
    },
    recommendedSubtitle: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '500',
    },
    recommendedTag: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    recommendedTagText: {
        fontSize: 10,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    recommendedDoctorRow: {
        marginTop: 12,
        flexDirection: 'row',
    },
    recommendedDoctorRowTap: {
        flexDirection: 'row',
        flex: 1,
    },
    recommendedDoctorImage: {
        width: 64,
        height: 64,
        borderRadius: 12,
        backgroundColor: '#eee',
    },
    recommendedDoctorInfo: {
        flex: 1,
        marginLeft: 12,
    },
    recommendedDoctorTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    recommendedDoctorName: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        marginRight: 10,
    },
    recommendedDoctorSpecialty: {
        marginTop: 3,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        fontWeight: '600',
    },
    recommendedDoctorMetaRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    recommendedDoctorMeta: {
        fontSize: 11,
        marginRight: 12,
        fontWeight: '500',
    },
    recommendedHint: {
        marginTop: 10,
        fontSize: 12,
        lineHeight: 18,
    },
    recommendedConsultButton: {
        marginTop: 12,
        borderWidth: 1,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
    },
    recommendedConsultText: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    recommendedAlternativesRow: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    recommendedAltPill: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 7,
        marginRight: 8,
        marginBottom: 8,
        maxWidth: '48%',
    },
    recommendedAltName: {
        fontSize: 11,
        fontWeight: '700',
    },
    recommendedAltMeta: {
        marginTop: 2,
        fontSize: 10,
        fontWeight: '600',
    },
    urgentCard: {
        borderRadius: 22,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    urgentTitle: { fontSize: 18, fontWeight: '800' },
    urgentSubTitle: { fontSize: 12, marginTop: 2, fontWeight: '500' },
    urgentButton: {
        borderRadius: 17,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 9,
    },
    urgentButtonText: { fontSize: 12, fontWeight: '700' },
    promoCarouselWrap: {
        marginBottom: 10,
        overflow: 'hidden',
    },
    promoCarouselScroll: {
        marginHorizontal: -20,
    },
    promoCarouselContent: {
        paddingHorizontal: 20,
        paddingVertical: 2,
    },
    promoCardTouch: {
        borderRadius: 20,
        shadowColor: '#0B1A2A',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
        elevation: 3,
    },
    promoCardSurface: {
        height: 238,
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 12,
    },
    promoCardTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    promoCardTag: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    promoCardTagText: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.35,
        textTransform: 'uppercase',
    },
    promoCardIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    promoCardTitle: {
        marginTop: 12,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    promoCardDescription: {
        marginTop: 8,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: '500',
    },
    promoCardCta: {
        marginTop: 'auto',
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
    },
    promoDoctorPreviewRow: {
        marginTop: 10,
        gap: 8,
    },
    promoDoctorMiniCard: {
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 7,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    promoDoctorMiniSkeletonCard: {
        minHeight: 50,
    },
    promoDoctorMiniAvatar: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: '#E9EEF3',
    },
    promoDoctorMiniInfo: {
        flex: 1,
        marginLeft: 8,
        marginRight: 8,
    },
    promoDoctorMiniSkeletonInfo: {
        flex: 1,
        marginLeft: 8,
        marginRight: 8,
        justifyContent: 'center',
    },
    promoDoctorMiniName: {
        fontSize: 11,
        fontWeight: '800',
    },
    promoDoctorMiniMeta: {
        marginTop: 2,
        fontSize: 10,
        fontWeight: '500',
    },
    promoDoctorMiniRating: {
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    promoDoctorMiniRatingText: {
        fontSize: 10,
        fontWeight: '800',
    },
    promoCardCtaText: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    filterHeaderActions: { flexDirection: 'row', alignItems: 'center' },
    cityCaption: { fontSize: 12, textTransform: 'capitalize' },
    funnelButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1,
        marginLeft: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loaderWrap: { paddingVertical: 24, alignItems: 'center' },
    loadMoreHintWrap: { paddingTop: 0, paddingBottom: 8, alignItems: 'center' },
    loadMoreHintText: { fontSize: 12, fontWeight: '600' },
    loaderSkeletonWrap: { paddingVertical: 12 },
    loaderSkeletonCard: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    loaderSkeletonContent: {
        flex: 1,
        marginLeft: 12,
    },
    loaderText: { fontSize: 13, marginTop: 10 },
    emptyHintText: { fontSize: 12, marginTop: 6 },
    card: { padding: 16, borderRadius: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
    secondaryDoctorTap: {
        flex: 1,
        flexDirection: 'row',
    },
    secondaryDoctorActionRow: {
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        paddingLeft: 10,
    },
    secondaryDoctorFee: {
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 8,
    },
    nearbyDoctorTap: {
        flex: 1,
        flexDirection: 'row',
    },
    nearbyDoctorInfo: {
        flex: 1,
        minWidth: 0,
        marginLeft: 14,
        paddingRight: 4,
    },
    nearbyDoctorName: {
        fontSize: 16,
        fontWeight: '700',
        lineHeight: 20,
    },
    nearbyDoctorSpecialty: {
        fontSize: 11,
        marginTop: 2,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        fontWeight: '600',
    },
    nearbyDoctorMetaRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    nearbyDoctorMetaText: {
        fontSize: 12,
        marginRight: 8,
    },
    nearbyDoctorMetaExperience: {
        maxWidth: '46%',
    },
    nearbyDoctorMetaCity: {
        marginRight: 0,
        flex: 1,
    },
    nearbyDoctorActionRow: {
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        paddingLeft: 10,
        minWidth: 120,
    },
    nearbyDoctorActionRowCompact: {
        minWidth: 106,
        paddingLeft: 8,
    },
    image: { width: 80, height: 80, borderRadius: 12, backgroundColor: '#eee' },
    name: { fontSize: 16, fontWeight: 'bold' },
    specialty: { fontSize: 12, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
    ratingBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    ratingText: { fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
    fee: { fontSize: 16, fontWeight: 'bold' },
    feePill: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 8,
    },
    feePillText: {
        fontSize: 14,
        fontWeight: '800',
    },
    nearbyDoctorActionRating: {
        marginBottom: 8,
        alignSelf: 'flex-end',
    },
    feePillTextCompact: {
        fontSize: 12,
    },
    consultButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
    consultButtonText: { fontWeight: '600', fontSize: 12 },
    nearbyConsultButtonCompact: {
        paddingHorizontal: 11,
    },
    consultButtonTextCompact: {
        fontSize: 11,
    },
    proPlanModalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 18,
    },
    proPlanModalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(3, 13, 10, 0.68)',
    },
    proPlanModalCard: {
        width: '100%',
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
    },
    proPlanModalClose: {
        alignSelf: 'flex-end',
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    proPlanModalBadge: {
        marginTop: 2,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        gap: 5,
    },
    proPlanModalBadgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    proPlanModalTitle: {
        marginTop: 12,
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '800',
    },
    proPlanModalSubtitle: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '500',
    },
    proPlanModalFeatureList: {
        marginTop: 12,
        gap: 9,
    },
    proPlanModalFeatureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    proPlanModalFeatureText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
    },
    proPlanModalPrimaryButton: {
        marginTop: 14,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0E5A3B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 6,
    },
    proPlanModalPrimaryText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '800',
    },
    proPlanModalSecondaryButton: {
        marginTop: 8,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
    },
    proPlanModalSecondaryText: {
        fontSize: 12,
        fontWeight: '600',
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        paddingHorizontal: 0,
        paddingBottom: 0,
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(2,8,7,0.62)',
    },
    modalSheet: {
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        borderWidth: 1,
        borderBottomWidth: 0,
        paddingTop: 10,
        paddingHorizontal: 16,
        paddingBottom: 18,
        maxHeight: '72%',
    },
    modalHandle: {
        width: 42,
        height: 5,
        borderRadius: 3,
        alignSelf: 'center',
        marginBottom: 10,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    modalTitle: { fontSize: 16, fontWeight: '700' },
    modalSubtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
    modalAction: { paddingHorizontal: 6, paddingVertical: 2 },
    modalReset: { fontSize: 13, fontWeight: '600' },
    modalDone: { fontSize: 13, fontWeight: '700' },
    modalQuickActions: { marginBottom: 12 },
    locationQuickButton: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    locationQuickButtonDisabled: { opacity: 0.7 },
    locationQuickText: { fontSize: 12, fontWeight: '600', marginLeft: 8 },
    cityListTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8, marginTop: 2 },
    modalList: { maxHeight: 336 },
    citySearchWrap: {
        borderWidth: 1,
        borderRadius: 12,
        minHeight: 42,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        gap: 8,
    },
    citySearchInput: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        paddingVertical: 10,
    },
    cityOptionRow: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 11,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 2 },
    },
    cityOptionText: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
    concernModalContainer: {
        flex: 1,
        paddingTop: 10,
    },
    concernModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    concernBackButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    concernModalTitle: {
        fontSize: 22,
        fontWeight: '700',
    },
    concernSearchWrap: {
        marginTop: 12,
        marginHorizontal: 16,
        borderWidth: 1,
        borderRadius: 12,
        height: 42,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
    },
    concernSearchInput: {
        flex: 1,
        marginLeft: 8,
        fontSize: 14,
    },
    concernCountText: {
        marginTop: 10,
        marginHorizontal: 16,
        fontSize: 12,
        fontWeight: '600',
    },
    concernList: {
        marginTop: 6,
        paddingHorizontal: 16,
    },
    concernListItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    concernListIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        overflow: 'hidden',
    },
    concernListImage: { width: '100%', height: '100%', borderRadius: 19 },
    concernListTextWrap: {
        flex: 1,
    },
    concernListTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    concernListSubtitle: {
        fontSize: 12,
        fontWeight: '500',
    },
    agentInlinePanel: {
        marginTop: 12,
        marginBottom: 14,
        borderRadius: 18,
        borderWidth: 1,
        paddingTop: 14,
        paddingHorizontal: 16,
        paddingBottom: 20,
        minHeight: 380,
        maxHeight: 640,
    },
    agentHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    agentTitle: {
        color: '#EAF8F2',
        fontSize: 18,
        fontWeight: '800',
    },
    agentSubtitle: {
        color: '#9FC5B8',
        fontSize: 11,
        marginTop: 2,
    },
    agentClose: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: '#2A4D43',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0A2720',
    },
    agentScroll: {
        flex: 1,
    },
    agentScrollContent: {
        paddingBottom: 14,
    },
    agentMessageRow: {
        marginBottom: 12,
        flexDirection: 'row',
    },
    agentAiRow: {
        justifyContent: 'flex-start',
    },
    agentUserRow: {
        justifyContent: 'flex-end',
    },
    agentMessageBubble: {
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        maxWidth: '88%',
    },
    agentAiBubble: {
        borderWidth: 1,
        borderTopLeftRadius: 6,
    },
    agentUserBubble: {
        backgroundColor: '#1B7460',
        borderTopRightRadius: 6,
    },
    agentMessageText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
    },
    agentLiveBadge: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
        marginBottom: 8,
    },
    agentLiveBadgeText: {
        fontSize: 9,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    agentBookingPromptText: {
        color: '#9DCABD',
        fontSize: 12,
        lineHeight: 17,
        marginTop: -4,
        marginBottom: 10,
        paddingHorizontal: 8,
    },
    agentSlotListWrap: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 10,
        marginTop: 8,
        marginBottom: 8,
    },
    agentSlotListTitle: {
        fontSize: 12,
        fontWeight: '800',
        marginBottom: 8,
    },
    agentSlotListHint: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: '600',
        marginTop: -3,
        marginBottom: 8,
    },
    agentSlotItem: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 8,
        marginBottom: 8,
    },
    agentSlotHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        gap: 8,
    },
    agentSlotIndexPill: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        fontSize: 10,
        fontWeight: '800',
        overflow: 'hidden',
    },
    agentSlotTapHint: {
        fontSize: 10,
        fontWeight: '700',
    },
    agentSlotLabel: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '600',
    },
    agentSlotId: {
        marginTop: 4,
        fontSize: 10,
        fontWeight: '600',
    },
    agentActivityCard: {
        marginTop: -2,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#245046',
        backgroundColor: '#0D2A22',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    agentActivityTitle: {
        color: '#BFE9DA',
        fontSize: 11,
        fontWeight: '800',
        marginBottom: 4,
    },
    agentActivityRow: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 5,
    },
    agentActivityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 8,
    },
    agentActivityStepText: {
        flex: 1,
        color: '#E6F6F0',
        fontSize: 12,
        fontWeight: '600',
    },
    agentActivityBadge: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    agentActivityBadgeText: {
        fontSize: 10,
        fontWeight: '700',
    },
    agentActivityDetailText: {
        marginLeft: 16,
        marginTop: 2,
        color: '#97C4B5',
        fontSize: 11,
        lineHeight: 15,
    },
    agentRecommendationWrap: {
        marginTop: -2,
        marginBottom: 10,
    },
    agentDepartmentPill: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: '#0D2F26',
        borderWidth: 1,
        borderColor: '#255044',
        marginBottom: 8,
    },
    agentDepartmentPillText: {
        color: '#95CAB6',
        fontSize: 11,
        fontWeight: '700',
    },
    agentAppointmentsBtnText: {
        color: '#BDE6D8',
        fontSize: 12,
        fontWeight: '700',
    },
    agentTypingBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    agentTypingText: {
        color: '#A8CEC1',
        fontSize: 12,
        fontWeight: '600',
    },
    agentTypingSubText: {
        fontSize: 11,
        marginTop: 2,
        fontWeight: '500',
    },
    agentVoiceOnlyRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    agentMicButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    agentVoiceMeta: {
        marginLeft: 10,
        flex: 1,
    },
    agentVoiceOnlyTitle: {
        fontSize: 12,
        fontWeight: '800',
    },
    agentVoiceOnlyHint: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: '500',
    },
    voiceLiveCard: {
        marginTop: 12,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    voiceLiveHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    voiceLiveDoctorWrap: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    voiceLiveDoctorPulse: {
        position: 'absolute',
        width: 42,
        height: 42,
        borderRadius: 21,
    },
    voiceLiveDoctorAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceLiveDoctorMouth: {
        position: 'absolute',
        bottom: 7,
        width: 11,
        height: 3,
        borderRadius: 999,
        backgroundColor: '#FFFFFF',
    },
    voiceLiveTitle: {
        fontSize: 13,
        fontWeight: '800',
    },
    voiceLiveSubtitle: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: '500',
    },
    voiceLiveActionBtn: {
        minWidth: 62,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    voiceLiveActionBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
    voiceLiveThinkingRow: {
        marginTop: 10,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voiceLiveThinkingText: {
        fontSize: 11,
        fontWeight: '600',
    },
    /* ───── Bottom Sheet (Voice Assistant Modal) ───── */
    bottomSheetOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    fullScreenAgentWrap: {
        flex: 1,
    },
    bottomSheetBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    bottomSheetContainer: {
        width: '100%',
        alignSelf: 'center',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: 1,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 20,
    },
    bottomSheetContainerFullScreen: {
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderWidth: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    bottomSheetHandleWrap: {
        alignItems: 'center',
        paddingTop: 12,
        paddingBottom: 8,
    },
    bottomSheetHandle: {
        width: 52,
        height: 5,
        borderRadius: 999,
    },
    bottomSheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    bottomSheetTitle: {
        fontSize: 22,
        fontWeight: '800',
        letterSpacing: -0.4,
    },
    bottomSheetSubtitle: {
        fontSize: 13,
        marginTop: 4,
        lineHeight: 18,
        fontWeight: '500',
    },
    bottomSheetCloseBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    premiumWaitCard: {
        marginHorizontal: 16,
        marginTop: 10,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    premiumWaitRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        gap: 8,
    },
    premiumWaitTitle: {
        fontSize: 12,
        fontWeight: '700',
        flex: 1,
    },
    premiumWaitDots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    premiumWaitDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    premiumWaitTrack: {
        height: 5,
        borderRadius: 999,
        overflow: 'hidden',
    },
    premiumWaitFill: {
        height: '100%',
        borderRadius: 999,
    },
    bottomSheetIntroCard: {
        marginTop: 14,
        marginHorizontal: 18,
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 15,
    },
    bottomSheetStatusPill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 5,
        marginBottom: 14,
    },
    statusIndicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    bottomSheetStatusText: {
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    bottomSheetIntroTitle: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    bottomSheetIntroSubtitle: {
        marginTop: 6,
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '500',
    },
    bottomSheetScroll: {
        flex: 1,
        paddingHorizontal: 18,
    },
    bottomSheetScrollContent: {
        paddingTop: 16,
        paddingBottom: 26,
    },
    bottomSheetVoiceBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 10,
        marginBottom: 0,
        gap: 10,
        borderWidth: 1,
        borderRadius: 24,
        padding: 10,
        shadowColor: '#081510',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
        elevation: 8,
    },
    bottomSheetUpgradeButton: {
        flex: 1,
        minHeight: 52,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.14,
        shadowRadius: 6,
        elevation: 4,
    },
    bottomSheetUpgradeTextWrap: {
        alignItems: 'center',
    },
    bottomSheetUpgradeTitle: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '900',
    },
    bottomSheetUpgradeSubtitle: {
        marginTop: 2,
        color: 'rgba(255, 255, 255, 0.84)',
        fontSize: 11,
        fontWeight: '700',
    },
    bottomSheetTextInputWrap: {
        flex: 1,
        minHeight: 54,
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 10,
        justifyContent: 'center',
        overflow: 'hidden',
    },
    bottomSheetTextInput: {
        fontSize: 15,
        fontWeight: '500',
        paddingVertical: 0,
        lineHeight: 20,
    },
    bottomSheetMicBtn: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    bottomSheetComposerCard: {
        flex: 1,
        borderRadius: 22,
        borderWidth: 1,
        padding: 12,
    },
    bottomSheetComposerHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 10,
    },
    bottomSheetComposerTitleWrap: {
        flex: 1,
    },
    bottomSheetComposerTitle: {
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    bottomSheetComposerSubtitle: {
        marginTop: 3,
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 16,
    },
    bottomSheetComposerModeBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    bottomSheetComposerRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
    },
    bottomSheetVoiceMeta: {
        marginLeft: 14,
        flex: 1,
        paddingVertical: 2,
    },
    bottomSheetVoiceMetaCard: {
        marginLeft: 4,
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        borderWidth: 1,
    },
    bottomSheetVoiceMetaTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    bottomSheetVoiceTitle: {
        fontSize: 16,
        fontWeight: '800',
    },
    bottomSheetVoiceHint: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: '500',
    },
    bottomSheetTextModeHint: {
        fontSize: 11,
        fontWeight: '700',
    },
    bottomSheetMiniWaveRow: {
        marginTop: 7,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
        minHeight: 12,
    },
    bottomSheetMiniWaveBar: {
        width: 4,
        height: 12,
        borderRadius: 3,
        opacity: 0.9,
    },
    bottomDoctorSpeakingRow: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
    },
    bottomDoctorWrap: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    bottomDoctorPulse: {
        position: 'absolute',
        width: 30,
        height: 30,
        borderRadius: 15,
    },
    bottomDoctorAvatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.45)',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomDoctorImage: {
        width: '100%',
        height: '100%',
    },
    bottomDoctorMouth: {
        position: 'absolute',
        bottom: 4.5,
        width: 8,
        height: 2.2,
        borderRadius: 999,
        backgroundColor: '#EE5A73',
        borderWidth: 0.4,
        borderColor: 'rgba(52, 17, 29, 0.22)',
    },
    bottomDoctorSpeakingText: {
        fontSize: 11,
        fontWeight: '600',
    },
    voiceRobotStageCard: {
        marginTop: 12,
        marginHorizontal: 2,
        marginBottom: 10,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    voiceListeningCard: {
        marginTop: 8,
        marginHorizontal: 2,
        marginBottom: 10,
        borderWidth: 1,
        borderRadius: 22,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 12,
        alignSelf: 'center',
        width: '100%',
        maxWidth: 560,
        shadowColor: '#0A2218',
        shadowOpacity: 0.16,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 18,
        elevation: 8,
        overflow: 'hidden',
    },
    voiceListeningBadge: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 12,
    },
    voiceListeningBadgeDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
    },
    voiceListeningBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.25,
    },
    voiceListeningPromptCard: {
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 14,
        maxWidth: 420,
        alignSelf: 'center',
    },
    voiceListeningPromptText: {
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '700',
        fontStyle: 'italic',
        textAlign: 'center',
    },
    voiceListeningCenter: {
        alignItems: 'center',
        gap: 4,
    },
    voiceRobotTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    voiceRobotAvatarWrap: {
        width: 78,
        height: 78,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    voiceRobotOrbitRingOuter: {
        position: 'absolute',
        width: 76,
        height: 76,
        borderRadius: 38,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    voiceRobotOrbitRingInner: {
        position: 'absolute',
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 1,
    },
    voiceRobotOrbitDot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    voiceRobotPulse: {
        position: 'absolute',
        width: 72,
        height: 72,
        borderRadius: 36,
    },
    voiceRobotCoreShadow: {
        position: 'absolute',
        width: 66,
        height: 66,
        borderRadius: 33,
    },
    voiceRobotAvatar: {
        width: 74,
        height: 74,
        borderRadius: 37,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
    },
    voiceDoctorGlyphWrap: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceDoctorImageFrame: {
        width: 68,
        height: 68,
        borderRadius: 34,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F6FBFF',
    },
    voiceDoctorImage: {
        width: '100%',
        height: '100%',
        borderRadius: 26,
    },
    voiceDoctorScanLine: {
        position: 'absolute',
        left: 5,
        right: 5,
        height: 7,
        borderRadius: 5,
    },
    voiceDoctorSpecular: {
        position: 'absolute',
        top: 10,
        left: 13,
        width: 13,
        height: 6,
        borderRadius: 5,
        backgroundColor: 'rgba(255,255,255,0.72)',
    },
    voiceDoctorSparkleDot: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 4.8,
        height: 4.8,
        borderRadius: 2.4,
    },
    voiceDoctorMouth: {
        position: 'absolute',
        top: 34,
        width: 8,
        height: 2.3,
        borderRadius: 999,
        borderWidth: 0.3,
        borderColor: 'rgba(52, 17, 29, 0.22)',
    },
    voiceRobotTitle: {
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    voiceRobotStatusPill: {
        marginTop: 5,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        gap: 6,
    },
    voiceRobotStatusDot: {
        width: 7,
        height: 7,
        borderRadius: 999,
    },
    voiceRobotStatusText: {
        fontSize: 10,
        fontWeight: '700',
    },
    voiceRobotSubtitle: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '500',
    },
    voiceRobotBarsRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 6,
    },
    voiceListeningStatusRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    voiceRobotBar: {
        width: 7,
        height: 22,
        borderRadius: 999,
    },
    voiceRobotWaveStatusRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    voiceRobotWaveDot: {
        width: 8,
        height: 8,
        borderRadius: 999,
    },
    voiceRobotWaveStatusText: {
        fontSize: 11,
        fontWeight: '700',
    },
    voicePendingResponseRow: {
        marginTop: 9,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voicePendingResponseText: {
        fontSize: 11,
        fontWeight: '700',
    },
    voiceAutoSendCountdownWrap: {
        marginTop: 8,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 9,
        paddingVertical: 7,
    },
    voiceAutoSendCountdownText: {
        fontSize: 11,
        fontWeight: '700',
    },
    voiceAutoSendCountdownTrack: {
        marginTop: 6,
        height: 4,
        borderRadius: 999,
        overflow: 'hidden',
    },
    voiceAutoSendCountdownFill: {
        height: '100%',
        borderRadius: 999,
    },
    voiceRobotHint: {
        marginTop: 10,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '500',
    },
    voiceListeningActionRow: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    voiceListeningActionBtn: {
        minWidth: 58,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceListeningActionBtnText: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    voiceListeningMicBtn: {
        width: 58,
        height: 58,
        borderRadius: 29,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.14,
        shadowRadius: 8,
        elevation: 5,
    },
    voiceLimitCard: {
        marginTop: 12,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
    },
    voiceLimitHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voiceLimitBadge: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    voiceLimitBadgeText: {
        fontSize: 10,
        fontWeight: '900',
    },
    voiceLimitTitle: {
        flex: 1,
        fontSize: 13,
        fontWeight: '800',
    },
    voiceLimitText: {
        marginTop: 7,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '600',
    },
    voiceLimitButton: {
        marginTop: 10,
        height: 38,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    voiceLimitButtonText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '800',
    },
    voiceRobotCardsTitle: {
        marginTop: 10,
        marginHorizontal: 2,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.35,
    },
    voiceBookingConfirmationCard: {
        marginTop: 10,
        marginHorizontal: 2,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    voiceBookingConfirmationTitle: {
        fontSize: 10,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.35,
        marginBottom: 5,
    },
    voiceBookingConfirmationText: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '800',
    },
    voiceBookingConfirmationSubText: {
        marginTop: 3,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: '600',
    },
    voiceRobotSlotListWrap: {
        marginTop: 8,
        marginHorizontal: 2,
    },
    /* ───── Booking Animation Overlay ───── */
    bookingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(5, 26, 19, 0.94)',
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bookingContent: {
        alignItems: 'center',
    },
    bookingPulseIcon: {
        width: 100,
        height: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bookingIconWrap: {
        width: 84,
        height: 84,
        borderRadius: 42,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#34D399',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 12,
    },
    bookingStatusText: {
        marginTop: 24,
        fontSize: 20,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    bookingSubStatus: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '500',
    },
});
