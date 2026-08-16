import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import { UpdateProfileData, UpdateSettingsData, User } from '../src/types';
import { normalizeStorageObjectPath } from '../src/utils/storageSignedUrl';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';

const PROFILE_MEDIA_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_MEDIA_FOLDER = 'profile-pictures';
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

type UploadableProfileFile = {
    uri?: string;
    name?: string;
    type?: string;
    blob?: Blob;
    base64?: string;
};

const sanitizeFileName = (value: string): string =>
    value
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

const getReadableProfileUploadError = (error: any): string => {
    const message = typeof error?.message === 'string' ? error.message.trim() : String(error || '').trim();
    if (!message) return 'Could not upload profile picture.';

    const normalized = message.toLowerCase();
    if (
        normalized.includes('network request failed') ||
        normalized.includes('network error') ||
        normalized.includes('failed to fetch') ||
        normalized.includes('uri-blob:') ||
        normalized.includes('xhr-blob:') ||
        normalized.includes('uri-object:')
    ) {
        return 'Could not read selected photo on this device. Please pick the image again and retry.';
    }
    if (normalized.includes('bucket') && normalized.includes('not found')) {
        return 'Profile image storage bucket is missing. Please run latest migration.';
    }
    if (normalized.includes('jwt') || normalized.includes('unauthorized')) {
        return 'Session expired. Please login again and retry.';
    }
    if (normalized.includes('too large')) {
        return 'Image is too large. Please choose an image under 5 MB.';
    }
    return message;
};

const extractProfileUploadFile = (value: FormData): UploadableProfileFile | null => {
    const asAny = value as any;
    if (typeof (value as any)?.forEach === 'function') {
        let found: UploadableProfileFile | null = null;
        (value as any).forEach((entryValue: any, entryKey: string) => {
            if (found) return;
            if (entryKey !== 'profilePicture') return;

            if (typeof Blob !== 'undefined' && entryValue instanceof Blob) {
                found = {
                    blob: entryValue,
                    name: typeof (entryValue as any)?.name === 'string' ? (entryValue as any).name : 'profile.jpg',
                    type: (entryValue as any)?.type || 'image/jpeg',
                };
                return;
            }

            if (entryValue && typeof entryValue === 'object') {
                found = {
                    uri: typeof entryValue.uri === 'string' ? entryValue.uri : undefined,
                    name: typeof entryValue.name === 'string' ? entryValue.name : undefined,
                    type: typeof entryValue.type === 'string' ? entryValue.type : undefined,
                    base64: typeof entryValue.base64 === 'string' ? entryValue.base64 : undefined,
                };
            }
        });
        if (found) return found;
    }

    const parts = Array.isArray(asAny?._parts) ? asAny._parts : [];
    for (const pair of parts) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const [key, entryValue] = pair;
        if (key !== 'profilePicture') continue;

        if (typeof Blob !== 'undefined' && entryValue instanceof Blob) {
            return {
                blob: entryValue,
                name: typeof (entryValue as any)?.name === 'string' ? (entryValue as any).name : 'profile.jpg',
                type: (entryValue as any)?.type || 'image/jpeg',
            };
        }

        if (entryValue && typeof entryValue === 'object') {
            return {
                uri: typeof entryValue.uri === 'string' ? entryValue.uri : undefined,
                name: typeof entryValue.name === 'string' ? entryValue.name : undefined,
                type: typeof entryValue.type === 'string' ? entryValue.type : undefined,
                base64: typeof entryValue.base64 === 'string' ? entryValue.base64 : undefined,
            };
        }
    }
    return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const assertProfileImageSize = (size: number) => {
    if (Number.isFinite(size) && size > MAX_PROFILE_IMAGE_BYTES) {
        throw new Error('Image is too large. Please keep it under 5 MB.');
    }
};

const base64ToBytes = (rawBase64: string): Uint8Array => {
    const normalized = rawBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const atobFn = (globalThis as any)?.atob;
    if (typeof atobFn === 'function') {
        const binary = atobFn(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    const BufferImpl = (globalThis as any)?.Buffer;
    if (BufferImpl?.from) {
        return Uint8Array.from(BufferImpl.from(normalized, 'base64'));
    }

    throw new Error('No base64 decoder available on device.');
};

const uriToBlobWithXhr = (uri: string): Promise<Blob> =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onerror = () => {
            xhr.abort();
            reject(new Error('Failed to read image via XHR.'));
        };
        xhr.onload = () => resolve(xhr.response as Blob);
        xhr.responseType = 'blob';
        xhr.open('GET', uri, true);
        xhr.send(null);
    });

