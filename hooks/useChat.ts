import { useQuery, useMutation, useQueryClient, useInfiniteQuery, InfiniteData } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import { useEffect, useMemo } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { ensureE2EEIdentity, encryptTextForRoom, decryptMessageTextForUser, isE2EEPlaceholderText } from '../src/lib/e2ee';
import { sanitizeNamePart } from '../src/utils/nameSanitizer';
import { normalizeStorageObjectPath, resolveStorageSignedUrlsByPath } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

const DEFAULT_CHAT_PAGE_SIZE = 40;
const E2EE_ALLOW_PLAINTEXT_FALLBACK =
    (process.env.EXPO_PUBLIC_CHAT_E2EE_ALLOW_PLAINTEXT_FALLBACK || 'true').trim().toLowerCase() === 'true';
const CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 30;
const CHAT_ATTACHMENT_SIGNED_URL_RENEW_BUFFER_MS = 60 * 1000;
const PROFILE_IMAGE_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const CHAT_MESSAGE_REALTIME_INVALIDATE_DEBOUNCE_MS = 180;
const CHAT_ROOMS_REALTIME_INVALIDATE_DEBOUNCE_MS = 180;
const attachmentSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const E2EE_RECOVERABLE_BOOTSTRAP_PATTERNS = [
    'recipient secure key not available yet',
    'secure chat key restore unavailable',
    'could not sync public key',
    'could not read profile key',
    'function invoke failed',
    'backup',
];
const ENCRYPTED_ROOM_STORAGE_PREVIEW = 'encrypted message';
const SECURE_MESSAGE_PREVIEW = '🔒 Secure message';
const SECURE_MESSAGE_UNAVAILABLE_PREVIEW = '🔒 Secure message unavailable';

const isRecoverableE2EEBootstrapError = (message: string): boolean => {
    const normalized = (message || '').trim().toLowerCase();
    if (!normalized) return false;
    return E2EE_RECOVERABLE_BOOTSTRAP_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const normalizeEncryptedRoomPreview = (value: string): string => {
    const normalized = (value || '').trim();
    if (!normalized) return SECURE_MESSAGE_PREVIEW;
    if (!isE2EEPlaceholderText(normalized)) return normalized;

    const lowered = normalized.toLowerCase();
    if (lowered.includes('unavailable') || lowered.includes('refreshed') || lowered.includes('resend')) {
        return SECURE_MESSAGE_UNAVAILABLE_PREVIEW;
    }

    return SECURE_MESSAGE_PREVIEW;
};

export const CHAT_QUERY_KEYS = {
    roomsPrefix: ['chat', 'rooms'] as const,
    rooms: (userId?: string) => ['chat', 'rooms', userId || 'anonymous'] as const,
    messages: (roomId: string, pageSize: number) => ['chat', 'messages', roomId, pageSize],
    messagesPrefix: (roomId: string) => ['chat', 'messages', roomId],
};

export interface ChatRoom {
    id: string;
    patient_id: string;
    doctor_id: string;
    created_at: string;
    last_message_at: string;
    last_message_text: string | null;
    unread_count_patient: number;
    unread_count_doctor: number;
    chat_enabled?: boolean;
    chat_disabled_reason?: string | null;
    chat_access_expires_at?: string | null;
    chat_has_future_slot?: boolean;
    other_party?: {
        id: string;
        firstName: string;
        lastName: string;
        profilePicture: string | null;
        lastSeenAt: string | null;
    };
}

export interface ChatMessage {
    id: string;
    room_id: string;
    sender_id: string;
    text: string;
    type: 'text' | 'image' | 'file';
    attachment_url?: string;
    attachment_access_url?: string;
    is_read: boolean;
    created_at: string;
    reply_to_id?: string;
    is_encrypted?: boolean;
    encrypted_payload?: string | null;
    encryption_version?: number | null;
    reply_to?: {
        id: string;
        text: string;
        type: string;
        sender_id: string;
        is_encrypted?: boolean | null;
        encrypted_payload?: string | null;
        encryption_version?: number | null;
    };
    is_pending?: boolean;
}

type ChatMessagePage = {
    items: ChatMessage[];
    nextCursor: string | null;
};

const mergeAndSortMessages = (rows: ChatMessage[]): ChatMessage[] => {
    const map = new Map<string, ChatMessage>();
    for (const row of rows) {
        map.set(row.id, row);
    }

    return Array.from(map.values()).sort((a, b) => {
        const ts = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (ts !== 0) return ts;
        return (b.id || '').localeCompare(a.id || '');
    });
};

const chatMessageComparator = (a: ChatMessage, b: ChatMessage): number => {
    const ts = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (ts !== 0) return ts;
    return a.id.localeCompare(b.id);
};

const upsertMessageInPage = (items: ChatMessage[], message: ChatMessage): ChatMessage[] => {
    const nextItems = [...items];
    const existingIndex = nextItems.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
        nextItems[existingIndex] = { ...nextItems[existingIndex], ...message };
    } else {
        nextItems.unshift(message);
    }

    // Keep page ordered newest-first because query fetches descending.
    nextItems.sort((a, b) => chatMessageComparator(b, a));
    return nextItems;
};

