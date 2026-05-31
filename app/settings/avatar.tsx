import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator, useColorScheme } from 'react-native';
import { useAuthContext } from '../../context/AuthContext';
import { useUploadProfilePicture } from '../../hooks/useAuth';
import Colors from '../../constants/Colors';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import { getImageUrl } from '../../constants/Config';
import { Camera } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAppLanguage } from '../../context/AppLanguageContext';
import SettingsHeader from '../../ui/common/SettingsHeader';

export default function AvatarSettings() {
    const { user, refreshAuth } = useAuthContext();
    const uploadImageMutation = useUploadProfilePicture();
    const [localImage, setLocalImage] = useState<string | null>(null);
    const { t } = useAppLanguage();

    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const profileImageUrl = localImage || getImageUrl(user?.profilePicture);

    const handlePickImage = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (status !== 'granted') {
            Toast.show({ type: 'error', text1: t('avatar.permissionDeniedTitle'), text2: t('avatar.permissionDeniedBody') });
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
            base64: true,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const selectedAsset = result.assets[0];
            const selectedImageUri = selectedAsset.uri;
            setLocalImage(selectedImageUri);

            // Prepare FormData to send to backend
            const formData = new FormData();
            const filename = selectedAsset.fileName || selectedImageUri.split('/').pop() || `profile_${Date.now()}.jpg`;
            const type = selectedAsset.mimeType || 'image/jpeg';

            formData.append('profilePicture', {
                uri: selectedImageUri,
                name: filename,
                type,
                base64: selectedAsset.base64 || undefined,
            } as any);

            try {
                await uploadImageMutation.mutateAsync(formData);
                Toast.show({ type: 'success', text1: t('avatar.updatedTitle') });
                refreshAuth();
            } catch (error: any) {
                Toast.show({
                    type: 'error',
                    text1: t('avatar.uploadFailedTitle'),
                    text2: error?.message || t('avatar.uploadFailedBody'),
                });
                setLocalImage(null); // revert specific image
            }
        }
    };

    return (
        <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
            <SettingsHeader title={t('avatar.title')} onBack={() => router.back()} theme={theme} />

            <View style={[styles.avatarCard, { backgroundColor: theme.cardBackground }]}>
                <View style={styles.avatarWrapper}>
                    {profileImageUrl ? (
                        <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
                    ) : (
                        <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                            <Text style={styles.placeholderText}>
                                {user?.firstName?.[0] || '?'}{user?.lastName?.[0] || '?'}
                            </Text>
                        </View>
                    )}
                </View>

                <TouchableOpacity
                    style={[styles.uploadButton, { backgroundColor: theme.tint }]}
                    onPress={handlePickImage}
                    disabled={uploadImageMutation.isPending}
                >
                    {uploadImageMutation.isPending ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Camera color="#fff" size={20} style={{ marginRight: 8 }} />
                            <Text style={styles.uploadText}>{t('avatar.changeAvatar')}</Text>
                        </>
                    )}
                </TouchableOpacity>

            </View>

        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    backButton: { marginRight: 15, padding: 5 },
    headerTitle: { fontSize: 24, fontWeight: 'bold' },
    avatarCard: {
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    avatarWrapper: {
        width: 140,
        height: 140,
        borderRadius: 70,
        marginBottom: 24,
        overflow: 'hidden',
        backgroundColor: '#eee',
        borderWidth: 3,
        borderColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ddd',
    },
    placeholderText: { fontSize: 48, fontWeight: 'bold', color: '#666' },
    uploadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 24,
        width: '100%',
        justifyContent: 'center',
    },
    uploadText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    }
});
