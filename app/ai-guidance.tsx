import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  Keyboard,
  ActivityIndicator,
  Alert,
  Modal,
  Animated,
  Easing,
  GestureResponderEvent,
  Image,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, MoreVertical, Send, CheckCheck, Bot, Mic, X, Paperclip, Star, MapPin, Trash2 } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import Svg, { Circle } from 'react-native-svg';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../src/lib/supabase';
import { AiChatHistoryMessage } from '../src/types';
import * as Speech from 'expo-speech';
import { useAppMode } from '../context/AppModeContext';
import { useAuthContext } from '../context/AuthContext';
import Colors from '../constants/Colors';
import Markdown from 'react-native-markdown-display';
import { getStoredLocationCity, syncLocationCityIfPermitted } from '../services/locationPermission';

const ThinkingIndicator = ({ text, palette, theme, isInitialLoad = false }: any) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={[styles.messageRow, styles.aiRow, isInitialLoad && { marginTop: 20 }]}>
      <View style={[styles.messageGroup, styles.aiGroup]}>
        <View style={[
          styles.messageBubble, 
          styles.aiBubble, 
          { 
            backgroundColor: palette.aiBubbleBg, 
            borderColor: palette.bubbleBorder, 
            flexDirection: 'row', 
            alignItems: 'center', 
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 16,
          }
        ]}>
          <View style={{ width: 14, height: 14, justifyContent: 'center', alignItems: 'center' }}>
            <Animated.View style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.tint,
              transform: [{ scale: pulseAnim }],
              shadowColor: theme.tint,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.8,
              shadowRadius: 4,
            }} />
          </View>
          <Text style={[styles.messageText, { color: palette.aiBubbleText, fontSize: 13, fontWeight: '600' }]}>
            {text}
          </Text>
        </View>
      </View>
    </View>
  );
};

const PulsingDot = ({ size = 8, theme }: any) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={{ width: size + 4, height: size + 4, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.tint,
        transform: [{ scale: pulseAnim }],
        shadowColor: theme.tint,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 3,
      }} />
    </View>
  );
};


type Sender = 'ai' | 'user';
type ConversationMode = 'assistant' | 'guided';
type SpeechRecognitionEventName = 'start' | 'end' | 'result' | 'error';
type VoiceLiveStage = 'idle' | 'listening' | 'processing' | 'speaking';

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
  useEffect(() => {
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

interface ChatMessage {
  id: string;
  sender: Sender;
  text: string;
  createdAt: string;
  showConsultNow?: boolean;
  recommendedDepartmentLabel?: string;
  recommendedDoctors?: RecommendedDoctor[];
  bookingSlotOptions?: BookingSlotOption[];
  bookingPrompt?: string;
  agentSteps?: AgentToolStep[];
}

interface RecommendedDoctor {
  id: string;
  firstName: string;
  lastName: string;
  city?: string;
  specialization: string;
  experience?: string;
  fee?: string;
  rating?: number;
  image?: string;
}

interface BookingSlotOption {
  id: string;
  label: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

type AgentToolStepStatus = 'success' | 'skipped' | 'error' | 'running';

interface AgentToolStep {
  id: string;
  name: string;
  label: string;
  status: AgentToolStepStatus;
  detail?: string;
}

interface PersistedMessageRow {
  id: string;
  sender: string;
  text: string;
  created_at: string | null;
  show_consult_now: boolean | null;
  metadata?: Record<string, any> | null;
}

interface PersistedConversationRow {
  id: string;
  mode: string;
  concern: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  clinical_summary?: string | null;
}

type PendingAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  source: 'image' | 'document';
};

type AiRateLimitState = {
  blocked: boolean;
  blockType: 'none' | 'burst' | 'daily';
  limit: number;
  used: number;
  remaining: number;
  isPro?: boolean;
  burstLimit: number;
  burstWindowMs: number;
  burstUsed: number;
  blockLevel: number;
  blockHours: number;
  blockUntil: string | null;
  retryAfterMs: number;
};

const DEFAULT_AI_RATE_LIMIT_STATE: AiRateLimitState = {
  blocked: false,
  blockType: 'none',
  limit: Math.max(1, Number(process.env.EXPO_PUBLIC_CHAT_AI_MESSAGE_LIMIT_PER_WINDOW || 20)),
  used: 0,
  remaining: Math.max(1, Number(process.env.EXPO_PUBLIC_CHAT_AI_MESSAGE_LIMIT_PER_WINDOW || 20)),
  burstLimit: 10,
  burstWindowMs: 60_000,
  burstUsed: 0,
  blockLevel: 0,
  blockHours: 0,
  blockUntil: null,
  retryAfterMs: 0,
};

const parseAiRateLimitState = (value: any): AiRateLimitState | null => {
  if (!value || typeof value !== 'object') return null;

  const limit = Math.max(1, Number(value.limit) || DEFAULT_AI_RATE_LIMIT_STATE.limit);
  const used = Math.max(0, Number(value.used) || 0);
  const remainingRaw = Number(value.remaining);
  const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : Math.max(0, limit - used);
  const blockTypeRaw = typeof value.blockType === 'string' ? value.blockType.toLowerCase() : 'none';
  const blockType: 'none' | 'burst' | 'daily' =
    blockTypeRaw === 'burst' || blockTypeRaw === 'daily' ? blockTypeRaw : 'none';

  return {
    blocked: Boolean(value.blocked),
    blockType,
    limit,
    used,
    remaining,
    isPro: Boolean(value.isPro),
    burstLimit: Math.max(1, Number(value.burstLimit) || DEFAULT_AI_RATE_LIMIT_STATE.burstLimit),
    burstWindowMs: Math.max(1000, Number(value.burstWindowMs) || DEFAULT_AI_RATE_LIMIT_STATE.burstWindowMs),
    burstUsed: Math.max(0, Number(value.burstUsed) || 0),
    blockLevel: Math.max(0, Number(value.blockLevel) || 0),
    blockHours: Math.max(0, Number(value.blockHours) || 0),
    blockUntil: typeof value.blockUntil === 'string' ? value.blockUntil : null,
    retryAfterMs: Math.max(0, Number(value.retryAfterMs) || 0),
  };
};

const nowIso = (): string => new Date().toISOString();

const AGENT_PROGRESS_HINTS = [
  'Thinking...',
];

const VOICE_STAGE_FLOW: Array<{ key: Exclude<VoiceLiveStage, 'idle'>; label: string }> = [
  { key: 'listening', label: 'Listening' },
  { key: 'processing', label: 'Processing' },
  { key: 'speaking', label: 'Speaking' },
];

const getVoiceStageTitle = (stage: VoiceLiveStage): string => {
  if (stage === 'listening') return 'Listening...';
  if (stage === 'processing') return 'Processing...';
  if (stage === 'speaking') return 'Speaking...';
  return 'Ready to listen';
};

const getVoiceStageHint = (stage: VoiceLiveStage): string => {
  if (stage === 'listening') {
    return 'Speak your symptoms clearly. We will capture and send automatically.';
  }
  if (stage === 'processing') {
    return 'Understanding your voice input and preparing a safe response.';
  }
  if (stage === 'speaking') {
    return 'Playing AI voice response now.';
  }
  return 'Tap Start, then speak clearly in your preferred language.';
};

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
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}...`;
};

const getAgentToolDetail = (details: any, fallbackObservation?: unknown): string | undefined => {
  if (details && typeof details === 'object') {
    const message = typeof details.message === 'string' ? details.message.trim() : '';
    if (message) return clipStepDetail(message);

    if (typeof details.count === 'number' && Number.isFinite(details.count)) {
      const count = Math.max(0, Math.round(details.count));
      const department = typeof details.department === 'string' ? details.department.trim() : '';
      return department ? `Found ${count} result(s) in ${department}.` : `Found ${count} result(s).`;
    }

    const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
    if (reason) return clipStepDetail(`Skipped: ${reason.replace(/_/g, ' ')}`);

    const observation = typeof details.observation === 'string' ? details.observation.trim() : '';
    if (observation) return clipStepDetail(observation);
  }

  const fallback = typeof fallbackObservation === 'string' ? fallbackObservation.trim() : '';
  return fallback ? clipStepDetail(fallback) : undefined;
};

const normalizeAgentToolSteps = (toolsExecuted: any, autonomousToolSteps: any): AgentToolStep[] => {
  const steps: AgentToolStep[] = [];
  const seen = new Set<string>();

  const pushStep = (rawName: unknown, rawStatus: unknown, detail?: string) => {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) return;

    const status = normalizeToolStepStatus(rawStatus);
    const key = `${name}|${status}|${detail || ''}`;
    if (seen.has(key)) return;
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
      dotColor: '#25B26B',
      badgeBg: '#E7F8EE',
      badgeBorder: '#BEECCF',
      badgeText: '#167A45',
    };
  }

  if (status === 'error') {
    return {
      label: 'Error',
      dotColor: '#E05A5A',
      badgeBg: '#FDEDED',
      badgeBorder: '#F5C1C1',
      badgeText: '#B73E3E',
    };
  }

  if (status === 'skipped') {
    return {
      label: 'Skipped',
      dotColor: '#9AA5B1',
      badgeBg: '#F2F4F7',
      badgeBorder: '#D9DEE5',
      badgeText: '#5D6978',
    };
  }

  return {
    label: 'Running',
    dotColor: '#4A90E2',
    badgeBg: '#EAF3FF',
    badgeBorder: '#C8DFFF',
    badgeText: '#2E69B2',
  };
};

const mapPersistedMessageRow = (row: PersistedMessageRow): ChatMessage => {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: row.id,
    sender: row.sender === 'user' ? 'user' : 'ai',
    text: row.text || '',
    createdAt: row.created_at || nowIso(),
    showConsultNow:
      row.sender !== 'user'
        ? Boolean(row.show_consult_now) || shouldShowConsultButton(row.text || '')
        : false,
    recommendedDepartmentLabel:
      typeof metadata.recommendedDepartmentLabel === 'string' ? metadata.recommendedDepartmentLabel : undefined,
    recommendedDoctors: Array.isArray(metadata.recommendedDoctors) ? metadata.recommendedDoctors : undefined,
    bookingSlotOptions: Array.isArray(metadata.bookingSlotOptions) ? metadata.bookingSlotOptions : undefined,
    bookingPrompt: typeof metadata.bookingPrompt === 'string' ? metadata.bookingPrompt : undefined,
    agentSteps: Array.isArray(metadata.agentSteps) ? metadata.agentSteps : undefined,
  };
};

const normalizeConcern = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] || 'General';
  }
  return value || 'General';
};

const normalizeRouteTextParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
};

const normalizeRouteBooleanParam = (value: string | string[] | undefined, fallback: boolean = false): boolean => {
  const text = normalizeRouteTextParam(value).trim().toLowerCase();
  if (!text) return fallback;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return fallback;
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

const getConcernStarterFollowUp = (concern: string): string => {
  const key = concern.toLowerCase();

  if (key.includes('heart') || key.includes('cardio') || key.includes('chest')) {
    return 'Understood. Is there chest pressure, breathlessness, sweating, dizziness, or pain spreading to the arm or jaw?';
  }

  if (key.includes('cough') || key.includes('cold') || key.includes('breath') || key.includes('respiratory')) {
    return 'Understood. How many days has this been present, and is there fever, phlegm, wheezing, or breathing difficulty?';
  }

  if (key.includes('skin')) {
    return 'Understood. Is there itching, redness, pain, swelling, or a rash that is spreading?';
  }

  if (key.includes('hypertension') || key.includes('blood pressure') || key === 'bp') {
    return 'Understood. Have you noticed headache, dizziness, chest discomfort, or blurry vision?';
  }

  if (key.includes('diabetes') || key.includes('sugar')) {
    return 'Understood. Are you noticing frequent urination, unusual thirst, blurred vision, or fatigue?';
  }

  if (key.includes('fever')) {
    return 'Understood. Are there chills, body ache, sore throat, cough, or breathing difficulty with the fever?';
  }

  if (key.includes('headache') || key.includes('migraine')) {
    return 'Understood. Did the headache start suddenly, and is there vomiting, vision change, weakness, fever, or neck stiffness?';
  }

  if (key.includes('stomach') || key.includes('abdomen') || key.includes('gastro') || key.includes('digestion')) {
    return 'Understood. Where exactly is the discomfort, and is there vomiting, loose motion, fever, acidity, or blood in stool?';
  }

  if (key.includes('pcos') || key.includes('period') || key.includes('pregnancy') || key.includes('women')) {
    return 'Understood. Please share your last period date, pain or bleeding severity, and whether pregnancy is possible.';
  }

  if (key.includes('urine') || key.includes('uti') || key.includes('kidney')) {
    return 'Understood. Is there burning urine, fever, back pain, blood in urine, or reduced urine?';
  }

  if (key.includes('anxiety') || key.includes('stress') || key.includes('sleep') || key.includes('mental')) {
    return 'Understood. How long has this been happening, and is it affecting sleep, appetite, work, or safety?';
  }

  if (key.includes('joint') || key.includes('bone') || key.includes('ortho') || key.includes('injury')) {
    return 'Understood. Was there an injury or fall, and is there swelling, numbness, weakness, or trouble moving?';
  }

  if (key.includes('child') || key.includes('baby') || key.includes('pediatric')) {
    return 'Understood. Please share the child age, when symptoms started, temperature if fever, and whether feeding/activity is normal.';
  }

  return 'Understood. Please share your top symptoms, when they started, and whether they are getting worse.';
};

const getTimeOfDayGreeting = (): string => {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 17) return 'Good afternoon';
  return 'Good evening';
};

const getInitialMessages = (concern: string, isAssistantMode: boolean, user?: any): ChatMessage[] => {
  const name = user?.firstName ? `, ${user.firstName}` : '';
  const timeGreeting = getTimeOfDayGreeting();
  const capitalizedConcern = concern.charAt(0).toUpperCase() + concern.slice(1).toLowerCase();

  const assistantTemplates = [
    `👋 Hello${name}! ${timeGreeting}. I am your **CD4 Health Assistant** 🩺. Please feel free to describe your symptoms or any health concerns you have today, and I will guide you step-by-step. Let me know how you are feeling! 😊`,
    `🌸 Welcome${name}! ${timeGreeting}. I am your **CD4 Health Assistant** 🩺. Let's record your symptoms or discuss any health concerns you have today. Just type how you are feeling below to begin! 😊`,
    `✨ Hi${name}! ${timeGreeting}. I'm your **CD4 Health Assistant** 🩺. I am here to help you note down your concerns and direct you to the right care. Please describe what is happening, and let's get started! 😊`
  ];

  const concernTemplates = [
    `👋 Hello${name}! ${timeGreeting}. I'm here to help you note down all details regarding your **${capitalizedConcern} concern** 🩺.\n\nI will guide you step-by-step to gather relevant information so we can prepare a structured clinical snapshot for the doctor. 📝\n\nWhen you're ready, please share what symptoms you are experiencing, or just say 'hi' to start! 😊`,
    `🌸 Welcome${name}! ${timeGreeting}. Let's take a look at your **${capitalizedConcern} concern** 🩺 together.\n\nI will ask you a few quick questions to create a clear clinical summary for the doctor. 📝\n\nWhenever you're ready, please tell me what you're experiencing! 😊`,
    `✨ Hi${name}! ${timeGreeting}. Let's record your symptoms and create a clinical snapshot for your **${capitalizedConcern} concern** 🩺.\n\nI will guide you step-by-step through a warm triage conversation to make sure the doctor has all the details. 📝\n\nJust type what's happening to begin! 😊`
  ];

  const idx = Math.floor(Math.random() * 3);
  const text = isAssistantMode ? assistantTemplates[idx] : concernTemplates[idx];

  return [
    {
      id: 'ai-1',
      sender: 'ai',
      text,
      createdAt: nowIso(),
    },
  ];
};

const CONCERN_HEADER_IMAGE_ASSETS = {
  diabetes: require('../assets/concerns/diabetes_care_1777377906586.jpg'),
  pcos: require('../assets/concerns/pcos_health_1777377967772.jpg'),
  heart: require('../assets/concerns/heart_health_1777378053936.jpg'),
  skin: require('../assets/concerns/skin_care_1777378482702.jpg'),
  assistant: require('../assets/concerns/general_assistant_1777377591600.jpg'),
} as const;

const resolveConcernHeaderImageSource = (
  concernLabel: string,
  isAssistant: boolean
): ImageSourcePropType | undefined => {
  const merged = (concernLabel || '').trim().toLowerCase();
  if (!merged) {
    return isAssistant ? CONCERN_HEADER_IMAGE_ASSETS.assistant : undefined;
  }

  if (merged.includes('diabet')) return CONCERN_HEADER_IMAGE_ASSETS.diabetes;
  if (merged.includes('pcos')) return CONCERN_HEADER_IMAGE_ASSETS.pcos;
  if (merged.includes('heart') || merged.includes('cardio') || merged.includes('chest')) {
    return CONCERN_HEADER_IMAGE_ASSETS.heart;
  }
  if (
    merged.includes('skin') ||
    merged.includes('eczema') ||
    merged.includes('acne') ||
    merged.includes('rash') ||
    merged.includes('dandruff')
  ) {
    return CONCERN_HEADER_IMAGE_ASSETS.skin;
  }
  if (merged.includes('assistant')) {
    return CONCERN_HEADER_IMAGE_ASSETS.assistant;
  }

  return isAssistant ? CONCERN_HEADER_IMAGE_ASSETS.assistant : undefined;
};

const resolveChatWallpaperSource = (
  concernLabel: string,
  isAssistant: boolean
): ImageSourcePropType | undefined => {
  return resolveConcernHeaderImageSource(concernLabel, isAssistant);
};

const AI_ONLY_RESPONSES = (process.env.EXPO_PUBLIC_AI_ONLY_RESPONSES || 'true').trim().toLowerCase() === 'true';
const CHAT_REST_REMINDER_AFTER_MS = 2 * 60 * 60 * 1000;
const CHAT_CONTINUOUS_IDLE_RESET_MS = 20 * 60 * 1000;
const CHAT_REST_REMINDER_TEXT =
  'You have been chatting continuously for a while. Please take a short 5-10 minute break, drink water, then continue.';
const AI_RATE_LIMIT_SNAPSHOT_TTL_MS = 90 * 1000;
const AI_RATE_LIMIT_SNAPSHOT_CACHE = new Map<string, number>();

const formatRetryWindowLabel = (retryAfterMs: number): string => {
  const safeMs = Math.max(0, Number(retryAfterMs) || 0);
  if (safeMs <= 0) return 'some time';
  const totalMinutes = Math.max(1, Math.ceil(safeMs / 60_000));
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }
  const totalHours = Math.max(1, Math.ceil(totalMinutes / 60));
  return `${totalHours} hour${totalHours === 1 ? '' : 's'}`;
};

const normalizeRateLimitReplyForPlan = (
  replyText: string,
  rateLimit: AiRateLimitState | null,
  isProUser: boolean
): string => {
  const safeReply = (replyText || '').trim();
  if (!safeReply) return safeReply;
  const mentionsUpgrade = /upgrade\s+to\s+pro|upgrade\s+pro/i.test(safeReply);
  const isProTier = isProUser || Boolean(rateLimit?.isPro);
  if (!isProTier || !mentionsUpgrade || !rateLimit?.blocked) {
    return safeReply;
  }

  const waitLabel = formatRetryWindowLabel(rateLimit?.retryAfterMs || 0);
  return `Your current Pro AI limit is reached. Please take a short break and try again in about ${waitLabel}.`;
};