const removeMessageFromPage = (items: ChatMessage[], messageId: string): ChatMessage[] =>
    items.filter((item) => item.id !== messageId);

const updateMessageCachesForRoom = (
    queryClient: QueryClient,
    roomId: string,
    updater: (data: InfiniteData<ChatMessagePage>) => InfiniteData<ChatMessagePage>
) => {
    const targetQueries = queryClient.getQueriesData<InfiniteData<ChatMessagePage>>({
        queryKey: CHAT_QUERY_KEYS.messagesPrefix(roomId),
    });

    targetQueries.forEach(([queryKey, data]) => {
        if (!data || !Array.isArray(data.pages)) return;
        queryClient.setQueryData(queryKey, updater(data));
    });
};

const updateRoomCaches = (
    queryClient: QueryClient,
    updater: (rooms: ChatRoom[]) => ChatRoom[]
) => {
    const targetQueries = queryClient.getQueriesData<ChatRoom[]>({
        queryKey: CHAT_QUERY_KEYS.roomsPrefix,
    });

    targetQueries.forEach(([queryKey, data]) => {
        if (!Array.isArray(data)) return;
        queryClient.setQueryData(queryKey, updater(data));
    });
};

const updateRoomPreviewInCache = (
    queryClient: QueryClient,
    roomId: string,
    previewText: string,
    lastMessageAt: string
) => {
    updateRoomCaches(queryClient, (rooms) => {
        let touched = false;
        const next = rooms.map((room) => {
            if (room.id !== roomId) return room;
            touched = true;
            return {
                ...room,
                last_message_text: previewText,
                last_message_at: lastMessageAt,
            };
        });

        if (!touched) return rooms;
        return [...next].sort((a, b) => {
            const ts = new Date(b.last_message_at || '').getTime() - new Date(a.last_message_at || '').getTime();
            if (ts !== 0) return ts;
            return (a.id || '').localeCompare(b.id || '');
        });
    });
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

const toImmediateAttachmentUrl = (value?: string): string | undefined => {
    if (!value) return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('file://') || normalized.startsWith('content://')) {
        return normalized;
    }
    return undefined;
};

export const addOrUpdateLocalChatMessage = (
    queryClient: QueryClient,
    roomId: string,
    message: ChatMessage
) => {
    updateMessageCachesForRoom(queryClient, roomId, (data) => {
        const pages = [...data.pages];
        if (!pages.length) {
            return {
                ...data,
                pages: [{ items: [message], nextCursor: null }],
            };
        }

        const firstPage = pages[0];
        pages[0] = {
            ...firstPage,
            items: upsertMessageInPage(firstPage.items || [], message),
        };

        return {
            ...data,
            pages,
        };
    });
};

export const removeLocalChatMessage = (
    queryClient: QueryClient,
    roomId: string,
    messageId: string
) => {
    updateMessageCachesForRoom(queryClient, roomId, (data) => {
        const pages = data.pages.map((page) => ({
            ...page,
            items: removeMessageFromPage(page.items || [], messageId),
        }));

        return {
            ...data,
            pages,
        };
    });
};

const decryptTextContentForUser = async (params: {
    userId: string;
    senderId: string;
    type?: string | null;
    text?: string | null;
    isEncrypted?: boolean | null;
    encryptedPayload?: string | null;
}): Promise<string> => {
    const { userId, senderId, type, text, isEncrypted, encryptedPayload } = params;
    const fallbackText = text || '';
    if (!isEncrypted) {
        return fallbackText;
    }
    const normalizedFallback = fallbackText.trim().toLowerCase() === ENCRYPTED_ROOM_STORAGE_PREVIEW
        ? null
        : fallbackText;

    return decryptMessageTextForUser({
        userId,
        senderId,
        isEncrypted,
        encryptedPayload,
        fallbackText: normalizedFallback,
    });
};

const decryptMessagesForUser = async (messages: ChatMessage[], userId: string): Promise<ChatMessage[]> => {
    return Promise.all(
        messages.map(async (msg) => {
            const decryptedText = await decryptTextContentForUser({
                userId,
                senderId: msg.sender_id,
                type: msg.type,
                text: msg.text,
                isEncrypted: msg.is_encrypted,
                encryptedPayload: msg.encrypted_payload,
            });

            let decryptedReply = msg.reply_to;
            if (msg.reply_to) {
                const decryptedReplyText = await decryptTextContentForUser({
                    userId,
                    senderId: msg.reply_to.sender_id,
                    type: msg.reply_to.type,
                    text: msg.reply_to.text,
                    isEncrypted: msg.reply_to.is_encrypted,
                    encryptedPayload: msg.reply_to.encrypted_payload,
                });

                if (decryptedReplyText !== (msg.reply_to.text || '')) {
                    decryptedReply = {
                        ...msg.reply_to,
                        text: decryptedReplyText,
                    };
                }
            }

            if (decryptedText === (msg.text || '') && decryptedReply === msg.reply_to) {
                return msg;
            }

            return {
                ...msg,
                text: decryptedText,
                reply_to: decryptedReply,
            };
        })
    );
};

