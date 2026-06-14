import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { supabase } from './supabase';

const E2EE_ALGORITHM = 'x25519-xsalsa20-poly1305-v1';
const E2EE_VERSION = 1;
const PROFILE_SYNC_TTL_MS = 10 * 60 * 1000;
const PUBLIC_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const ROOM_PARTICIPANTS_CACHE_TTL_MS = 15 * 60 * 1000;
const KEY_BACKUP_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
const E2EE_WAITING_TEXT = 'Waiting for this message. This may take a while.';
const E2EE_UNAVAILABLE_TEXT = 'Message unavailable. Please ask the sender to resend.';
const E2EE_KEY_REFRESHED_TEXT = 'Secure chat key was refreshed on this device. Please ask sender to resend this message.';
const E2EE_STORAGE_PLACEHOLDER_TEXT = 'Encrypted message';

// SecureStore key names can only contain [a-zA-Z0-9._-] on Android.
const SECRET_KEY_PREFIX = 'cd4.e2ee.secret.';
const PUBLIC_KEY_PREFIX = 'cd4.e2ee.public.';
const LEGACY_SECRET_KEY_PREFIX = 'cd4.e2ee.legacy.secret.';
const LEGACY_PUBLIC_KEY_PREFIX = 'cd4.e2ee.legacy.public.';

type IdentityKeyPair = {
  publicKey: string;
  secretKey: string;
};

type ParsedEncryptedPayload = {
  v: number;
  alg: string;
  nonce: string;
  senderPublicKey: string;
  recipientPublicKey: string;
  ciphertext: string;
};

type RawEncryptedPayload =
  | string
  | {
      v?: number;
      version?: number;
      alg?: string;
      algorithm?: string;
      nonce?: string;
      senderPublicKey?: string;
      sender_public_key?: string;
      recipientPublicKey?: string;
      recipient_public_key?: string;
      ciphertext?: string;
    }
  | null
  | undefined;

const getE2EERecoveryMessage = (): string => E2EE_KEY_REFRESHED_TEXT;

export const isE2EEPlaceholderText = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === E2EE_WAITING_TEXT.toLowerCase()
    || normalized === E2EE_UNAVAILABLE_TEXT.toLowerCase()
    || normalized === E2EE_KEY_REFRESHED_TEXT.toLowerCase()
    || normalized === E2EE_STORAGE_PLACEHOLDER_TEXT.toLowerCase();
};

const normalizeEncryptedFallbackText = (value: string | null | undefined): string | null => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (normalized.toLowerCase() === E2EE_STORAGE_PLACEHOLDER_TEXT.toLowerCase()) return null;
  return normalized;
};

const identityCache = new Map<string, IdentityKeyPair>();
const profileSyncCache = new Map<string, { publicKey: string; syncedAt: number }>();
const keyBackupSyncCache = new Map<string, { publicKey: string; syncedAt: number }>();
const inflightProfileSync = new Map<string, Promise<void>>();
const publicKeyCache = new Map<string, { key: string; fetchedAt: number }>();
const inflightPublicKeyFetch = new Map<string, Promise<string>>();
const roomParticipantsCache = new Map<string, { patientId: string; doctorId: string; fetchedAt: number }>();
const inflightRoomParticipantsFetch = new Map<string, Promise<{ patientId: string; doctorId: string }>>();
const inflightIdentityEnsure = new Map<string, Promise<IdentityKeyPair>>();

const isFresh = (timestamp: number, ttlMs: number): boolean => Date.now() - timestamp < ttlMs;