// The Edge Function normally unwraps structured model output. This second
// guard keeps an occasional raw JSON model response from appearing in chat.
const extractReplyFromStructuredText = (value: string): string => {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed?.reply === 'string' && parsed.reply.trim()) return parsed.reply.trim();
  } catch {
    const match = normalized.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`).trim();
      } catch {
        // Leave the original text untouched if the model output is malformed.
      }
    }
  }
  return text;
};

const hasConsultCueInText = (rawText: string): boolean => {
  const text = (rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return false;

  const consultTerms = [
    'consult a doctor',
    'consult with a doctor',
    'consult doctor',
    'doctor consultation',
    'consultation with doctor',
    'book an appointment',
    'book appointment',
    'visit a doctor',
    'see a doctor',
    'seek medical care',
    'seek medical attention',
    'healthcare professional',
    'in-person care',
    'in person care',
    'in-person consultation',
    'doctor review',
    'doctor se consult',
    'doctor se mil',
    'doctor ko dikhao',
    'doctor ko dikhaiye',
    'appointment book',
    'consult now',
    'show doctors',
    'doctor suggestion',
    'doctor suggestions',
    'specialist consultation',
    'specialist review',
    'get checked',
    'medical evaluation',
    'clinical review',
    'follow up with doctor',
    'follow-up with doctor',
    'should be examined',
    'needs examination',
    'recommended to see a doctor',
    'recommended to consult',
    'doctor assessment',
  ];

  return consultTerms.some((term) => text.includes(term));
};

const hasSoftDoctorNeedCue = (rawText: string): boolean => {
  const text = (rawText || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return false;

  return [
    /\b(doctor|specialist|clinician|physician)\b.{0,32}\b(advise|advised|review|consult|visit|see|evaluation|check)\b/i,
    /\b(please|kindly)?\s*(consider|plan|arrange)\s+(a\s+)?(doctor|specialist)\s+(visit|consultation|review)\b/i,
    /\b(if this continues|if symptoms persist|if it gets worse|if worsening)\b/i,
    /\b(persistent|worsening|ongoing)\b.{0,28}\b(symptom|pain|cough|fever|breathing|bleeding|vomiting)\b/i,
    /\b(in-person|in person)\b.{0,18}\b(review|check|care|evaluation|visit)\b/i,
  ].some((pattern) => pattern.test(text));
};

const shouldShowConsultButton = (
  replyText: string,
  reviewReason?: string,
  consultRecommended?: boolean,
  needsHumanReview?: boolean,
  consultPriority?: string,
  riskScore?: number
): boolean => {
  if (consultRecommended || needsHumanReview) {
    return true;
  }

  if (consultPriority === 'immediate' || consultPriority === 'today' || consultPriority === 'soon') {
    return true;
  }

  if ((riskScore || 0) >= 0.35) {
    return true;
  }

  if (
    reviewReason === 'emergency_signal' ||
    reviewReason === 'moderation_flagged' ||
    reviewReason === 'danger_signal_detected'
  ) {
    return true;
  }

  if (hasConsultCueInText(replyText)) {
    return true;
  }

  if ((riskScore || 0) >= 0.2 && hasSoftDoctorNeedCue(replyText)) {
    return true;
  }

  return false;
};

const formatAttachmentSize = (size: number | null): string => {
  if (!Number.isFinite(size || 0) || !size || size <= 0) {
    return 'size unknown';
  }
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

const formatAttachmentLabel = (attachment: PendingAttachment): string => {
  const sizeLabel = formatAttachmentSize(attachment.size);
  return `${attachment.name} (${sizeLabel})`;
};

const buildHistoryForApi = (chatMessages: ChatMessage[], maxMessages: number = 20): AiChatHistoryMessage[] =>
  chatMessages
    .map((item) => {
      const payload: AiChatHistoryMessage & {
        doctorRecommendations?: RecommendedDoctor[];
        bookingSlotOptions?: BookingSlotOption[];
      } = {
        role: item.sender === 'ai' ? ('assistant' as const) : ('user' as const),
        content: item.text.trim(),
      };

      if (item.sender === 'ai' && Array.isArray(item.recommendedDoctors) && item.recommendedDoctors.length > 0) {
        payload.doctorRecommendations = item.recommendedDoctors.slice(0, 6);
        if (item.recommendedDepartmentLabel) {
          payload.departmentSuggestion = {
            label: item.recommendedDepartmentLabel,
          };
        }
      }

      if (item.sender === 'ai' && Array.isArray(item.bookingSlotOptions) && item.bookingSlotOptions.length > 0) {
        payload.bookingSlotOptions = item.bookingSlotOptions.slice(0, 6);
      }

       if (item.sender === 'ai' && item.showConsultNow) {
        payload.consultRecommended = true;
      }

      if (item.sender === 'ai' && typeof item.bookingPrompt === 'string' && item.bookingPrompt.trim()) {
        payload.bookingPrompt = item.bookingPrompt.trim();
      }

      return payload;
    })
    .filter((item) => item.content.length > 0)
    .slice(-Math.max(1, maxMessages));

const extractFunctionErrorMessage = async (error: any): Promise<string> => {
  if (!error) {
    return 'Unknown function error';
  }

  const context = error.context;
  if (context?.json) {
    try {
      const payload = await context.json();
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
      }
    } catch {
      // fall through to next parser
    }
  }

  if (context?.text) {
    try {
      const payloadText = await context.text();
      if (typeof payloadText === 'string' && payloadText.trim()) {
        return payloadText.trim();
      }
    } catch {
      // fall through to generic message
    }
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Edge function call failed';
};

const isJwtAuthError = (message: string): boolean =>
  /invalid jwt|jwt expired|token has expired|unauthorized/i.test((message || '').toLowerCase());

const isLikelyJwt = (token: string): boolean => {
  const segments = token.split('.');
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
};

const FUNCTIONS_BASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const STREAM_MODE_RAW = (process.env.EXPO_PUBLIC_CHAT_STREAM_MODE || 'on').trim().toLowerCase();
const STREAM_MODE: 'on' | 'off' | 'auto' =
  STREAM_MODE_RAW === 'on' || STREAM_MODE_RAW === 'off' ? STREAM_MODE_RAW : 'auto';
const CHAT_VOICE_TTS_MODE: 'fast' | 'premium' =
  (process.env.EXPO_PUBLIC_CHAT_VOICE_TTS_MODE || 'premium').trim().toLowerCase() === 'fast'
    ? 'fast'
    : 'premium';
const AGENT_WS_MODE = (process.env.EXPO_PUBLIC_AGENT_WS_MODE || 'on').trim().toLowerCase() === 'on';
const AGENT_WS_FIRST = (process.env.EXPO_PUBLIC_AGENT_WS_FIRST || 'off').trim().toLowerCase() === 'on';
const toWebSocketBaseUrl = (baseUrl: string): string => {
  if (!baseUrl) return '';
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}`;
  return '';
};
const AGENT_WS_ENDPOINT = FUNCTIONS_BASE_URL
  ? `${toWebSocketBaseUrl(FUNCTIONS_BASE_URL)}/functions/v1/chat-agent-ws`
  : '';
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
const isStreamUnsupportedError = (message: string): boolean =>
  /streaming reader is unavailable|stream unsupported|unsupported stream/i.test((message || '').toLowerCase());
const shouldFallbackFromAgentWsToHttp = (message: string): boolean => {
  const normalized = (message || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('mode disabled')) return true;
  if (normalized.includes('endpoint is not configured')) return true;
  return false;
};

const sleepFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const splitIntoReadableSegments = (text: string): string[] => {
  const input = String(text || '').trim();
  if (!input) return [];
  return input
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const resolveSpeechPacing = (text: string): { rate: number; pauseMs: number } => {
  const raw = String(text || '').trim();
  const normalized = raw.toLowerCase();
  const hasDevanagari = /[\u0900-\u097F]/.test(raw);
  const looksHindiRoman =
    /\b(kya|mujhe|mera|meri|mere|hai|nahi|haan|han|doctor|dawai|bukhar|dard|slot|book)\b/.test(normalized);

  if (hasDevanagari) return { rate: 0.9, pauseMs: 80 };
  if (looksHindiRoman) return { rate: 0.93, pauseMs: 65 };
  return { rate: 1.0, pauseMs: 45 };
};

const resolveSpeechLocale = (text: string): string => {
  const raw = String(text || '').trim();
  if (!raw) return 'en-IN';
  const normalized = raw.toLowerCase();
  const hasDevanagari = /[\u0900-\u097F]/.test(raw);
  const looksHindiRoman =
    /\b(kya|mujhe|mera|meri|mere|hai|nahi|haan|han|doctor|dawai|bukhar|dard|slot|book)\b/.test(normalized);
  return hasDevanagari || looksHindiRoman ? 'hi-IN' : 'en-IN';
};

type ParsedSseEvent = {
  event: string;
  data: any;
};

type AgentWsServerEvent = {
  type?: string;
  requestId?: string;
  payload?: any;
  text?: string;
  message?: string;
  stage?: string;
  ts?: number;
};

type AgentWsPendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  onDelta?: (chunk: string) => void;
  onStage?: (stage: string) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
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
      // keep raw string payload when JSON parse fails
    }

    events.push({ event: eventName, data });
  }

  return {
    events,
    rest: normalized.slice(cursor),
  };
};

const extractPayloadFromSseOrJsonText = (rawText: string): any | null => {
  const text = (rawText || '').trim();
  if (!text) return null;

  const { events } = parseSseBuffer(text.endsWith('\n\n') ? text : `${text}\n\n`);
  for (const event of events) {
    if (event.event === 'done') {
      return event.data;
    }
    if (event.event === 'message') {
      const messagePayload = event.data;
      const isStructuredPayload =
        messagePayload &&
        typeof messagePayload === 'object' &&
        (
          messagePayload.success === true ||
          typeof messagePayload?.data?.reply === 'string' ||
          typeof messagePayload?.data?.text === 'string' ||
          Boolean(messagePayload?.data?.rateLimit)
        );
      if (isStructuredPayload) {
        return messagePayload;
      }
    }
  }

  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (
        parsed.success === true ||
        typeof parsed?.data?.reply === 'string' ||
        typeof parsed?.data?.text === 'string' ||
        Boolean(parsed?.data?.rateLimit)
      )
    ) {
      return parsed;
    }
  } catch {
    // non-json payload
  }

  return null;
};