const hydrateEncryptedRoomPreviews = async (rooms: ChatRoom[], userId: string): Promise<ChatRoom[]> => {
    const targets = rooms.filter((room) =>
        (room.last_message_text || '').trim().toLowerCase().startsWith(ENCRYPTED_ROOM_STORAGE_PREVIEW)
    );
    if (!targets.length) {
        return rooms;
    }

    const previewPairs = await Promise.all(
        targets.map(async (room) => {
            try {
                const { data, error } = await supabase
                    .from('chat_messages')
                    .select('text, type, is_encrypted, encrypted_payload, sender_id')
                    .eq('room_id', room.id)
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (error || !data) return null;

                if (data.type === 'image' && !data.is_encrypted) {
                    return { roomId: room.id, preview: '📷 Photo' };
                }

                if (data.type === 'file' && !data.is_encrypted) {
                    return { roomId: room.id, preview: '📄 File' };
                }

                if (data.is_encrypted) {
                    const rawFallbackText = typeof data.text === 'string' ? data.text.trim() : '';
                    const decrypted = await decryptMessageTextForUser({
                        userId,
                        senderId: data.sender_id,
                        isEncrypted: data.is_encrypted,
                        encryptedPayload: data.encrypted_payload as any,
                        fallbackText:
                            rawFallbackText.toLowerCase() === ENCRYPTED_ROOM_STORAGE_PREVIEW
                                ? null
                                : rawFallbackText,
                    });
                    const preview = normalizeEncryptedRoomPreview(decrypted);
                    if (data.type === 'image') return { roomId: room.id, preview: '📷 Photo' };
                    if (data.type === 'file') return { roomId: room.id, preview: '📄 ' + (preview || 'File') };
                    return { roomId: room.id, preview };
                }

                return { roomId: room.id, preview: data.text || '' };
            } catch {
                return null;
            }
        })
    );

    const previewMap = new Map<string, string>();
    previewPairs.forEach((pair) => {
        if (!pair) return;
        if (typeof pair.preview !== 'string' || !pair.preview.trim()) return;
        previewMap.set(pair.roomId, pair.preview);
    });

    if (!previewMap.size) {
        return rooms;
    }

    return rooms.map((room) => {
        const preview = previewMap.get(room.id);
        if (!preview) return room;
        return {
            ...room,
            last_message_text: preview,
        };
    });
};

type AppointmentWindowRow = {
    patient_id: string;
    doctor_id: string;
    status: string;
    slot: { date?: string | null } | null;
};

type PairWindowState = {
    hasAnyEligibleAppointment: boolean;
    hasFutureSlot: boolean;
    latestPastSlotDate: Date | null;
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

const toPairKey = (patientId: string, doctorId: string) => `${patientId}:${doctorId}`;

const attachChatEligibilityWindow = async (rooms: ChatRoom[], userId: string): Promise<ChatRoom[]> => {
    if (!rooms.length || !userId) return rooms;

    const { data, error } = await supabase
        .from('appointments')
        .select('patient_id, doctor_id, status, slot:slots!slot_id(date)')
        .or(`patient_id.eq.${userId},doctor_id.eq.${userId}`)
        .in('status', ['pending', 'confirmed', 'completed']);

    if (error) {
        if (__DEV__) console.warn('[useChat] Failed to fetch appointment windows for chat eligibility:', error);
        return rooms;
    }

    const appointmentRows = (data || []) as AppointmentWindowRow[];
    const pairMap = new Map<string, PairWindowState>();
    const today = startOfTodayLocal();

    for (const row of appointmentRows) {
        const patientId = typeof row.patient_id === 'string' ? row.patient_id : '';
        const doctorId = typeof row.doctor_id === 'string' ? row.doctor_id : '';
        if (!patientId || !doctorId) continue;

        const slotDate = parseDateOnlyToLocalDate(row.slot?.date || null);
        if (!slotDate) continue;

        const key = toPairKey(patientId, doctorId);
        const current = pairMap.get(key) || {
            hasAnyEligibleAppointment: false,
            hasFutureSlot: false,
            latestPastSlotDate: null,
        };

        current.hasAnyEligibleAppointment = true;
        if (slotDate.getTime() >= today.getTime()) {
            current.hasFutureSlot = true;
        } else if (!current.latestPastSlotDate || slotDate.getTime() > current.latestPastSlotDate.getTime()) {
            current.latestPastSlotDate = slotDate;
        }

        pairMap.set(key, current);
    }

    return rooms.map((room) => {
        const key = toPairKey(room.patient_id, room.doctor_id);
        const state = pairMap.get(key);

        if (!state || !state.hasAnyEligibleAppointment) {
            return {
                ...room,
                chat_enabled: false,
                chat_disabled_reason: 'Book an appointment to enable chat.',
                chat_access_expires_at: null,
                chat_has_future_slot: false,
            };
        }

        if (state.hasFutureSlot) {
            return {
                ...room,
                chat_enabled: true,
                chat_disabled_reason: null,
                chat_access_expires_at: null,
                chat_has_future_slot: true,
            };
        }

        if (!state.latestPastSlotDate) {
            return {
                ...room,
                chat_enabled: false,
                chat_disabled_reason: 'Book a future slot to re-enable chat.',
                chat_access_expires_at: null,
                chat_has_future_slot: false,
            };
        }

        const accessExpiry = addDays(state.latestPastSlotDate, 30);
        const stillInWindow = today.getTime() <= accessExpiry.getTime();

        return {
            ...room,
            chat_enabled: stillInWindow,
            chat_disabled_reason: stillInWindow ? null : 'Chat window expired. Book a future slot to re-enable.',
            chat_access_expires_at: accessExpiry.toISOString(),
            chat_has_future_slot: false,
        };
    });
};

const resolveSignedProfilePicture = (
    rawValue: unknown,
    pathToSignedUrl: Map<string, string>
): string | null => {
    const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!raw) return null;

    const path = normalizeStorageObjectPath(PROFILE_IMAGE_BUCKET, raw);
    if (!path) return raw;
    return pathToSignedUrl.get(path) || raw;
};