const sanitizeSecureStoreKeyPart = (value: string | null | undefined): string => {
  const normalized = (value || '').trim();
  if (!normalized) return 'unknown_user';
  return normalized.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const getSecretKeyName = (userId: string): string => `${SECRET_KEY_PREFIX}${sanitizeSecureStoreKeyPart(userId)}`;
const getPublicKeyName = (userId: string): string => `${PUBLIC_KEY_PREFIX}${sanitizeSecureStoreKeyPart(userId)}`;
const getLegacySecretKeyName = (userId: string): string => `${LEGACY_SECRET_KEY_PREFIX}${sanitizeSecureStoreKeyPart(userId)}`;
const getLegacyPublicKeyName = (userId: string): string => `${LEGACY_PUBLIC_KEY_PREFIX}${sanitizeSecureStoreKeyPart(userId)}`;

const toBase64 = (input: Uint8Array): string => naclUtil.encodeBase64(input);
const fromBase64 = (input: string): Uint8Array => naclUtil.decodeBase64(input);

type KeyRestoreStatus = 'restored' | 'not_found' | 'unavailable';

type KeyRestoreResult = {
  status: KeyRestoreStatus;
  identity?: IdentityKeyPair;
};

const isLikelyBase64Key = (value: string): boolean => {
  const normalized = (value || '').trim();
  if (!normalized) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false;
  try {
    const bytes = fromBase64(normalized);
    return bytes.length === 32;
  } catch {
    return false;
  }
};

const extractFunctionInvokeErrorMessage = async (error: any): Promise<string> => {
  if (!error) return 'Function invoke failed.';
  const context = (error as any)?.context as Response | undefined;

  if (context) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
      if (typeof payload?.reason === 'string' && payload.reason.trim()) return payload.reason.trim();
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

const restoreIdentityFromServerBackup = async (userId: string): Promise<KeyRestoreResult> => {
  try {
    const { data, error } = await supabase.functions.invoke('chat-e2ee-key-backup', {
      body: { action: 'restore' },
    });

    if (error) {
      const message = (await extractFunctionInvokeErrorMessage(error)).toLowerCase();
      if (message.includes('backup_not_found') || message.includes('not found')) {
        return { status: 'not_found' };
      }
      return { status: 'unavailable' };
    }

    const payload: any = data || {};
    if (!payload?.success) {
      const reason = String(payload?.reason || '').toLowerCase();
      if (reason.includes('backup_not_found') || reason.includes('not_found')) {
        return { status: 'not_found' };
      }
      return { status: 'unavailable' };
    }

    const publicKey = typeof payload?.data?.publicKey === 'string' ? payload.data.publicKey.trim() : '';
    const secretKey = typeof payload?.data?.secretKey === 'string' ? payload.data.secretKey.trim() : '';
    if (!isLikelyBase64Key(publicKey) || !isLikelyBase64Key(secretKey)) {
      return { status: 'unavailable' };
    }

    const identity: IdentityKeyPair = { publicKey, secretKey };
    await persistIdentityToStore(userId, identity);
    identityCache.set(userId, identity);
    publicKeyCache.set(userId, { key: publicKey, fetchedAt: Date.now() });
    return { status: 'restored', identity };
  } catch {
    return { status: 'unavailable' };
  }
};

const backupIdentityToServer = async (userId: string, identity: IdentityKeyPair): Promise<void> => {
  const cached = keyBackupSyncCache.get(userId);
  if (cached && cached.publicKey === identity.publicKey && isFresh(cached.syncedAt, KEY_BACKUP_SYNC_TTL_MS)) {
    return;
  }

  try {
    const { data, error } = await supabase.functions.invoke('chat-e2ee-key-backup', {
      body: {
        action: 'backup',
        publicKey: identity.publicKey,
        secretKey: identity.secretKey,
      },
    });

    if (error) {
      const message = await extractFunctionInvokeErrorMessage(error);
      console.warn('E2EE key backup skipped:', message);
      return;
    }

    if (!data?.success) {
      const reason = String(data?.reason || '').trim() || 'unknown_reason';
      console.warn('E2EE key backup skipped:', reason);
      return;
    }

    keyBackupSyncCache.set(userId, {
      publicKey: identity.publicKey,
      syncedAt: Date.now(),
    });
  } catch (error) {
    console.warn('E2EE key backup failed:', error);
  }
};

const loadIdentityFromStore = async (userId: string): Promise<IdentityKeyPair | null> => {
  try {
    const secretKey = await SecureStore.getItemAsync(getSecretKeyName(userId));
    const publicKey = await SecureStore.getItemAsync(getPublicKeyName(userId));
    if (secretKey && publicKey) {
      return { secretKey, publicKey };
    }
  } catch (error) {
    console.warn('SecureStore read failed for new key format:', error);
  }

  // Backward compatibility for users who may already have old-format keys.
  try {
    const legacySecretKey = await SecureStore.getItemAsync(getLegacySecretKeyName(userId));
    const legacyPublicKey = await SecureStore.getItemAsync(getLegacyPublicKeyName(userId));
    if (!legacySecretKey || !legacyPublicKey) {
      return null;
    }

    // Migrate silently to new key format.
    await SecureStore.setItemAsync(getSecretKeyName(userId), legacySecretKey);
    await SecureStore.setItemAsync(getPublicKeyName(userId), legacyPublicKey);
    return { secretKey: legacySecretKey, publicKey: legacyPublicKey };
  } catch (_legacyError) {
    return null;
  }
};

const persistIdentityToStore = async (userId: string, identity: IdentityKeyPair): Promise<void> => {
  await SecureStore.setItemAsync(getSecretKeyName(userId), identity.secretKey);
  await SecureStore.setItemAsync(getPublicKeyName(userId), identity.publicKey);
};

const createNewIdentity = async (userId: string): Promise<IdentityKeyPair> => {
  const keyPair = nacl.box.keyPair();
  const identity: IdentityKeyPair = {
    publicKey: toBase64(keyPair.publicKey),
    secretKey: toBase64(keyPair.secretKey),
  };
  await persistIdentityToStore(userId, identity);
  identityCache.set(userId, identity);
  profileSyncCache.delete(userId);
  keyBackupSyncCache.delete(userId);
  publicKeyCache.set(userId, { key: identity.publicKey, fetchedAt: Date.now() });
  return identity;
};

const getOrCreateLocalIdentity = async (userId: string): Promise<IdentityKeyPair> => {
  const cached = identityCache.get(userId);
  if (cached) return cached;

  const stored = await loadIdentityFromStore(userId);
  if (stored) {
    identityCache.set(userId, stored);
    return stored;
  }

  const restored = await restoreIdentityFromServerBackup(userId);
  if (restored.status === 'restored' && restored.identity) {
    return restored.identity;
  }

  if (restored.status === 'unavailable') {
    // If backup restore is unavailable on a fresh install, recover by rotating to a new local key.
    // This keeps future messages readable instead of permanently blocking chat on this device.
    const { data: profileSnapshot, error: profileReadError } = await supabase
      .from('profiles')
      .select('chat_public_key')
      .eq('id', userId)
      .maybeSingle();

    if (!profileReadError) {
      const remotePublicKey =
        typeof profileSnapshot?.chat_public_key === 'string' ? profileSnapshot.chat_public_key.trim() : '';
      if (remotePublicKey) {
        const rotatedIdentity = await createNewIdentity(userId);
        return rotatedIdentity;
      }
    }
  }

  return createNewIdentity(userId);
};

export const ensureE2EEIdentity = async (userId: string): Promise<IdentityKeyPair> => {
  let inflight = inflightIdentityEnsure.get(userId);
  if (inflight) return await inflight;

  const promise = (async () => {
    const identity = await getOrCreateLocalIdentity(userId);
    const cachedSync = profileSyncCache.get(userId);
    if (
      cachedSync &&
      cachedSync.publicKey === identity.publicKey &&
      isFresh(cachedSync.syncedAt, PROFILE_SYNC_TTL_MS)
    ) {
      void backupIdentityToServer(userId, identity);
      return identity;
    }

    let syncPromise = inflightProfileSync.get(userId);
    if (!syncPromise) {
      syncPromise = (async () => {
        const { data: existingProfile, error: profileReadError } = await supabase
          .from('profiles')
          .select('chat_public_key')
          .eq('id', userId)
          .maybeSingle();

        if (profileReadError) {
          throw new Error(`Could not read profile key: ${profileReadError.message}`);
        }

        const remotePublicKey =
          typeof existingProfile?.chat_public_key === 'string' ? existingProfile.chat_public_key : '';
        if (remotePublicKey !== identity.publicKey) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ chat_public_key: identity.publicKey })
            .eq('id', userId);

          if (updateError) {
            throw new Error(`Could not sync public key: ${updateError.message}`);
          }
        }

        const now = Date.now();
        profileSyncCache.set(userId, {
          publicKey: identity.publicKey,
          syncedAt: now,
        });
        publicKeyCache.set(userId, {
          key: identity.publicKey,
          fetchedAt: now,
        });
      })();
      inflightProfileSync.set(userId, syncPromise);
    }

    try {
      await syncPromise;
    } finally {
      if (inflightProfileSync.get(userId) === syncPromise) {
        inflightProfileSync.delete(userId);
      }
    }

    void backupIdentityToServer(userId, identity);
    return identity;
  })();

  inflightIdentityEnsure.set(userId, promise);
  try {
    return await promise;
  } finally {
    inflightIdentityEnsure.delete(userId);
  }
};