const uploadProfilePictureToStorage = async (args: {
    filePath: string;
    file: UploadableProfileFile;
    mimeType: string;
}): Promise<{ byteSize: number | null }> => {
    const { filePath, file, mimeType } = args;
    const errors: string[] = [];

    if (file.base64) {
        try {
            const fileBytes = base64ToBytes(file.base64);
            assertProfileImageSize(Number(fileBytes.byteLength || 0));
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, fileBytes, {
                    contentType: mimeType,
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: Number(fileBytes.byteLength || 0) || null };
        } catch (error: any) {
            errors.push(`base64:${error?.message || 'failed'}`);
        }
    }

    if (file.blob) {
        try {
            assertProfileImageSize(Number((file.blob as any)?.size || 0));
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, file.blob, {
                    contentType: mimeType,
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: Number((file.blob as any)?.size || 0) || null };
        } catch (error: any) {
            errors.push(`blob:${error?.message || 'failed'}`);
        }
    }

    if (file.uri) {
        try {
            const fileResponse = await fetch(file.uri);
            const uploadBlob = await fileResponse.blob();
            assertProfileImageSize(Number((uploadBlob as any)?.size || 0));
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, uploadBlob, {
                    contentType: mimeType,
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: Number((uploadBlob as any)?.size || 0) || null };
        } catch (error: any) {
            errors.push(`uri-blob:${error?.message || 'failed'}`);
        }
    }

    if (file.uri) {
        await sleep(80);
        try {
            const uploadBlob = await uriToBlobWithXhr(file.uri);
            assertProfileImageSize(Number((uploadBlob as any)?.size || 0));
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, uploadBlob, {
                    contentType: mimeType,
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: Number((uploadBlob as any)?.size || 0) || null };
        } catch (error: any) {
            errors.push(`xhr-blob:${error?.message || 'failed'}`);
        }
    }

    if (file.uri) {
        await sleep(80);
        try {
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(
                    filePath,
                    {
                        uri: file.uri,
                        name: file.name || `profile_${Date.now()}.jpg`,
                        type: mimeType,
                    } as any,
                    {
                        contentType: mimeType,
                        upsert: false,
                        cacheControl: '3600',
                    }
                );
            if (error) throw error;
            return { byteSize: null };
        } catch (error: any) {
            errors.push(`uri-object:${error?.message || 'failed'}`);
        }
    }

    if (file.uri) {
        await sleep(120);
        try {
            const formData = new FormData();
            formData.append('file', {
                uri: file.uri,
                name: file.name || `profile_${Date.now()}.jpg`,
                type: mimeType,
            } as any);
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, formData as any, {
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: null };
        } catch (error: any) {
            errors.push(`form:${error?.message || 'failed'}`);
        }
    }

    if (file.uri) {
        await sleep(120);
        try {
            const fileResponse = await fetch(file.uri);
            const fileArrayBuffer = await fileResponse.arrayBuffer();
            const fileBytes = new Uint8Array(fileArrayBuffer);
            assertProfileImageSize(Number(fileBytes.byteLength || 0));
            const { error } = await supabase.storage
                .from(PROFILE_MEDIA_BUCKET)
                .upload(filePath, fileBytes, {
                    contentType: mimeType,
                    upsert: false,
                    cacheControl: '3600',
                });
            if (error) throw error;
            return { byteSize: Number(fileBytes.byteLength || 0) || null };
        } catch (error: any) {
            errors.push(`bytes:${error?.message || 'failed'}`);
        }
    }

    throw new Error(errors.join(' | ') || 'Could not upload profile picture.');
};

// Query Keys
export const AUTH_QUERY_KEYS = {
    user: ['auth', 'user'] as const,
    profile: ['auth', 'profile'] as const,
    status: ['auth', 'status'] as const,
} as const;

// Custom hook for logout
export const useLogout = () => {
    const queryClient = useQueryClient();
    const { refreshAuth } = useAuthContext();

    return useMutation({
        mutationFn: async () => {
            // Best-effort cleanup: detach this device token from current user on explicit logout.
            void supabase.functions.invoke('register-push-token', { body: { token: null } }).catch((tokenCleanupError) => {
                console.warn('Push token cleanup after logout failed:', tokenCleanupError);
            });

            const { error } = await supabase.auth.signOut({ scope: 'local' });
            if (error) throw error;
        },
        onSuccess: async () => {
            queryClient.clear();
            await refreshAuth();
        },
        onError: (error: any) => {
            if (__DEV__) console.error('[useLogout] error:', error);
        },
    });
};

