import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, PermissionsAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useQueryClient } from '@tanstack/react-query';
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
        return 'Agora App ID missing in app build. Set EXPO_PUBLIC_AGORA_APP_ID in frontend env and rebuild the app.';
    }
    return null;
};

const getAgoraTokenErrorMessage = (value?: string | null) => {
    const normalized = (value || '').trim();
    if (normalized === 'agora_credentials_missing') {
        return 'Agora server credentials missing. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in Supabase Edge Function secrets.';
    }
    if (normalized === 'service_env_missing') {
        return 'Supabase service env missing for Agora token function.';
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
    return normalized || 'Could not get Agora token.';
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
    const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

    const engineRef = useRef<any>(null);
    const roomChannelRef = useRef<any>(null);
    const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ongoingNotificationIdRef = useRef<string | null>(null);
    const incomingRingtoneSoundRef = useRef<Audio.Sound | null>(null);
    const isIncomingRingtonePlayingRef = useRef(false);
    const isJoiningChannelRef = useRef(false);

    const hasOngoingCall = callStatus === 'ringing' || callStatus === 'active';
    const currentRoomId = activeCallRoomId || boundRoomId;

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

    const stopIncomingRingtone = useCallback(async () => {
        isIncomingRingtonePlayingRef.current = false;
        const activeSound = incomingRingtoneSoundRef.current;
        incomingRingtoneSoundRef.current = null;
        if (!activeSound) return;

        try {
            await activeSound.stopAsync();
        } catch {
            // best-effort
        }
        try {
            await activeSound.unloadAsync();
        } catch {
            // best-effort
        }
    }, []);

    const startIncomingRingtone = useCallback(async () => {
        if (Platform.OS === 'web') return;
        if (isIncomingRingtonePlayingRef.current) return;
        isIncomingRingtonePlayingRef.current = true;

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                interruptionModeIOS: InterruptionModeIOS.DoNotMix,
                shouldDuckAndroid: false,
                interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
                playThroughEarpieceAndroid: false,
                staysActiveInBackground: true,
            });

            const { sound } = await Audio.Sound.createAsync(
                require('../assets/ringtone.wav'),
                {
                    shouldPlay: true,
                    isLooping: true,
                    volume: 1,
                }
            );

            incomingRingtoneSoundRef.current = sound;
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to start incoming ringtone:', error);
            await stopIncomingRingtone();
        }
    }, [stopIncomingRingtone]);

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
                trigger: null,
            });
            ongoingNotificationIdRef.current = notificationId;
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to schedule ongoing call notification:', error);
        }
    }, [callType, currentRoomId, hasOngoingCall]);

    const initEngine = useCallback(async () => {
        if (engineRef.current) return true;

        const configError = getAgoraClientConfigError();
        if (configError) {
            if (__DEV__) console.warn(`[CallContext] ${configError}`);
            return false;
        }

        if (Platform.OS === 'android') {
            await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                PermissionsAndroid.PERMISSIONS.CAMERA,
            ]);
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
                onError: (err: any, msg: string) => {
                    if (__DEV__) console.error('[Agora] Error:', err, msg);
                },
            });

            engineInstance.enableVideo();
            engineInstance.startPreview();
            engineRef.current = engineInstance;
            return true;
        } catch (error) {
            if (__DEV__) console.warn('[CallContext] Failed to initialize Agora:', error);
            engineRef.current = null;
            return false;
        }
    }, []);

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
            throw new Error('Could not prepare Agora user id for this account.');
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
                throw new Error('Agora token missing from server response.');
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

        clearStatusResetTimer();

        try {
            const eligibility = await getConsultationEligibilityForRoom(targetRoomId);
            if (!eligibility.allowed) {
                throw new Error(eligibility.reason || 'Consultation window closed.');
            }

            const [tokenBundle, engineReady] = await Promise.all([
                fetchAgoraToken(targetRoomId),
                initEngine(),
            ]);
            if (!engineReady) {
                throw new Error('Could not initialize Agora call engine. Please check Agora setup and rebuild the app.');
            }

            const { data: sessionData, error } = await supabase
                .from('call_sessions')
                .insert({
                    room_id: targetRoomId,
                    caller_id: user.id,
                    type,
                    status: 'ringing',
                    agora_token: tokenBundle.token,
                })
                .select('id')
                .single();

            if (error) throw error;

            setBoundRoomId(targetRoomId);
            setActiveCallRoomId(targetRoomId);
            setIsCaller(true);
            setAgoraToken(tokenBundle.token);
            setLocalAgoraUid(tokenBundle.uid);
            setCallType(type);
            setIsAudioMuted(false);
            setIsVideoMuted(type === 'audio');
            setCallStatus('ringing');

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
            await cleanupEngine();
            resetToIdle();
            throw error;
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

        try {
            clearStatusResetTimer();

            const { data: session, error: sessionError } = await supabase
                .from('call_sessions')
                .select('id, agora_token, type, caller_id')
                .eq('room_id', targetRoomId)
                .eq('status', 'ringing')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (sessionError) throw sessionError;
            if (!session) return;

            const [tokenBundle, engineReady] = await Promise.all([
                fetchAgoraToken(targetRoomId),
                initEngine(),
            ]);
            if (!engineReady) {
                throw new Error('Could not initialize Agora call engine. Please check Agora setup and rebuild the app.');
            }

            const { error } = await supabase
                .from('call_sessions')
                .update({ status: 'active' })
                .eq('id', session.id);

            if (error) throw error;

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
            throw error;
        }
    }, [activeCallRoomId, clearStatusResetTimer, currentRoomId, fetchAgoraToken, hasOngoingCall, initEngine, user?.id]);

    const endCall = useCallback(async (roomId?: string | null) => {
        const targetRoomId = (roomId || currentRoomId || '').trim();
        if (!targetRoomId) return;

        clearStatusResetTimer();
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

            if (hadActiveSession) {
                const marked = await markTodayAppointmentCompletedForRoom(targetRoomId);
                if (marked) {
                    queryClient.invalidateQueries({ queryKey: ['appointments'] });
                }
            }

            setCallStatus('ended');
        } catch (error) {
            if (__DEV__) console.error('[CallContext] Error ending call:', error);
        } finally {
            await cleanupEngine();
            scheduleResetToIdle(2000);
        }
    }, [cleanupEngine, clearStatusResetTimer, currentRoomId, markTodayAppointmentCompletedForRoom, queryClient, scheduleResetToIdle]);

    const declineCall = useCallback(async (roomId?: string | null) => {
        const targetRoomId = (roomId || currentRoomId || '').trim();
        if (!targetRoomId) return;

        clearStatusResetTimer();
        try {
            await supabase
                .from('call_sessions')
                .update({ status: 'declined' })
                .eq('room_id', targetRoomId)
                .eq('status', 'ringing');

            setCallStatus('declined');
        } catch (error) {
            if (__DEV__) console.error('[CallContext] Error declining call:', error);
        } finally {
            await cleanupEngine();
            scheduleResetToIdle(2000);
        }
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
        if (!engineRef.current) return;
        engineRef.current.setEnableSpeakerphone(!isSpeakerOn);
        setIsSpeakerOn((prev) => !prev);
    }, [isSpeakerOn]);

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
                    .select('room_id, status, type, caller_id, agora_token')
                    .in('room_id', roomIds)
                    .in('status', ['ringing', 'active'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cancelled || sessionError || !ongoingSession?.room_id) return;

                clearStatusResetTimer();
                setBoundRoomId(ongoingSession.room_id);
                setActiveCallRoomId(ongoingSession.room_id);
                setCallStatus(ongoingSession.status as CallStatus);
                const nextIsCaller = ongoingSession.caller_id === user.id;
                if (ongoingSession.type === 'audio' || ongoingSession.type === 'video') {
                    setCallType(ongoingSession.type);
                    setIsVideoMuted(ongoingSession.type === 'audio');
                }
                if (ongoingSession.status === 'active' && nextIsCaller && ongoingSession.agora_token) {
                    setAgoraToken(ongoingSession.agora_token);
                    setLocalAgoraUid(getAgoraUidFromUserId(user.id));
                }
                setIsCaller(nextIsCaller);
            } catch (error) {
                if (__DEV__) console.warn('[CallContext] Failed to hydrate ongoing call globally:', error);
            }
        };

        void hydrateAnyOngoingCall();

        return () => {
            cancelled = true;
        };
    }, [cleanupEngine, clearStatusResetTimer, resetToIdle, user?.id]);

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

                setCallStatus(nextStatus);
                if (payload.new.type === 'audio' || payload.new.type === 'video') {
                    setCallType(payload.new.type);
                    setIsVideoMuted(payload.new.type === 'audio');
                }
                const nextIsCaller = Boolean(payload.new.caller_id && user?.id && payload.new.caller_id === user.id);
                if (payload.new.caller_id && user?.id) {
                    setIsCaller(nextIsCaller);
                }
                if (nextStatus === 'active' && nextIsCaller && payload.new.agora_token) {
                    setAgoraToken(payload.new.agora_token);
                    setLocalAgoraUid(getAgoraUidFromUserId(user?.id));
                }

                if (nextStatus === 'ringing' || nextStatus === 'active') {
                    setActiveCallRoomId(payloadRoomId);
                    setBoundRoomId(payloadRoomId);
                    return;
                }

                if (['ended', 'declined', 'missed'].includes(nextStatus)) {
                    if (nextStatus === 'ended' && payload.old?.status === 'active') {
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
                    .select('id, room_id, status, type, caller_id, agora_token')
                    .eq('room_id', boundRoomId)
                    .in('status', ['ringing', 'active'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cancelled || error || !session) return;

                clearStatusResetTimer();
                setCallStatus(session.status as CallStatus);
                setActiveCallRoomId(session.room_id || boundRoomId);
                setBoundRoomId(session.room_id || boundRoomId);

                if (session.type === 'audio' || session.type === 'video') {
                    setCallType(session.type);
                    setIsVideoMuted(session.type === 'audio');
                }
                const nextIsCaller = session.caller_id === user.id;
                setIsCaller(nextIsCaller);
                if (session.status === 'active' && nextIsCaller && session.agora_token) {
                    setAgoraToken(session.agora_token);
                    setLocalAgoraUid(getAgoraUidFromUserId(user.id));
                }
            } catch (error) {
                if (__DEV__) console.warn('[CallContext] Failed to hydrate current call session:', error);
            }
        };

        void hydrateLatestSession();

        return () => {
            cancelled = true;
        };
    }, [boundRoomId, clearStatusResetTimer, user?.id]);

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
        let isCancelled = false;
        if (callStatus === 'active' && agoraToken && localAgoraUid && !isJoined && currentRoomId) {
            if (isJoiningChannelRef.current) return;
            const connect = async () => {
                isJoiningChannelRef.current = true;
                const initialized = await initEngine();
                if (isCancelled || !initialized || !engineRef.current) {
                    isJoiningChannelRef.current = false;
                    return;
                }

                const shouldBeSpeakerOn = callType === 'video';
                setIsSpeakerOn(shouldBeSpeakerOn);
                engineRef.current.setEnableSpeakerphone(shouldBeSpeakerOn);

                try {
                    engineRef.current.joinChannel(agoraToken, currentRoomId, localAgoraUid, {});
                } catch (error) {
                    isJoiningChannelRef.current = false;
                    if (__DEV__) console.error('[CallContext] Failed to join Agora channel:', error);
                }
            };
            void connect();
        }
        return () => {
            isCancelled = true;
        };
    }, [agoraToken, callStatus, callType, currentRoomId, initEngine, isJoined, localAgoraUid]);

    useEffect(() => {
        if (callStatus === 'ringing' && isCaller && currentRoomId) {
            if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
            }

            ringingTimeoutRef.current = setTimeout(async () => {
                await supabase.from('call_sessions')
                    .update({ status: 'missed' })
                    .eq('room_id', currentRoomId)
                    .eq('status', 'ringing');
            }, 45000);
        }

        return () => {
            if (ringingTimeoutRef.current) {
                clearTimeout(ringingTimeoutRef.current);
                ringingTimeoutRef.current = null;
            }
        };
    }, [callStatus, currentRoomId, isCaller]);

    useEffect(() => {
        const shouldPlayIncomingRingtone = callStatus === 'ringing' && !isCaller;
        if (shouldPlayIncomingRingtone) {
            void startIncomingRingtone();
            return;
        }
        void stopIncomingRingtone();
    }, [callStatus, isCaller, startIncomingRingtone, stopIncomingRingtone]);

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
            void stopIncomingRingtone();
            void cleanupEngine();
        };
    }, [cleanupEngine, clearStatusResetTimer, dismissOngoingCallNotification, stopIncomingRingtone]);

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