const fetchChatRoomsForUser = async (userId: string): Promise<ChatRoom[]> => {
    const { data, error } = await supabase
        .from('chat_rooms')
        .select(`
            *,
            patient:profiles!patient_id(id, first_name, last_name, profile_picture, last_seen_at),
            doctor:doctors!doctor_id(id, profiles(id, first_name, last_name, profile_picture, last_seen_at))
        `)
        .or(`patient_id.eq.${userId},doctor_id.eq.${userId}`)
        .not('last_message_at', 'is', null) // Must have a timestamp
        .not('last_message_text', 'is', null) // Must have text/preview metadata
        .order('last_message_at', { ascending: false });

    if (error) throw error;

    const profilePathToSignedUrl = await resolveStorageSignedUrlsByPath({
        bucket: PROFILE_IMAGE_BUCKET,
        values: (data || []).flatMap((row: any) => [
            row?.patient?.profile_picture || '',
            row?.doctor?.profiles?.profile_picture || '',
        ]),
        ttlSeconds: PROFILE_IMAGE_SIGNED_URL_TTL_SECONDS,
    });

    const mappedRooms = (data || []).map((room: any) => {
        const isPatient = room.patient_id === userId;
        const other = isPatient
            ? room.doctor?.profiles
            : room.patient;
        const signedOtherProfilePicture = resolveSignedProfilePicture(other?.profile_picture, profilePathToSignedUrl);
        const firstName = sanitizeNamePart(other?.first_name) || 'User';
        const lastName = sanitizeNamePart(other?.last_name);

        return {
            ...room,
            other_party: {
                id: isPatient ? (room.doctor?.profiles?.id || room.doctor_id) : (room.patient?.id || room.patient_id),
                firstName,
                lastName,
                profilePicture: signedOtherProfilePicture,
                lastSeenAt: other?.last_seen_at,
            },
        };
    }) as ChatRoom[];

    const roomsWithPreview = await hydrateEncryptedRoomPreviews(mappedRooms, userId);
    return attachChatEligibilityWindow(roomsWithPreview, userId);
};

const resolveChatAttachmentPath = (rawUrl?: string | null): { path: string | null; directUrl?: string } => {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!value) return { path: null };

    if (value.startsWith('file://') || value.startsWith('content://')) {
        return { path: null, directUrl: value };
    }

    if (/^https?:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);
            const markers = [
                '/storage/v1/object/public/chat-attachments/',
                '/storage/v1/object/sign/chat-attachments/',
                '/storage/v1/object/authenticated/chat-attachments/',
            ];

            for (const marker of markers) {
                const markerIndex = parsed.pathname.indexOf(marker);
                if (markerIndex >= 0) {
                    const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
                    if (!encodedPath) break;
                    return { path: decodeURIComponent(encodedPath) };
                }
            }
        } catch {
            return { path: null, directUrl: value };
        }

        // External URL. Keep as-is.
        return { path: null, directUrl: value };
    }

    // Already a storage object path like "<room_id>/<file>"
    return { path: value };
};

const getSignedChatAttachmentUrl = async (attachmentUrl?: string | null): Promise<string | null> => {
    const resolved = resolveChatAttachmentPath(attachmentUrl);
    if (resolved.directUrl) return resolved.directUrl;
    if (!resolved.path) return typeof attachmentUrl === 'string' ? attachmentUrl : null;

    const cached = attachmentSignedUrlCache.get(resolved.path);
    const now = Date.now();
    if (cached && cached.expiresAt - CHAT_ATTACHMENT_SIGNED_URL_RENEW_BUFFER_MS > now) {
        return cached.url;
    }

    const { data, error } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(resolved.path, CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
        throw error || new Error('Could not create signed URL for attachment');
    }

    const expiresAt = now + CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS * 1000;
    attachmentSignedUrlCache.set(resolved.path, { url: data.signedUrl, expiresAt });
    return data.signedUrl;
};

