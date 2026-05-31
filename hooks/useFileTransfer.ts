import { useState } from 'react';
import { supabase } from '../src/lib/supabase';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../context/AuthContext';
import { addOrUpdateLocalChatMessage, removeLocalChatMessage, useSendMessage } from './useChat';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toReadableUploadError = (error: any): string => {
    const message = typeof error?.message === 'string' ? error.message : String(error || '');
    const normalized = message.toLowerCase();

    if (normalized.includes('network request failed') || normalized.includes('network error')) {
        return 'Could not upload file due to network issue. Please check internet and try again.';
    }

    if (normalized.includes('bucket') && normalized.includes('not found')) {
        return 'Chat attachments storage bucket is missing.';
    }

    if (normalized.includes('jwt') || normalized.includes('unauthorized')) {
        return 'Your login session expired. Please login again.';
    }

    return message || 'File upload failed.';
};

const uploadToChatAttachmentsBucket = async (params: {
    filePath: string;
    fileUri: string;
    fileName: string;
    mimeType: string;
}) => {
    const { filePath, fileUri, fileName, mimeType } = params;
    const errors: string[] = [];

    // Strategy 1: Blob upload (fast path)
    try {
        const fileResponse = await fetch(fileUri);
        const fileBlob = await fileResponse.blob();
        const { error } = await supabase.storage
            .from('chat-attachments')
            .upload(filePath, fileBlob, {
                contentType: mimeType,
                cacheControl: '3600',
                upsert: false,
            });

        if (error) throw error;
        return;
    } catch (error: any) {
        errors.push(`blob:${error?.message || 'failed'}`);
    }

    await sleep(120);

    // Strategy 2: URI form-data upload fallback
    try {
        const formData = new FormData();
        formData.append('file', {
            uri: fileUri,
            name: fileName,
            type: mimeType,
        } as any);

        const { error } = await supabase.storage
            .from('chat-attachments')
            .upload(filePath, formData as any, {
                cacheControl: '3600',
                upsert: false,
            });

        if (error) throw error;
        return;
    } catch (error: any) {
        errors.push(`form:${error?.message || 'failed'}`);
    }

    await sleep(120);

    // Strategy 3: Uint8Array upload fallback
    try {
        const fileResponse = await fetch(fileUri);
        const fileArrayBuffer = await fileResponse.arrayBuffer();
        const fileBytes = new Uint8Array(fileArrayBuffer);

        const { error } = await supabase.storage
            .from('chat-attachments')
            .upload(filePath, fileBytes, {
                contentType: mimeType,
                cacheControl: '3600',
                upsert: false,
            });

        if (error) throw error;
        return;
    } catch (error: any) {
        errors.push(`bytes:${error?.message || 'failed'}`);
        throw new Error(errors.join(' | '));
    }
};

const createAttachmentSignedUrl = async (filePath: string): Promise<string | null> => {
    try {
        const { data, error } = await supabase.storage
            .from('chat-attachments')
            .createSignedUrl(filePath, 60 * 30);

        if (error || !data?.signedUrl) {
            return null;
        }
        return data.signedUrl;
    } catch {
        return null;
    }
};

export const useFileTransfer = () => {
    const [isUploading, setIsUploading] = useState(false);
    const sendMessage = useSendMessage();
    const queryClient = useQueryClient();
    const { user } = useAuthContext();

    const uploadAndSend = async (roomId: string, fileUri: string, fileName: string, mimeType: string) => {
        setIsUploading(true);
        const type = mimeType.startsWith('image/') ? 'image' : 'file';
        const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (user?.id) {
            addOrUpdateLocalChatMessage(queryClient, roomId, {
                id: tempId,
                room_id: roomId,
                sender_id: user.id,
                text: type === 'file' ? `Uploading ${fileName}...` : fileName,
                type: type === 'file' ? 'text' : type,
                attachment_url: type === 'image' ? fileUri : undefined,
                is_read: true,
                created_at: new Date().toISOString(),
                is_encrypted: false,
                encrypted_payload: null,
                encryption_version: null,
                is_pending: true,
            });
        }

        try {
            const fileExt = fileName.split('.').pop() || 'file';
            const filePath = `${roomId}/${Date.now()}.${fileExt}`;

            await uploadToChatAttachmentsBucket({
                filePath,
                fileUri,
                fileName,
                mimeType,
            });

            // 3. Generate signed display URL (storage path is saved in DB)
            const signedDisplayUrl = await createAttachmentSignedUrl(filePath);
            
            // 4. Send Message with attachment
            await sendMessage.mutateAsync({
                roomId,
                text: fileName,
                type: type,
                attachmentUrl: filePath,
                attachmentDisplayUrl: signedDisplayUrl || undefined,
                clientTempId: tempId,
            });

            return signedDisplayUrl || filePath;
        } catch (error) {
            removeLocalChatMessage(queryClient, roomId, tempId);
            const readable = toReadableUploadError(error);
            console.warn('File upload error:', readable);
            throw new Error(readable);
        } finally {
            setIsUploading(false);
        }
    };

    const pickImage = async (roomId: string) => {
        // Request permissions first
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            import('react-native').then(({ Alert }) => {
                Alert.alert('Permission Denied', 'Please allow access to your media library to send photos.');
            });
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            const fileName = asset.fileName || `image_${Date.now()}.jpg`;
            return await uploadAndSend(roomId, asset.uri, fileName, asset.mimeType || 'image/jpeg');
        }
    };

    const pickDocument = async (roomId: string) => {
        const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            copyToCacheDirectory: true,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            return await uploadAndSend(roomId, asset.uri, asset.name, asset.mimeType || 'application/octet-stream');
        }
    };

    return {
        isUploading,
        pickImage,
        pickDocument,
    };
};
