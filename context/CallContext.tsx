import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, PermissionsAndroid, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from './AuthContext';
import Agora from '../src/lib/agora';
import { AGORA_APP_ID } from '../constants/Config';

export type CallStatus = 'idle' | 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
type CallType = 'audio' | 'video';
type AgoraTokenBundle = {
    token: string;
    uid: number;
};

type CallContextValue = {
    boundRoomId: string | null;
    activeCallRoomId: string | null;
    callStatus: CallStatus;
    callType: CallType | null;
    isCaller: boolean;
    agoraToken: string | null;
    remoteUid: number;
    isRemoteVideoMuted: boolean;
    isJoined: boolean;
    isAudioMuted: boolean;
    isVideoMuted: boolean;
    isSpeakerOn: boolean;
    connectedAt: number | null;
    hasOngoingCall: boolean;
    bindRoom: (roomId: string | null) => void;
    startCall: (roomId: string, type?: CallType) => Promise<void>;
    acceptCall: (roomId?: string | null) => Promise<void>;
    endCall: (roomId?: string | null) => Promise<void>;
    declineCall: (roomId?: string | null) => Promise<void>;
    toggleAudio: () => void;
    toggleVideo: () => void;
    toggleSpeaker: () => void;
};

const CallContext = createContext<CallContextValue | undefined>(undefined);

const RING_TIMEOUT_MS = 45000;
const STALE_RING_MS = RING_TIMEOUT_MS + 15000;
const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;
// How long to wait for the other person to join or come back before closing the call.
const NO_REMOTE_TIMEOUT_MS = 40000;
// A call shorter than this is a wrong number or a test, not a consultation.
const CONSULTATION_MIN_MS = 60000;
const LOCAL_END_WINDOW_MS = 8000;
const AGORA_CONNECTION_FAILED = 5;
const AGORA_ROLE_BROADCASTER = 1;
const INCOMING_VIBRATION = [0, 800, 1200];

// Only the caller's phone closes a call that nobody answered, so a crash can leave a row "ringing" for ever.
const isSessionStale = (session: { status?: string | null; created_at?: string | null }) => {
    const startedAt = new Date(session.created_at || '').getTime();
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt > (session.status === 'ringing' ? STALE_RING_MS : STALE_ACTIVE_MS);
};