const resolveAttachmentUrlsForMessages = async (messages: ChatMessage[]): Promise<ChatMessage[]> => {
    return Promise.all(
        messages.map(async (message) => {
            if (!message.attachment_url || (message.type !== 'image' && message.type !== 'file')) {
                return message;
            }

            try {
                const signedUrl = await getSignedChatAttachmentUrl(message.attachment_url);
                if (!signedUrl) return message;
                return {
                    ...message,
                    attachment_access_url: signedUrl,
                };
            } catch (error) {
                if (__DEV__) console.warn('[useChat] Attachment signed URL generation failed:', error);
                return message;
            }
        })
    );
};


// 1. Hook to fetch rooms (conversations)
export const useChatRooms = () => {
    const { user } = useAuthContext();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!user?.id) return;

        // Ensure local keypair exists and user public key is synced.
        void ensureE2EEIdentity(user.id).catch((error) => {
            if (__DEV__) console.warn('[useChat] E2EE identity bootstrap failed:', error);
        });
    }, [user?.id]);

    useEffect(() => {
        if (!user) return;
        let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleInvalidate = () => {
            if (invalidateTimer) return;
            invalidateTimer = setTimeout(() => {
                invalidateTimer = null;
                void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEYS.roomsPrefix });
            }, CHAT_ROOMS_REALTIME_INVALIDATE_DEBOUNCE_MS);
        };

        // Subscribe to changes in chat_rooms table for real-time list updates
        const channel = supabase
            .channel(`chat_rooms_updates:${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chat_rooms',
                    filter: `patient_id=eq.${user.id}`,
                },
                scheduleInvalidate
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chat_rooms',
                    filter: `doctor_id=eq.${user.id}`,
                },
                scheduleInvalidate
            )
            // Fallback signal for environments where chat_rooms realtime publication is inconsistent.
            // chat_messages inserts are enough to refresh room previews/order without manual pull-to-refresh.
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                },
                scheduleInvalidate
            )
            .subscribe();

        return () => {
            if (invalidateTimer) {
                clearTimeout(invalidateTimer);
                invalidateTimer = null;
            }
            void supabase.removeChannel(channel);
        };
    }, [user?.id, queryClient]);

    return useQuery({
        queryKey: CHAT_QUERY_KEYS.rooms(user?.id),
        queryFn: async () => {
            if (!user?.id) return [];
            return fetchChatRoomsForUser(user.id);
        },
        enabled: !!user?.id,
        staleTime: 30 * 1000,
        gcTime: 20 * 60 * 1000,
        placeholderData: (previousData) => previousData ?? [],
    });
};

export const prefetchChatRooms = async (queryClient: QueryClient, userId?: string) => {
    if (!userId) return;

    await queryClient.prefetchQuery({
        queryKey: CHAT_QUERY_KEYS.rooms(userId),
        queryFn: () => fetchChatRoomsForUser(userId),
        staleTime: 30 * 1000,
    });
};

// 2. Hook to fetch messages with keyset pagination + decryption
export const useChatMessages = (roomId: string, pageSize: number = DEFAULT_CHAT_PAGE_SIZE) => {
    const queryClient = useQueryClient();
    const { user } = useAuthContext();
    const normalizedPageSize = Math.max(10, pageSize || DEFAULT_CHAT_PAGE_SIZE);

    useEffect(() => {
        if (!roomId || !user?.id) return;

        // Fresh device / reinstall guard:
        // ensure key bootstrap + profile sync runs as soon as chat opens.
        void ensureE2EEIdentity(user.id).catch((error) => {
            if (__DEV__) console.warn('[useChat] E2EE identity bootstrap failed on chat open:', error);
        });
    }, [roomId, user?.id]);

    const query = useInfiniteQuery({
        queryKey: CHAT_QUERY_KEYS.messages(roomId, normalizedPageSize),
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }): Promise<ChatMessagePage> => {
            if (!user?.id) return { items: [], nextCursor: null };

            let request = supabase
                .from('chat_messages')
                .select(`
                    *,
                    reply_to:reply_to_id(id, text, type, sender_id, is_encrypted, encrypted_payload, encryption_version)
                `)
                .eq('room_id', roomId)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(normalizedPageSize + 1);

            if (pageParam) {
                request = request.lt('created_at', pageParam);
            }

            const { data, error } = await request;
            if (error) throw error;

            const fetchedRows = (data || []) as ChatMessage[];
            const hasMore = fetchedRows.length > normalizedPageSize;
            const rows = hasMore ? fetchedRows.slice(0, normalizedPageSize) : fetchedRows;
            const decryptedRows = await decryptMessagesForUser(rows, user.id);
            const resolvedRows = await resolveAttachmentUrlsForMessages(decryptedRows);
            const nextCursor = hasMore ? rows[rows.length - 1]?.created_at || null : null;

            return { items: resolvedRows, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !!roomId && !!user?.id,
    });

    // Real-time subscription — push messages directly into cache to avoid a full refetch round-trip
    useEffect(() => {
        if (!roomId || !user?.id) return;

        let fallbackInvalidateTimer: ReturnType<typeof setTimeout> | null = null;

        const scheduleFallbackInvalidate = () => {
            if (fallbackInvalidateTimer) return;
            fallbackInvalidateTimer = setTimeout(() => {
                fallbackInvalidateTimer = null;
                void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEYS.messagesPrefix(roomId) });
            }, CHAT_MESSAGE_REALTIME_INVALIDATE_DEBOUNCE_MS);
        };

        const handleRealtimeEvent = async (payload: any) => {
            const eventType: string = payload.eventType || '';

            // DELETE: just do a background invalidate (rare event)
            if (eventType === 'DELETE') {
                scheduleFallbackInvalidate();
                return;
            }

            const row = payload.new;
            if (!row || !row.id) {
                scheduleFallbackInvalidate();
                return;
            }

            // Own messages are already in cache via optimistic update — only process others' messages
            if (row.sender_id === user.id) return;

            // Decrypt and push into cache directly (no full refetch)
            try {
                let msg: ChatMessage = row as ChatMessage;

                if (msg.is_encrypted) {
                    const decryptedText = await decryptTextContentForUser({
                        userId: user.id,
                        senderId: msg.sender_id,
                        type: msg.type,
                        text: msg.text,
                        isEncrypted: msg.is_encrypted,
                        encryptedPayload: msg.encrypted_payload,
                    });
                    msg = { ...msg, text: decryptedText };
                }

                if ((msg.type === 'image' || msg.type === 'file') && msg.attachment_url) {
                    try {
                        const signedUrl = await getSignedChatAttachmentUrl(msg.attachment_url);
                        if (signedUrl) msg = { ...msg, attachment_access_url: signedUrl };
                    } catch {
                        // keep original url
                    }
                }

                addOrUpdateLocalChatMessage(queryClient, roomId, msg);
            } catch {
                // Fallback: refetch if realtime push fails
                scheduleFallbackInvalidate();
            }
        };

        const channel = supabase
            .channel(`room:${roomId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `room_id=eq.${roomId}`,
                },
                handleRealtimeEvent
            )
            .subscribe();

        return () => {
            if (fallbackInvalidateTimer) {
                clearTimeout(fallbackInvalidateTimer);
                fallbackInvalidateTimer = null;
            }
            void supabase.removeChannel(channel);
        };
    }, [roomId, queryClient, user?.id]);

    const mergedMessages = useMemo(() => {
        const pages = query.data?.pages || [];
        const flattened = pages.flatMap((page) => page.items);
        return mergeAndSortMessages(flattened);
    }, [query.data]);

    return {
        ...query,
        data: mergedMessages,
        messages: mergedMessages,
    };
};

