import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import { useRouter } from 'expo-router';
import { ensureE2EEIdentity } from '../src/lib/e2ee';

const DEFAULT_CHANNEL_ID = 'default';
const CALLS_CHANNEL_ID = 'calls_ringtone_v2';
const LEGACY_CALLS_CHANNEL_ID = 'calls';
const LEGACY_CALLS_CHANNEL_V1_ID = 'calls_ringtone';
const APPOINTMENTS_CHANNEL_ID = 'appointments';
const HEALTH_REMINDERS_CHANNEL_ID = 'health-reminders';

// Global tracker: which chat room is the user currently viewing?
// When set, notifications from this room will be suppressed (WhatsApp behavior)
let _activeRoomId: string | null = null;
let _activeAuthUserId: string | null = null;
let _pendingChatNavigation: { roomId: string; autoAccept?: boolean } | null = null;

export const setActiveRoomId = (roomId: string | null) => {
    _activeRoomId = roomId;
};

export const getActiveRoomId = () => _activeRoomId;

const normalizeNotificationData = (raw: any): Record<string, any> => {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof raw === 'object' ? raw : {};
};

const getRoomIdFromNotificationPayload = (raw: any): string | null => {
    const source = normalizeNotificationData(raw);
    const roomId =
        source?.roomId ??
        source?.room_id ??
        source?.chatRoomId ??
        source?.chat_room_id ??
        source?.room?.id ??
        null;
    if (typeof roomId === 'string' && roomId.trim()) return roomId.trim();
    return null;
};

Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        // Normalize data because payload can arrive as object or JSON string depending on platform/runtime.
        const data = normalizeNotificationData(notification.request.content.data);
        const notificationType = typeof data?.type === 'string' ? data.type : '';
        const roomId = getRoomIdFromNotificationPayload(data);
        const recipientId = typeof data?.recipientId === 'string' ? data.recipientId.trim() : '';

        // Extra safety: if payload carries a recipient id and it does not match the logged-in user,
        // suppress it to prevent cross-account leakage on shared devices.
        if (recipientId && _activeAuthUserId && recipientId !== _activeAuthUserId) {
            return {
                shouldShowAlert: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
                shouldShowBanner: false,
                shouldShowList: false,
            };
        }

        if (notificationType === 'chat_message' && roomId && roomId === _activeRoomId) {
            // User is already on this chat — suppress the notification (like WhatsApp)
            if (__DEV__) console.log('[PushNotifications] Suppressing notification: user is viewing this chat room');
            return {
                shouldShowAlert: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
                shouldShowBanner: false,
                shouldShowList: false,
            };
        }

        // We'll mirror incoming calls as local notifications while app is foregrounded
        // to ensure action buttons are consistently visible.
        if (notificationType === 'incoming_call' && !data?.localMirrored) {
            return {
                shouldShowAlert: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
                shouldShowBanner: false,
                shouldShowList: false,
            };
        }

        // User is NOT on this chat — show the notification normally
        return {
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
        };
    },
});