// Custom hook for updating profile
export const useUpdateProfile = () => {
    const queryClient = useQueryClient();
    const { session, refetchUser } = useAuthContext();

    return useMutation({
        mutationFn: async (data: UpdateProfileData) => {
            if (!session?.user) throw new Error('Not authenticated');

            // Core fields should never be blocked by optional-schema differences.
            const coreUpdates: any = {
                updated_at: new Date().toISOString(),
            };
            if (data.firstName) coreUpdates.first_name = data.firstName;
            if (data.lastName) coreUpdates.last_name = data.lastName;
            if (data.email) coreUpdates.email = data.email;
            if (data.phoneNumber) coreUpdates.phone_number = data.phoneNumber;
            if (data.profileSetupCompleted !== undefined) coreUpdates.profile_setup_completed = data.profileSetupCompleted;

            const { error: coreError } = await supabase
                .from('profiles')
                .update(coreUpdates)
                .eq('id', session.user.id);

            if (coreError) throw coreError;

            const optionalUpdates: any = {};
            if (data.age !== undefined) optionalUpdates.age = data.age;
            if (data.gender) optionalUpdates.gender = data.gender;
            if (data.address) optionalUpdates.address = data.address;
            if (data.weight !== undefined) optionalUpdates.weight = data.weight;
            if (data.bloodPressure) optionalUpdates.blood_pressure = data.bloodPressure;
            if (data.pulse !== undefined) optionalUpdates.pulse = data.pulse;

            if (Object.keys(optionalUpdates).length > 0) {
                const { error: optionalError } = await supabase
                    .from('profiles')
                    .update(optionalUpdates)
                    .eq('id', session.user.id);

                // Do not block onboarding completion if only optional fields fail.
                if (optionalError && __DEV__) {
                    console.warn('[useUpdateProfile] optional fields update failed:', optionalError.message);
                }
            }

            const updatedUser = await refetchUser();
            return updatedUser;
        },
        onSuccess: (updatedUser: User | null) => {
            if (updatedUser) {
                queryClient.setQueryData(AUTH_QUERY_KEYS.user, updatedUser);
                queryClient.setQueryData(AUTH_QUERY_KEYS.profile, updatedUser);
            }
        },
        onError: (error: any) => {
            if (__DEV__) console.error('[useUpdateProfile] error:', error);
        },
    });
};

export const useUpdateSettings = () => {
    const queryClient = useQueryClient();
    const { session, refetchUser } = useAuthContext();

    return useMutation({
        mutationFn: async (data: UpdateSettingsData) => {
            if (!session?.user) throw new Error('Not authenticated');

            const { data: profile } = await supabase
                .from('profiles')
                .select('settings')
                .eq('id', session.user.id)
                .single();

            const currentSettings = profile?.settings || {};
            const newSettings = { ...currentSettings, ...data };

            const { error } = await supabase
                .from('profiles')
                .update({ settings: newSettings })
                .eq('id', session.user.id);

            if (error) throw error;

            return await refetchUser();
        },
        onSuccess: (updatedUser: User | null) => {
            if (updatedUser) {
                queryClient.setQueryData(AUTH_QUERY_KEYS.user, updatedUser);
                queryClient.setQueryData(AUTH_QUERY_KEYS.profile, updatedUser);
            }
        },
        onError: (error: any) => {
            if (__DEV__) console.error('[useUpdateSettings] error:', error);
        },
    });
};

export const useUploadProfilePicture = () => {
    const queryClient = useQueryClient();
    const { session, refetchUser, user } = useAuthContext();

    return useMutation({
        mutationFn: async (formData: FormData) => {
            try {
                if (!session?.user) throw new Error('Not authenticated');

                const file = extractProfileUploadFile(formData);
                if (!file) {
                    throw new Error('Selected image is invalid.');
                }

                const mimeType = (file.type || 'image/jpeg').toLowerCase();
                if (!mimeType.startsWith('image/')) {
                    throw new Error('Please upload an image file.');
                }

                const extensionFromMime = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
                const normalizedFileName = sanitizeFileName(file.name || `profile_${Date.now()}.${extensionFromMime}`);
                const filePath = `${PROFILE_MEDIA_FOLDER}/${session.user.id}/${Date.now()}_${normalizedFileName}`;

                await uploadProfilePictureToStorage({
                    filePath,
                    file,
                    mimeType,
                });

                const { error: profileError } = await supabase
                    .from('profiles')
                    .update({
                        profile_picture: filePath,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', session.user.id);

                if (profileError) {
                    await supabase.storage.from(PROFILE_MEDIA_BUCKET).remove([filePath]);
                    throw profileError;
                }

                const previousProfilePicture = typeof user?.profilePicture === 'string' ? user.profilePicture.trim() : '';
                const oldPath = normalizeStorageObjectPath(PROFILE_MEDIA_BUCKET, previousProfilePicture);
                if (oldPath && oldPath !== filePath) {
                    try {
                        await supabase.storage.from(PROFILE_MEDIA_BUCKET).remove([oldPath]);
                    } catch {
                        // ignore cleanup failures for old image
                    }
                }

                return await refetchUser();
            } catch (error: any) {
                throw new Error(getReadableProfileUploadError(error));
            }
        },
        retry: false,
        onSuccess: (updatedUser: User | null) => {
            if (updatedUser) {
                queryClient.setQueryData(AUTH_QUERY_KEYS.user, updatedUser);
                queryClient.setQueryData(AUTH_QUERY_KEYS.profile, updatedUser);
            }
        },
        onError: (error: any) => {
            if (__DEV__) console.error('[useUploadProfilePicture] error:', getReadableProfileUploadError(error));
        },
    });
};

export const useProfile = () => {
    const { session } = useAuthContext();

    return useQuery({
        queryKey: AUTH_QUERY_KEYS.profile,
        queryFn: async () => {
            if (!session?.user) return null;

            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

            if (error) throw error;
            return data as User;
        },
        enabled: !!session?.user,
    });
};