// 2.5 Helper to prefetch first page instantly in the background
export const prefetchChatMessages = async (
    queryClient: QueryClient,
    roomId: string,
    pageSize: number = DEFAULT_CHAT_PAGE_SIZE,
    userId?: string
) => {
    const normalizedPageSize = Math.max(10, pageSize || DEFAULT_CHAT_PAGE_SIZE);
    await queryClient.prefetchInfiniteQuery({
        queryKey: CHAT_QUERY_KEYS.messages(roomId, normalizedPageSize),
        initialPageParam: null as string | null,
        queryFn: async (): Promise<ChatMessagePage> => {
            const { data, error } = await supabase
                .from('chat_messages')
                .select(`
                    *,
                    reply_to:reply_to_id(id, text, type, sender_id, is_encrypted, encrypted_payload, encryption_version)
                `)
                .eq('room_id', roomId)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(normalizedPageSize + 1);

            if (error) throw error;

            const fetchedRows = (data || []) as ChatMessage[];
            const hasMore = fetchedRows.length > normalizedPageSize;
            const rows = hasMore ? fetchedRows.slice(0, normalizedPageSize) : fetchedRows;
            let hydratedRows = rows;
            if (userId) {
                hydratedRows = await decryptMessagesForUser(rows, userId);
            }

            const resolvedRows = await resolveAttachmentUrlsForMessages(hydratedRows);
            const nextCursor = hasMore ? rows[rows.length - 1]?.created_at || null : null;

            return { items: resolvedRows, nextCursor };
        },
        getNextPageParam: (lastPage:any) => lastPage.nextCursor,
        staleTime: 5 * 60 * 1000,
    });
};