export const usePushNotifications = () => {
    const { user } = useAuthContext();
    const router = useRouter();
    const [expoPushToken, setExpoPushToken] = useState<string | undefined>();
    const notificationListener = useRef<Notifications.Subscription | null>(null);
    const responseListener = useRef<Notifications.Subscription | null>(null);
    const handledResponseKeysRef = useRef<Set<string>>(new Set());
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const syncInFlightRef = useRef(false);
    const bootSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTokenSyncAtRef = useRef(0);
    const lastRegisteredTokenRef = useRef<string | undefined>(undefined);

    const getRoomIdFromData = (data: any): string | null => getRoomIdFromNotificationPayload(data);

    const getCallIdFromData = (data: any): string | null => {
        const source = normalizeNotificationData(data);
        const callId = source?.callId ?? source?.call_id ?? null;
        if (typeof callId === 'string' && callId.trim()) return callId.trim();
        return null;
    };

    const navigateToChatDetail = (roomId: string, autoAccept?: boolean) => {
        const params: Record<string, string> = { roomId };
        if (autoAccept) {
            params.autoAccept = 'true';
        }

        try {
            router.push({
                pathname: '/chat-detail',
                params,
            });
            return;
        } catch (pushObjectError) {
            if (__DEV__) console.warn('[PushNotifications] Object navigation failed, retrying with href:', pushObjectError);
        }

        try {
            const query = new URLSearchParams(params).toString();
            router.push(`/chat-detail?${query}` as any);
        } catch (pushHrefError) {
            if (__DEV__) console.error('[PushNotifications] Href navigation failed:', pushHrefError);
        }
    };

    const navigateToReportAssistant = (reportId?: string) => {
        const normalizedReportId = typeof reportId === 'string' ? reportId.trim() : '';
        if (normalizedReportId) {
            router.push({
                pathname: '/report-assistant',
                params: { reportId: normalizedReportId },
            } as any);
            return;
        }
        router.push('/report-assistant');
    };

    const queueChatNavigation = (roomId: string, autoAccept?: boolean) => {
        _pendingChatNavigation = { roomId, autoAccept };
    };

    const flushQueuedChatNavigation = () => {
        if (!_pendingChatNavigation) return;
        const pending = _pendingChatNavigation;
        _pendingChatNavigation = null;
        navigateToChatDetail(pending.roomId, pending.autoAccept);
    };

    const configureNotificationCategories = async () => {
        try {
            await Notifications.setNotificationCategoryAsync('incoming_call', [
                {
                    identifier: 'accept',
                    buttonTitle: 'Accept ✅',
                    options: {
                        opensAppToForeground: true,
                    },
                },
                {
                    identifier: 'decline',
                    buttonTitle: 'Decline ❌',
                    options: {
                        // Keep true for reliability so action is always processed.
                        opensAppToForeground: true,
                        isDestructive: true,
                    },
                },
            ]);
        } catch (error) {
            if (__DEV__) console.error('[PushNotifications] Failed to configure notification categories:', error);
        }
    };

    const getEffectiveAuthUserId = async (): Promise<string | null> => {
        if (_activeAuthUserId) {
            return _activeAuthUserId;
        }

        try {
            const { data } = await supabase.auth.getSession();
            return data?.session?.user?.id || null;
        } catch {
            return null;
        }
    };

    const handleNotificationResponse = async (response: Notifications.NotificationResponse) => {
        try {
            const notificationIdentifier = response?.notification?.request?.identifier || 'unknown';
            const actionIdentifier = response?.actionIdentifier || Notifications.DEFAULT_ACTION_IDENTIFIER;
            const dedupeKey = `${notificationIdentifier}:${actionIdentifier}`;
            if (handledResponseKeysRef.current.has(dedupeKey)) {
                return;
            }
            handledResponseKeysRef.current.add(dedupeKey);

            const data = normalizeNotificationData(response?.notification?.request?.content?.data as any);
            const recipientId = typeof data?.recipientId === 'string' ? data.recipientId.trim() : '';
            const effectiveAuthUserId = await getEffectiveAuthUserId();
            if (recipientId && effectiveAuthUserId && recipientId !== effectiveAuthUserId) {
                return;
            }
            const roomId = getRoomIdFromData(data);
            const callId = getCallIdFromData(data);
            const notificationType = typeof data?.type === 'string' ? data.type : '';

            if (notificationType === 'appointment_booked') {
                router.push('/doctor/dashboard');
                return;
            }

            if (notificationType === 'appointment_update' || notificationType === 'appointment_booked_patient') {
                const reportId =
                    typeof data?.aiReportId === 'string' && data.aiReportId.trim()
                        ? data.aiReportId.trim()
                        : typeof data?.reportId === 'string' && data.reportId.trim()
                            ? data.reportId.trim()
                            : '';
                if (reportId) {
                    navigateToReportAssistant(reportId);
                    return;
                }

                const isDoctor = (user?.role || '').toLowerCase() === 'doctor';
                router.push(isDoctor ? '/doctor/slots' : '/(tabs)/appointments');
                return;
            }

            if (notificationType === 'medical_report_alert') {
                const reportId =
                    typeof data?.reportId === 'string'
                        ? data.reportId
                        : typeof data?.report_id === 'string'
                            ? data.report_id
                            : '';
                navigateToReportAssistant(reportId);
                return;
            }

            if (!roomId) return;

            if (actionIdentifier === 'accept') {
                await Notifications.dismissNotificationAsync(notificationIdentifier).catch(() => {
                    // Ignore if notification already dismissed by OS.
                });

                // Let CallContext accept the still-ringing session. Updating it
                // here first causes acceptCall() to find no ringing session and
                // prevents Agora token setup/join from running.
                queueChatNavigation(roomId, true);
                flushQueuedChatNavigation();
                return;
            }

            if (actionIdentifier === 'decline') {
                // Decline directly from push actions.
                let query = supabase
                    .from('call_sessions')
                    .update({ status: 'declined' });

                if (callId) {
                    query = query.eq('id', callId);
                } else {
                    query = query.eq('room_id', roomId).eq('status', 'ringing');
                }

                const { error } = await query;
                if (error) {
                    if (__DEV__) console.error('[PushNotifications] Error declining call from notification action:', error);
                }

                await Notifications.dismissNotificationAsync(notificationIdentifier).catch(() => {
                    // Ignore if notification already dismissed by OS.
                });
                return;
            }

            // Default tap on notification => open related chat.
            if (notificationType === 'chat_message') {
                queueChatNavigation(roomId, false);
                flushQueuedChatNavigation();
                return;
            }

            // Tapping an incoming-call notification means the user wants to
            // answer it. Open the chat and let CallContext perform the full
            // accept flow (token, engine, session update, and Agora join).
            queueChatNavigation(roomId, notificationType === 'incoming_call');
            flushQueuedChatNavigation();
        } catch (error) {
            if (__DEV__) console.error('[PushNotifications] Error handling notification response:', error);
        }
    };

    useEffect(() => {
        if (!user?.id) return;
        // If notification tap happened before auth/user hydration, complete pending navigation now.
        flushQueuedChatNavigation();
    }, [user?.id]);

    useEffect(() => {
        void configureNotificationCategories();

        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
            if (__DEV__) console.log('[PushNotifications] Notification received:', notification);
            const data = (notification?.request?.content?.data || {}) as any;
            if (data?.type === 'incoming_call' && !data?.localMirrored) {
                const mirroredContent: Notifications.NotificationContentInput = {
                    title: notification.request.content.title || 'Incoming Call',
                    body: notification.request.content.body || 'Tap to respond',
                    sound: 'default',
                    categoryIdentifier: 'incoming_call',
                    data: {
                        ...(data || {}),
                        localMirrored: true,
                    },
                };

                if (Platform.OS === 'android') {
                    (mirroredContent as any).channelId = CALLS_CHANNEL_ID;
                }

                void Notifications.scheduleNotificationAsync({
                    content: mirroredContent,
                    trigger: null,
                });
            }
        });

        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            if (__DEV__) console.log('[PushNotifications] Notification response:', response);
            void handleNotificationResponse(response);
        });

        // Handles notification tap/actions that launched app from terminated state.
        void Notifications.getLastNotificationResponseAsync().then(async (lastResponse) => {
            if (!lastResponse) return;
            await handleNotificationResponse(lastResponse);
            const clearLastResponseAsync = (Notifications as any).clearLastNotificationResponseAsync;
            if (typeof clearLastResponseAsync === 'function') {
                await clearLastResponseAsync();
            }
        }).catch((error) => {
            if (__DEV__) console.error('[PushNotifications] Error reading last notification response:', error);
        });

        return () => {
            notificationListener.current?.remove();
            responseListener.current?.remove();
        };
    }, [router]);

    const saveTokenToDatabase = async (userId: string, token: string) => {
        try {
            const { data, error } = await supabase.functions.invoke('register-push-token', {
                body: { token },
            });

            if (error || data?.success === false) {
                // Fallback to direct self-row update if the edge function is not deployed yet.
                const { error: fallbackError } = await supabase
                    .from('profiles')
                    .update({ push_token: token })
                    .eq('id', userId);

                if (fallbackError) throw fallbackError;
            }

            if (__DEV__) console.log('[PushNotifications] Push token saved to Supabase');
            lastRegisteredTokenRef.current = token;
        } catch (error: any) {
            if (__DEV__) console.error('[PushNotifications] Error saving push token:', error);
        }
    };

    const clearTokenInDatabase = async () => {
        try {
            await supabase.functions.invoke('register-push-token', {
                body: { token: null },
            });
            lastRegisteredTokenRef.current = undefined;
        } catch (error) {
            if (__DEV__) console.warn('[PushNotifications] Failed to clear push token after push disable:', error);
        }
    };

    const resolvePushEnabledSetting = async (targetUserId: string, fallback: boolean): Promise<boolean> => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('settings')
                .eq('id', targetUserId)
                .maybeSingle();

            if (error || !data) {
                return fallback;
            }

            const remotePush = (data as any)?.settings?.notifications?.push;
            if (typeof remotePush === 'boolean') {
                return remotePush;
            }
            return fallback;
        } catch {
            return fallback;
        }
    };

    const syncPushTokenForUser = async (targetUserId: string, isPushEnabled: boolean, force = false) => {
        if (!targetUserId) return;
        if (syncInFlightRef.current) return;

        const now = Date.now();
        if (!force && now - lastTokenSyncAtRef.current < 20_000) {
            return;
        }
        lastTokenSyncAtRef.current = now;

        syncInFlightRef.current = true;
        try {
            const resolvedPushEnabled = await resolvePushEnabledSetting(targetUserId, isPushEnabled);

            if (!resolvedPushEnabled) {
                setExpoPushToken(undefined);
                await clearTokenInDatabase();
                return;
            }

            const token = await registerForPushNotificationsAsync();
            setExpoPushToken(token);
            if (!token) return;

            if (!force && lastRegisteredTokenRef.current === token) {
                return;
            }

            await saveTokenToDatabase(targetUserId, token);
        } finally {
            syncInFlightRef.current = false;
        }
    };

    useEffect(() => {
        if (!user) {
            _activeAuthUserId = null;
            if (bootSyncTimerRef.current) {
                clearTimeout(bootSyncTimerRef.current);
                bootSyncTimerRef.current = null;
            }
            return;
        }
        _activeAuthUserId = user.id;
        const isPushEnabled = user?.settings?.notifications?.push !== false;

        void ensureE2EEIdentity(user.id).catch((error) => {
            if (__DEV__) console.warn('[PushNotifications] E2EE identity init failed during push setup:', error);
        });

        void configureNotificationCategories();
        bootSyncTimerRef.current = setTimeout(() => {
            void syncPushTokenForUser(user.id, isPushEnabled, true);
        }, 2200);

        return () => {
            if (bootSyncTimerRef.current) {
                clearTimeout(bootSyncTimerRef.current);
                bootSyncTimerRef.current = null;
            }
            if (_activeAuthUserId === user.id) {
                _activeAuthUserId = null;
            }
        };
    }, [user?.id, user?.settings?.notifications?.push]);

    useEffect(() => {
        if (!user?.id) return;
        const subscription = AppState.addEventListener('change', (nextState) => {
            const previousState = appStateRef.current;
            appStateRef.current = nextState;
            if (
                previousState.match(/inactive|background/) &&
                nextState === 'active'
            ) {
                const isPushEnabled = user?.settings?.notifications?.push !== false;
                void syncPushTokenForUser(user.id, isPushEnabled, false);
            }
        });

        return () => {
            subscription.remove();
        };
    }, [user?.id, user?.settings?.notifications?.push]);

    return { expoPushToken };
};