const parseEncryptedPayload = (input: RawEncryptedPayload): ParsedEncryptedPayload | null => {
  if (!input) return null;

  const normalize = (raw: any): ParsedEncryptedPayload | null => {
    if (!raw || typeof raw !== 'object') return null;

    let payload: any = raw;
    if (raw.payload && typeof raw.payload === 'object') {
      payload = raw.payload;
    } else if (typeof raw.payload === 'string') {
      try {
        payload = JSON.parse(raw.payload);
      } catch {
        payload = raw;
      }
    } else if (raw.data && typeof raw.data === 'object') {
      payload = raw.data;
    } else if (typeof raw.data === 'string') {
      try {
        payload = JSON.parse(raw.data);
      } catch {
        payload = raw;
      }
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const v = typeof payload.v === 'number' ? payload.v : (typeof payload.version === 'number' ? payload.version : E2EE_VERSION);
    const algCandidate =
      typeof payload.alg === 'string'
        ? payload.alg
        : (typeof payload.algorithm === 'string' ? payload.algorithm : E2EE_ALGORITHM);
    const alg = algCandidate || E2EE_ALGORITHM;
    const nonce =
      typeof payload.nonce === 'string'
        ? payload.nonce
        : (typeof payload.n === 'string'
            ? payload.n
            : (typeof payload.iv === 'string' ? payload.iv : ''));
    const senderPublicKey =
      typeof payload.senderPublicKey === 'string'
        ? payload.senderPublicKey
        : (typeof payload.sender_public_key === 'string'
            ? payload.sender_public_key
            : (typeof payload.senderKey === 'string'
                ? payload.senderKey
                : (typeof payload.sender === 'string'
                    ? payload.sender
                    : (typeof payload.fromPublicKey === 'string'
                        ? payload.fromPublicKey
                        : (typeof payload.from_public_key === 'string' ? payload.from_public_key : '')))));
    const recipientPublicKey =
      typeof payload.recipientPublicKey === 'string'
        ? payload.recipientPublicKey
        : (typeof payload.recipient_public_key === 'string'
            ? payload.recipient_public_key
            : (typeof payload.recipientKey === 'string'
                ? payload.recipientKey
                : (typeof payload.recipient === 'string'
                    ? payload.recipient
                    : (typeof payload.toPublicKey === 'string'
                        ? payload.toPublicKey
                        : (typeof payload.to_public_key === 'string' ? payload.to_public_key : '')))));
    const ciphertext =
      typeof payload.ciphertext === 'string'
        ? payload.ciphertext
        : (typeof payload.ct === 'string'
            ? payload.ct
            : (typeof payload.cipher_text === 'string'
                ? payload.cipher_text
                : (typeof payload.encryptedText === 'string'
                    ? payload.encryptedText
                    : (typeof payload.encrypted_text === 'string'
                        ? payload.encrypted_text
                        : (typeof payload.message === 'string' ? payload.message : '')))));

    if (!Number.isFinite(v) || !alg || !nonce || !senderPublicKey || !recipientPublicKey || !ciphertext) {
      return null;
    }

    return {
      v,
      alg,
      nonce,
      senderPublicKey,
      recipientPublicKey,
      ciphertext,
    };
  };

  if (typeof input === 'object') {
    return normalize(input);
  }

  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === 'string') {
      try {
        return normalize(JSON.parse(parsed));
      } catch {
        return null;
      }
    }
    return normalize(parsed);
  } catch {
    return null;
  }
};