// 3. Hook to send message
export const useSendMessage = () => {
    const { user } = useAuthContext();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            roomId,
            text,
            type = 'text',
            attachmentUrl,
            attachmentDisplayUrl,
            replyToId
        }: {
            roomId: string;
            text: string;
            type?: 'text' | 'image' | 'file';
            attachmentUrl?: string;
            attachmentDisplayUrl?: string;
            replyToId?: string;
            clientTempId?: string;
        }) => {
            if (!user) throw new Error('Not authenticated');

            let insertText = text;
            let isEncrypted = false;
            let encryptedPayload: string | null = null;
            let encryptionVersion: number | null = null;
            let e2eeFallbackUsed = false;

            if (text && type === 'text') {
                try {
                    const encrypted = await encryptTextForRoom({
                        roomId,
                        senderId: user.id,
                        plaintext: text,
                    });
                    insertText = encrypted.text;
                    isEncrypted = encrypted.is_encrypted;
                    encryptedPayload = encrypted.encrypted_payload;
                    encryptionVersion = encrypted.encryption_version;
                } catch (encryptionError: any) {
                    const baseMessage =
                        typeof encryptionError?.message === 'string' && encryptionError.message.trim()
                            ? encryptionError.message.trim()
                            : 'Encryption failed.';
                    const allowFallback =
                        E2EE_ALLOW_PLAINTEXT_FALLBACK || isRecoverableE2EEBootstrapError(baseMessage);

                    if (!allowFallback) {
                        throw new Error(
                            `End-to-end encryption required. ${baseMessage}`
                        );
                    }

                    // Reliability fallback: if E2EE bootstrap/key exchange fails, send plaintext.
                    e2eeFallbackUsed = true;
                    if (__DEV__) console.warn('[useChat] E2EE encryption failed, sending plaintext fallback:', baseMessage);
                    insertText = text;
                    isEncrypted = false;
                    encryptedPayload = null;
                    encryptionVersion = null;
                }
            }

            const { data, error } = await supabase
                .from('chat_messages')
                .insert({
                    room_id: roomId,
                    sender_id: user.id,
                    text: insertText,
                    type,
                    attachment_url: attachmentUrl,
                    reply_to_id: replyToId,
                    is_encrypted: isEncrypted,
                    encrypted_payload: encryptedPayload,
                    encryption_version: encryptionVersion,
                })
                .select(`*, reply_to:reply_to_id(id, text, type, sender_id, is_encrypted, encrypted_payload, encryption_version)`)
                .single();

            if (error) throw error;
            return {
                ...(data as ChatMessage),
                __meta: {
                    e2eeFallbackUsed,
                },
            };
        },
        onMutate: async (variables) => {
            const optimisticId = variables.clientTempId || `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            await queryClient.cancelQueries({ queryKey: CHAT_QUERY_KEYS.messagesPrefix(variables.roomId) });

            const previousQueries = queryClient.getQueriesData<InfiniteData<ChatMessagePage>>({
                queryKey: CHAT_QUERY_KEYS.messagesPrefix(variables.roomId),
            });

            const optimisticMessage: ChatMessage = {
                id: optimisticId,
                room_id: variables.roomId,
                sender_id: user?.id || '',
                text: variables.text,
                type: variables.type || 'text',
                attachment_url: variables.attachmentUrl,
                attachment_access_url: variables.attachmentDisplayUrl || toImmediateAttachmentUrl(variables.attachmentUrl),
                is_read: true,
                created_at: new Date().toISOString(),
                reply_to_id: variables.replyToId,
                is_encrypted: false,
                encrypted_payload: null,
                encryption_version: null,
                is_pending: true,
            };

            addOrUpdateLocalChatMessage(queryClient, variables.roomId, optimisticMessage);

            return {
                previousQueries,
                roomId: variables.roomId,
                optimisticId,
            };
        },
        onSuccess: (newMessage, variables, context) => {
            const optimisticId = variables.clientTempId || context?.optimisticId;
            const messageForCache: ChatMessage = {
                ...(newMessage as any),
                text:
                    (newMessage as any)?.type === 'text' && Boolean((newMessage as any)?.is_encrypted)
                        ? variables.text
                        : (newMessage as any)?.text || variables.text,
                attachment_access_url:
                    variables.attachmentDisplayUrl ||
                    toImmediateAttachmentUrl((newMessage as any)?.attachment_url),
                is_pending: false,
            };

            if (optimisticId) {
                removeLocalChatMessage(queryClient, variables.roomId, optimisticId);
            }
            addOrUpdateLocalChatMessage(queryClient, variables.roomId, messageForCache);

            const roomPreviewText =
                messageForCache.type === 'image'
                    ? '📷 Photo'
                    : messageForCache.type === 'file'
                        ? '📄 File'
                        : (variables.text || messageForCache.text || '');
            const roomLastMessageAt = messageForCache.created_at || new Date().toISOString();
            updateRoomPreviewInCache(queryClient, variables.roomId, roomPreviewText, roomLastMessageAt);

            // Fire-and-forget notification invoke. Do not block chat UX on notification issues.
            void (async () => {
                const notificationPreviewText =
                    newMessage.type === 'text'
                        ? (variables.text || newMessage.text || '')
                        : (newMessage.text || variables.text || '');

                const { data, error } = await supabase.functions.invoke('send-chat-notification', {
                    body: {
                        record: {
                            id: newMessage.id,
                            room_id: newMessage.room_id,
                            sender_id: newMessage.sender_id,
                            text: newMessage.is_encrypted ? 'Encrypted message' : newMessage.text,
                            notification_preview_text: notificationPreviewText,
                            type: newMessage.type,
                            is_encrypted: Boolean(newMessage.is_encrypted),
                        }
                    }
                });

                if (error) {
                    const message = await extractFunctionInvokeErrorMessage(error);
                    if (__DEV__) console.warn('[useChat] Push notification skipped:', message);
                    return;
                }

                if (data?.success === false) {
                    const message =
                        typeof data?.error === 'string' && data.error.trim()
                            ? data.error.trim()
                            : 'Notification service returned unsuccessful response.';
                    if (__DEV__) console.warn('[useChat] Push notification not sent:', message);
                    return;
                }

                if (data?.skipped && typeof data?.reason === 'string' && data.reason.trim()) {
                    if (__DEV__) console.info(`[useChat] Push notification skipped: ${data.reason}`);
                }
            })();
            // Keep UX smooth: optimistic state already reconciled with server payload.
            // Real-time listener will sync any additional server-side changes.
        },
        onError: (_error, variables, context) => {
            if (context?.previousQueries?.length) {
                context.previousQueries.forEach(([queryKey, previousData]) => {
                    queryClient.setQueryData(queryKey, previousData);
                });
            } else if (context?.optimisticId) {
                removeLocalChatMessage(queryClient, variables.roomId, context.optimisticId);
            }
        }
    });
};

// 4. Hook to ensure a room exists between two parties (or create it)
export const useGetOrCreateRoom = () => {
    const { user } = useAuthContext();

    return useMutation({
        mutationFn: async ({ doctorId, patientId }: { doctorId: string; patientId: string }) => {
            if (!user) throw new Error('Not authenticated');

            // Try to find existing room
            const { data: existing, error: fetchError } = await supabase
                .from('chat_rooms')
                .select('id')
                .eq('patient_id', patientId)
                .eq('doctor_id', doctorId)
                .maybeSingle();

            if (fetchError) throw fetchError;
            if (existing) return existing.id;

            // Create new room if not found
            const { data: newRoom, error: createError } = await supabase
                .from('chat_rooms')
                .insert({ patient_id: patientId, doctor_id: doctorId })
                .select('id')
                .single();

            if (createError) throw createError;
            return newRoom.id;
        }
    });
};

// 5. Hook to mark a room as read
export const useMarkAsRead = () => {
    const { user } = useAuthContext();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (roomId: string) => {
            if (!user) return;
            const { error } = await supabase.rpc('mark_room_as_read', {
                target_room_id: roomId,
                user_role: user.role,
                target_user_id: user.id,
            });
            if (error) throw error;

            // Keep in-app notification center consistent with seen state for this chat room.
            const { error: notificationError } = await supabase
                .from('in_app_notifications')
                .update({ is_read: true })
                .eq('user_id', user.id)
                .eq('type', 'chat_message')
                .eq('is_read', false)
                .eq('data->>roomId', roomId);

            if (notificationError) {
                if (__DEV__) console.warn('[useChat] Failed to mark room notifications as read:', notificationError);
            }
        },
        onSuccess: () => {
            // Refresh rooms list to clear badges
            queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEYS.roomsPrefix });
        },
    });
};

export const useSendPrescriptionPdfToChat = () => {
    const { user, session } = useAuthContext();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            roomId,
            doctorText,
            patientName,
            consultationId,
            concern,
        }: {
            roomId: string;
            doctorText: string;
            patientName?: string;
            consultationId?: string;
            concern?: string;
        }) => {
            if (!user?.id || !session?.access_token) {
                throw new Error('Please login again to send prescription PDF.');
            }

            const functionsClient = supabase.functions;
            functionsClient.setAuth(session.access_token);
            const { data, error } = await functionsClient.invoke('send-prescription-chat-pdf', {
                body: {
                    roomId,
                    doctorText,
                    patientName: patientName || null,
                    consultationId: consultationId || null,
                    concern: concern || null,
                },
            });

            if (error) {
                const msg = await extractFunctionInvokeErrorMessage(error);
                throw new Error(msg || 'Could not generate prescription PDF.');
            }
            if (!data?.success) {
                throw new Error(data?.message || 'Could not generate prescription PDF.');
            }
            return data?.data;
        },
        onSuccess: (_result, variables) => {
            // Message is inserted server-side; refresh caches so chat UI picks it quickly.
            void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEYS.messagesPrefix(variables.roomId) });
            void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEYS.roomsPrefix });
        },
    });
};