async function configureAndroidNotificationChannelsAsync() {
    if (Platform.OS !== 'android') {
        return;
    }

    // Standard channel
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        bypassDnd: false,
        audioAttributes: {
            usage: Notifications.AndroidAudioUsage.NOTIFICATION,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
    });

    const callsChannelConfig: Notifications.NotificationChannelInput = {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        bypassDnd: false,
        audioAttributes: {
            usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
    };

    // Dedicated channel for incoming calls using ringtone usage.
    await Notifications.setNotificationChannelAsync(CALLS_CHANNEL_ID, callsChannelConfig);
    // Backward compatibility for already-deployed payloads that may still target "calls".
    await Notifications.setNotificationChannelAsync(LEGACY_CALLS_CHANNEL_ID, callsChannelConfig);
    // Compatibility for old builds targeting first ringtone channel id.
    await Notifications.setNotificationChannelAsync(LEGACY_CALLS_CHANNEL_V1_ID, callsChannelConfig);

    // Dedicated channel for appointment updates/reminders
    await Notifications.setNotificationChannelAsync(APPOINTMENTS_CHANNEL_ID, {
        name: 'Appointments',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        bypassDnd: false,
        audioAttributes: {
            usage: Notifications.AndroidAudioUsage.NOTIFICATION,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
    });

    // Channel used by scheduled follow-up reminders from `health-reminders` edge function.
    await Notifications.setNotificationChannelAsync(HEALTH_REMINDERS_CHANNEL_ID, {
        name: 'Health Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 220, 160, 220],
        lightColor: '#FF231F7C',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        bypassDnd: false,
        audioAttributes: {
            usage: Notifications.AndroidAudioUsage.NOTIFICATION,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
    });
}

async function registerForPushNotificationsAsync() {
    if (Platform.OS === 'web') {
        return;
    }
    await configureAndroidNotificationChannelsAsync();

    let token;
    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            if (__DEV__) console.log('[PushNotifications] Failed to get push token for push notification!');
            return;
        }

        // Project ID is required for Expo Push Token
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) {
            if (__DEV__) console.warn('[PushNotifications] Project ID not found in expo config.');
        }

        token = (await Notifications.getExpoPushTokenAsync({
            projectId: projectId,
        })).data;
        if (__DEV__) console.log('[PushNotifications] Expo Push Token:', token);
    } else {
        if (__DEV__) console.log('[PushNotifications] Must use physical device for Push Notifications');
    }

    return token;
}