const getRoomParticipants = async (roomId: string): Promise<{ patientId: string; doctorId: string }> => {
  const cached = roomParticipantsCache.get(roomId);
  if (cached && isFresh(cached.fetchedAt, ROOM_PARTICIPANTS_CACHE_TTL_MS)) {
    return {
      patientId: cached.patientId,
      doctorId: cached.doctorId,
    };
  }

  let inflight = inflightRoomParticipantsFetch.get(roomId);
  if (!inflight) {
    inflight = (async () => {
      const { data: room, error } = await supabase
        .from('chat_rooms')
        .select('patient_id, doctor_id')
        .eq('id', roomId)
        .single();

      if (error || !room) {
        throw new Error('Chat room not found for encryption');
      }

      const patientId = typeof room.patient_id === 'string' ? room.patient_id : '';
      const doctorId = typeof room.doctor_id === 'string' ? room.doctor_id : '';
      if (!patientId || !doctorId) {
        throw new Error('Chat room participants are missing');
      }

      roomParticipantsCache.set(roomId, {
        patientId,
        doctorId,
        fetchedAt: Date.now(),
      });

      return { patientId, doctorId };
    })();
    inflightRoomParticipantsFetch.set(roomId, inflight);
  }

  try {
    return await inflight;
  } finally {
    if (inflightRoomParticipantsFetch.get(roomId) === inflight) {
      inflightRoomParticipantsFetch.delete(roomId);
    }
  }
};