const retireStaleSessions = async (roomId: string) => {
    await supabase
        .from('call_sessions')
        .update({ status: 'missed' })
        .eq('room_id', roomId)
        .eq('status', 'ringing')
        .lt('created_at', new Date(Date.now() - STALE_RING_MS).toISOString());
    await supabase
        .from('call_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('room_id', roomId)
        .eq('status', 'active')
        .lt('created_at', new Date(Date.now() - STALE_ACTIVE_MS).toISOString());
};

const startOfTodayLocal = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const parseDateOnlyToLocalDate = (value?: string | null): Date | null => {
    if (!value || typeof value !== 'string') return null;
    const parts = value.split('-').map((p) => Number(p));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
};

const addDays = (baseDate: Date, days: number) => {
    const copy = new Date(baseDate.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
};

const getLocalISODate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const extractFunctionInvokeErrorMessage = async (error: any): Promise<string> => {
    if (!error) return 'Unknown function invoke error';

    const context = (error as any)?.context as Response | undefined;
    if (context) {
        try {
            const payload = await context.clone().json();
            if (typeof payload?.message === 'string' && payload.message.trim()) {
                return payload.message.trim();
            }
            if (typeof payload?.error === 'string' && payload.error.trim()) {
                return payload.error.trim();
            }
        } catch {
            try {
                const text = await context.clone().text();
                if (text?.trim()) return text.trim();
            } catch {
                // no-op
            }
        }
    }

    if (typeof error?.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }
    return 'Function invoke failed.';
};

const getAgoraClientConfigError = () => {
    if (!AGORA_APP_ID.trim()) {
        return 'Calling is not available right now. Please try again later.';
    }
    return null;
};

const getAgoraTokenErrorMessage = (value?: string | null) => {
    const normalized = (value || '').trim();
    if (normalized === 'agora_credentials_missing') {
        return 'Calling is not available right now. Please try again later.';
    }
    if (normalized === 'service_env_missing') {
        return 'Calling is not available right now. Please try again later.';
    }
    if (normalized === 'missing_bearer_token' || normalized === 'invalid_or_expired_token') {
        return 'Login session expired. Please login again before starting a call.';
    }
    if (normalized === 'rate_limit_exceeded') {
        return 'Too many call attempts. Please wait a moment and try again.';
    }
    if (normalized === 'invalid_channel_name' || normalized === 'room_not_found') {
        return 'Call room is not valid. Please reopen the chat and try again.';
    }
    if (normalized === 'not_allowed_for_room') {
        return 'You are not allowed to start a call in this room.';
    }
    return normalized || 'Could not connect the call. Please try again.';
};

const AGORA_UID_MAX = 2147483647;

const getAgoraUidFromUserId = (userId?: string | null) => {
    const source = (userId || '').trim();
    if (!source) return 0;

    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }

    return (hash % AGORA_UID_MAX) + 1;
};

const normalizeAgoraUid = (value: unknown, fallbackUserId?: string | null) => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= AGORA_UID_MAX) {
        return parsed;
    }
    return getAgoraUidFromUserId(fallbackUserId);
};

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuthContext();
    const queryClient = useQueryClient();

    const [boundRoomId, setBoundRoomId] = useState<string | null>(null);
    const [activeCallRoomId, setActiveCallRoomId] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<CallStatus>('idle');
    const [callType, setCallType] = useState<CallType | null>(null);
    const [isCaller, setIsCaller] = useState(false);
    const [agoraToken, setAgoraToken] = useState<string | null>(null);
    const [localAgoraUid, setLocalAgoraUid] = useState<number | null>(null);
    const [remoteUid, setRemoteUid] = useState<number>(0);
    const [isRemoteVideoMuted, setIsRemoteVideoMuted] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoMuted, setIsVideoMuted] = useState(false);
    const [isSpeakerOn, setIsSpeakerOn] = useState(false);
    const [connectedAt, setConnectedAt] = useState<number | null>(null);
    const [appState, setAppState] = useState<AppStateStatus>((AppState.currentState ?? 'active') as AppStateStatus);

    const engineRef = useRef<any>(null);
    const roomChannelRef = useRef<any>(null);
    const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ongoingNotificationIdRef = useRef<string | null>(null);
    const callTonePlayerRef = useRef<AudioPlayer | null>(null);
    const activeToneRef = useRef<'incoming' | 'outgoing' | null>(null);
    const toneRequestRef = useRef(0);
    const isJoiningChannelRef = useRef(false);
    // True while a call is being set up: the row may not exist yet, so a read that finds nothing means nothing.
    const isCallTransitioningRef = useRef(false);
    // Bumped when the person hangs up, so a start still in progress knows to stop.
    const callAttemptRef = useRef(0);
    const activeSessionIdRef = useRef<string | null>(null);
    const localEndedAtRef = useRef(0);
    const connectedAtRef = useRef<number | null>(null);
    const callStatusRef = useRef<CallStatus>('idle');
    const isCallerRef = useRef(false);
    const activeRoomRef = useRef<string | null>(null);
    const fetchTokenRef = useRef<((channelName: string) => Promise<AgoraTokenBundle>) | null>(null);
    const endCallRef = useRef<((roomId?: string | null) => Promise<void>) | null>(null);

    callStatusRef.current = callStatus;
    isCallerRef.current = isCaller;
    activeRoomRef.current = activeCallRoomId;

    const hasOngoingCall = callStatus === 'ringing' || callStatus === 'active';
    const currentRoomId = activeCallRoomId || boundRoomId;

    // A hang-up on this phone beats a read that started just before the database was updated.
    const wasEndedHere = (createdAt?: string | null) => {
        if (Date.now() - localEndedAtRef.current > LOCAL_END_WINDOW_MS) return false;
        const startedAt = new Date(createdAt || '').getTime();
        return !Number.isFinite(startedAt) || startedAt <= localEndedAtRef.current;
    };

    const wasRealConsultation = () =>
        connectedAtRef.current !== null && Date.now() - connectedAtRef.current >= CONSULTATION_MIN_MS;

    const clearStatusResetTimer = useCallback(() => {
        if (statusResetRef.current) {
            clearTimeout(statusResetRef.current);
            statusResetRef.current = null;
        }
    }, []);

    const resetToIdle = useCallback(() => {
        setCallStatus('idle');
        setCallType(null);
        setIsCaller(false);
        setAgoraToken(null);
        setLocalAgoraUid(null);
        setIsAudioMuted(false);
        setIsVideoMuted(false);
        setIsSpeakerOn(false);
        setActiveCallRoomId(null);
        setBoundRoomId(null);
    }, []);

    const scheduleResetToIdle = useCallback((delayMs: number) => {
        if (statusResetRef.current) {
            clearTimeout(statusResetRef.current);
        }
        statusResetRef.current = setTimeout(() => {
            statusResetRef.current = null;
            resetToIdle();
        }, delayMs);
    }, [resetToIdle]);

    const cleanupEngine = useCallback(async () => {
        isJoiningChannelRef.current = false;
        connectedAtRef.current = null;
        setConnectedAt(null);
        if (engineRef.current) {
            try {
                engineRef.current.leaveChannel();
            } catch {
                // best-effort
            }
            try {
                engineRef.current.release();
            } catch {
                // best-effort
            }
            engineRef.current = null;
        }

        setIsJoined(false);
        setRemoteUid(0);
        setIsRemoteVideoMuted(false);
        setAgoraToken(null);
        setLocalAgoraUid(null);
        setIsAudioMuted(false);
        setIsSpeakerOn(false);
    }, []);

    const stopCallTone = useCallback(() => {
        toneRequestRef.current += 1;
        activeToneRef.current = null;
        if (Platform.OS !== 'web') Vibration.cancel();
        const activeSound = callTonePlayerRef.current;
        callTonePlayerRef.current = null;
        if (!activeSound) return;

        try {
            activeSound.pause();
        } catch {
            // best-effort
        }
        try {
            activeSound.remove();
        } catch {
            // best-effort
        }
    }, []);

    const startCallTone = useCallback(async (tone: 'incoming' | 'outgoing') => {
        if (Platform.OS === 'web') return;
        if (activeToneRef.current === tone) return;
        stopCallTone();
        activeToneRef.current = tone;
        const request = toneRequestRef.current;

        try {
            await setAudioModeAsync({
                allowsRecording: false,
                playsInSilentMode: true,
                interruptionMode: 'doNotMix',
                shouldRouteThroughEarpiece: false,
                shouldPlayInBackground: true,
            });
            // The call may have been answered or cancelled during the await. Starting now would ring for ever.
            if (request !== toneRequestRef.current) return;

            const sound = createAudioPlayer(tone === 'incoming' ? require('../assets/ringtone.wav') : require('../assets/ringback.wav'));
            sound.loop = true;
            sound.volume = tone === 'incoming' ? 1 : 0.5;
            sound.play();
            callTonePlayerRef.current = sound;
            if (tone === 'incoming') Vibration.vibrate(INCOMING_VIBRATION, true);
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to start call tone:', error);
            stopCallTone();
        }
    }, [stopCallTone]);

    const dismissOngoingCallNotification = useCallback(async () => {
        if (!ongoingNotificationIdRef.current) return;
        const notificationId = ongoingNotificationIdRef.current;
        ongoingNotificationIdRef.current = null;
        try {
            await Notifications.dismissNotificationAsync(notificationId);
        } catch {
            // no-op
        }
    }, []);

    const ensureOngoingCallNotification = useCallback(async () => {
        if (Platform.OS === 'web') return;
        if (!currentRoomId) return;
        if (!hasOngoingCall) return;
        if (ongoingNotificationIdRef.current) return;

        try {
            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title: callType === 'video' ? 'Video call in progress' : 'Audio call in progress',
                    body: 'Tap to return to the call.',
                    data: {
                        type: 'ongoing_call',
                        roomId: currentRoomId,
                    },
                    sound: false,
                },
                trigger: Platform.OS === 'android' ? { channelId: 'ongoing_call' } : null,
            });
            ongoingNotificationIdRef.current = notificationId;
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to schedule ongoing call notification:', error);
        }
    }, [callType, currentRoomId, hasOngoingCall]);

    const initEngine = useCallback(async (type: CallType) => {
        if (engineRef.current) return true;

        const configError = getAgoraClientConfigError();
        if (configError) {
            if (__DEV__) console.warn(`[CallContext] ${configError}`);
            return false;
        }

        if (Platform.OS === 'android') {
            const needed = [
                PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                ...(type === 'video' ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
            ];
            const granted = await PermissionsAndroid.requestMultiple(needed);
            if (granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) {
                throw new Error('Please allow microphone access to make calls.');
            }
            if (type === 'video' && granted[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED) {
                throw new Error('Please allow camera access for video calls, or make a voice call.');
            }
        }

        if (!Agora) {
            console.warn('Agora Engine instance could not be created');
            return false;
        }

        try {
            const engineInstance = Agora.createAgoraRtcEngine();
            if (!engineInstance) return false;

            engineInstance.initialize({
                appId: AGORA_APP_ID,
                channelProfile: Agora.ChannelProfileType?.ChannelProfileCommunication,
            });

            engineInstance.registerEventHandler({
                onJoinChannelSuccess: (connection: any) => {
                    if (__DEV__) console.log('[Agora] Joined channel:', connection.channelId);
                    isJoiningChannelRef.current = false;
                    setIsJoined(true);
                },
                onUserJoined: (_connection: any, uid: number) => {
                    if (__DEV__) console.log('[Agora] Remote user joined:', uid);
                    setRemoteUid(uid);
                    if (connectedAtRef.current === null) {
                        connectedAtRef.current = Date.now();
                        setConnectedAt(connectedAtRef.current);
                    }
                },
                onUserOffline: (_connection: any, uid: number) => {
                    if (__DEV__) console.log('[Agora] Remote user offline:', uid);
                    setRemoteUid(0);
                    setIsRemoteVideoMuted(false);
                },
                onUserMuteVideo: (_connection: any, uid: number, muted: boolean) => {
                    if (__DEV__) console.log('[Agora] Remote user mute video:', uid, muted);
                    setIsRemoteVideoMuted(muted);
                },
                onConnectionStateChanged: (_connection: any, state: number) => {
                    if (state !== AGORA_CONNECTION_FAILED) return;
                    Toast.show({ type: 'error', text1: 'Call disconnected', text2: 'Please check your internet and call again.' });
                    void endCallRef.current?.();
                },
                // Tokens last an hour. Without a new one, a long consultation would drop.
                onTokenPrivilegeWillExpire: (connection: any) => {
                    void (async () => {
                        try {
                            const bundle = await fetchTokenRef.current?.(connection.channelId);
                            if (bundle) engineRef.current?.renewToken(bundle.token);
                        } catch (error) {
                            if (__DEV__) console.warn('[CallContext] Could not renew call token:', error);
                        }
                    })();
                },
                onError: (err: any, msg: string) => {
                    if (__DEV__) console.error('[Agora] Error:', err, msg);
                },
            });

            engineInstance.enableAudio();
            // A voice call must never turn the camera on.
            if (type === 'video') {
                engineInstance.enableVideo();
                engineInstance.startPreview();
            }
            engineRef.current = engineInstance;
            return true;
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to initialize Agora:', error);
            engineRef.current = null;
            return false;
        }
    }, []);

    const notifyMissedCall = useCallback(async (sessionId: string, roomId: string, type: CallType | null) => {
        if (!user?.id) return;
        try {
            await supabase.functions.invoke('send-chat-notification', {
                body: {
                    record: { id: sessionId, room_id: roomId, caller_id: user.id, type: type || 'audio', status: 'missed' },
                    table: 'call_sessions',
                },
            });
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Missed call notification skipped:', error);
        }
    }, [user?.id]);

    const markTodayAppointmentCompletedForRoom = useCallback(async (targetRoomId: string) => {
        if (!targetRoomId) return false;

        const { data: room, error: roomError } = await supabase
            .from('chat_rooms')
            .select('patient_id, doctor_id')
            .eq('id', targetRoomId)
            .maybeSingle();

        if (roomError || !room?.patient_id || !room?.doctor_id) {
            if (roomError) {
                if (__DEV__) console.warn('[CallContext] Failed to resolve chat room for completion update:', roomError);
            }
            return false;
        }

        const today = getLocalISODate();
        const { data: appointments, error: appointmentsError } = await supabase
            .from('appointments')
            .select('id, status, slot:slots!slot_id(date)')
            .eq('patient_id', room.patient_id)
            .eq('doctor_id', room.doctor_id)
            .in('status', ['pending', 'confirmed'])
            .order('created_at', { ascending: false });

        if (appointmentsError || !appointments?.length) {
            if (appointmentsError) {
                if (__DEV__) console.warn('[CallContext] Failed to fetch appointments for completion update:', appointmentsError);
            }
            return false;
        }

        const todayAppointment = appointments.find((apt: any) => apt?.slot?.date === today);
        if (!todayAppointment?.id) return false;

        const { error: updateError } = await supabase
            .from('appointments')
            .update({ status: 'completed' })
            .eq('id', todayAppointment.id);

        if (updateError) {
            if (__DEV__) console.warn('[CallContext] Failed to mark appointment completed:', updateError);
            return false;
        }

        return true;
    }, []);

    const getConsultationEligibilityForRoom = useCallback(async (targetRoomId: string) => {
        if (!targetRoomId) {
            return {
                allowed: false,
                reason: 'Consultation window is unavailable.',
            };
        }

        const { data: room, error: roomError } = await supabase
            .from('chat_rooms')
            .select('patient_id, doctor_id')
            .eq('id', targetRoomId)
            .maybeSingle();

        if (roomError || !room?.patient_id || !room?.doctor_id) {
            return {
                allowed: false,
                reason: 'Consultation room is not available.',
            };
        }

        const { data: appointments, error: appointmentsError } = await supabase
            .from('appointments')
            .select('status, slot:slots!slot_id(date)')
            .eq('patient_id', room.patient_id)
            .eq('doctor_id', room.doctor_id)
            .in('status', ['pending', 'confirmed', 'completed']);

        if (appointmentsError) {
            if (__DEV__) console.warn('[CallContext] Failed to verify consultation eligibility:', appointmentsError);
            return {
                allowed: false,
                reason: 'Could not verify consultation window. Please try again.',
            };
        }

        const rows = (appointments || []) as Array<{ slot?: { date?: string | null } | null }>;
        if (!rows.length) {
            return {
                allowed: false,
                reason: 'Book an appointment to start consultation.',
            };
        }

        const today = startOfTodayLocal();
        let hasFutureSlot = false;
        let latestPastSlotDate: Date | null = null;

        for (const row of rows) {
            const slotDate = parseDateOnlyToLocalDate(row?.slot?.date || null);
            if (!slotDate) continue;

            if (slotDate.getTime() >= today.getTime()) {
                hasFutureSlot = true;
                break;
            }

            if (!latestPastSlotDate || slotDate.getTime() > latestPastSlotDate.getTime()) {
                latestPastSlotDate = slotDate;
            }
        }

        if (hasFutureSlot) {
            return {
                allowed: true,
                reason: null,
            };
        }

        if (!latestPastSlotDate) {
            return {
                allowed: false,
                reason: 'Book a future appointment to start consultation.',
            };
        }

        const expiry = addDays(latestPastSlotDate, 30);
        if (today.getTime() <= expiry.getTime()) {
            return {
                allowed: true,
                reason: null,
            };
        }

        return {
            allowed: false,
            reason: 'Consultation window expired. Book a future appointment.',
        };
    }, []);

    const fetchAgoraToken = useCallback(async (channelName: string): Promise<AgoraTokenBundle> => {
        if (!user?.id) {
            throw new Error('Login session missing. Please login again before starting a call.');
        }

        const localUid = getAgoraUidFromUserId(user.id);
        if (!localUid) {
            throw new Error('Could not connect the call. Please try again.');
        }

        try {
            const { data, error } = await supabase.functions.invoke('get-agora-token', {
                body: { channelName, uid: localUid, role: 'publisher' },
            });
            if (error) {
                const message = await extractFunctionInvokeErrorMessage(error);
                throw new Error(getAgoraTokenErrorMessage(message));
            }
            if (data?.success === false) {
                throw new Error(getAgoraTokenErrorMessage(data?.error));
            }
            const token = typeof data?.token === 'string' ? data.token.trim() : '';
            if (!token) {
                throw new Error('Could not connect the call. Please try again.');
            }
            return {
                token,
                uid: normalizeAgoraUid(data?.uid, user.id),
            };
        } catch (error) {
            if (__DEV__) console.error('[CallContext] Error fetching Agora token:', error);
            throw error;
        }
    }, [user?.id]);

    fetchTokenRef.current = fetchAgoraToken;

    const bindRoom = useCallback((nextRoomId: string | null) => {
        if (!nextRoomId || !nextRoomId.trim()) return;
        const normalizedRoomId = nextRoomId.trim();

        setBoundRoomId((current) => {
            if (current === normalizedRoomId) return current;
            if (hasOngoingCall && activeCallRoomId && activeCallRoomId !== normalizedRoomId) {
                return current;
            }
            return normalizedRoomId;
        });
    }, [activeCallRoomId, hasOngoingCall]);

    const startCall = useCallback(async (targetRoomId: string, type: CallType = 'video') => {
        if (!user?.id || !targetRoomId) {
            throw new Error('User or room missing for call start.');
        }

        if (hasOngoingCall && activeCallRoomId && activeCallRoomId !== targetRoomId) {
            throw new Error('Another call is already in progress.');
        }

        const configError = getAgoraClientConfigError();
        if (configError) {
            throw new Error(configError);
        }

        // A double tap would otherwise ring twice.
        if (isCallTransitioningRef.current) return;
        isCallTransitioningRef.current = true;
        const attempt = ++callAttemptRef.current;

        clearStatusResetTimer();

        try {
            const eligibility = await getConsultationEligibilityForRoom(targetRoomId);
            if (!eligibility.allowed) {
                throw new Error(eligibility.reason || 'Consultation window closed.');
            }

            // Set state to ringing instantly so calling screen pops up in one click
            setBoundRoomId(targetRoomId);
            setActiveCallRoomId(targetRoomId);
            setIsCaller(true);
            setCallType(type);
            setIsAudioMuted(false);
            setIsVideoMuted(type === 'audio');
            setCallStatus('ringing');

            // The permission prompt can take a long time. Ask first, then fetch a token that is still fresh.
            const engineReady = await initEngine(type);
            if (!engineReady) {
                throw new Error('Could not start the call. Please try again.');
            }
            const tokenBundle = await fetchAgoraToken(targetRoomId);
            if (attempt !== callAttemptRef.current) return;

            setAgoraToken(tokenBundle.token);
            setLocalAgoraUid(tokenBundle.uid);

            await retireStaleSessions(targetRoomId);

            const { data: sessionData, error } = await supabase
                .from('call_sessions')
                .insert({
                    room_id: targetRoomId,
                    caller_id: user.id,
                    type,
                    status: 'ringing',
                })
                .select('id')
                .single();

            if (error) {
                if ((error as any).code === '23505') {
                    throw new Error('A call is already in progress in this chat. Please try again in a moment.');
                }
                throw error;
            }

            // Hung up while the row was being created: close it so the other phone does not ring.
            if (attempt !== callAttemptRef.current) {
                await supabase.from('call_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionData.id);
                return;
            }
            activeSessionIdRef.current = sessionData.id;

            void (async () => {
                const { data, error: pushError } = await supabase.functions.invoke('send-chat-notification', {
                    body: {
                        record: {
                            id: sessionData.id,
                            room_id: targetRoomId,
                            caller_id: user.id,
                            type,
                            status: 'ringing',
                        },
                        table: 'call_sessions',
                    },
                });

                if (pushError) {
                    const message = await extractFunctionInvokeErrorMessage(pushError);
                    if (__DEV__) console.warn('[CallContext] Call push notification skipped:', message);
                    return;
                }

                if (data?.success === false) {
                    const message =
                        typeof data?.error === 'string' && data.error.trim()
                            ? data.error.trim()
                            : 'Notification service returned unsuccessful response.';
                    if (__DEV__) console.warn('[CallContext] Call push notification not sent:', message);
                }
            })();
        } catch (error) {
            if (attempt !== callAttemptRef.current) return;
            await cleanupEngine();
            resetToIdle();
            throw error;
        } finally {
            isCallTransitioningRef.current = false;
        }
    }, [
        activeCallRoomId,
        clearStatusResetTimer,
        cleanupEngine,
        fetchAgoraToken,
        getConsultationEligibilityForRoom,
        hasOngoingCall,
        initEngine,
        resetToIdle,
        user?.id,
    ]);

    const acceptCall = useCallback(async (roomId?: string | null) => {
        const targetRoomId = (roomId || currentRoomId || '').trim();
        if (!targetRoomId) return;

        if (hasOngoingCall && activeCallRoomId && activeCallRoomId !== targetRoomId) {
            if (__DEV__) console.warn('[CallContext] acceptCall skipped: another call is already in progress.');
            return;
        }

        // The auto-answer effect and a button tap can both land here.
        if (isCallTransitioningRef.current) return;
        isCallTransitioningRef.current = true;
        // Silence the ring straight away. Connecting takes a second or two.
        stopCallTone();

        try {
            clearStatusResetTimer();

            const { data: session, error: sessionError } = await supabase
                .from('call_sessions')
                .select('id, type, caller_id')
                .eq('room_id', targetRoomId)
                .eq('status', 'ringing')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (sessionError) throw sessionError;
            if (!session) throw new Error('This call has already ended.');

            const sessionType: CallType = session.type === 'video' ? 'video' : 'audio';
            const engineReady = await initEngine(sessionType);
            if (!engineReady) {
                throw new Error('Could not start the call. Please try again.');
            }
            const tokenBundle = await fetchAgoraToken(targetRoomId);

            // Only a call that is still ringing can be answered: the caller may have hung up during the steps above.
            const { data: answered, error } = await supabase
                .from('call_sessions')
                .update({ status: 'active' })
                .eq('id', session.id)
                .eq('status', 'ringing')
                .select('id');

            if (error) throw error;
            if (!answered?.length) throw new Error('This call has already ended.');

            activeSessionIdRef.current = session.id;

            setAgoraToken(tokenBundle.token);
            setLocalAgoraUid(tokenBundle.uid);
            if (session.type === 'audio' || session.type === 'video') {
                setCallType(session.type);
                setIsVideoMuted(session.type === 'audio');
            }
            if (user?.id) {
                setIsCaller(session.caller_id === user.id);
            }
            setBoundRoomId(targetRoomId);
            setActiveCallRoomId(targetRoomId);
            setCallStatus('active');
        } catch (error) {
            if (__DEV__) console.error('[CallContext] Error accepting call:', error);
            await cleanupEngine();
            if (callStatusRef.current === 'ringing') void startCallTone('incoming');
            throw error;
        } finally {
            isCallTransitioningRef.current = false;
        }
    }, [activeCallRoomId, cleanupEngine, clearStatusResetTimer, currentRoomId, fetchAgoraToken, hasOngoingCall, initEngine, startCallTone, stopCallTone, user?.id]);

    const endCall = useCallback(async (roomId?: string | null) => {
        const targetRoomId = (roomId || currentRoomId || '').trim();
        if (!targetRoomId) return;

        clearStatusResetTimer();
        callAttemptRef.current += 1;
        localEndedAtRef.current = Date.now();
        const qualifiesAsConsultation = wasRealConsultation();
        const cancelledSessionId = callStatusRef.current === 'ringing' && isCallerRef.current ? activeSessionIdRef.current : null;
        activeSessionIdRef.current = null;

        // Instantly transition local state and cleanup Agora engine to stop audio/video immediately
        setCallStatus('ended');
        void cleanupEngine();
        scheduleResetToIdle(2000);

        // Perform database updates asynchronously in the background
        void (async () => {
            try {
                const { data: activeSessions } = await supabase
                    .from('call_sessions')
                    .select('id')
                    .eq('room_id', targetRoomId)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1);
                const hadActiveSession = Boolean(activeSessions && activeSessions.length > 0);

                await supabase
                    .from('call_sessions')
                    .update({ status: 'ended', ended_at: new Date().toISOString() })
                    .eq('room_id', targetRoomId)
                    .in('status', ['ringing', 'active']);

                if (hadActiveSession && qualifiesAsConsultation) {
                    const marked = await markTodayAppointmentCompletedForRoom(targetRoomId);
                    if (marked) {
                        queryClient.invalidateQueries({ queryKey: ['appointments'] });
                    }
                }
                if (cancelledSessionId) void notifyMissedCall(cancelledSessionId, targetRoomId, callType);
            } catch (error) {
                if (__DEV__) console.error('[CallContext] Background endCall DB update failed:', error);
            }
        })();
    }, [callType, cleanupEngine, clearStatusResetTimer, currentRoomId, markTodayAppointmentCompletedForRoom, notifyMissedCall, queryClient, scheduleResetToIdle]);

    endCallRef.current = endCall;

    const declineCall = useCallback(async (roomId?: string | null) => {
        const targetRoomId = (roomId || currentRoomId || '').trim();
        if (!targetRoomId) return;

        clearStatusResetTimer();
        callAttemptRef.current += 1;
        localEndedAtRef.current = Date.now();
        activeSessionIdRef.current = null;

        // Instantly update local status and cleanup
        setCallStatus('declined');
        void cleanupEngine();
        scheduleResetToIdle(2000);

        // Update database status asynchronously in the background
        void (async () => {
            try {
                await supabase
                    .from('call_sessions')
                    .update({ status: 'declined' })
                    .eq('room_id', targetRoomId)
                    .eq('status', 'ringing');
            } catch (error) {
                if (__DEV__) console.error('[CallContext] Background declineCall DB update failed:', error);
            }
        })();
    }, [cleanupEngine, clearStatusResetTimer, currentRoomId, scheduleResetToIdle]);

    const toggleAudio = useCallback(() => {
        if (!engineRef.current) return;
        engineRef.current.muteLocalAudioStream(!isAudioMuted);
        setIsAudioMuted((prev) => !prev);
    }, [isAudioMuted]);

    const toggleVideo = useCallback(() => {
        if (!engineRef.current) return;
        engineRef.current.muteLocalVideoStream(!isVideoMuted);
        setIsVideoMuted((prev) => !prev);
    }, [isVideoMuted]);

    const toggleSpeaker = useCallback(() => {
        // Agora only accepts this after joining; before that it fails and the icon would lie.
        if (!engineRef.current || !isJoined) return;
        engineRef.current.setEnableSpeakerphone(!isSpeakerOn);
        setIsSpeakerOn((prev) => !prev);
    }, [isJoined, isSpeakerOn]);

    useEffect(() => {
        if (!user?.id) {
            clearStatusResetTimer();
            resetToIdle();
            setBoundRoomId(null);
            void cleanupEngine();
            return;
        }

        let cancelled = false;

        const hydrateAnyOngoingCall = async () => {
            try {
                const { data: participantRooms, error: roomsError } = await supabase
                    .from('chat_rooms')
                    .select('id')
                    .or(`patient_id.eq.${user.id},doctor_id.eq.${user.id}`);

                if (cancelled || roomsError || !participantRooms?.length) return;

                const roomIds = participantRooms
                    .map((room: any) => room?.id)
                    .filter((id: any) => typeof id === 'string' && id.length > 0);

                if (!roomIds.length) return;

                const { data: ongoingSession, error: sessionError } = await supabase
                    .from('call_sessions')
                    .select('id, room_id, status, type, caller_id, created_at')
                    .in('room_id', roomIds)
                    .in('status', ['ringing', 'active'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cancelled) return;

                const isLive = Boolean(ongoingSession?.room_id) && !isSessionStale(ongoingSession as any) && !wasEndedHere((ongoingSession as any)?.created_at);

                if (ongoingSession?.room_id && isSessionStale(ongoingSession as any)) {
                    void retireStaleSessions(ongoingSession.room_id);
                }

                if (sessionError || !isLive || !ongoingSession) {
                    // A call being set up has no row yet, so finding nothing does not mean it is over.
                    if (isCallTransitioningRef.current) return;
                    // Reset if local state has ongoing call but DB says there is none
                    setCallStatus((curr) => {
                        if (curr === 'ringing' || curr === 'active') {
                            setTimeout(() => {
                                resetToIdle();
                                void cleanupEngine();
                            }, 0);
                        }
                        return curr;
                    });
                    return;
                }

                // Already on a call: a second one ringing in another room must not take over this screen.
                const isOnCall = callStatusRef.current === 'ringing' || callStatusRef.current === 'active';
                if (isOnCall && activeRoomRef.current && activeRoomRef.current !== ongoingSession.room_id) return;

                clearStatusResetTimer();
                activeSessionIdRef.current = ongoingSession.id;
                setBoundRoomId(ongoingSession.room_id);
                setActiveCallRoomId(ongoingSession.room_id);
                setCallStatus(ongoingSession.status as CallStatus);
                const nextIsCaller = ongoingSession.caller_id === user.id;
                if (ongoingSession.type === 'audio' || ongoingSession.type === 'video') {
                    setCallType(ongoingSession.type);
                    setIsVideoMuted(ongoingSession.type === 'audio');
                }
                setIsCaller(nextIsCaller);
            } catch (error) {
                if (__DEV__) console.warn('[CallContext] Failed to hydrate ongoing call globally:', error);
            }
        };

        if (appState === 'active') {
            void hydrateAnyOngoingCall();
        }

        return () => {
            cancelled = true;
        };
    }, [cleanupEngine, clearStatusResetTimer, resetToIdle, user?.id, appState]);

    useEffect(() => {
        if (!boundRoomId) return;

        if (roomChannelRef.current) {
            void supabase.removeChannel(roomChannelRef.current);
            roomChannelRef.current = null;
        }

        const channel = supabase
            .channel(`call_room_${boundRoomId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'call_sessions',
                filter: `room_id=eq.${boundRoomId}`,
            }, (payload: any) => {
                if (!payload?.new) return;

                const nextStatus = payload.new.status as CallStatus;
                const payloadRoomId = (payload.new.room_id as string) || boundRoomId;
                const isLiveStatus = nextStatus === 'ringing' || nextStatus === 'active';

                if (isLiveStatus) {
                    if (wasEndedHere(payload.new.created_at)) return;
                    activeSessionIdRef.current = payload.new.id || activeSessionIdRef.current;
                } else {
                    // The closing event of an earlier call must not end the one happening now, or show "Call ended" on an idle chat.
                    if (callStatusRef.current === 'idle') return;
                    if (activeSessionIdRef.current && payload.new.id !== activeSessionIdRef.current) return;
                    activeSessionIdRef.current = null;
                }

                setCallStatus(nextStatus);
                if (payload.new.type === 'audio' || payload.new.type === 'video') {
                    setCallType(payload.new.type);
                    setIsVideoMuted(payload.new.type === 'audio');
                }
                const nextIsCaller = Boolean(payload.new.caller_id && user?.id && payload.new.caller_id === user.id);
                if (payload.new.caller_id && user?.id) {
                    setIsCaller(nextIsCaller);
                }

                if (nextStatus === 'ringing' || nextStatus === 'active') {
                    setActiveCallRoomId(payloadRoomId);
                    setBoundRoomId(payloadRoomId);
                    return;
                }

                if (['ended', 'declined', 'missed'].includes(nextStatus)) {
                    if (nextStatus === 'ended' && payload.old?.status === 'active' && wasRealConsultation()) {
                        void (async () => {
                            const marked = await markTodayAppointmentCompletedForRoom(payloadRoomId);
                            if (marked) {
                                queryClient.invalidateQueries({ queryKey: ['appointments'] });
                            }
                        })();
                    }
                    void cleanupEngine();
                    scheduleResetToIdle(2500);
                }
            })
            .subscribe();

        roomChannelRef.current = channel;

        return () => {
            if (roomChannelRef.current === channel) {
                void supabase.removeChannel(channel);
                roomChannelRef.current = null;
            } else {
                void supabase.removeChannel(channel);
            }
        };
    }, [
        boundRoomId,
        cleanupEngine,
        markTodayAppointmentCompletedForRoom,
        queryClient,
        scheduleResetToIdle,
        user?.id,
    ]);

    useEffect(() => {
        if (!boundRoomId || !user?.id) return;
        let cancelled = false;

        const hydrateLatestSession = async () => {
            try {
                const { data: session, error } = await supabase
                    .from('call_sessions')
                    .select('id, room_id, status, type, caller_id, created_at')
                    .eq('room_id', boundRoomId)
                    .in('status', ['ringing', 'active'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cancelled) return;

                if (session && isSessionStale(session)) void retireStaleSessions(boundRoomId);

                if (error || !session || isSessionStale(session) || wasEndedHere(session.created_at)) {
                    // A call being set up has no row yet, so finding nothing does not mean it is over.
                    if (isCallTransitioningRef.current) return;
                    // Reset if local state has ongoing call but DB says there is none
                    setCallStatus((curr) => {
                        if (curr === 'ringing' || curr === 'active') {
                            setTimeout(() => {
                                resetToIdle();
                                void cleanupEngine();
                            }, 0);
                        }
                        return curr;
                    });
                    return;
                }

                clearStatusResetTimer();
                activeSessionIdRef.current = session.id;
                setCallStatus(session.status as CallStatus);
                setActiveCallRoomId(session.room_id || boundRoomId);
                setBoundRoomId(session.room_id || boundRoomId);

                if (session.type === 'audio' || session.type === 'video') {
                    setCallType(session.type);
                    setIsVideoMuted(session.type === 'audio');
                }
                const nextIsCaller = session.caller_id === user.id;
                setIsCaller(nextIsCaller);
            } catch (error) {
                if (__DEV__) console.warn('[CallContext] Failed to hydrate current call session:', error);
            }
        };

        if (appState === 'active') {
            void hydrateLatestSession();
        }

        return () => {
            cancelled = true;
        };
    }, [boundRoomId, clearStatusResetTimer, user?.id, appState]);

    useEffect(() => {
        let isCancelled = false;
        if (callStatus === 'active' && currentRoomId && user?.id && (!agoraToken || !localAgoraUid)) {
            const loadLocalToken = async () => {
                try {
                    const tokenBundle = await fetchAgoraToken(currentRoomId);
                    if (isCancelled) return;
                    setAgoraToken(tokenBundle.token);
                    setLocalAgoraUid(tokenBundle.uid);
                } catch (error) {
                    if (__DEV__) console.error('[CallContext] Failed to prepare local Agora token:', error);
                }
            };
            void loadLocalToken();
        }
        return () => {
            isCancelled = true;
        };
    }, [agoraToken, callStatus, currentRoomId, fetchAgoraToken, localAgoraUid, user?.id]);

    useEffect(() => {
        if (callStatus === 'active' && agoraToken && localAgoraUid && !isJoined && currentRoomId) {
            if (isJoiningChannelRef.current) return;
            const connect = async () => {
                isJoiningChannelRef.current = true;
                try {
                    const type: CallType = callType === 'video' ? 'video' : 'audio';
                    const initialized = await initEngine(type);
                    // Checked by ref: this effect re-runs on any state change, and a re-run must not cancel a join already under way.
                    if (callStatusRef.current !== 'active' || !initialized || !engineRef.current) {
                        isJoiningChannelRef.current = false;
                        return;
                    }

                    const shouldBeSpeakerOn = type === 'video';
                    setIsSpeakerOn(shouldBeSpeakerOn);
                    engineRef.current.setDefaultAudioRouteToSpeakerphone(shouldBeSpeakerOn);

                    const result = engineRef.current.joinChannel(agoraToken, currentRoomId, localAgoraUid, {
                        clientRoleType: AGORA_ROLE_BROADCASTER,
                        publishMicrophoneTrack: true,
                        publishCameraTrack: type === 'video',
                        autoSubscribeAudio: true,
                        autoSubscribeVideo: type === 'video',
                    });
                    if (typeof result === 'number' && result < 0) {
                        throw new Error(`joinChannel returned ${result}`);
                    }
                } catch (error) {
                    isJoiningChannelRef.current = false;
                    if (__DEV__) console.error('[CallContext] Failed to join Agora channel:', error);
                    Toast.show({ type: 'error', text1: 'Could not connect the call', text2: 'Please try again.' });
                    void endCallRef.current?.();
                }
            };
            void connect();
        }
    }, [agoraToken, callStatus, callType, currentRoomId, initEngine, isJoined, localAgoraUid]);

    // The other phone may have crashed or lost its network, and then it can never say the call ended.
    useEffect(() => {
        if (callStatus !== 'active' || !isJoined || remoteUid !== 0) return;
        const timer = setTimeout(() => {
            Toast.show({ type: 'info', text1: 'Call ended', text2: 'The other person could not be reached.' });
            void endCallRef.current?.();
        }, NO_REMOTE_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [callStatus, isJoined, remoteUid]);

    useEffect(() => {
        let intervalId: any = null;

        if (callStatus === 'ringing' && currentRoomId) {
            if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
            }

            if (isCaller) {
                ringingTimeoutRef.current = setTimeout(async () => {
                    const sessionId = activeSessionIdRef.current;
                    await supabase.from('call_sessions')
                        .update({ status: 'missed' })
                        .eq('room_id', currentRoomId)
                        .eq('status', 'ringing');
                    if (sessionId) void notifyMissedCall(sessionId, currentRoomId, callType);
                }, RING_TIMEOUT_MS);
            }

            // Polling status updates fallback for WebSocket disconnect/sync resilience
            intervalId = setInterval(async () => {
                // Until the row is created the newest one belongs to the previous call, and it says "ended".
                if (isCallTransitioningRef.current) return;
                try {
                    const { data: session, error } = await supabase
                        .from('call_sessions')
                        .select('status, type, caller_id')
                        .eq('room_id', currentRoomId)
                        .in('status', ['ringing', 'active', 'ended', 'declined', 'missed'])
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (error || !session) return;

                    const nextStatus = session.status as CallStatus;
                    if (nextStatus !== callStatus) {
                        setCallStatus(nextStatus);
                        if (session.type === 'audio' || session.type === 'video') {
                            setCallType(session.type);
                            setIsVideoMuted(session.type === 'audio');
                        }
                        const nextIsCaller = session.caller_id === user?.id;
                        setIsCaller(nextIsCaller);

                        if (['ended', 'declined', 'missed'].includes(nextStatus)) {
                            void cleanupEngine();
                            scheduleResetToIdle(2500);
                        }
                    }
                } catch (error) {
                    if (__DEV__) console.warn('[CallContext] Polling status fetch failed:', error);
                }
            }, 3000);
        }

        return () => {
            if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [callStatus, callType, currentRoomId, isCaller, notifyMissedCall, user?.id, cleanupEngine, scheduleResetToIdle]);

    useEffect(() => {
        if (callStatus === 'ringing') {
            void startCallTone(isCaller ? 'outgoing' : 'incoming');
            return;
        }
        stopCallTone();
    }, [callStatus, isCaller, startCallTone, stopCallTone]);

    // Once the ringing is over, the "incoming call" notification has nothing left to answer.
    useEffect(() => {
        if (Platform.OS === 'web' || callStatus === 'ringing') return;
        void (async () => {
            try {
                const presented = await Notifications.getPresentedNotificationsAsync();
                await Promise.all(
                    presented
                        .filter((item) => item.request.content.data?.type === 'incoming_call')
                        .map((item) => Notifications.dismissNotificationAsync(item.request.identifier))
                );
            } catch {
                // best-effort
            }
        })();
    }, [callStatus]);

    useEffect(() => {
        if (engineRef.current && isJoined) {
            engineRef.current.muteLocalVideoStream(isVideoMuted);
        }
    }, [isJoined, isVideoMuted]);

    useEffect(() => {
        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
            setAppState(nextState);
        });
        return () => {
            appStateSubscription.remove();
        };
    }, []);

    useEffect(() => {
        const shouldShowBackgroundNotification =
            hasOngoingCall &&
            !!currentRoomId &&
            appState !== 'active';

        if (shouldShowBackgroundNotification) {
            void ensureOngoingCallNotification();
        } else {
            void dismissOngoingCallNotification();
        }
    }, [
        appState,
        currentRoomId,
        dismissOngoingCallNotification,
        ensureOngoingCallNotification,
        hasOngoingCall,
    ]);

    useEffect(() => {
        return () => {
            clearStatusResetTimer();
            if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
            }
            if (roomChannelRef.current) {
                void supabase.removeChannel(roomChannelRef.current);
                roomChannelRef.current = null;
            }
            void dismissOngoingCallNotification();
            stopCallTone();
            void cleanupEngine();
        };
    }, [cleanupEngine, clearStatusResetTimer, dismissOngoingCallNotification, stopCallTone]);

    const value = useMemo<CallContextValue>(() => ({
        boundRoomId,
        activeCallRoomId,
        callStatus,
        callType,
        isCaller,
        agoraToken,
        remoteUid,
        isRemoteVideoMuted,
        isJoined,
        isAudioMuted,
        isVideoMuted,
        isSpeakerOn,
        connectedAt,
        hasOngoingCall,
        bindRoom,
        startCall,
        acceptCall,
        endCall,
        declineCall,
        toggleAudio,
        toggleVideo,
        toggleSpeaker,
    }), [
        activeCallRoomId,
        acceptCall,
        agoraToken,
        bindRoom,
        boundRoomId,
        callStatus,
        callType,
        connectedAt,
        declineCall,
        endCall,
        hasOngoingCall,
        isAudioMuted,
        isCaller,
        isJoined,
        isRemoteVideoMuted,
        isSpeakerOn,
        isVideoMuted,
        remoteUid,
        startCall,
        toggleAudio,
        toggleSpeaker,
        toggleVideo,
    ]);

    return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
};

export const useCallContext = () => {
    const context = useContext(CallContext);
    if (!context) {
        throw new Error('useCallContext must be used within CallProvider');
    }
    return context;
};
