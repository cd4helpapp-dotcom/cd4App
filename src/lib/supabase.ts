import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const FORBIDDEN_PUBLIC_SECRET_ENV_KEYS = [
    'EXPO_PUBLIC_RAZORPAY_KEY_SECRET',
    'EXPO_PUBLIC_RAZORPAY_WEBHOOK_SECRET',
    'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'EXPO_PUBLIC_OPENAI_API_KEY',
    'EXPO_PUBLIC_GEMINI_API_KEY',
];
const SECURE_AUTH_KEY_PREFIX = 'cd4.auth.';

const sanitizeSecureStoreKeyPart = (value: string): string =>
    String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

const getSecureAuthStorageKey = (key: string): string =>
    `${SECURE_AUTH_KEY_PREFIX}${sanitizeSecureStoreKeyPart(key)}`;

const leakedPublicSecrets = FORBIDDEN_PUBLIC_SECRET_ENV_KEYS.filter((key) => {
    const raw = (process.env as Record<string, string | undefined>)[key];
    return typeof raw === 'string' && raw.trim().length > 0;
});
const getWebSessionStorage = () => (typeof globalThis !== 'undefined' ? (globalThis as any).sessionStorage : undefined);

if (leakedPublicSecrets.length > 0) {
    const joined = leakedPublicSecrets.join(', ');
    const message =
        `[Security] Forbidden EXPO_PUBLIC secret env detected: ${joined}. ` +
        'Move secrets to server-side env (Edge Functions) and remove public exposure.';
    // Fail fast so secret leaks are caught during startup.
    throw new Error(message);
}

const secureAuthStorage = {
    async getItem(key: string): Promise<string | null> {
        if (Platform.OS === 'web') {
            const sessionStorageRef = getWebSessionStorage();
            if (!sessionStorageRef) return null;
            try {
                return sessionStorageRef.getItem(key);
            } catch {
                return null;
            }
        }

        try {
            return await SecureStore.getItemAsync(getSecureAuthStorageKey(key));
        } catch {
            return null;
        }
    },
    async setItem(key: string, value: string): Promise<void> {
        if (Platform.OS === 'web') {
            const sessionStorageRef = getWebSessionStorage();
            if (!sessionStorageRef) return;
            try {
                sessionStorageRef.setItem(key, value);
            } catch {
                // no-op
            }
            return;
        }

        try {
            await SecureStore.setItemAsync(getSecureAuthStorageKey(key), value);
        } catch {
            // no-op
        }
    },
    async removeItem(key: string): Promise<void> {
        if (Platform.OS === 'web') {
            const sessionStorageRef = getWebSessionStorage();
            if (!sessionStorageRef) return;
            try {
                sessionStorageRef.removeItem(key);
            } catch {
                // no-op
            }
            return;
        }

        try {
            await SecureStore.deleteItemAsync(getSecureAuthStorageKey(key));
        } catch {
            // no-op
        }
    },
};

if (__DEV__) {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('[Supabase] URL or Anon Key is missing. Check your .env file.');
    }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: secureAuthStorage,
        autoRefreshToken: true,
        // Native: encrypted secure store. Web: sessionStorage only (no long-lived local storage).
        persistSession: true,
        detectSessionInUrl: true,
    },
});

// Helper to create the redirect URL for deep linking
export const createRedirectUrl = (path: string = 'login') => {
    return Linking.createURL(path);
};