const resolveRecipientId = async (roomId: string, senderId: string): Promise<string> => {
  const room = await getRoomParticipants(roomId);
  if (room.patientId === senderId) return room.doctorId;
  if (room.doctorId === senderId) return room.patientId;
  throw new Error('Sender is not a participant in this room');
};

const fetchUserPublicKeyFromServer = async (userId: string): Promise<string> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('chat_public_key')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch recipient key: ${error.message}`);
  }

  if (!data?.chat_public_key) {
    throw new Error('Recipient secure key not available yet. Ask them to open the latest app once.');
  }

  publicKeyCache.set(userId, {
    key: data.chat_public_key,
    fetchedAt: Date.now(),
  });

  return data.chat_public_key;
};

const getUserPublicKey = async (userId: string, options: { forceRefresh?: boolean } = {}): Promise<string> => {
  const forceRefresh = Boolean(options.forceRefresh);
  const cached = publicKeyCache.get(userId);
  if (!forceRefresh && cached && isFresh(cached.fetchedAt, PUBLIC_KEY_CACHE_TTL_MS)) {
    return cached.key;
  }

  let inflight = inflightPublicKeyFetch.get(userId);
  if (!inflight) {
    inflight = fetchUserPublicKeyFromServer(userId);
    inflightPublicKeyFetch.set(userId, inflight);
  }

  try {
    return await inflight;
  } finally {
    if (inflightPublicKeyFetch.get(userId) === inflight) {
      inflightPublicKeyFetch.delete(userId);
    }
  }
};

export type EncryptedMessageInsert = {
  text: string;
  is_encrypted: boolean;
  encrypted_payload: string | null;
  encryption_version: number | null;
};

export const encryptTextForRoom = async (params: {
  roomId: string;
  senderId: string;
  plaintext: string;
}): Promise<EncryptedMessageInsert> => {
  const { roomId, senderId, plaintext } = params;
  const message = plaintext.trim();
  if (!message) {
    throw new Error('Cannot encrypt empty message');
  }

  const senderIdentity = await ensureE2EEIdentity(senderId);
  const recipientId = await resolveRecipientId(roomId, senderId);
  // Force a fresh recipient key read on send to avoid encrypting to stale keys after reinstall/key-rotation.
  const recipientPublicKey = await getUserPublicKey(recipientId, { forceRefresh: true });
  const recipientPublicKeyBytes = fromBase64(recipientPublicKey);
  const senderSecretKeyBytes = fromBase64(senderIdentity.secretKey);
  const sharedKey = nacl.box.before(recipientPublicKeyBytes, senderSecretKeyBytes);

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box.after(
    naclUtil.decodeUTF8(message),
    nonce,
    sharedKey
  );

  const payload: ParsedEncryptedPayload = {
    v: E2EE_VERSION,
    alg: E2EE_ALGORITHM,
    nonce: toBase64(nonce),
    senderPublicKey: senderIdentity.publicKey,
    recipientPublicKey,
    ciphertext: toBase64(ciphertext),
  };

  return {
    text: 'Encrypted message',
    is_encrypted: true,
    encrypted_payload: JSON.stringify(payload),
    encryption_version: E2EE_VERSION,
  };
};

export const decryptMessageTextForUser = async (params: {
  userId: string;
  senderId: string;
  isEncrypted?: boolean | null;
  encryptedPayload?: RawEncryptedPayload;
  fallbackText?: string | null;
}): Promise<string> => {
  const { userId, senderId, isEncrypted, encryptedPayload, fallbackText } = params;
  if (!isEncrypted) {
    return fallbackText || '';
  }

  const safeFallbackText = normalizeEncryptedFallbackText(fallbackText);
  const fallbackPayloadSource =
    typeof safeFallbackText === 'string' && safeFallbackText.length > 0 ? safeFallbackText : null;
  const payload = parseEncryptedPayload(encryptedPayload || fallbackPayloadSource);

  if (!payload && !encryptedPayload) {
    return safeFallbackText || E2EE_WAITING_TEXT;
  }

  if (!payload || payload.alg !== E2EE_ALGORITHM) {
    return safeFallbackText || E2EE_UNAVAILABLE_TEXT;
  }

  try {
    // Ensure local identity is also profile-synced so future inbound messages target the latest key.
    const identity = await ensureE2EEIdentity(userId);
    if (senderId !== userId && payload.recipientPublicKey !== identity.publicKey) {
      return safeFallbackText || getE2EERecoveryMessage();
    }

    const peerPublicKey = senderId === userId ? payload.recipientPublicKey : payload.senderPublicKey;
    const sharedKey = nacl.box.before(fromBase64(peerPublicKey), fromBase64(identity.secretKey));
    const opened = nacl.box.open.after(
      fromBase64(payload.ciphertext),
      fromBase64(payload.nonce),
      sharedKey
    );

    if (!opened) {
      // Fallback: try peer public key from profile in case payload key format/key field changed.
      if (senderId !== userId) {
        try {
          const fallbackPeerPublicKey = await getUserPublicKey(senderId);
          const fallbackSharedKey = nacl.box.before(fromBase64(fallbackPeerPublicKey), fromBase64(identity.secretKey));
          const reopened = nacl.box.open.after(
            fromBase64(payload.ciphertext),
            fromBase64(payload.nonce),
            fallbackSharedKey
          );
          if (reopened) {
            return naclUtil.encodeUTF8(reopened);
          }
        } catch {
          // ignore fallback error
        }
      }
      return safeFallbackText || getE2EERecoveryMessage();
    }

    return naclUtil.encodeUTF8(opened);
  } catch {
    return safeFallbackText || E2EE_WAITING_TEXT;
  }
};
