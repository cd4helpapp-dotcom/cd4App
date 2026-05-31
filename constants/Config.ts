// All data is served by Supabase. This file only holds app-wide config.

export const APP_BRAND_NAME = 'CD4';

export const SUPABASE_PROFILE_MEDIA_BUCKET = (() => {
    const bucket = (process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET || '').trim();
    return bucket || 'cd4-storage';
})();

export const AGORA_APP_ID = (() => {
    const id = process.env.EXPO_PUBLIC_AGORA_APP_ID || '';
    if (!id && __DEV__) {
        console.warn('[Config] EXPO_PUBLIC_AGORA_APP_ID is not set. Video calls will not work.');
    }
    return id;
})();

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const API_URL = (() => {
    const direct = (process.env.EXPO_PUBLIC_API_URL || '').trim();
    if (direct) return normalizeBaseUrl(direct);

    const local = (process.env.EXPO_PUBLIC_API_URL_LOCAL || '').trim();
    if (local) return normalizeBaseUrl(local);

    if (__DEV__) {
        console.warn('[Config] EXPO_PUBLIC_API_URL is not set. Relative image paths will be used as-is.');
    }
    return '';
})();

export const getImageUrl = (value?: string | null): string => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';

    if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
        return raw;
    }

    // Handle Windows-style slashes from legacy values.
    const normalizedPath = raw.replace(/\\/g, '/');
    if (!API_URL) return normalizedPath;

    if (normalizedPath.startsWith('/')) {
        return `${API_URL}${normalizedPath}`;
    }
    return `${API_URL}/${normalizedPath}`;
};