export default function AiGuidanceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setMode } = useAppMode();
  const { user } = useAuthContext();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = (colorScheme ?? 'light') === 'dark';
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ concern?: string; variant?: string; initialMessage?: string; draftMessage?: string; voice?: string }>();
  const variant = Array.isArray(params.variant) ? params.variant[0] : params.variant;
  const normalizedRouteConcern = normalizeConcern(params.concern);
  const concernLooksAssistant = /\bassistant\b/i.test(normalizedRouteConcern);
  const isAssistantMode = (variant || '').toLowerCase() === 'assistant' || concernLooksAssistant;
  const concern = normalizeConcern(params.concern || (isAssistantMode ? 'General Assistant' : 'General'));
  const mode: ConversationMode = isAssistantMode ? 'assistant' : 'guided';
  const concernKey = concern.trim() || 'General';
  const headerConcernImageSource = resolveConcernHeaderImageSource(concernKey, isAssistantMode);
  const chatWallpaperSource = resolveChatWallpaperSource(concernKey, isAssistantMode);
  const initialMessage = normalizeRouteTextParam(params.initialMessage);
  const draftMessage = normalizeRouteTextParam(params.draftMessage);
  const isVoiceEnabledOnThisScreen = normalizeRouteBooleanParam(params.voice, false);
  const flatListRef = useRef<FlatList | null>(null);
  const messageCounterRef = useRef(0);
  const initialMessageKeyRef = useRef<string | null>(null);
  const draftMessageKeyRef = useRef<string | null>(null);
  const screenTitle = isAssistantMode ? 'AI Assistant' : 'AI History & Guidance';
  const screenSubTitle = isAssistantMode ? 'Describe your symptoms' : concern;
  const sessionSeed = `${concern}|${isAssistantMode ? 'assistant' : 'guided'}`;

  const [messages, setMessages] = useState<ChatMessage[]>(() => getInitialMessages(concern, isAssistantMode, user));
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [clinicalSummary, setClinicalSummary] = useState('');
  const [locationCity, setLocationCity] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(true);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const isSendingRef = useRef(isSending);
  const conversationIdRef = useRef<string | null>(null);
  const clinicalSummaryRef = useRef('');
  const initialMessageConsumedRef = useRef(false);

  useEffect(() => {
    clinicalSummaryRef.current = '';
    setClinicalSummary('');
  }, [sessionSeed]);
  const [isVoicePromptVisible, setIsVoicePromptVisible] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceLiveStage, setVoiceLiveStage] = useState<VoiceLiveStage>('idle');
  const [voiceStageHint, setVoiceStageHint] = useState<string>(getVoiceStageHint('idle'));
  const [voiceFallbackHint, setVoiceFallbackHint] = useState<string | null>(null);
  const [agentProgressIndex, setAgentProgressIndex] = useState(0);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVoiceSubmitRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const voiceAutoSubmitDelayMs = 850;
  const voiceFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicePulse = useRef(new Animated.Value(1)).current;
  const typingDot1 = useRef(new Animated.Value(0.28)).current;
  const typingDot2 = useRef(new Animated.Value(0.28)).current;
  const typingDot3 = useRef(new Animated.Value(0.28)).current;
  const [isConversationDrawerVisible, setIsConversationDrawerVisible] = useState(false);
  const conversationDrawerOffset = useRef(new Animated.Value(360)).current;
  const activeRequestTokenRef = useRef<string | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const voiceAbortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamCapabilityRef = useRef<'unknown' | 'supported' | 'unsupported'>('unknown');
  const voiceStreamCapabilityRef = useRef<'unknown' | 'supported' | 'unsupported'>('unknown');
  const agentWsRef = useRef<WebSocket | null>(null);
  const agentWsConnectPromiseRef = useRef<Promise<WebSocket> | null>(null);
  const agentWsTokenRef = useRef<string>('');
  const agentWsPendingRequestsRef = useRef<Map<string, AgentWsPendingRequest>>(new Map());
  const activeWsRequestIdRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const lastActiveTokenRef = useRef<string>('');
  const triggerReconnectRef = useRef<((token: string) => void) | null>(null);
  const handleServerVoiceAudioChunkRef = useRef<((audio: string, text: string, index: number, mimeType?: string) => void) | null>(null);
  const requestCounterRef = useRef(0);
  const chatSessionStartedAtRef = useRef<number | null>(null);
  const chatLastActivityAtRef = useRef<number | null>(null);
  const chatRestReminderShownRef = useRef(false);
  const [aiRateLimit, setAiRateLimit] = useState<AiRateLimitState>(DEFAULT_AI_RATE_LIMIT_STATE);
  const [hasRateLimitSnapshot, setHasRateLimitSnapshot] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isAttachmentPicking, setIsAttachmentPicking] = useState(false);
  const activeVoiceSoundRef = useRef<Audio.Sound | null>(null);
  const activeSpeechRef = useRef(false);
  const serverVoiceAudioChunksMapRef = useRef<Map<number, { audio: string; text: string; mimeType?: string }>>(new Map());
  const nextExpectedVoiceAudioIndexRef = useRef<number>(0);
  const isPlayingServerVoiceAudioRef = useRef<boolean>(false);
  const hasReceivedServerVoiceAudioChunksRef = useRef<boolean>(false);
  const [isVoiceDeltaLive, setIsVoiceDeltaLive] = useState(false);
  const voiceLiveDraftIdRef = useRef<string | null>(null);
  const voiceLiveSpeechQueueRef = useRef<string[]>([]);
  const voiceLiveSpeechBusyRef = useRef(false);
  const voiceLiveSpokenCharsRef = useRef(0);
  const voiceOpenAiAudioOnlyRef = useRef(true);
  const activeAgentProgressHint = AGENT_PROGRESS_HINTS[agentProgressIndex] || AGENT_PROGRESS_HINTS[0];
  const setVoiceStage = React.useCallback((stage: VoiceLiveStage, customHint?: string) => {
    setVoiceLiveStage(stage);
    setVoiceStageHint(customHint || getVoiceStageHint(stage));
  }, []);

  // Manual keyboard height tracking for Android
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const storedCity = await getStoredLocationCity();
        if (active && storedCity) {
          setLocationCity(storedCity);
        }
        const syncedCity = await syncLocationCityIfPermitted();
        if (active && syncedCity) {
          setLocationCity(syncedCity);
        }
      } catch {
        // best effort only
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const snapshotKey = `${user?.id || 'anonymous'}|${concernKey}|${isAssistantMode ? 'assistant' : 'guided'}`;
    const cachedSnapshotAt = AI_RATE_LIMIT_SNAPSHOT_CACHE.get(snapshotKey) || 0;
    const nowMs = Date.now();

    if (!user?.id) {
      setHasRateLimitSnapshot(false);
      setAiRateLimit(DEFAULT_AI_RATE_LIMIT_STATE);
      return () => {
        active = false;
      };
    }

    if (cachedSnapshotAt > 0 && nowMs - cachedSnapshotAt < AI_RATE_LIMIT_SNAPSHOT_TTL_MS) {
      return () => {
        active = false;
      };
    }

    const syncRateLimitSnapshot = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('chat-ai', {
          body: {
            quotaOnly: true,
            concern: concernKey,
            mode: isAssistantMode ? 'assistant' : 'guided',
          },
        });

        if (error || data?.success === false) {
          return;
        }

        const parsedRateLimit = parseAiRateLimitState(data?.data?.rateLimit);
        if (active && parsedRateLimit) {
          setAiRateLimit(parsedRateLimit);
          setHasRateLimitSnapshot(true);
          AI_RATE_LIMIT_SNAPSHOT_CACHE.set(snapshotKey, Date.now());
        }
      } catch {
        // Keep current snapshot if quota fetch fails.
      }
    };

    void syncRateLimitSnapshot();

    return () => {
      active = false;
    };
  }, [user?.id, concernKey, isAssistantMode]);

  useEffect(() => {
    if (!isVoicePromptVisible) {
      voicePulse.setValue(1);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(voicePulse, {
          toValue: 1.22,
          duration: 950,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(voicePulse, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
      voicePulse.setValue(1);
    };
  }, [isVoicePromptVisible, voicePulse]);

  useEffect(() => {
    if (!isVoicePromptVisible) {
      setVoiceStage('idle');
    }
  }, [isVoicePromptVisible, setVoiceStage]);

  useEffect(() => {
    if (!isSending || streamingMessageIdRef.current) {
      typingDot1.setValue(0.28);
      typingDot2.setValue(0.28);
      typingDot3.setValue(0.28);
      return;
    }

    const createDotLoop = (dot: Animated.Value, initialDelay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(initialDelay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.28,
            duration: 320,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(120),
        ])
      );

    const loop1 = createDotLoop(typingDot1, 0);
    const loop2 = createDotLoop(typingDot2, 140);
    const loop3 = createDotLoop(typingDot3, 280);

    loop1.start();
    loop2.start();
    loop3.start();

    return () => {
      loop1.stop();
      loop2.stop();
      loop3.stop();
      typingDot1.setValue(0.28);
      typingDot2.setValue(0.28);
      typingDot3.setValue(0.28);
    };
  }, [isSending, typingDot1, typingDot2, typingDot3]);

  useEffect(() => {
    if (!isSending) {
      setAgentProgressIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setAgentProgressIndex((previous) => (previous + 1) % AGENT_PROGRESS_HINTS.length);
    }, 1400);

    return () => clearInterval(interval);
  }, [isSending]);

  useEffect(() => {
    const draftId = streamingMessageIdRef.current;
    if (!isSending || !draftId) return;

    const hint = activeAgentProgressHint || 'Thinking...';
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== draftId || msg.sender !== 'ai') return msg;
        const current = (msg.text || '').trim();
        if (!current || AGENT_PROGRESS_HINTS.includes(current)) {
          return { ...msg, text: hint };
        }
        return msg;
      })
    );
  }, [isSending, activeAgentProgressHint]);

  const rejectAllAgentWsPending = React.useCallback((reason: string) => {
    const pendingMap = agentWsPendingRequestsRef.current;
    for (const [, pending] of pendingMap.entries()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error(reason));
    }
    pendingMap.clear();
  }, []);

  const closeAgentWs = React.useCallback((reason: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (agentWsRef.current) {
      try {
        agentWsRef.current.close();
      } catch {
        // noop
      }
    }
    agentWsRef.current = null;
    agentWsConnectPromiseRef.current = null;
    agentWsTokenRef.current = '';
    rejectAllAgentWsPending(reason);
  }, [rejectAllAgentWsPending]);

  const getOrConnectAgentWs = React.useCallback(async (accessToken: string): Promise<WebSocket> => {
    if (!AGENT_WS_MODE) {
      throw new Error('Agent websocket mode disabled');
    }
    if (!AGENT_WS_ENDPOINT) {
      throw new Error('Agent websocket endpoint is not configured.');
    }

    const existing = agentWsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      if (agentWsTokenRef.current !== accessToken) {
        try {
          existing.send(JSON.stringify({ type: 'auth.update', token: accessToken, requestId: `auth-${Date.now()}` }));
          agentWsTokenRef.current = accessToken;
        } catch {
          closeAgentWs('auth_update_failed');
        }
      }
      if (agentWsRef.current && agentWsRef.current.readyState === WebSocket.OPEN) {
        return agentWsRef.current;
      }
    }

    if (agentWsConnectPromiseRef.current) {
      return await agentWsConnectPromiseRef.current;
    }

    const wsUrl = `${AGENT_WS_ENDPOINT}?token=${encodeURIComponent(accessToken)}`
    const connectPromise = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      let openTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        openTimeout = null;
        if (settled) return;
        settled = true;
        closeAgentWs('websocket_connect_timeout');
        reject(new Error('Agent websocket connection timed out.'));
        if (lastActiveTokenRef.current && !isUnmountedRef.current) {
          triggerReconnectRef.current?.(lastActiveTokenRef.current);
        }
      }, 12000);

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
      } catch (openError: any) {
        if (openTimeout) {
          clearTimeout(openTimeout);
          openTimeout = null;
        }
        settled = true;
        agentWsConnectPromiseRef.current = null;
        reject(new Error(openError?.message || 'Failed to open agent websocket.'));
        if (lastActiveTokenRef.current && !isUnmountedRef.current) {
          triggerReconnectRef.current?.(lastActiveTokenRef.current);
        }
        return;
      }

      agentWsRef.current = socket;

      socket.onopen = () => {
        if (openTimeout) {
          clearTimeout(openTimeout);
          openTimeout = null;
        }
        agentWsTokenRef.current = accessToken;
        lastActiveTokenRef.current = accessToken;
        reconnectAttemptsRef.current = 0;
        if (!settled) {
          settled = true;
          resolve(socket);
        }
      };

      socket.onmessage = (messageEvent) => {
        if (typeof messageEvent.data !== 'string') {
          try {
            const buffer = messageEvent.data;
            const view = new DataView(buffer);
            const index = view.getUint32(0, true);
            const textLen = view.getUint32(4, true);
            
            const textDecoder = new TextDecoder();
            const textBytes = new Uint8Array(buffer, 8, textLen);
            const text = textDecoder.decode(textBytes);
            
            const audioBytes = new Uint8Array(buffer, 8 + textLen);
            
            let binary = '';
            const len = audioBytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(audioBytes[i]);
            }
            const audioBase64 = btoa(binary);

            handleServerVoiceAudioChunkRef.current?.(audioBase64, text, index);
          } catch (err: any) {
            console.warn('[AI WS] Failed to parse binary audio packet:', err?.message);
          }
          return;
        }

        let eventPayload: AgentWsServerEvent | null = null;
        try {
          eventPayload = typeof messageEvent.data === 'string' ? JSON.parse(messageEvent.data) : null;
        } catch {
          eventPayload = null;
        }
        if (!eventPayload || typeof eventPayload !== 'object') return;

        const requestId = typeof eventPayload.requestId === 'string' ? eventPayload.requestId : '';
        if (!requestId) return;

        const pending = agentWsPendingRequestsRef.current.get(requestId);
        if (!pending) return;

        const eventType = typeof eventPayload.type === 'string' ? eventPayload.type : '';
        if (eventType === 'delta') {
          pending.onDelta?.(typeof eventPayload.text === 'string' ? eventPayload.text : '');
          return;
        }
        if (eventType === 'stage') {
          pending.onStage?.(typeof eventPayload.stage === 'string' ? eventPayload.stage : '');
          return;
        }
        if (eventType === 'done') {
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          agentWsPendingRequestsRef.current.delete(requestId);
          pending.resolve(eventPayload.payload);
          return;
        }
        if (eventType === 'error') {
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          agentWsPendingRequestsRef.current.delete(requestId);
          const message = typeof eventPayload.message === 'string' && eventPayload.message.trim()
            ? eventPayload.message.trim()
            : 'Websocket request failed.';
          pending.reject(new Error(message));
        }
      };

      const handleSocketCloseOrError = () => {
        if (openTimeout) {
          clearTimeout(openTimeout);
          openTimeout = null;
        }
        if (!settled) {
          settled = true;
          reject(new Error('Agent websocket disconnected.'));
        }
        closeAgentWs('websocket_closed');
        const tokenToUse = lastActiveTokenRef.current;
        if (tokenToUse && !isUnmountedRef.current) {
          triggerReconnectRef.current?.(tokenToUse);
        }
      };

      socket.onerror = () => {
        handleSocketCloseOrError();
      };

      socket.onclose = () => {
        handleSocketCloseOrError();
      };
    });

    agentWsConnectPromiseRef.current = connectPromise.finally(() => {
      if (agentWsConnectPromiseRef.current === connectPromise) {
        agentWsConnectPromiseRef.current = null;
      }
    });

    return await connectPromise;
  }, [closeAgentWs]);

  const triggerReconnect = React.useCallback((token: string) => {
    if (isUnmountedRef.current) return;
    if (!AGENT_WS_MODE || !AGENT_WS_ENDPOINT) return;
    if (reconnectTimeoutRef.current) return;

    const attempt = reconnectAttemptsRef.current;
    const delaySec = Math.min(16, Math.pow(2, attempt));
    const jitter = Math.random() * 0.5 * delaySec;
    const delayMs = (delaySec + jitter) * 1000;

    console.log(`[AI WS] Reconnect attempt #${attempt + 1} scheduled in ${delayMs.toFixed(0)}ms`);

    reconnectTimeoutRef.current = setTimeout(async () => {
      reconnectTimeoutRef.current = null;
      if (isUnmountedRef.current) return;

      try {
        reconnectAttemptsRef.current++;
        await getOrConnectAgentWs(token);
        console.log('[AI WS] Reconnected successfully');
        reconnectAttemptsRef.current = 0;
      } catch (err: any) {
        console.warn('[AI WS] Reconnect attempt failed:', err?.message);
        triggerReconnect(token);
      }
    }, delayMs);
  }, [getOrConnectAgentWs]);

  triggerReconnectRef.current = triggerReconnect;

  const executeHttpFallback = React.useCallback(async (args: {
    accessToken: string;
    requestId: string;
    type: 'chat.message' | 'voice.message';
    payload: any;
    onDelta?: (chunk: string) => void;
    onStage?: (stage: string) => void;
  }) => {
    const isChat = args.type === 'chat.message';
    const endpointName = 'chat-ai';
    const fallbackUrl = `${FUNCTIONS_BASE_URL}/functions/v1/${endpointName}`;

    console.warn(`[AI Failover] Executing HTTP fallback to /${endpointName}`);

    const bodyPayload = { ...args.payload };
    const streamRequested = isChat && typeof args.onDelta === 'function';
    if (isChat) {
      bodyPayload.stream = streamRequested;
    }

    const controller = new AbortController();
    const response = await fetch(fallbackUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        apikey: SUPABASE_ANON_KEY || '',
        'Content-Type': 'application/json',
        Accept: streamRequested ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP fallback failed: ${errorText || response.statusText}`);
    }

    if (streamRequested) {
      const reader = (response as any)?.body?.getReader?.();
      if (!reader) {
        const fallbackText = await response.text().catch(() => '');
        const recoveredPayload = extractPayloadFromSseOrJsonText(fallbackText);
        if (recoveredPayload) {
          return recoveredPayload;
        }
        throw new Error('Streaming not supported in HTTP fallback');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finalPayload: any = null;

      while (true) {
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
            if (textDelta && args.onDelta) {
              args.onDelta(textDelta);
            }
          } else if (event.event === 'stage') {
            const stage = typeof event.data?.stage === 'string' ? event.data.stage : (typeof event.data === 'string' ? event.data : '');
            if (stage && args.onStage) {
              args.onStage(stage);
            }
          } else if (event.event === 'done') {
            finalPayload = event.data;
          } else if (event.event === 'error') {
            const message = typeof event.data?.message === 'string' ? event.data.message : 'Streaming fallback failed';
            throw new Error(message);
          }
        }
      }

      const tail = decoder.decode();
      if (tail) {
        buffer += tail;
        const parsed = parseSseBuffer(buffer);
        for (const event of parsed.events) {
          if (event.event === 'delta') {
            const textDelta = typeof event.data?.text === 'string' ? event.data.text : (typeof event.data === 'string' ? event.data : '');
            if (textDelta && args.onDelta) {
              args.onDelta(textDelta);
            }
          } else if (event.event === 'done') {
            finalPayload = event.data;
          }
        }
      }

      return finalPayload;
    } else {
      return await response.json();
    }
  }, []);

  const sendAgentWsRequest = React.useCallback(async (args: {
    accessToken: string;
    requestId: string;
    type: 'chat.message' | 'voice.message';
    payload: any;
    timeoutMs?: number;
    onDelta?: (chunk: string) => void;
    onStage?: (stage: string) => void;
  }) => {
    let socket: WebSocket | null = null;
    try {
      socket = await getOrConnectAgentWs(args.accessToken);
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket connection is not open');
      }
    } catch (wsConnError: any) {
      console.warn('[AI WS] WebSocket connection failed, fallback to HTTP:', wsConnError?.message);
      return await executeHttpFallback(args);
    }

    const timeoutMs = Math.max(5000, Number(args.timeoutMs || 120000));

    return await new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        agentWsPendingRequestsRef.current.delete(args.requestId);
        try {
          socket!.send(JSON.stringify({ type: 'cancel', targetRequestId: args.requestId, requestId: `cancel-${Date.now()}` }));
        } catch {
          // noop
        }
        reject(new Error('Websocket request timed out.'));
      }, timeoutMs);

      agentWsPendingRequestsRef.current.set(args.requestId, {
        resolve,
        reject,
        onDelta: args.onDelta,
        onStage: args.onStage,
        timeoutId,
      });

      try {
        socket!.send(
          JSON.stringify({
            type: args.type,
            requestId: args.requestId,
            payload: args.payload,
          }),
        );
      } catch (sendError: any) {
        clearTimeout(timeoutId);
        agentWsPendingRequestsRef.current.delete(args.requestId);
        console.warn('[AI WS] WebSocket send failed, fallback to HTTP:', sendError?.message);
        executeHttpFallback(args).then(resolve).catch(reject);
      }
    });
  }, [getOrConnectAgentWs, executeHttpFallback]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      closeAgentWs('screen_unmounted');
    };
  }, [closeAgentWs]);

  const palette = {
    pageBg: theme.background,
    headerBg: theme.cardBackground,
    headerBorder: theme.borderColor,
    title: theme.text,
    subTitle: theme.textSecondary,
    aiBubbleBg: theme.cardBackground,
    aiBubbleText: theme.text,
    bubbleBorder: theme.borderColor,
    userBubbleBg: theme.tint,
    userBubbleText: '#FFFFFF',
    inputBarBg: theme.cardBackground,
    inputBorder: theme.borderColor,
    inputBg: isDark ? '#0F1418' : '#EEF2F6',
    inputText: theme.text,
    placeholder: theme.textSecondary,
    sendBg: theme.tint,
    consultBg: theme.successLight,
    consultText: theme.tint,
    consultBorder: theme.successBorder,
  };

  const aiMarkdownStyles = React.useMemo(
    () => ({
      body: {
        color: palette.aiBubbleText,
        fontSize: 15,
        lineHeight: 22,
      },
      paragraph: {
        marginTop: 0,
        marginBottom: 8,
      },
      heading1: {
        color: palette.aiBubbleText,
        fontSize: 20,
        lineHeight: 26,
        fontWeight: '800' as const,
        marginTop: 2,
        marginBottom: 8,
      },
      heading2: {
        color: palette.aiBubbleText,
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '800' as const,
        marginTop: 2,
        marginBottom: 7,
      },
      heading3: {
        color: palette.aiBubbleText,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '700' as const,
        marginTop: 1,
        marginBottom: 6,
      },
      strong: {
        color: palette.aiBubbleText,
        fontWeight: '800' as const,
      },
      em: {
        color: palette.aiBubbleText,
        fontStyle: 'italic' as const,
      },
      link: {
        color: theme.tint,
        textDecorationLine: 'underline' as const,
      },
      bullet_list: {
        marginTop: 4,
        marginBottom: 6,
      },
      bullet_list_icon: {
        color: theme.tint,
      },
      bullet_list_content: {
        color: palette.aiBubbleText,
      },
      ordered_list: {
        marginTop: 4,
        marginBottom: 6,
      },
      ordered_list_icon: {
        color: theme.tint,
      },
      ordered_list_content: {
        color: palette.aiBubbleText,
      },
      list_item: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        marginTop: 2,
        marginBottom: 2,
      },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.tint,
        backgroundColor: theme.tint + '12',
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      code_inline: {
        color: palette.aiBubbleText,
        backgroundColor: theme.background,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      },
      code_block: {
        color: palette.aiBubbleText,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderColor,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      fence: {
        color: palette.aiBubbleText,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderColor,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      hr: {
        backgroundColor: theme.borderColor,
        height: 1,
        marginTop: 8,
        marginBottom: 8,
      },
    }),
    [palette.aiBubbleText, theme.tint, theme.background, theme.borderColor]
  );

  const quotaLimit = Math.max(1, aiRateLimit.limit || 1);
  const quotaUsed = Math.max(0, Math.min(quotaLimit, aiRateLimit.used || 0));
  const quotaRemaining = Math.max(0, Math.min(quotaLimit, aiRateLimit.remaining || (quotaLimit - quotaUsed)));
  const quotaProgress = hasRateLimitSnapshot ? Math.max(0, Math.min(1, quotaUsed / quotaLimit)) : 0;
  const quotaRemainingLabel = hasRateLimitSnapshot ? String(quotaRemaining) : '--';
  const subscriptionStatus = String(user?.subscription?.status || '').toLowerCase();
  const subscriptionExpiryMs =
    typeof user?.subscription?.expiresAt === 'string' && user.subscription.expiresAt.trim().length > 0
      ? new Date(user.subscription.expiresAt).getTime()
      : null;
  const hasValidProWindow =
    subscriptionExpiryMs === null || (Number.isFinite(subscriptionExpiryMs) && subscriptionExpiryMs > Date.now());
  const isProUser = ['active', 'trialing', 'grace'].includes(subscriptionStatus) && hasValidProWindow;
  const quotaRingSize = 30;
  const quotaStroke = 3;
  const quotaRadius = (quotaRingSize - quotaStroke) / 2;
  const quotaCircumference = 2 * Math.PI * quotaRadius;
  const quotaDashOffset = quotaCircumference * (1 - quotaProgress);
  const quotaRingColor =
    quotaProgress >= 0.9
      ? '#E45865'
      : quotaProgress >= 0.75
        ? '#E9A43A'
        : theme.tint;

  const nextMessageId = (prefix: 'u' | 'a') => {
    messageCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${messageCounterRef.current}`;
  };

  const buildConversationTitle = (seedText?: string): string => {
    const trimmedSeed = (seedText || '').trim();
    if (trimmedSeed) return trimmedSeed.slice(0, 70);
    return isAssistantMode ? 'AI Assistant Chat' : `${concernKey} Guidance`;
  };

  const createConversation = async (userId: string, seedText?: string): Promise<string> => {
    const { data, error } = await supabase
      .from('ai_chat_conversations')
      .insert({
        user_id: userId,
        mode,
        concern: concernKey,
        title: buildConversationTitle(seedText),
      })
      .select('id')
      .single();

    if (error || !data?.id) {
      throw error || new Error('Could not create AI conversation');
    }
    return data.id;
  };

  const persistMessage = async (userId: string, targetConversationId: string, msg: ChatMessage): Promise<void> => {
    const { error } = await supabase
      .from('ai_chat_messages')
      .insert({
        conversation_id: targetConversationId,
        user_id: userId,
        sender: msg.sender,
        text: msg.text,
        show_consult_now: Boolean(msg.showConsultNow),
        metadata: msg.sender === 'ai'
          ? {
              recommendedDepartmentLabel: msg.recommendedDepartmentLabel || null,
              recommendedDoctors: Array.isArray(msg.recommendedDoctors) ? msg.recommendedDoctors.slice(0, 6) : [],
              bookingSlotOptions: Array.isArray(msg.bookingSlotOptions) ? msg.bookingSlotOptions.slice(0, 6) : [],
              bookingPrompt: msg.bookingPrompt || null,
              agentSteps: Array.isArray(msg.agentSteps) ? msg.agentSteps : [],
            }
          : {},
        created_at: msg.createdAt,
      });

    if (error) throw error;
  };

  const formatConversationTimestamp = (rawDate: string | null): string => {
    if (!rawDate) return '';
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const conversationListQueryKey = React.useMemo(
    () => ['ai-conversations', user?.id || 'anonymous', mode, concernKey],
    [user?.id, mode, concernKey]
  );
  const fetchConversationList = React.useCallback(async (): Promise<PersistedConversationRow[]> => {
    if (!user?.id) return [];

    const { data, error } = await supabase
      .from('ai_chat_conversations')
      .select('id, mode, concern, title, created_at, updated_at, clinical_summary')
      .eq('user_id', user.id)
      .eq('mode', mode)
      .eq('concern', concernKey)
      .order('updated_at', { ascending: false })
      .limit(60);

    if (error) {
      throw error;
    }

    return (data as PersistedConversationRow[]) || [];
  }, [user?.id, mode, concernKey]);

  const {
    data: conversationList = [],
    isFetching: isConversationListFetching,
    refetch: refetchConversationList,
  } = useQuery({
    queryKey: conversationListQueryKey,
    queryFn: fetchConversationList,
    enabled: Boolean(user?.id),
    refetchInterval: 12000,
    refetchOnWindowFocus: false,
  });

  const openConversationMenu = () => {
    setIsConversationDrawerVisible(true);
    conversationDrawerOffset.setValue(360);
    Animated.timing(conversationDrawerOffset, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    void refetchConversationList();
  };

  const closeConversationMenu = () => {
    Animated.timing(conversationDrawerOffset, {
      toValue: 360,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsConversationDrawerVisible(false);
      }
    });
  };

  const ensureConversationActionAllowed = (): boolean => {
    if (isSendingRef.current || isLoadingConversation) {
      Toast.show({
        type: 'info',
        text1: 'Please wait',
        text2: 'Wait for current response/loading to complete first.',
      });
      return false;
    }
    return true;
  };

  const deleteConversationById = async (targetConversationId: string): Promise<void> => {
    if (!user?.id || !targetConversationId) {
      throw new Error('Conversation context missing.');
    }

    const { error } = await supabase
      .from('ai_chat_conversations')
      .delete()
      .eq('id', targetConversationId)
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }
  };

  const deleteAllScopedConversations = async (): Promise<void> => {
    if (!user?.id) {
      throw new Error('Session required.');
    }

    const { error } = await supabase
      .from('ai_chat_conversations')
      .delete()
      .eq('user_id', user.id)
      .eq('mode', mode)
      .eq('concern', concernKey);

    if (error) {
      throw error;
    }
  };

  const handleDeleteConversation = (targetConversationId: string, fromDrawer: boolean = false) => {
    if (!targetConversationId || !ensureConversationActionAllowed()) {
      return;
    }

    Alert.alert(
      'Delete conversation?',
      'This will permanently delete all messages in this chat thread.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteConversationById(targetConversationId);
                const wasActive = targetConversationId === conversationIdRef.current;
                if (wasActive) {
                  await handleStartNewConversation();
                }
                refreshConversationList();
                if (fromDrawer) {
                  void refetchConversationList();
                }
                Toast.show({
                  type: 'success',
                  text1: 'Conversation deleted',
                  text2: 'Chat history removed successfully.',
                });
              } catch (error: any) {
                Toast.show({
                  type: 'error',
                  text1: 'Delete failed',
                  text2: error?.message || 'Could not delete this conversation.',
                });
              }
            })();
          },
        },
      ]
    );
  };

  const handleDeleteAllConversations = () => {
    if (!ensureConversationActionAllowed()) {
      return;
    }

    Alert.alert(
      'Delete all chat history?',
      'This will permanently delete all saved conversations in this section.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteAllScopedConversations();
                await handleStartNewConversation();
                refreshConversationList();
                closeConversationMenu();
                Toast.show({
                  type: 'success',
                  text1: 'All chats deleted',
                  text2: 'Conversation history cleared.',
                });
              } catch (error: any) {
                Toast.show({
                  type: 'error',
                  text1: 'Delete failed',
                  text2: error?.message || 'Could not delete chat history.',
                });
              }
            })();
          },
        },
      ]
    );
  };

  const openChatActionsMenu = () => {
    openConversationMenu();
  };

  const pickImageAttachment = async () => {
    setIsAttachmentPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Toast.show({
          type: 'error',
          text1: 'Permission denied',
          text2: 'Please allow photo access to attach an image.',
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const nextAttachment: PendingAttachment = {
        uri: asset.uri,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
        size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
        source: 'image',
      };
      setPendingAttachment(nextAttachment);
      Toast.show({
        type: 'success',
        text1: 'Attachment added',
        text2: formatAttachmentLabel(nextAttachment),
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Attachment failed',
        text2: error?.message || 'Could not pick image.',
      });
    } finally {
      setIsAttachmentPicking(false);
    }
  };

  const pickDocumentAttachment = async () => {
    setIsAttachmentPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const nextAttachment: PendingAttachment = {
        uri: asset.uri,
        name: asset.name || `document_${Date.now()}`,
        mimeType: asset.mimeType || 'application/octet-stream',
        size: typeof asset.size === 'number' ? asset.size : null,
        source: 'document',
      };
      setPendingAttachment(nextAttachment);
      Toast.show({
        type: 'success',
        text1: 'Attachment added',
        text2: formatAttachmentLabel(nextAttachment),
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Attachment failed',
        text2: error?.message || 'Could not pick document.',
      });
    } finally {
      setIsAttachmentPicking(false);
    }
  };

  const handleAttachmentPress = () => {
    if (isLoadingConversation || isSendingRef.current || isAttachmentPicking) {
      return;
    }

    Alert.alert('Attach file', 'Choose attachment type', [
      {
        text: 'Photo/Image',
        onPress: () => {
          void pickImageAttachment();
        },
      },
      {
        text: 'Document',
        onPress: () => {
          void pickDocumentAttachment();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const refreshConversationList = () => {
    void queryClient.invalidateQueries({ queryKey: conversationListQueryKey });
  };

  const resetContinuousChatSession = () => {
    chatSessionStartedAtRef.current = null;
    chatLastActivityAtRef.current = null;
    chatRestReminderShownRef.current = false;
  };

  const maybeShowContinuousChatRestReminder = async (targetConversationId: string | null) => {
    const nowMs = Date.now();
    const lastActivityAtMs = chatLastActivityAtRef.current;
    const shouldRestartWindow =
      chatSessionStartedAtRef.current === null ||
      (lastActivityAtMs !== null && nowMs - lastActivityAtMs > CHAT_CONTINUOUS_IDLE_RESET_MS);

    if (shouldRestartWindow) {
      chatSessionStartedAtRef.current = nowMs;
      chatRestReminderShownRef.current = false;
    }

    chatLastActivityAtRef.current = nowMs;

    if (chatRestReminderShownRef.current) {
      return;
    }

    const sessionStartedAtMs = chatSessionStartedAtRef.current;
    if (sessionStartedAtMs === null || nowMs - sessionStartedAtMs < CHAT_REST_REMINDER_AFTER_MS) {
      return;
    }

    chatRestReminderShownRef.current = true;
    const restReminderMessage: ChatMessage = {
      id: nextMessageId('a'),
      sender: 'ai',
      text: CHAT_REST_REMINDER_TEXT,
      createdAt: nowIso(),
    };

    if (conversationIdRef.current === targetConversationId) {
      setMessages((prev) => [...prev, restReminderMessage]);
    }

    if (user?.id && targetConversationId) {
      void persistMessage(user.id, targetConversationId, restReminderMessage)
        .then(() => {
          refreshConversationList();
        })
        .catch((persistError) => {
          console.error('Failed to persist rest reminder message:', persistError);
        });
    }

    Toast.show({
      type: 'info',
      text1: 'Take a short rest',
      text2: 'You have been chatting for a long time. Please take a quick break and hydrate.',
    });
  };

  const showVoiceFallbackHint = React.useCallback((message: string) => {
    setVoiceFallbackHint(message);
    if (voiceFallbackTimerRef.current) {
      clearTimeout(voiceFallbackTimerRef.current);
    }
    voiceFallbackTimerRef.current = setTimeout(() => {
      setVoiceFallbackHint(null);
      voiceFallbackTimerRef.current = null;
    }, 5000);
  }, []);

  const stopActiveVoicePlayback = React.useCallback(async (options?: { resetStage?: boolean }) => {
    const shouldResetStage = options?.resetStage ?? true;
    serverVoiceAudioChunksMapRef.current.clear();
    nextExpectedVoiceAudioIndexRef.current = 0;
    isPlayingServerVoiceAudioRef.current = false;
    hasReceivedServerVoiceAudioChunksRef.current = false;
    if (activeVoiceSoundRef.current) {
      try {
        const sound = activeVoiceSoundRef.current;
        activeVoiceSoundRef.current = null;
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (error) {
        console.warn('Failed to stop active voice audio:', error);
      }
    }

    if (activeSpeechRef.current) {
      try {
        await Speech.stop();
      } catch (error) {
        console.warn('Failed to stop active speech:', error);
      }
      activeSpeechRef.current = false;
    }
    voiceLiveSpeechQueueRef.current = [];
    voiceLiveSpeechBusyRef.current = false;
    voiceLiveSpokenCharsRef.current = 0;
    voiceLiveDraftIdRef.current = null;
    setIsVoiceDeltaLive(false);
    if (shouldResetStage) {
      setVoiceStage('idle');
    }
  }, [setVoiceStage]);

  const interruptActiveResponse = React.useCallback((showToast?: boolean | GestureResponderEvent) => {
    const shouldShowToast = typeof showToast === 'boolean' ? showToast : true;
    const hadActiveSend = isSendingRef.current;
    let interrupted = false;

    if (streamAbortControllerRef.current) {
      streamAbortControllerRef.current.abort();
      streamAbortControllerRef.current = null;
      interrupted = true;
    }

    if (voiceAbortControllerRef.current) {
      voiceAbortControllerRef.current.abort();
      voiceAbortControllerRef.current = null;
      interrupted = true;
    }

    const activeWsRequestId = activeWsRequestIdRef.current;
    if (activeWsRequestId && agentWsRef.current && agentWsRef.current.readyState === WebSocket.OPEN) {
      try {
        agentWsRef.current.send(
          JSON.stringify({
            type: 'cancel',
            targetRequestId: activeWsRequestId,
            requestId: `cancel-${Date.now()}`,
          }),
        );
        interrupted = true;
      } catch {
        // noop
      }
    }

    if (!hadActiveSend && !interrupted) {
      return false;
    }

    const streamingMessageId = streamingMessageIdRef.current;
    if (streamingMessageId) {
      setMessages((prev) => prev.filter((msg) => msg.id !== streamingMessageId));
      streamingMessageIdRef.current = null;
    }

    activeRequestTokenRef.current = `interrupted-${Date.now()}`;
    activeWsRequestIdRef.current = null;
    setIsSending(false);
    isSendingRef.current = false;
    void stopActiveVoicePlayback();
    if (shouldShowToast) {
      Toast.show({
        type: 'info',
        text1: 'Response stopped',
        text2: 'You can speak or type your next message now.',
      });
    }
    return true;
  }, [stopActiveVoicePlayback]);

  const normalizeRecommendedDoctors = (value: any): RecommendedDoctor[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item: any) => {
        const doctorId = typeof item?.id === 'string' ? item.id : '';
        if (!doctorId) {
          return null;
        }

        return {
          id: doctorId,
          firstName: typeof item?.firstName === 'string' ? item.firstName : '',
          lastName: typeof item?.lastName === 'string' ? item.lastName : '',
          city: typeof item?.city === 'string' ? item.city : '',
          specialization: typeof item?.specialization === 'string' ? item.specialization : '',
          experience: typeof item?.experience === 'string' ? item.experience : '',
          fee: typeof item?.fee === 'string' ? item.fee : '',
          rating: typeof item?.rating === 'number' ? item.rating : Number(item?.rating || 0),
          image: typeof item?.image === 'string' ? item.image : '',
        } as RecommendedDoctor;
      })
      .filter((doctor: RecommendedDoctor | null): doctor is RecommendedDoctor => Boolean(doctor))
      .slice(0, 10);
  };

  const normalizeBookingSlotOptions = (value: any): BookingSlotOption[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item: any): BookingSlotOption | null => {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        const label = typeof item?.label === 'string' ? item.label.trim() : '';
        if (!id || !label) {
          return null;
        }

        return {
          id,
          label,
          date: typeof item?.date === 'string' ? item.date : null,
          startTime: typeof item?.startTime === 'string' ? item.startTime : null,
          endTime: typeof item?.endTime === 'string' ? item.endTime : null,
        };
      })
      .filter((slot: BookingSlotOption | null): slot is BookingSlotOption => Boolean(slot))
      .slice(0, 6);
  };

  const handleBookFromRecommendation = (doctor: RecommendedDoctor, departmentLabel?: string) => {
    const fullName = `${doctor.firstName || ''} ${doctor.lastName || ''}`.trim() || 'Selected Doctor';
    const subtitle = doctor.specialization || departmentLabel || concern;
    const activeConversationId = conversationIdRef.current || undefined;

    Alert.alert(
      'Book Appointment',
      `Proceed with ${fullName}${subtitle ? ` (${subtitle})` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            router.push({
              pathname: '/(tabs)/appointments',
              params: {
                concern: departmentLabel || concern,
                doctorId: doctor.id,
                conversationId: activeConversationId,
              },
            });
          },
        },
      ]
    );
  };

  const loadConversationMessages = async (targetConversationId: string) => {
    if (!user?.id) return;

    setIsLoadingConversation(true);
    try {
      const { data: storedMessages, error: messagesError } = await supabase
        .from('ai_chat_messages')
        .select('id, sender, text, show_consult_now, metadata, created_at')
        .eq('conversation_id', targetConversationId)
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;

      const starterMessages = getInitialMessages(concern, isAssistantMode, user);
      const mappedMessages =
        storedMessages && storedMessages.length > 0
          ? (storedMessages as PersistedMessageRow[]).map(mapPersistedMessageRow)
          : starterMessages;

      setConversationId(targetConversationId);
      conversationIdRef.current = targetConversationId;
      clinicalSummaryRef.current = String((targetConversationId && conversationList.find((item) => item.id === targetConversationId)?.clinical_summary) || '');
      setClinicalSummary(clinicalSummaryRef.current);
      setMessages(mappedMessages);
      messagesRef.current = mappedMessages;
      setInput('');
      setPendingAttachment(null);
      resetContinuousChatSession();
    } catch (error) {
      console.error('Failed to switch AI conversation:', error);
      setPendingAttachment(null);
      Toast.show({
        type: 'error',
        text1: 'Conversation error',
        text2: 'Could not open this conversation.',
      });
    } finally {
      setIsLoadingConversation(false);
      closeConversationMenu();
    }
  };

  const handleStartNewConversation = async () => {
    if (isSendingRef.current) {
      Toast.show({
        type: 'info',
        text1: 'Please wait',
        text2: 'Wait for the current response to finish first.',
      });
      return;
    }

    const starterMessages = getInitialMessages(concern, isAssistantMode, user);
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages(starterMessages);
    messagesRef.current = starterMessages;
    setInput('');
    setPendingAttachment(null);
    resetContinuousChatSession();
    initialMessageKeyRef.current = null;
    draftMessageKeyRef.current = null;
    initialMessageConsumedRef.current = true;
    setIsLoadingConversation(false);
  };

  const handleStartNewConversationFromDrawer = async () => {
    await handleStartNewConversation();
    closeConversationMenu();
  };

  const handleSelectConversation = async (targetConversationId: string) => {
    if (isSendingRef.current || isLoadingConversation) {
      Toast.show({
        type: 'info',
        text1: 'Please wait',
        text2: 'Wait for the current response to finish first.',
      });
      return;
    }

    if (targetConversationId === conversationIdRef.current) {
      closeConversationMenu();
      return;
    }

    await loadConversationMessages(targetConversationId);
  };

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (!user?.id) return;
    void queryClient.prefetchQuery({
      queryKey: conversationListQueryKey,
      queryFn: fetchConversationList,
    });
  }, [user?.id, queryClient, conversationListQueryKey, fetchConversationList]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapConversation = async () => {
      const starterMessages = getInitialMessages(concern, isAssistantMode, user);
      resetContinuousChatSession();
      initialMessageConsumedRef.current = false;
      draftMessageKeyRef.current = null;

      if (!user?.id) {
        setConversationId(null);
        setMessages(starterMessages);
        messagesRef.current = starterMessages;
        setInput('');
        setPendingAttachment(null);
        resetContinuousChatSession();
        setIsLoadingConversation(false);
        return;
      }

      setIsLoadingConversation(true);
      setIsSending(false);
      isSendingRef.current = false;
      messageCounterRef.current = 0;

      try {
        const { data: existingConversation, error: conversationError } = await supabase
          .from('ai_chat_conversations')
          .select('id, clinical_summary')
          .eq('user_id', user.id)
          .eq('mode', mode)
          .eq('concern', concernKey)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (conversationError) throw conversationError;

        const targetConversationId = existingConversation?.id;
        if (!targetConversationId) {
          if (cancelled) return;
          setConversationId(null);
          conversationIdRef.current = null;
          setMessages(starterMessages);
          messagesRef.current = starterMessages;
          setInput('');
          setPendingAttachment(null);
          resetContinuousChatSession();
          initialMessageKeyRef.current = null;
          draftMessageKeyRef.current = null;
          return;
        }

        if (cancelled) return;

        setConversationId(targetConversationId);
        conversationIdRef.current = targetConversationId;
        clinicalSummaryRef.current = String(existingConversation?.clinical_summary || '');
        setClinicalSummary(clinicalSummaryRef.current);

        const { data: storedMessages, error: messagesError } = await supabase
          .from('ai_chat_messages')
          .select('id, sender, text, show_consult_now, metadata, created_at')
          .eq('conversation_id', targetConversationId)
          .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;
        if (cancelled) return;

        if (storedMessages && storedMessages.length > 0) {
          const mappedMessages = (storedMessages as PersistedMessageRow[]).map(mapPersistedMessageRow);
          setMessages(mappedMessages);
          messagesRef.current = mappedMessages;
        } else {
          setMessages(starterMessages);
          messagesRef.current = starterMessages;
        }

        setInput('');
        setPendingAttachment(null);
        resetContinuousChatSession();
        initialMessageKeyRef.current = null;
        draftMessageKeyRef.current = null;
      } catch (error) {
        console.error('Failed to bootstrap AI conversation:', error);
      if (cancelled) return;
      setConversationId(null);
      setMessages(starterMessages);
      messagesRef.current = starterMessages;
      setPendingAttachment(null);
      resetContinuousChatSession();
    } finally {
        if (!cancelled) {
          setIsLoadingConversation(false);
        }
      }
    };

    void bootstrapConversation();

    return () => {
      cancelled = true;
    };
  }, [user?.id, sessionSeed, mode, concernKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 40);

    return () => clearTimeout(timer);
  }, [messages.length, isSending]);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)');
  };

  const openBookingPaymentHandoff = (handoff: any, targetConversationId?: string | null): boolean => {
    if (handoff?.status !== 'payment_required') return false;

    const doctorId = typeof handoff?.doctorId === 'string' ? handoff.doctorId.trim() : '';
    const slotId = typeof handoff?.slotId === 'string' ? handoff.slotId.trim() : '';
    if (!doctorId || !slotId) {
      Toast.show({
        type: 'error',
        text1: 'Booking details missing',
        text2: 'Please select the doctor and slot again.',
      });
      return false;
    }

    router.push({
      pathname: '/confirm-consultation',
      params: {
        doctorId,
        slotId,
        doctorName: String(handoff?.doctorName || 'Selected Doctor'),
        doctorSpecialization: String(handoff?.doctorSpecialization || ''),
        doctorCity: String(handoff?.doctorCity || ''),
        doctorFee: String(handoff?.doctorFee || '500'),
        concern: concern || '',
        slotDate: String(handoff?.slotDate || ''),
        slotStartTime: String(handoff?.slotStartTime || ''),
        slotEndTime: String(handoff?.slotEndTime || ''),
        conversationId: targetConversationId || '',
      },
    });
    return true;
  };

  const handleConsultNow = async () => {
    try {
      setIsSending(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const activeConversationId = conversationIdRef.current || undefined;

      let reportId = null;
      if (token) {
        // Build history from current messages
        const history = buildHistoryForApi(messages, 40);

        const { data, error } = await supabase.functions.invoke('save-ai-report', {
          body: { concern, history, conversationId: activeConversationId }
        });

        if (!error && data?.success) {
          reportId = data.reportId;
        }
      }

      setMode('teleconsultation');
      router.replace({
        pathname: '/(tabs)/appointments',
        params: {
          concern,
          reportId: reportId || undefined,
          conversationId: activeConversationId,
        },
      });
    } catch (err) {
      console.error('Failed to save AI report:', err);
      // Fallback navigate without reportId on error
      setMode('teleconsultation');
      const activeConversationId = conversationIdRef.current || undefined;
      router.replace({
        pathname: '/(tabs)/appointments',
        params: { concern, conversationId: activeConversationId },
      });
    } finally {
      setIsSending(false);
    }
  };

  const sendMessage = async (
    rawText: string,
    historySource?: ChatMessage[],
    attachmentOverride?: PendingAttachment | null
  ) => {
    const baseText = rawText.trim();
    const activeAttachment = attachmentOverride || null;
    if ((!baseText && !activeAttachment) || isLoadingConversation) {
      return;
    }
    if (isSendingRef.current) {
      Toast.show({
        type: 'info',
        text1: 'One response at a time',
        text2: 'Please wait, or stop the current response first.',
      });
      return;
    }
    if (!user?.id) {
      Toast.show({
        type: 'error',
        text1: 'Session required',
        text2: 'Please login again to continue AI chat.',
      });
      return;
    }

    // Lock immediately to prevent duplicate sends from rapid submit events.
    setIsSending(true);
    isSendingRef.current = true;

    const attachmentText = activeAttachment ? `📎 Attachment: ${formatAttachmentLabel(activeAttachment)}` : '';
    const userVisibleText = [baseText || (activeAttachment ? 'Please check this attachment.' : ''), attachmentText]
      .filter((part) => part.trim().length > 0)
      .join('\n\n')
      .trim();
    const requestText = activeAttachment
      ? [
        userVisibleText,
        `Attachment metadata: source=${activeAttachment.source}; mimeType=${activeAttachment.mimeType}; size=${formatAttachmentSize(activeAttachment.size)}.`,
      ]
        .filter((part) => part.trim().length > 0)
        .join('\n')
      : userVisibleText;

    let targetConversationId = conversationIdRef.current;
    if (!targetConversationId) {
      try {
        targetConversationId = await createConversation(user.id, userVisibleText);
        setConversationId(targetConversationId);
        conversationIdRef.current = targetConversationId;
        refreshConversationList();
      } catch (error) {
        console.error('Failed to create conversation before sending message:', error);
        Toast.show({
          type: 'error',
          text1: 'Conversation error',
          text2: 'Could not start conversation. Please retry.',
        });
        setIsSending(false);
        isSendingRef.current = false;
        return;
      }
    }

    await maybeShowContinuousChatRestReminder(targetConversationId);

    // Keep the AI prompt focused and lightweight: send only the latest five messages.
    const history = buildHistoryForApi(historySource ?? messagesRef.current, 5);
    const userMessage: ChatMessage = { id: nextMessageId('u'), sender: 'user', text: userVisibleText, createdAt: nowIso() };
    const requestConversationId = targetConversationId;

    requestCounterRef.current += 1;
    const requestToken = `${Date.now()}-${requestCounterRef.current}`;
    activeRequestTokenRef.current = requestToken;

    setMessages((prev) => [...prev, userMessage]);
    const optimisticDraftId = nextMessageId('a');
    const optimisticDraftCreatedAt = nowIso();
    streamingMessageIdRef.current = optimisticDraftId;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticDraftId,
        sender: 'ai',
        text: activeAgentProgressHint || AGENT_PROGRESS_HINTS[0] || 'Thinking...',
        createdAt: optimisticDraftCreatedAt,
      },
    ]);
    setInput('');
    setPendingAttachment(null);

    if (requestConversationId) {
      void persistMessage(user.id, requestConversationId, userMessage)
        .then(() => {
          refreshConversationList();
        })
        .catch((error) => {
          console.error('Failed to persist user AI message:', error);
        });
    }

    try {
      let voiceStreamedText = '';
      let voiceLiveSpokenViaDelta = false;
      voiceLiveSpeechQueueRef.current = [];
      voiceLiveSpeechBusyRef.current = false;
      voiceLiveSpokenCharsRef.current = 0;

      const ensureActiveSession = async (): Promise<string> => {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw new Error(sessionError.message || 'Could not read auth session');
        }

        let currentSession = sessionData.session;
        if (!currentSession?.access_token) {
          throw new Error('Session not available for AI call.');
        }

        const expiryInMs = (currentSession.expires_at || 0) * 1000;
        const expiresSoon = expiryInMs > 0 && expiryInMs <= Date.now() + 60_000;
        if (expiresSoon) {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshed.session?.access_token) {
            throw new Error(refreshError?.message || 'Could not refresh auth session for AI call.');
          }
          currentSession = refreshed.session;
        }

        if (!isLikelyJwt(currentSession.access_token)) {
          throw new Error('Session token format is invalid for AI call.');
        }

        return currentSession.access_token;
      };

      const invokeChatAi = async (accessToken: string) => {
        const functionsClient = supabase.functions;
        functionsClient.setAuth(accessToken);
        return functionsClient.invoke('chat-ai', {
          body: {
            message: requestText,
            concern,
            history,
            clinicalSummary: clinicalSummaryRef.current,
            conversationId: requestConversationId,
            mode: isAssistantMode ? 'assistant' : 'guided',
            locationCity,
            searchAreaCity: locationCity,
          },
        });
      };

      const requestBody = {
        message: requestText,
        concern,
        history,
        clinicalSummary: clinicalSummaryRef.current,
        conversationId: requestConversationId,
        mode: isAssistantMode ? 'assistant' as const : 'guided' as const,
        locationCity,
        searchAreaCity: locationCity,
      };

      const canUseAgentWebSocket = (): boolean => {
        if (!AGENT_WS_MODE) return false;
        if (!AGENT_WS_ENDPOINT) return false;
        return true;
      };

      const canAttemptStreaming = (): boolean => {
        if (STREAM_MODE !== 'on') return false;
        if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) return false;
        if (!hasReadableStreamSupport()) return false;
        if (streamCapabilityRef.current === 'unsupported') return false;
        return true;
      };

      const clearStreamingDraft = (messageId: string | null) => {
        if (!messageId) return;
        setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      };

      const invokeChatAiStream = async (accessToken: string): Promise<{
        payload: any;
        streamedMessageId: string | null;
        streamedCreatedAt: string | null;
      }> => {
        if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error('Streaming endpoint is not configured.');
        }

        const streamUrl = `${FUNCTIONS_BASE_URL}/functions/v1/chat-ai`;
        const controller = new AbortController();
        streamAbortControllerRef.current = controller;

        const response = await fetch(streamUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ ...requestBody, stream: true }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          let parsedMessage = `AI stream request failed (${response.status})`;
          if (errorText) {
            try {
              const parsed = JSON.parse(errorText);
              parsedMessage = parsed?.message || parsedMessage;
            } catch {
              parsedMessage = errorText;
            }
          }
          throw new Error(parsedMessage);
        }

        const reader = (response as any)?.body?.getReader?.();
        if (!reader) {
          streamCapabilityRef.current = 'unsupported';
          const fallbackText = await response.text().catch(() => '');
          const recoveredPayload = extractPayloadFromSseOrJsonText(fallbackText);
          if (recoveredPayload) {
            return {
              payload: recoveredPayload,
              streamedMessageId: null,
              streamedCreatedAt: null,
            };
          }
          throw new Error('STREAM_UNSUPPORTED: Streaming reader is unavailable on this device.');
        }
        streamCapabilityRef.current = 'supported';

        const decoder = new TextDecoder();
        let buffer = '';
        let finalPayload: any = null;
        let streamedMessageId: string | null = null;
        let streamedCreatedAt: string | null = null;
        let streamedText = '';
        let pendingStreamChunk = '';
        let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
        let shouldStopReading = false;

        const ensureStreamMessage = () => {
          if (streamedMessageId) return;
          streamedMessageId = nextMessageId('a');
          streamedCreatedAt = nowIso();
          streamingMessageIdRef.current = streamedMessageId;
          setMessages((prev) => [
            ...prev,
            {
              id: streamedMessageId as string,
              sender: 'ai',
              text: '',
              createdAt: streamedCreatedAt as string,
            },
          ]);
        };

        const flushPendingStreamText = () => {
          if (!pendingStreamChunk) return;
          const candidateText = `${streamedText}${pendingStreamChunk}`;
          const cleanText = extractReplyFromStructuredText(candidateText);
          const looksLikeUnfinishedStructuredOutput =
            candidateText.trimStart().startsWith('{') && !candidateText.trimEnd().endsWith('}');
          if (looksLikeUnfinishedStructuredOutput) {
            // Hold raw model JSON until the complete payload can be unwrapped.
            return;
          }
          streamedText = cleanText;
          pendingStreamChunk = '';
          ensureStreamMessage();
          setMessages((prev) =>
            prev.map((msg) => (
              msg.id === streamedMessageId
                ? { ...msg, text: streamedText }
                : msg
            ))
          );
        };

        const queueStreamText = (chunk: string) => {
          if (!chunk) return;
          pendingStreamChunk += chunk;
          if (streamFlushTimer) return;
          streamFlushTimer = setTimeout(() => {
            streamFlushTimer = null;
            flushPendingStreamText();
          }, 24);
        };

        while (!shouldStopReading) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

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
              queueStreamText(textDelta);
              continue;
            }

            if (event.event === 'done') {
              finalPayload = event.data;
              shouldStopReading = true;
              break;
            }

            if (event.event === 'error') {
              const message =
                typeof event.data?.message === 'string' && event.data.message.trim()
                  ? event.data.message.trim()
                  : 'AI streaming failed.';
              throw new Error(message);
            }

            if (event.event === 'message') {
              const messagePayload = event.data;
              const isStructuredPayload =
                messagePayload &&
                typeof messagePayload === 'object' &&
                (
                  messagePayload.success === true ||
                  typeof messagePayload?.data?.reply === 'string' ||
                  typeof messagePayload?.data?.text === 'string' ||
                  Boolean(messagePayload?.data?.rateLimit)
                );

              if (isStructuredPayload) {
                finalPayload = messagePayload;
                shouldStopReading = true;
                break;
              }

              if (typeof messagePayload === 'string') {
                queueStreamText(messagePayload);
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
              queueStreamText(textDelta);
            } else if (event.event === 'done') {
              finalPayload = event.data;
            } else if (event.event === 'message') {
              const messagePayload = event.data;
              const isStructuredPayload =
                messagePayload &&
                typeof messagePayload === 'object' &&
                (
                  messagePayload.success === true ||
                  typeof messagePayload?.data?.reply === 'string' ||
                  typeof messagePayload?.data?.text === 'string' ||
                  Boolean(messagePayload?.data?.rateLimit)
                );
              if (isStructuredPayload) {
                finalPayload = messagePayload;
              } else if (typeof messagePayload === 'string') {
                queueStreamText(messagePayload);
              }
            }
          }
        }

        if (streamFlushTimer) {
          clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        flushPendingStreamText();

        if (!finalPayload) {
          if (streamedText.trim()) {
            finalPayload = {
              success: true,
              data: {
                reply: streamedText,
                source: 'stream',
              },
            };
          } else {
            throw new Error('Stream completed without AI payload.');
          }
        }

        return {
          payload: finalPayload,
          streamedMessageId,
          streamedCreatedAt,
        };
      };

      const invokeChatAiWebSocket = async (accessToken: string): Promise<{
        payload: any;
        streamedMessageId: string | null;
        streamedCreatedAt: string | null;
      }> => {
        if (!canUseAgentWebSocket()) {
          throw new Error('Agent websocket transport unavailable.');
        }

        let streamedMessageId: string | null = null;
        let streamedCreatedAt: string | null = null;
        let streamedText = '';
        let pendingStreamChunk = '';
        let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;

        const ensureStreamMessage = () => {
          if (streamedMessageId) return;
          streamedMessageId = nextMessageId('a');
          streamedCreatedAt = nowIso();
          streamingMessageIdRef.current = streamedMessageId;
          setMessages((prev) => [
            ...prev,
            {
              id: streamedMessageId as string,
              sender: 'ai',
              text: '',
              createdAt: streamedCreatedAt as string,
            },
          ]);
        };

        const flushPendingStreamText = () => {
          if (!pendingStreamChunk) return;
          const candidateText = `${streamedText}${pendingStreamChunk}`;
          const cleanText = extractReplyFromStructuredText(candidateText);
          const looksLikeUnfinishedStructuredOutput =
            candidateText.trimStart().startsWith('{') && !candidateText.trimEnd().endsWith('}');
          if (looksLikeUnfinishedStructuredOutput) {
            // Hold raw model JSON until the complete payload can be unwrapped.
            return;
          }
          streamedText = cleanText;
          pendingStreamChunk = '';
          ensureStreamMessage();
          setMessages((prev) =>
            prev.map((msg) => (
              msg.id === streamedMessageId
                ? { ...msg, text: streamedText }
                : msg
            ))
          );
        };

        const queueStreamText = (chunk: string) => {
          const nextChunk = chunk || '';
          if (!nextChunk) return;
          pendingStreamChunk += nextChunk;
          if (streamFlushTimer) return;
          streamFlushTimer = setTimeout(() => {
            streamFlushTimer = null;
            flushPendingStreamText();
          }, 24);
        };

        const wsRequestId = `chat-${requestToken}`;
        activeWsRequestIdRef.current = wsRequestId;
        let wsPayload: any;
        try {
          wsPayload = await sendAgentWsRequest({
            accessToken,
            requestId: wsRequestId,
            type: 'chat.message',
            payload: { ...requestBody, stream: true },
            timeoutMs: 18000,
            onDelta: (chunk) => queueStreamText(chunk),
          });
        } finally {
          if (streamFlushTimer) {
            clearTimeout(streamFlushTimer);
            streamFlushTimer = null;
          }
          flushPendingStreamText();
          if (activeWsRequestIdRef.current === wsRequestId) {
            activeWsRequestIdRef.current = null;
          }
        }

        let payload = wsPayload;
        if (!payload || typeof payload !== 'object') {
          if (streamedText.trim()) {
            payload = {
              success: true,
              data: {
                reply: streamedText.trim(),
                source: 'ws_stream',
              },
            };
          } else {
            throw new Error('Websocket completed without AI payload.');
          }
        }

        return {
          payload,
          streamedMessageId,
          streamedCreatedAt,
        };
      };

      let accessToken = await ensureActiveSession();
      let responseContent: any = null;
      let streamedMessageId: string | null = optimisticDraftId;
      let streamedCreatedAt: string | null = optimisticDraftCreatedAt;
      const invokeChatAiJsonWithRetry = async (token: string): Promise<{ payload: any; accessToken: string }> => {
        let nextToken = token;
        let { data: jsonResponseContent, error } = await invokeChatAi(nextToken);

        if (error) {
          const firstErrorMessage = await extractFunctionErrorMessage(error);

          if (isJwtAuthError(firstErrorMessage)) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token && isLikelyJwt(refreshed.session.access_token)) {
              nextToken = refreshed.session.access_token;
              const retryResult = await invokeChatAi(nextToken);
              jsonResponseContent = retryResult.data;
              error = retryResult.error;
            } else {
              throw new Error('AI request rejected due to auth token mismatch. Please login again and retry.');
            }

            if (error) {
              const retryErrorMessage = await extractFunctionErrorMessage(error);
              throw new Error(retryErrorMessage || 'AI request failed after token refresh retry.');
            }
          } else {
            throw new Error(firstErrorMessage);
          }
        }

        return { payload: jsonResponseContent, accessToken: nextToken };
      };

      if (canUseAgentWebSocket() && (AGENT_WS_FIRST || !canAttemptStreaming())) {
        try {
          const wsResult = await invokeChatAiWebSocket(accessToken);
          responseContent = wsResult.payload;
          streamedMessageId = wsResult.streamedMessageId;
          streamedCreatedAt = wsResult.streamedCreatedAt;
          console.log('[AI Chat] transport: websocket');
        } catch (wsError: any) {
          const wsMessage =
            typeof wsError?.message === 'string' ? wsError.message : 'AI websocket failed.';
          const hadWsDraftOutput = Boolean(streamedMessageId || streamingMessageIdRef.current);
          const allowTransportFallback =
            !hadWsDraftOutput || shouldFallbackFromAgentWsToHttp(wsMessage);
          console.warn(
            allowTransportFallback
              ? '[AI Chat] websocket failed, falling back to HTTP transport:'
              : '[AI Chat] websocket failed, fallback suppressed to avoid duplicate AI calls:',
            wsMessage
          );
          if (activeRequestTokenRef.current !== requestToken) {
            return;
          }
          const draftMessageId = streamedMessageId || streamingMessageIdRef.current;
          if (draftMessageId) {
            clearStreamingDraft(draftMessageId);
          }
          streamedMessageId = null;
          streamedCreatedAt = null;
          streamingMessageIdRef.current = null;

          if (isJwtAuthError(wsMessage)) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token && isLikelyJwt(refreshed.session.access_token)) {
              accessToken = refreshed.session.access_token;
              const retryWsResult = await invokeChatAiWebSocket(accessToken);
              responseContent = retryWsResult.payload;
              streamedMessageId = retryWsResult.streamedMessageId;
              streamedCreatedAt = retryWsResult.streamedCreatedAt;
            }
          }

          if (!responseContent && !allowTransportFallback) {
            throw new Error(wsMessage);
          }
        }
      }

      if (!responseContent && canAttemptStreaming()) {
        try {
          const streamResult = await invokeChatAiStream(accessToken);
          responseContent = streamResult.payload;
          streamedMessageId = streamResult.streamedMessageId;
          streamedCreatedAt = streamResult.streamedCreatedAt;
        } catch (streamError: any) {
          const streamMessage =
            typeof streamError?.message === 'string' ? streamError.message : 'AI streaming failed.';

          if (activeRequestTokenRef.current !== requestToken) {
            return;
          }

          if (isJwtAuthError(streamMessage)) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token && isLikelyJwt(refreshed.session.access_token)) {
              accessToken = refreshed.session.access_token;
              const retryStreamResult = await invokeChatAiStream(accessToken);
              responseContent = retryStreamResult.payload;
              streamedMessageId = retryStreamResult.streamedMessageId;
              streamedCreatedAt = retryStreamResult.streamedCreatedAt;
            } else {
              throw new Error('AI request rejected due to auth token mismatch. Please login again and retry.');
            }
          } else {
            if (isStreamUnsupportedError(streamMessage)) {
              streamCapabilityRef.current = 'unsupported';
            }
            const draftMessageId = streamedMessageId || streamingMessageIdRef.current;
            if (draftMessageId) {
              clearStreamingDraft(draftMessageId);
            }
            streamedMessageId = null;
            streamedCreatedAt = null;
            streamingMessageIdRef.current = null;
          }
        }
      }

      if (!responseContent && canUseAgentWebSocket() && !AGENT_WS_FIRST) {
        try {
          const wsResult = await invokeChatAiWebSocket(accessToken);
          responseContent = wsResult.payload;
          streamedMessageId = wsResult.streamedMessageId;
          streamedCreatedAt = wsResult.streamedCreatedAt;
          console.log('[AI Chat] transport: websocket (post-stream fallback)');
        } catch (wsError: any) {
          const wsMessage =
            typeof wsError?.message === 'string' ? wsError.message : 'AI websocket failed.';
          console.warn('[AI Chat] websocket post-stream fallback failed:', wsMessage);
        }
      }

      if (!responseContent) {
        const jsonResult = await invokeChatAiJsonWithRetry(accessToken);
        accessToken = jsonResult.accessToken;
        responseContent = jsonResult.payload;
      }

      if (activeRequestTokenRef.current !== requestToken) {
        return;
      }

      const response = responseContent as any;
      const parsedRateLimit = parseAiRateLimitState(response?.data?.rateLimit);
      if (parsedRateLimit) {
        setAiRateLimit(parsedRateLimit);
        setHasRateLimitSnapshot(true);
      }
      const source = response.data?.source;
      const rawReplyText = extractReplyFromStructuredText(response.data?.reply?.trim() || '');
      const nextClinicalSummary = typeof response.data?.clinicalSummary === 'string'
        ? response.data.clinicalSummary.trim()
        : '';
      if (nextClinicalSummary) {
        clinicalSummaryRef.current = nextClinicalSummary;
        setClinicalSummary(nextClinicalSummary);
        if (requestConversationId) {
          void supabase
            .from('ai_chat_conversations')
            .update({ clinical_summary: nextClinicalSummary })
            .eq('id', requestConversationId)
            .eq('user_id', user.id);
        }
      }
      const replyText = normalizeRateLimitReplyForPlan(rawReplyText, parsedRateLimit, isProUser);
      const reviewReason = response.data?.reviewReason;
      const needsHumanReview = Boolean(response.data?.needsHumanReview);
      const consultRecommended = Boolean(response.data?.consultRecommended);
      const consultPriority = typeof response.data?.consultPriority === 'string' ? response.data.consultPriority : undefined;
      const riskScore = Number(response.data?.riskScore || 0);
      const recommendedDepartmentLabel =
        typeof response.data?.departmentSuggestion?.label === 'string'
          ? response.data.departmentSuggestion.label
          : undefined;
      const recommendedDoctors = normalizeRecommendedDoctors(response.data?.doctorRecommendations);
      const bookingSlotOptions = normalizeBookingSlotOptions(response.data?.bookingPreparation?.slotOptions);
      const agentSteps = normalizeAgentToolSteps(
        response.data?.orchestrator?.toolsExecuted,
        response.data?.orchestrator?.autonomousToolSteps
      );
      const bookingPrompt =
        typeof response.data?.bookingPrompt === 'string' && response.data.bookingPrompt.trim()
          ? response.data.bookingPrompt.trim()
          : undefined;
      const allowFallbackForSafety = consultRecommended || needsHumanReview;
      const isAiSource =
        source === 'gemini' ||
        source === 'openai' ||
        source === 'gemini_fallback' ||
        source === 'medical_scope_guard' ||
        source === 'fallback' ||
        source === 'stream' ||
        source === 'ws_stream' ||
        Boolean(rawReplyText);

      if (AI_ONLY_RESPONSES && !isAiSource && !allowFallbackForSafety) {
        Toast.show({
          type: 'error',
          text1: 'AI unavailable',
          text2: 'Please retry in a few seconds.',
        });
        
        const fallbackMessage: ChatMessage = {
          id: nextMessageId('a'),
          sender: 'ai',
          text: 'I am unable to reach AI right now. Please retry in a few seconds.',
          createdAt: nowIso(),
        };
        if (conversationIdRef.current === requestConversationId) {
          setMessages((prev) => [
            ...prev.filter((msg) => msg.id !== optimisticDraftId),
            fallbackMessage,
          ]);
        }
        if (requestConversationId) {
          try {
            await persistMessage(user.id, requestConversationId, fallbackMessage);
          } catch (persistError) {
            console.error('Failed to persist AI fallback message:', persistError);
          }
        }
        return;
      }

      if (!response.success || !replyText) {
        throw new Error(response.message || 'Empty AI response');
      }

      // Reuse the optimistic draft for JSON responses, and remove it when a
      // separate streaming message was created. This prevents "Thinking..."
      // from remaining above the completed AI response.
      const aiMessageId = streamedMessageId || optimisticDraftId || nextMessageId('a');
      const aiCreatedAt = streamedCreatedAt || nowIso();
      const aiMessage: ChatMessage = {
        id: aiMessageId,
        sender: 'ai',
        text: replyText,
        createdAt: aiCreatedAt,
        recommendedDepartmentLabel,
        recommendedDoctors,
        bookingSlotOptions,
        bookingPrompt,
        agentSteps,
        showConsultNow: shouldShowConsultButton(
          replyText,
          reviewReason,
          consultRecommended,
          needsHumanReview,
          consultPriority,
          riskScore
        ),
      };

      if (conversationIdRef.current === requestConversationId) {
        setMessages((prev) => {
          const withoutThinking = prev.filter(
            (msg) => msg.id !== optimisticDraftId || msg.id === aiMessageId,
          );
          const existingIndex = withoutThinking.findIndex((msg) => msg.id === aiMessageId);
          if (existingIndex < 0) {
            return [...withoutThinking, aiMessage];
          }
          const next = [...withoutThinking];
          next[existingIndex] = { ...next[existingIndex], ...aiMessage };
          return next;
        });
      }
      if (!streamedMessageId && aiMessage.text.includes('\n')) {
        void revealMessageProgressively(aiMessageId, aiMessage.text, requestToken);
      }
      streamingMessageIdRef.current = null;

      if (requestConversationId) {
        try {
          await persistMessage(user.id, requestConversationId, aiMessage);
          refreshConversationList();
        } catch (persistError) {
          console.error('Failed to persist AI response message:', persistError);
        }
      }

      openBookingPaymentHandoff(response.data?.bookingConfirmation, requestConversationId);

      // Dedicated voice mode should rely on backend TTS audio from sendVoiceMessage.
      // Avoid forcing device-local TTS here because it sounds inconsistent across entry points/devices.
    } catch (error: any) {
      if (activeRequestTokenRef.current !== requestToken) {
        return;
      }

      if (streamingMessageIdRef.current) {
        const draftId = streamingMessageIdRef.current;
        setMessages((prev) => prev.filter((msg) => msg.id !== draftId));
        streamingMessageIdRef.current = null;
      }

      console.error('AI invoke failed:', error);
      const errorMessage =
        typeof error?.message === 'string' && error.message.trim().length > 0
          ? error.message.trim()
          : null;

      Toast.show({
        type: 'error',
        text1: 'AI chat error',
        text2: errorMessage || (AI_ONLY_RESPONSES ? 'No AI response received. Please retry.' : 'Could not fetch AI response.'),
      });
      const errorReply: ChatMessage = {
        id: nextMessageId('a'),
        sender: 'ai',
        text: 'I am having trouble generating a response right now. Please try again.',
        createdAt: nowIso(),
      };
      if (conversationIdRef.current === requestConversationId) {
        setMessages((prev) => [...prev, errorReply]);
      }
      if (requestConversationId) {
        try {
          await persistMessage(user.id, requestConversationId, errorReply);
        } catch (persistError) {
          console.error('Failed to persist AI error message:', persistError);
        }
      }
    } finally {
      streamAbortControllerRef.current = null;
      streamingMessageIdRef.current = null;
      activeWsRequestIdRef.current = null;
      if (activeRequestTokenRef.current === requestToken) {
        activeRequestTokenRef.current = null;
        setIsSending(false);
        isSendingRef.current = false;
      }
    }
  };

  const speakText = async (text: string, audioBase64?: string, audioMimeType?: string) => {
    await stopActiveVoicePlayback({ resetStage: false });
    setVoiceStage('speaking');

    // 2. Clear markdown and simple tags for cleaner speech
    const cleanText = text
      .replace(/<[^>]*>/g, '') // Remove HTML-like tags
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove markdown links
      .replace(/[*#_~`>]/g, '') // Remove markdown special chars
      .trim();

    if (!cleanText) {
      setVoiceStage('idle');
      return;
    }

    // 3. Play Backend Audio if provided
    const playedBackendAudio = audioBase64
      ? await playVoiceAudioBase64(audioBase64, audioMimeType)
      : false;

    if (voiceOpenAiAudioOnlyRef.current) {
      if (!playedBackendAudio) {
        console.warn('[AI Voice] OpenAI audio-only mode is enabled; skipping browser speech fallback.');
        setVoiceStage('idle');
      }
      return;
    }

    if (!playedBackendAudio) {
      // 4. Fallback to Local TTS
      activeSpeechRef.current = true;
      Speech.speak(cleanText, { 
        language: resolveSpeechLocale(cleanText),
        pitch: 1.08,
        rate: 1.0,
        onDone: () => {
          activeSpeechRef.current = false;
          setVoiceStage('idle');
        },
        onError: () => {
          activeSpeechRef.current = false;
          setVoiceStage('idle');
        },
      });
    }
  };

  const playNextServerVoiceAudioChunk = React.useCallback(async () => {
    if (isPlayingServerVoiceAudioRef.current) return;
    
    const nextIdx = nextExpectedVoiceAudioIndexRef.current;
    const chunk = serverVoiceAudioChunksMapRef.current.get(nextIdx);
    if (!chunk) {
      isPlayingServerVoiceAudioRef.current = false;
      return;
    }

    isPlayingServerVoiceAudioRef.current = true;
    serverVoiceAudioChunksMapRef.current.delete(nextIdx);
    nextExpectedVoiceAudioIndexRef.current = nextIdx + 1;

    try {
      setVoiceStage('speaking');
    const sourceUri = `data:${chunk.mimeType || 'audio/mpeg'};base64,${chunk.audio}`;
      
      const created = await Audio.Sound.createAsync(
        { uri: sourceUri },
        { shouldPlay: true }
      );
      const sound = created.sound;
      activeVoiceSoundRef.current = sound;
      
      await new Promise<void>((resolve) => {
        let finished = false;
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (!status?.isLoaded) {
            if (!finished) {
              finished = true;
              resolve();
            }
            return;
          }
          if (status?.didJustFinish) {
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
      console.warn('[AI WS Client] Server audio chunk playback failed:', error);
    } finally {
      isPlayingServerVoiceAudioRef.current = false;
      setVoiceStage('idle');
      void playNextServerVoiceAudioChunk();
    }
  }, [setVoiceStage]);

  const handleServerVoiceAudioChunk = React.useCallback((
    audioBase64: string,
    text: string,
    index: number,
    mimeType?: string
  ) => {
    if (!Number.isFinite(index) || index < 0) {
      return;
    }
    if (index < nextExpectedVoiceAudioIndexRef.current) {
      return;
    }
    if (serverVoiceAudioChunksMapRef.current.has(index)) {
      return;
    }
    if (!hasReceivedServerVoiceAudioChunksRef.current) {
      voiceLiveSpeechQueueRef.current = [];
      voiceLiveSpeechBusyRef.current = false;
      voiceLiveSpokenCharsRef.current = 0;
      if (activeSpeechRef.current) {
        try {
          void Speech.stop();
        } catch (error) {
          console.warn('[AI WS Client] Failed to stop local speech before server audio playback:', error);
        }
        activeSpeechRef.current = false;
      }
    }
    hasReceivedServerVoiceAudioChunksRef.current = true;
    serverVoiceAudioChunksMapRef.current.set(index, { audio: audioBase64, text, mimeType });
    void playNextServerVoiceAudioChunk();
  }, [playNextServerVoiceAudioChunk]);

  handleServerVoiceAudioChunkRef.current = handleServerVoiceAudioChunk;

  const playVoiceAudioBase64 = async (audioBase64: string, audioMimeType?: string): Promise<boolean> => {
    const trimmed = (audioBase64 || '').trim();
    if (!trimmed) return false;
    try {
      await stopActiveVoicePlayback({ resetStage: false });
      const mimeType = (audioMimeType || 'audio/wav').trim() || 'audio/wav';
      const sourceUri = `data:${mimeType};base64,${trimmed}`;
      const created = await Audio.Sound.createAsync(
        { uri: sourceUri },
        { shouldPlay: true }
      );
      const sound = created.sound;
      activeVoiceSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (!status?.isLoaded || status?.didJustFinish) {
          sound.unloadAsync().catch(() => undefined);
          if (activeVoiceSoundRef.current === sound) {
            activeVoiceSoundRef.current = null;
          }
          if (status?.didJustFinish) {
            setVoiceStage('idle');
          }
        }
      });
      return true;
    } catch (error) {
      console.warn('Failed to play voice audio:', error);
      setVoiceStage('idle');
      return false;
    }
  };

  const processVoiceLiveSpeechQueue = React.useCallback(async () => {
    if (hasReceivedServerVoiceAudioChunksRef.current) return;
    if (voiceOpenAiAudioOnlyRef.current) return;
    if (voiceLiveSpeechBusyRef.current) return;
    voiceLiveSpeechBusyRef.current = true;
    try {
      while (voiceLiveSpeechQueueRef.current.length > 0) {
        if (!isSendingRef.current) break;
        setVoiceStage('speaking', 'Speaking response while finalizing guidance.');
        const next = voiceLiveSpeechQueueRef.current.shift();
        const clean = (next || '').trim();
        if (!clean) continue;
        const pacing = resolveSpeechPacing(clean);
        await new Promise<void>((resolve) => {
          activeSpeechRef.current = true;
          Speech.speak(clean, {
            language: resolveSpeechLocale(clean),
            pitch: 1.08,
            rate: pacing.rate,
            onDone: () => {
              activeSpeechRef.current = false;
              resolve();
            },
            onError: () => {
              activeSpeechRef.current = false;
              resolve();
            },
          });
        });
        if (pacing.pauseMs > 0) {
          await sleepFor(pacing.pauseMs);
        }
      }
    } finally {
      voiceLiveSpeechBusyRef.current = false;
      if (!isSendingRef.current) {
        setVoiceStage('idle');
      }
    }
  }, [setVoiceStage]);

  const revealMessageProgressively = React.useCallback(async (
    messageId: string,
    finalText: string,
    requestToken: string
  ) => {
    const chunks = splitIntoReadableSegments(finalText);
    if (chunks.length <= 1) return;
    let built = '';
    for (let idx = 0; idx < chunks.length; idx += 1) {
      if (activeRequestTokenRef.current !== requestToken) return;
      built = built ? `${built}\n${chunks[idx]}` : chunks[idx];
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, text: built } : msg))
      );
      if (idx < chunks.length - 1) {
        await sleepFor(70);
      }
    }
  }, []);

  const sendVoiceMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isLoadingConversation) {
      return;
    }
    if (isSendingRef.current) {
      Toast.show({
        type: 'info',
        text1: 'One response at a time',
        text2: 'Please wait, or stop the current response first.',
      });
      return;
    }
    if (!user?.id) {
      Toast.show({
        type: 'error',
        text1: 'Session required',
        text2: 'Please login again to continue AI chat.',
      });
      return;
    }

    // Lock immediately to avoid duplicate voice submits.
    setIsSending(true);
    isSendingRef.current = true;
    setVoiceStage('processing', 'Sending your symptom details to the AI voice assistant.');
    voiceOpenAiAudioOnlyRef.current = true;
    serverVoiceAudioChunksMapRef.current.clear();
    nextExpectedVoiceAudioIndexRef.current = 0;
    isPlayingServerVoiceAudioRef.current = false;
    hasReceivedServerVoiceAudioChunksRef.current = false;
    voiceLiveSpeechQueueRef.current = [];
    voiceLiveSpeechBusyRef.current = false;
    voiceLiveSpokenCharsRef.current = 0;

    let targetConversationId = conversationIdRef.current;
    if (!targetConversationId) {
      try {
        targetConversationId = await createConversation(user.id, text);
        setConversationId(targetConversationId);
        conversationIdRef.current = targetConversationId;
        refreshConversationList();
      } catch (error) {
        console.error('Failed to create conversation before voice message:', error);
        Toast.show({
          type: 'error',
          text1: 'Conversation error',
          text2: 'Could not start conversation. Please retry.',
        });
        setVoiceStage('idle');
        setIsSending(false);
        isSendingRef.current = false;
        return;
      }
    }

    await maybeShowContinuousChatRestReminder(targetConversationId);

    const userMessage: ChatMessage = { id: nextMessageId('u'), sender: 'user', text, createdAt: nowIso() };
    const voiceDraftId = nextMessageId('a');
    const voiceDraftCreatedAt = nowIso();
    voiceLiveDraftIdRef.current = voiceDraftId;
    setIsVoiceDeltaLive(false);
    const requestConversationId = targetConversationId;
    const requestToken = `voice-${Date.now()}-${++requestCounterRef.current}`;
    activeRequestTokenRef.current = requestToken;
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: voiceDraftId,
        sender: 'ai',
        text: activeAgentProgressHint || AGENT_PROGRESS_HINTS[0] || 'Processing...',
        createdAt: voiceDraftCreatedAt,
      },
    ]);
    setInput('');

    if (requestConversationId) {
      void persistMessage(user.id, requestConversationId, userMessage)
        .then(() => {
          refreshConversationList();
        })
        .catch((error) => {
          console.error('Failed to persist voice user message:', error);
        });
    }

    try {
      let voiceStreamedText = '';
      let voiceLiveSpokenViaDelta = false;
      let voiceStreamProducedOutput = false;
      voiceLiveSpeechQueueRef.current = [];
      voiceLiveSpeechBusyRef.current = false;
      voiceLiveSpokenCharsRef.current = 0;

      const ensureActiveSession = async (): Promise<string> => {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw new Error(sessionError.message || 'Could not read auth session');
        }

        let currentSession = sessionData.session;
        if (!currentSession?.access_token) {
          throw new Error('Session not available for voice AI call.');
        }

        const expiryInMs = (currentSession.expires_at || 0) * 1000;
        const expiresSoon = expiryInMs > 0 && expiryInMs <= Date.now() + 60_000;
        if (expiresSoon) {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshed.session?.access_token) {
            throw new Error(refreshError?.message || 'Could not refresh auth session for voice AI call.');
          }
          currentSession = refreshed.session;
        }

        if (!isLikelyJwt(currentSession.access_token)) {
          throw new Error('Session token format is invalid for voice AI call.');
        }

        return currentSession.access_token;
      };

      // Keep voice context compact so the first answer is generated quickly.
      const historyForVoice = buildHistoryForApi(messagesRef.current, 5);
      const baseVoiceRequestBody = {
        message: text,
        concern,
        conversationId: requestConversationId,
        mode: isAssistantMode ? 'assistant' : 'guided',
        voicePersona: 'female',
        history: historyForVoice,
        locationCity,
        searchAreaCity: locationCity,
        preferLocalPlayback: false,
        fastResponse: true,
        quick: true,
        ttsMode: CHAT_VOICE_TTS_MODE,
      };

      const canUseAgentWebSocket = (): boolean => {
        if (!AGENT_WS_MODE) return false;
        if (!AGENT_WS_ENDPOINT) return false;
        return true;
      };

      const canAttemptVoiceStreaming = (): boolean => {
        if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) return false;
        if (!hasReadableStreamSupport()) return false;
        if (voiceStreamCapabilityRef.current === 'unsupported') return false;
        return true;
      };

      const invokeVoiceChatJson = async (accessToken: string): Promise<any> => {
        if (FUNCTIONS_BASE_URL && SUPABASE_ANON_KEY) {
          const controller = new AbortController();
          voiceAbortControllerRef.current = controller;
          const response = await fetch(`${FUNCTIONS_BASE_URL}/functions/v1/chat-ai`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: SUPABASE_ANON_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...baseVoiceRequestBody, stream: false }),
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || `Voice chat failed (${response.status})`);
          }
          return payload;
        }

        const functionsClient = supabase.functions;
        functionsClient.setAuth(accessToken);
        const { data, error } = await functionsClient.invoke('chat-ai', {
          body: { ...baseVoiceRequestBody, stream: false },
        });
        if (error || !data?.success) {
          throw new Error(data?.message || error?.message || 'Voice chat failed');
        }
        return data;
      };

      const invokeVoiceChatWebSocket = async (accessToken: string): Promise<any> => {
        if (!canUseAgentWebSocket()) {
          throw new Error('Voice websocket transport unavailable.');
        }
        setVoiceStage('processing', 'Connecting to realtime voice channel.');
        const wsRequestId = `voice-${requestToken}`;
        activeWsRequestIdRef.current = wsRequestId;
        let wsPayload: any;
        try {
          wsPayload = await sendAgentWsRequest({
            accessToken,
            requestId: wsRequestId,
            type: 'chat.message',
            payload: { ...baseVoiceRequestBody, stream: false },
            timeoutMs: 18000,
            onStage: (stage) => {
              const normalized = String(stage || '').trim().toLowerCase();
              if (normalized === 'processing_voice') {
                setVoiceStage('processing', 'Analyzing symptoms and preparing voice-safe guidance.');
              } else if (normalized) {
                setVoiceStage('processing', `Working on: ${normalized.replace(/_/g, ' ')}`);
              }
            },
          });
        } finally {
          if (activeWsRequestIdRef.current === wsRequestId) {
            activeWsRequestIdRef.current = null;
          }
        }
        if (!wsPayload || typeof wsPayload !== 'object') {
          throw new Error('Voice websocket completed without payload.');
        }
        return wsPayload;
      };

      const invokeVoiceChatStream = async (accessToken: string): Promise<any> => {
        if (!FUNCTIONS_BASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error('Streaming endpoint is not configured.');
        }
        setVoiceStage('processing', 'Switching to streaming fallback for faster response.');

        const controller = new AbortController();
        voiceAbortControllerRef.current = controller;

        const response = await fetch(`${FUNCTIONS_BASE_URL}/functions/v1/chat-ai`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ ...baseVoiceRequestBody, stream: true }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          let parsedMessage = `Voice stream request failed (${response.status})`;
          if (errorText) {
            try {
              const parsed = JSON.parse(errorText);
              parsedMessage = parsed?.message || parsedMessage;
            } catch {
              parsedMessage = errorText;
            }
          }
          throw new Error(parsedMessage);
        }

        const reader = (response as any)?.body?.getReader?.();
        if (!reader) {
          voiceStreamCapabilityRef.current = 'unsupported';
          const fallbackText = await response.text().catch(() => '');
          const recoveredPayload = extractPayloadFromSseOrJsonText(fallbackText);
          if (recoveredPayload) {
            return recoveredPayload;
          }
          throw new Error('STREAM_UNSUPPORTED: Streaming reader is unavailable on this device.');
        }
        voiceStreamCapabilityRef.current = 'supported';

        const decoder = new TextDecoder();
        let buffer = '';
        let finalPayload: any = null;
        let shouldStopReading = false;
        let sawAnyStreamOutput = false;
        let streamedAudioTranscript = '';

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
              if (textDelta) {
                sawAnyStreamOutput = true;
                voiceStreamProducedOutput = true;
                setIsVoiceDeltaLive(true);
                voiceStreamedText += textDelta;
                setMessages((prev) =>
                  prev.map((msg) => (
                    msg.id === voiceDraftId
                      ? { ...msg, text: voiceStreamedText }
                      : msg
                  ))
                );

                // Keep voice delivery as one complete response. Speaking each
                // streamed text chunk creates audible pauses and can overlap
                // with backend audio chunks.
                if (!voiceOpenAiAudioOnlyRef.current) {
                  const speakableText = voiceStreamedText.slice(voiceLiveSpokenCharsRef.current);
                  const segments = splitIntoReadableSegments(speakableText);
                  if (segments.length > 1) {
                    const completeSegments = segments.slice(0, -1);
                    if (completeSegments.length > 0) {
                      const spokenNow = completeSegments.join(' ').trim();
                      if (spokenNow) {
                        voiceLiveSpokenViaDelta = true;
                        voiceLiveSpokenCharsRef.current += spokenNow.length + 1;
                        voiceLiveSpeechQueueRef.current.push(...completeSegments);
                        void processVoiceLiveSpeechQueue();
                      }
                    }
                  }
                }
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

            if (event.event === 'audio-chunk') {
              const audioBase64 =
                typeof event.data?.audio === 'string'
                  ? event.data.audio.trim()
                  : '';
              if (audioBase64) {
                sawAnyStreamOutput = true;
                voiceStreamProducedOutput = true;
                const chunkText = typeof event.data?.text === 'string' ? event.data.text : '';
                if (chunkText.trim()) {
                  streamedAudioTranscript = `${streamedAudioTranscript} ${chunkText.trim()}`.trim();
                }
                handleServerVoiceAudioChunkRef.current?.(
                  audioBase64,
                  chunkText,
                  Number.isFinite(Number(event.data?.index)) ? Number(event.data.index) : 0,
                  typeof event.data?.mimeType === 'string' ? event.data.mimeType : undefined
                );
              }
              continue;
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
                (messagePayload.success === true || typeof messagePayload?.data?.reply === 'string' || typeof messagePayload?.data?.text === 'string');
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
              if (textDelta) {
                sawAnyStreamOutput = true;
                voiceStreamProducedOutput = true;
                setIsVoiceDeltaLive(true);
                voiceStreamedText += textDelta;
                setMessages((prev) =>
                  prev.map((msg) => (
                    msg.id === voiceDraftId
                      ? { ...msg, text: voiceStreamedText }
                      : msg
                  ))
                );
              }
              continue;
            }
            if (event.event === 'done') {
              finalPayload = event.data;
              break;
            }
            if (event.event === 'audio-chunk') {
              const audioBase64 =
                typeof event.data?.audio === 'string'
                  ? event.data.audio.trim()
                  : '';
              if (audioBase64) {
                sawAnyStreamOutput = true;
                const chunkText = typeof event.data?.text === 'string' ? event.data.text : '';
                if (chunkText.trim()) {
                  streamedAudioTranscript = `${streamedAudioTranscript} ${chunkText.trim()}`.trim();
                }
                handleServerVoiceAudioChunkRef.current?.(
                  audioBase64,
                  chunkText,
                  Number.isFinite(Number(event.data?.index)) ? Number(event.data.index) : 0,
                  typeof event.data?.mimeType === 'string' ? event.data.mimeType : undefined
                );
              }
              continue;
            }
            if (event.event === 'message') {
              const messagePayload = event.data;
              const isStructuredPayload =
                messagePayload &&
                typeof messagePayload === 'object' &&
                (messagePayload.success === true || typeof messagePayload?.data?.reply === 'string' || typeof messagePayload?.data?.text === 'string');
              if (isStructuredPayload) {
                finalPayload = messagePayload;
                break;
              }
            }
          }
        }

        if (!finalPayload) {
          if (sawAnyStreamOutput) {
            const partialText = (voiceStreamedText || streamedAudioTranscript || '').trim();
            return {
              success: true,
              data: {
                text: partialText,
                message: partialText,
                reply: partialText,
                audio: '',
                audioMimeType: undefined,
                source: 'voice_stream_partial',
              },
            };
          }
          throw new Error('Voice stream completed without payload.');
        }
        return finalPayload;
      };

      let accessToken = await ensureActiveSession();
      let responseContent: any = null;

      // Force SSE-first for stronger live incremental UX.
      if (!responseContent && canAttemptVoiceStreaming()) {
        try {
          responseContent = await invokeVoiceChatStream(accessToken);
        } catch (streamError: any) {
          const streamMessage =
            typeof streamError?.message === 'string' ? streamError.message : 'Voice streaming failed.';
          if (isJwtAuthError(streamMessage)) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token && isLikelyJwt(refreshed.session.access_token)) {
              accessToken = refreshed.session.access_token;
              responseContent = await invokeVoiceChatStream(accessToken);
            } else {
              throw new Error('Voice request rejected due to auth token mismatch. Please login again and retry.');
            }
          } else if (isStreamUnsupportedError(streamMessage)) {
            voiceStreamCapabilityRef.current = 'unsupported';
          } else if (voiceStreamProducedOutput) {
            // Never send the same user turn through another AI transport after
            // a stream has already produced content.
            responseContent = {
              success: true,
              data: {
                text: voiceStreamedText.trim(),
                message: voiceStreamedText.trim(),
                reply: voiceStreamedText.trim(),
                source: 'voice_stream_partial',
              },
            };
          } else {
            console.warn('Voice stream failed, falling back to JSON:', streamError);
          }
        }
      }

      if (!responseContent && canUseAgentWebSocket()) {
        try {
          responseContent = await invokeVoiceChatWebSocket(accessToken);
          console.log('[Voice Chat] transport: websocket (post-stream fallback)');
        } catch (wsError: any) {
          const wsMessage =
            typeof wsError?.message === 'string' ? wsError.message : 'Voice websocket failed.';
          console.warn('[Voice Chat] websocket fallback failed:', wsMessage);
        }
      }

      if (!responseContent) {
        try {
          responseContent = await invokeVoiceChatJson(accessToken);
        } catch (error: any) {
          if (isJwtAuthError(typeof error?.message === 'string' ? error.message : '')) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token && isLikelyJwt(refreshed.session.access_token)) {
              accessToken = refreshed.session.access_token;
              responseContent = await invokeVoiceChatJson(accessToken);
            } else {
              throw new Error('Voice request rejected due to auth token mismatch. Please login again and retry.');
            }
          } else {
            throw error;
          }
        }
      }

      if (activeRequestTokenRef.current !== requestToken) {
        return;
      }

      const responseData = responseContent?.data || {};
      setVoiceStage('processing', 'Finalizing medical response and preparing voice output.');
      const parsedVoiceRateLimit = parseAiRateLimitState(responseData?.rateLimit);
      if (parsedVoiceRateLimit) {
        setAiRateLimit(parsedVoiceRateLimit);
        setHasRateLimitSnapshot(true);
      }
      const rawAiText = typeof responseData?.text === 'string' ? responseData.text.trim() : '';
      const aiText = normalizeRateLimitReplyForPlan(rawAiText, parsedVoiceRateLimit, isProUser);
      if (!aiText) {
        throw new Error('Voice chat returned empty response');
      }

      const audioBase64 = typeof responseData?.audio === 'string' ? responseData.audio : '';
      const audioMimeType = typeof responseData?.audioMimeType === 'string' ? responseData.audioMimeType : undefined;
      const reviewReason = typeof responseData?.reviewReason === 'string' ? responseData.reviewReason : undefined;
      const needsHumanReview = Boolean(responseData?.needsHumanReview);
      const consultRecommended = Boolean(responseData?.consultRecommended);
      const consultPriority = typeof responseData?.consultPriority === 'string' ? responseData.consultPriority : undefined;
      const riskScore = Number(responseData?.riskScore || 0);
      const recommendedDepartmentLabel =
        typeof responseData?.departmentSuggestion?.label === 'string'
          ? responseData.departmentSuggestion.label
          : undefined;
      const recommendedDoctors = normalizeRecommendedDoctors(responseData?.doctorRecommendations);
      const bookingSlotOptions = normalizeBookingSlotOptions(responseData?.bookingPreparation?.slotOptions);
      const agentSteps = normalizeAgentToolSteps(
        responseData?.orchestrator?.toolsExecuted,
        responseData?.orchestrator?.autonomousToolSteps
      );
      const bookingPrompt =
        typeof responseData?.bookingPrompt === 'string' && responseData.bookingPrompt.trim()
          ? responseData.bookingPrompt.trim()
          : undefined;
      
      // 3. Update local state and persist response
      const aiMessage: ChatMessage = {
        id: voiceDraftId,
        sender: 'ai',
        text: aiText,
        createdAt: voiceDraftCreatedAt,
        recommendedDepartmentLabel,
        recommendedDoctors,
        bookingSlotOptions,
        bookingPrompt,
        agentSteps,
        showConsultNow: shouldShowConsultButton(
          aiText,
          reviewReason,
          consultRecommended,
          needsHumanReview,
          consultPriority,
          riskScore
        ),
      };

      if (conversationIdRef.current === requestConversationId && activeRequestTokenRef.current === requestToken) {
        setMessages((prev) => {
          const existingIndex = prev.findIndex((msg) => msg.id === voiceDraftId);
          if (existingIndex < 0) return [...prev, aiMessage];
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], ...aiMessage };
          return next;
        });
      }

      if (requestConversationId) {
        try {
          await persistMessage(user.id, requestConversationId, aiMessage);
          refreshConversationList();
        } catch (persistError) {
          console.error('Failed to persist voice AI response:', persistError);
        }
      }

      // 4. Speak the response (prefer base64 audio) when live delta speech was not already used.
      if (!hasReceivedServerVoiceAudioChunksRef.current && (voiceOpenAiAudioOnlyRef.current || !voiceLiveSpokenViaDelta)) {
        void speakText(aiText, audioBase64, audioMimeType);
      }
      openBookingPaymentHandoff(responseData?.bookingConfirmation, requestConversationId);
      setIsVoiceDeltaLive(false);
    } catch (error: any) {
      if (activeRequestTokenRef.current !== requestToken) {
        return;
      }
      const errorMessage = typeof error?.message === 'string' ? error.message : '';
      if (error?.name === 'AbortError' || errorMessage.toLowerCase().includes('aborted')) {
        setVoiceStage('idle');
        return;
      }
      console.error('Voice send failed:', error);
      setIsVoiceDeltaLive(false);
      setVoiceStage('idle');
      Toast.show({
        type: 'error',
        text1: 'Voice chat error',
        text2: errorMessage || 'Could not fetch voice response.',
      });
      const errorReply: ChatMessage = {
        id: nextMessageId('a'),
        sender: 'ai',
        text: 'I am having trouble with voice right now. Please try again.',
        createdAt: nowIso(),
      };
      if (conversationIdRef.current === requestConversationId) {
        setMessages((prev) => [...prev, errorReply]);
      }
    } finally {
      voiceAbortControllerRef.current = null;
      activeWsRequestIdRef.current = null;
      voiceLiveDraftIdRef.current = null;
      setIsVoiceDeltaLive(false);
      if (activeRequestTokenRef.current === requestToken) {
        activeRequestTokenRef.current = null;
        setIsSending(false);
        isSendingRef.current = false;
      }
    }
  };

  const handleSend = () => {
    if (isLoadingConversation) return;
    if (isVoiceEnabledOnThisScreen && !pendingAttachment) {
      void sendVoiceMessage(input);
      return;
    }
    void sendMessage(input, undefined, pendingAttachment);
  };

  useSpeechRecognitionEventSafe<null>('start', (_event) => {
    void stopActiveVoicePlayback();
    setIsListening(true);
    setIsVoicePromptVisible(true);
    setVoiceStage('listening');
  });

  useSpeechRecognitionEventSafe<null>('end', (_event) => {
    setIsListening(false);
    if (isSendingRef.current) {
      setVoiceStage('processing');
    } else {
      setVoiceStage('idle');
      setIsVoicePromptVisible(false);
    }
  });

  useSpeechRecognitionEventSafe<SpeechRecognitionResultEvent>('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) {
      return;
    }

    setInput(transcript);

    if (event.isFinal) {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
      }

      autoSubmitTimerRef.current = setTimeout(() => {
        const normalized = transcript.trim();
        if (!normalized) {
          setVoiceStage('idle');
          return;
        }

        const now = Date.now();
        const isDuplicateBurst =
          lastVoiceSubmitRef.current.text === normalized.toLowerCase() &&
          // Speech recognition may emit the same final result again after the
          // native recognizer closes. Keep the same turn locked through the
          // full AI response window.
          now - lastVoiceSubmitRef.current.at < 10000;

        if (isDuplicateBurst) {
          setVoiceStage('idle');
          return;
        }

        lastVoiceSubmitRef.current = {
          text: normalized.toLowerCase(),
          at: now,
        };
        setVoiceStage('processing', 'Analyzing your voice input...');
        void sendVoiceMessage(normalized);
      }, voiceAutoSubmitDelayMs);
    }
  });

  useSpeechRecognitionEventSafe<SpeechRecognitionErrorEvent>('error', (event) => {
    setIsListening(false);
    setVoiceStage('idle');

    if (isBenignSpeechRecognitionError(event.message)) {
      return;
    }

    showVoiceFallbackHint('Voice capture failed. Continue by typing your symptoms below.');
    Toast.show({
      type: 'error',
      text1: 'Voice input error',
      text2: event.message || 'Could not capture voice input.',
    });
  });

  useEffect(() => {
    return () => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
      }
      if (voiceFallbackTimerRef.current) {
        clearTimeout(voiceFallbackTimerRef.current);
      }
      activeRequestTokenRef.current = null;
      if (voiceAbortControllerRef.current) {
        voiceAbortControllerRef.current.abort();
        voiceAbortControllerRef.current = null;
      }

      try {
        ExpoSpeechRecognitionModule?.abort();
      } catch (e) {
        console.warn('Speech recognition abort failed:', e);
      }
      void stopActiveVoicePlayback({ resetStage: false });
    };
  }, [stopActiveVoicePlayback]);

  const handleVoiceModalClose = () => {
    try {
      if (isListening && ExpoSpeechRecognitionModule) {
        ExpoSpeechRecognitionModule.stop();
      } else {
        ExpoSpeechRecognitionModule?.abort();
      }
    } catch (e) {
      console.warn('Speech recognition close failed:', e);
    }

    setIsVoicePromptVisible(false);
    setVoiceStage('idle');
    void stopActiveVoicePlayback();
  };

  const openVoiceModal = () => {
    // Opening the modal must not request the microphone or start listening.
    // Listening begins only after the user taps Start inside the modal.
    setIsVoicePromptVisible(true);
    setVoiceStage('idle', 'Tap Start when you are ready to speak.');
  };

  const handleMicPress = async (forceVoiceCapture: boolean = false) => {
    if (isSendingRef.current) {
      interruptActiveResponse(false);
    }

    if (isListening) {
      ExpoSpeechRecognitionModule?.stop();
      setVoiceStage('processing', 'Finalizing your voice input...');
      return;
    }

    await stopActiveVoicePlayback();

    setIsVoicePromptVisible(true);

    if (!ExpoSpeechRecognitionModule) {
      Toast.show({
        type: 'error',
        text1: 'Voice not available',
        text2: 'Speech recognition needs a dev build with expo-speech-recognition. In Expo Go, use the keyboard to continue.',
      });
      showVoiceFallbackHint('Voice not available on this device. Continue by typing your symptoms.');
      setIsVoicePromptVisible(false);
      setVoiceStage('idle');
      return;
    }

    try {
      const recognitionAvailable =
        typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function'
          ? ExpoSpeechRecognitionModule.isRecognitionAvailable()
          : true;
      if (!recognitionAvailable) {
        // Some Android release devices report false here even though start() still works.
        // Do not hard-block; continue and let start() attempt.
        console.warn('Speech recognition reported unavailable; attempting fallback start.');
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Toast.show({
          type: 'error',
          text1: 'Microphone permission denied',
          text2: 'Enable microphone access to use voice input.',
        });
        showVoiceFallbackHint('Microphone permission denied. Continue by typing your message.');
        setIsVoicePromptVisible(false);
        setVoiceStage('idle');
        return;
      }

      setVoiceStage('listening');
      ExpoSpeechRecognitionModule.start({
        lang: 'en-IN',
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Voice input error',
        text2: 'Could not start voice recognition.',
      });
      showVoiceFallbackHint('Voice could not start. Continue by typing your message.');
      setIsVoicePromptVisible(false);
      setVoiceStage('idle');
    }
  };

  useEffect(() => {
    if (isLoadingConversation) return;
    const seededText = initialMessage.trim();
    if (!seededText) {
      return;
    }
    if (initialMessageConsumedRef.current) {
      return;
    }

    const activeConversationId = conversationIdRef.current || 'no-conversation';
    const requestKey = `${activeConversationId}|${sessionSeed}|${seededText}`;
    if (initialMessageKeyRef.current === requestKey) {
      return;
    }
    initialMessageKeyRef.current = requestKey;
    initialMessageConsumedRef.current = true;

    setInput(seededText);

    const timer = setTimeout(() => {
      if (isVoiceEnabledOnThisScreen) {
        void sendVoiceMessage(seededText);
        return;
      }
      void sendMessage(seededText);
    }, 120);

    return () => clearTimeout(timer);
  }, [initialMessage, sessionSeed, isLoadingConversation, conversationId, isVoiceEnabledOnThisScreen]);

  useEffect(() => {
    if (isLoadingConversation) return;
    const draftText = draftMessage.trim();
    if (!draftText) {
      return;
    }

    const activeConversationId = conversationIdRef.current || 'no-conversation';
    const requestKey = `${activeConversationId}|${sessionSeed}|draft|${draftText}`;
    if (draftMessageKeyRef.current === requestKey) {
      return;
    }
    draftMessageKeyRef.current = requestKey;

    setInput((prev) => {
      if (prev.trim().length > 0) {
        return prev;
      }
      return draftText;
    });
  }, [draftMessage, sessionSeed, isLoadingConversation, conversationId]);

  // On Android, use a plain View with manual keyboard padding
  // On iOS, use KeyboardAvoidingView with padding behavior
  const Wrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const wrapperProps = Platform.OS === 'ios' ? { behavior: 'padding' as const, keyboardVerticalOffset: 0 } : {};
  const canSendMessage = (input.trim().length > 0 || Boolean(pendingAttachment)) && !isSending && !isLoadingConversation;
  const voiceStageIndexMap: Record<Exclude<VoiceLiveStage, 'idle'>, number> = {
    listening: 0,
    processing: 1,
    speaking: 2,
  };
  const activeVoiceStageIndex =
    voiceLiveStage === 'idle' ? -1 : voiceStageIndexMap[voiceLiveStage as Exclude<VoiceLiveStage, 'idle'>];

  const renderMessage = (msg: ChatMessage) => {
    const isStreamingDraft =
      msg.sender === 'ai' &&
      isSending &&
      Boolean(streamingMessageIdRef.current) &&
      streamingMessageIdRef.current === msg.id;
    const isVoiceLiveBadgeVisible =
      msg.sender === 'ai' &&
      isSending &&
      isVoiceDeltaLive &&
      Boolean(voiceLiveDraftIdRef.current) &&
      voiceLiveDraftIdRef.current === msg.id;

    return (
    <View key={msg.id} style={[styles.messageRow, msg.sender === 'user' ? styles.userRow : styles.aiRow]}>
      <View style={[styles.messageGroup, msg.sender === 'user' ? styles.userGroup : styles.aiGroup]}>
        <View
          style={[
            styles.messageBubble,
            msg.sender === 'user' ? styles.userBubble : styles.aiBubble,
            {
              backgroundColor: msg.sender === 'user' ? palette.userBubbleBg : palette.aiBubbleBg,
              borderColor: msg.sender === 'user' ? palette.userBubbleBg : palette.bubbleBorder,
            },
          ]}
        >
          {msg.sender === 'user' ? (
            <Text style={[styles.messageText, { color: palette.userBubbleText }]}>
              {msg.text}
            </Text>
          ) : isStreamingDraft ? (
            <Markdown style={aiMarkdownStyles}>
              {msg.text}
            </Markdown>
          ) : (
            <Markdown style={aiMarkdownStyles}>
              {msg.text}
            </Markdown>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4, gap: 4 }}>
            {isVoiceLiveBadgeVisible && (
              <View style={[styles.liveBadge, { backgroundColor: theme.tint + '22', borderColor: theme.tint + '55' }]}>
                <Text style={[styles.liveBadgeText, { color: theme.tint }]}>LIVE</Text>
              </View>
            )}
            <Text style={{ fontSize: 10, color: msg.sender === 'user' ? 'rgba(255,255,255,0.7)' : theme.textSecondary }}>
              {new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {msg.sender === 'user' && (
              <CheckCheck size={12} color="rgba(255,255,255,0.7)" />
            )}
          </View>
        </View>


        {msg.sender === 'ai' && msg.showConsultNow && (
          <TouchableOpacity
            style={[
              styles.consultButton,
              {
                backgroundColor: palette.consultBg,
                borderColor: palette.consultBorder,
              },
            ]}
            onPress={handleConsultNow}
            activeOpacity={0.9}
          >
            <Text style={[styles.consultButtonText, { color: palette.consultText }]}>Consult Now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
    );
  };

  const renderConversationItem = ({ item }: { item: PersistedConversationRow }) => {
    const isActiveConversation = item.id === conversationId;
    const statusLabel = isActiveConversation ? 'Started' : 'Ended';
    const title = item.title?.trim() || `${item.concern || 'General'} Chat`;
    const meta = formatConversationTimestamp(item.updated_at || item.created_at);

    return (
      <TouchableOpacity
        style={[
          styles.conversationCard,
          {
            backgroundColor: isActiveConversation ? theme.successLight : theme.background,
            borderColor: isActiveConversation ? theme.successBorder : theme.borderColor,
          },
        ]}
        activeOpacity={0.86}
        onPress={() => {
          void handleSelectConversation(item.id);
        }}
      >
        <View style={styles.conversationCardTopRow}>
          <Text style={[styles.conversationTitle, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          <View
            style={[
              styles.conversationStatusBadge,
              {
                backgroundColor: isActiveConversation ? theme.tint + '18' : theme.borderColor,
              },
            ]}
          >
            <Text
              style={[
                styles.conversationStatusText,
                { color: isActiveConversation ? theme.tint : theme.textSecondary },
              ]}
            >
              {statusLabel}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.conversationDeleteBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
            onPress={(event) => {
              event.stopPropagation?.();
              handleDeleteConversation(item.id, true);
            }}
            activeOpacity={0.85}
          >
            <Trash2 size={12} color="#D9534F" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.conversationMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {meta}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Wrapper
      style={[styles.screen, { backgroundColor: palette.pageBg, paddingBottom: Platform.OS === 'android' ? (keyboardHeight > 0 ? keyboardHeight + 2 : 0) : 0 }]}
      {...wrapperProps}
    >
      {/* Header (Matching chat-detail) */}
      <View style={[styles.header, { borderBottomColor: theme.borderColor, paddingTop: insets.top, height: 60 + insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <ArrowLeft size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={[styles.avatar, { backgroundColor: theme.tint + '15' }]}>
            {headerConcernImageSource ? (
              <Image source={headerConcernImageSource} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <Bot size={20} color={theme.tint} />
            )}
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: palette.title }]} numberOfLines={1} ellipsizeMode="tail">
              {screenTitle}
            </Text>
            <Text style={[styles.headerSubTitle, { color: palette.subTitle }]} numberOfLines={1} ellipsizeMode="tail">
              {screenSubTitle}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {isProUser ? (
            <View style={[styles.proBadge, { borderColor: theme.tint + '55', backgroundColor: theme.tint + '1A' }]}>
              <Star size={12} color={theme.tint} />
              <Text style={[styles.proBadgeText, { color: theme.tint }]}>PRO</Text>
            </View>
          ) : (
            <View style={[styles.quotaIndicatorWrap, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
              <Svg width={quotaRingSize} height={quotaRingSize}>
                <Circle
                  cx={quotaRingSize / 2}
                  cy={quotaRingSize / 2}
                  r={quotaRadius}
                  stroke={theme.borderColor}
                  strokeWidth={quotaStroke}
                  fill="transparent"
                />
                <Circle
                  cx={quotaRingSize / 2}
                  cy={quotaRingSize / 2}
                  r={quotaRadius}
                  stroke={quotaRingColor}
                  strokeWidth={quotaStroke}
                  strokeLinecap="round"
                  strokeDasharray={`${quotaCircumference} ${quotaCircumference}`}
                  strokeDashoffset={quotaDashOffset}
                  fill="transparent"
                  transform={`rotate(-90 ${quotaRingSize / 2} ${quotaRingSize / 2})`}
                />
              </Svg>
              <Text style={[styles.quotaRemainingText, { color: palette.title }]}>
                {quotaRemainingLabel}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={openChatActionsMenu}>
            <MoreVertical size={20} color={palette.title} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.chatBody}>
        {chatWallpaperSource ? (
          <View pointerEvents="none" style={styles.chatWallpaperWrap}>
            <Image
              source={chatWallpaperSource}
              style={[styles.chatWallpaperImage, { opacity: isDark ? 0.14 : 0.18 }]}
              resizeMode="contain"
            />
          </View>
        ) : null}
        <FlatList
          ref={flatListRef}
          inverted
          style={styles.chatList}
          contentContainerStyle={styles.chatListContent}
          data={[...messages].reverse()}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderMessage(item)}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={() => {
            if (isLoadingConversation && messages.length === 0) {
              return (
                <ThinkingIndicator 
                  text="Connecting to health agent..." 
                  palette={palette} 
                  theme={theme} 
                  isInitialLoad={true}
                />
              );
            }
            // The optimistic AI draft already renders the thinking state while
            // a message is being generated. Do not add a second global
            // indicator after the final reply has arrived but persistence is
            // still finishing.
            return null;
          }}
        />
      </View>

      {/* Input Area (Matching chat-detail) */}
      <View style={[
        styles.inputArea,
        {
          backgroundColor: theme.cardBackground,
          borderTopColor: theme.borderColor,
          paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12),
          paddingTop: 8,
          borderTopWidth: 1,
        }
      ]}>
        {isVoiceEnabledOnThisScreen && voiceFallbackHint ? (
          <View style={[styles.voiceFallbackHint, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
            <Text style={[styles.voiceFallbackHintText, { color: theme.textSecondary }]}>{voiceFallbackHint}</Text>
          </View>
        ) : null}
        {pendingAttachment ? (
          <View style={[styles.attachmentPreviewRow, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
            <Paperclip size={13} color={theme.tint} />
            <Text style={[styles.attachmentPreviewText, { color: theme.text }]} numberOfLines={1}>
              {formatAttachmentLabel(pendingAttachment)}
            </Text>
            <TouchableOpacity
              style={[styles.attachmentPreviewRemove, { borderColor: theme.borderColor }]}
              onPress={() => setPendingAttachment(null)}
              activeOpacity={0.85}
            >
              <X size={12} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}
        <View
          style={[
            styles.composerShell,
            {
              backgroundColor: isDark ? '#171A1F' : '#F7FAFC',
              borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(9,21,31,0.08)',
            },
          ]}
        >
        <View style={styles.inputRow}>
          {isVoiceEnabledOnThisScreen ? (
            <TouchableOpacity
              style={[
                styles.micButton,
                { backgroundColor: isListening ? '#D9534F' : theme.tint },
              ]}
              onPress={() => {
                openVoiceModal();
              }}
              activeOpacity={0.85}
            >
              <Mic size={16} color="#fff" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.attachmentButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
            onPress={handleAttachmentPress}
            activeOpacity={0.85}
            disabled={isAttachmentPicking || isSending || isLoadingConversation}
          >
            {isAttachmentPicking ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <Paperclip size={15} color={theme.textSecondary} />
            )}
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
            placeholder={isAssistantMode ? "Type symptoms or tap the mic..." : "Type your response..."}
            placeholderTextColor={palette.placeholder}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            multiline
            editable={!isSending && !isLoadingConversation}
          />
          <TouchableOpacity
            onPress={handleSend}
            style={[styles.sendButton, { backgroundColor: canSendMessage ? theme.tint : theme.borderColor }]}
            disabled={!canSendMessage}
          >
            <Send size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        </View>
      </View>

      <Modal
        visible={isVoicePromptVisible}
        transparent
        animationType="fade"
        onRequestClose={handleVoiceModalClose}
      >
        <View style={styles.voiceOverlay}>
          <TouchableOpacity style={styles.voiceBackdrop} activeOpacity={1} onPress={handleVoiceModalClose} />
          <View style={[styles.voiceSheet, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <TouchableOpacity
              style={[styles.voiceCloseBtn, { backgroundColor: theme.background, borderColor: theme.borderColor }]}
              onPress={handleVoiceModalClose}
              activeOpacity={0.85}
            >
              <X size={14} color={theme.textSecondary} />
            </TouchableOpacity>

            <View style={styles.voiceOrbWrap}>
              <Animated.View
                style={[
                  styles.voicePulse,
                  { backgroundColor: theme.tint + '33', transform: [{ scale: voicePulse }] },
                ]}
              />
              <View style={[styles.voiceOrb, { backgroundColor: theme.tint }]}>
                <Mic size={22} color="#fff" />
              </View>
            </View>

            <Text style={[styles.voiceTitle, { color: theme.text }]}>
              {getVoiceStageTitle(voiceLiveStage)}
            </Text>
            <Text style={[styles.voiceSubtitle, { color: theme.textSecondary }]}>
              {voiceStageHint}
            </Text>

            <View style={styles.voiceStageFlowRow}>
              {VOICE_STAGE_FLOW.map((stageItem, index) => {
                const isActive = index === activeVoiceStageIndex;
                const isCompleted = activeVoiceStageIndex > index;
                const baseColor = isCompleted || isActive ? theme.tint : theme.borderColor;
                const textColor = isActive ? theme.text : theme.textSecondary;
                return (
                  <View key={stageItem.key} style={styles.voiceStageItem}>
                    <View
                      style={[
                        styles.voiceStageDot,
                        {
                          borderColor: baseColor,
                          backgroundColor: isCompleted || isActive ? theme.tint : 'transparent',
                        },
                      ]}
                    />
                    <Text style={[styles.voiceStageLabel, { color: textColor }]}>{stageItem.label}</Text>
                    {index < VOICE_STAGE_FLOW.length - 1 ? (
                      <View style={[styles.voiceStageConnector, { backgroundColor: activeVoiceStageIndex > index ? theme.tint : theme.borderColor }]} />
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.voiceActionRow}>
              <TouchableOpacity
                style={[styles.voiceSecondaryBtn, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                onPress={handleVoiceModalClose}
                activeOpacity={0.85}
              >
                <Text style={[styles.voiceSecondaryText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.voicePrimaryBtn, { backgroundColor: theme.tint }]}
                onPress={() => {
                  if (voiceLiveStage === 'processing' || voiceLiveStage === 'speaking') {
                    interruptActiveResponse(true);
                    return;
                  }
                  void handleMicPress(true);
                }}
                activeOpacity={0.88}
              >
                {(voiceLiveStage === 'processing' || voiceLiveStage === 'speaking') ? (
                  <X size={14} color="#fff" />
                ) : (
                  <Mic size={14} color="#fff" />
                )}
                <Text style={styles.voicePrimaryText}>
                  {isListening ? 'Stop' : (voiceLiveStage === 'processing' || voiceLiveStage === 'speaking') ? 'Interrupt' : 'Start'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isConversationDrawerVisible}
        transparent
        animationType="none"
        onRequestClose={closeConversationMenu}
      >
        <View style={styles.conversationDrawerOverlay}>
          <TouchableOpacity
            style={styles.conversationDrawerBackdrop}
            activeOpacity={1}
            onPress={closeConversationMenu}
          />
          <Animated.View
            style={[
              styles.conversationDrawerPanel,
              {
                backgroundColor: theme.cardBackground,
                borderColor: theme.borderColor,
                paddingTop: insets.top + 10,
                transform: [{ translateX: conversationDrawerOffset }],
              },
            ]}
          >
            <View style={styles.conversationDrawerHeader}>
              <Text style={[styles.conversationDrawerTitle, { color: theme.text }]}>Conversations</Text>
              <TouchableOpacity
                style={[styles.conversationDrawerClose, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                onPress={closeConversationMenu}
                activeOpacity={0.85}
              >
                <X size={14} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.drawerHeroCard,
                {
                  backgroundColor: theme.tint + '14',
                  borderColor: theme.tint + '36',
                },
              ]}
            >
              <View style={[styles.drawerHeroIcon, { backgroundColor: theme.tint + '26' }]}>
                <Bot size={16} color={theme.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerHeroTitle, { color: theme.text }]}>AI Chat Threads</Text>
                <Text style={[styles.drawerHeroSubtitle, { color: theme.textSecondary }]}>
                  Continue previous chats or start a fresh consultation.
                </Text>
              </View>
            </View>

            <View style={styles.drawerMetaRow}>
              <Text style={[styles.drawerMetaText, { color: theme.textSecondary }]}>
                {conversationList.length} saved chats
              </Text>
              {isConversationListFetching && (
                <View style={styles.drawerSyncRow}>
                  <PulsingDot size={6} theme={theme} />
                  <Text style={[styles.drawerSyncText, { color: theme.textSecondary }]}>Syncing</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.newConversationBtn, { backgroundColor: theme.tint }]}
              activeOpacity={0.88}
              onPress={() => {
                void handleStartNewConversationFromDrawer();
              }}
            >
              <Text style={styles.newConversationBtnText}>Start New Conversation</Text>
            </TouchableOpacity>

            {isConversationListFetching && conversationList.length === 0 ? (
              <View style={styles.conversationListLoader}>
                <PulsingDot size={10} theme={theme} />
                <Text style={[styles.conversationListLoaderText, { color: theme.textSecondary, marginTop: 12 }]}>Loading consultations...</Text>
              </View>
            ) : (
              <FlatList
                data={conversationList}
                keyExtractor={(item) => item.id}
                renderItem={renderConversationItem}
                contentContainerStyle={styles.conversationListContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={styles.conversationListEmpty}>
                    <Text style={[styles.conversationListEmptyTitle, { color: theme.text }]}>No previous conversations</Text>
                    <Text style={[styles.conversationListEmptyText, { color: theme.textSecondary }]}>
                      Start a new one and it will appear here.
                    </Text>
                  </View>
                }
              />
            )}
          </Animated.View>
        </View>
      </Modal>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    marginRight: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSubTitle: { fontSize: 12, fontWeight: '500' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginLeft: 8,
    flexShrink: 0,
  },
  chatBody: {
    flex: 1,
    position: 'relative',
  },
  chatWallpaperWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  chatWallpaperImage: {
    width: '88%',
    height: '88%',
    maxWidth: 360,
    maxHeight: 360,
    opacity: 0.08,
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 32,
  },
  quotaIndicatorWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBadge: {
    minWidth: 50,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  proBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  quotaRemainingText: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '700',
  },
  messageRow: { marginBottom: 12, flexDirection: 'row', width: '100%' },
  aiRow: { justifyContent: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  messageGroup: { maxWidth: '85%' },
  aiGroup: { alignItems: 'flex-start' },
  userGroup: { alignItems: 'flex-end' },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  aiBubble: {
    borderTopLeftRadius: 4,
  },
  userBubble: {
    borderTopRightRadius: 4,
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  typingBubble: {
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  typingHintText: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '600',
  },
  liveBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.35,
  },
  typingDotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 12,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  consultButton: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  consultButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  recommendationCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    width: '100%',
  },
  recommendationTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  recommendationSubtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
  },
  recommendationDoctorRow: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recommendationDoctorMain: {
    flex: 1,
    marginRight: 8,
  },
  recommendationDoctorName: {
    fontSize: 13,
    fontWeight: '700',
  },
  recommendationDoctorMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
  },
  recommendationDoctorMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  recommendationMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 2,
  },
  recommendationMetaPillText: {
    marginLeft: 4,
    fontSize: 10,
    fontWeight: '600',
  },
  recommendationBookBtn: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendationBookBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  recommendationViewAllBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  recommendationViewAllBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  agentActivityCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    width: '100%',
  },
  agentActivityTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  agentActivityRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  agentActivityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  agentActivityStepText: {
    flex: 1,
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
    fontSize: 11,
    lineHeight: 15,
  },
  inputArea: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  composerShell: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#09151F',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  attachmentPreviewRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attachmentPreviewText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  attachmentPreviewRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 48,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopTypingBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stopTypingBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  voiceFallbackHint: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  voiceFallbackHintText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  conversationDrawerOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  conversationDrawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  conversationDrawerPanel: {
    width: '84%',
    maxWidth: 360,
    height: '100%',
    borderLeftWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: 16,
    shadowColor: '#09151F',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: -4, height: 0 },
    elevation: 14,
  },
  conversationDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  conversationDrawerTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  conversationDrawerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerHeroCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  drawerHeroIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  drawerHeroTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  drawerHeroSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
  drawerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  drawerMetaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  drawerSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  drawerSyncText: {
    fontSize: 11,
    fontWeight: '600',
  },
  newConversationBtn: {
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  newConversationBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  conversationListLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  conversationListLoaderText: {
    fontSize: 12,
    fontWeight: '500',
  },
  conversationListContent: {
    paddingBottom: 26,
  },
  conversationListEmpty: {
    marginTop: 30,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  conversationListEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  conversationListEmptyText: {
    marginTop: 6,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  conversationCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  conversationCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  conversationMeta: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '500',
  },
  conversationStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  conversationStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  conversationDeleteBtn: {
    marginLeft: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  voiceBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 14, 12, 0.72)',
  },
  voiceSheet: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    alignItems: 'center',
  },
  voiceCloseBtn: {
    alignSelf: 'flex-end',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceOrbWrap: {
    width: 136,
    height: 136,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  voicePulse: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
  },
  voiceOrb: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0C2E22',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  voiceTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
  },
  voiceSubtitle: {
    marginTop: 8,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  voiceStageFlowRow: {
    marginTop: 14,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  voiceStageItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceStageDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.6,
    marginRight: 6,
  },
  voiceStageLabel: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  voiceStageConnector: {
    flex: 1,
    height: 1.6,
    marginHorizontal: 8,
    borderRadius: 999,
  },
  voiceActionRow: {
    marginTop: 18,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  voiceSecondaryBtn: {
    width: '47%',
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  voicePrimaryBtn: {
    width: '47%',
    height: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  voicePrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
