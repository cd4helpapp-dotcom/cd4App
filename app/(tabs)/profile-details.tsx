import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useColorScheme,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Mail, Phone, Calendar, User as UserIcon, CheckCircle, ArrowLeft, Camera } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';

import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useUploadProfilePicture } from '../../hooks/useAuth';
import { getImageUrl } from '../../constants/Config';

const displayOrPlaceholder = (value: string | number | undefined | null, fallback = 'Not added') => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
};

const InfoRow = ({
  label,
  value,
  withDivider = true,
  theme,
}: {
  label: string;
  value: string;
  withDivider?: boolean;
  theme: typeof Colors.light;
}) => (
  <View style={styles.metaRowWrap}>
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: theme.text }]}>{value}</Text>
    </View>
    {withDivider ? <View style={[styles.metaDivider, { backgroundColor: theme.borderColor }]} /> : null}
  </View>
);

export default function ProfileDetailsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
  const insets = useSafeAreaInsets();
  const { user, isLoading, refreshAuth } = useAuthContext();
  const uploadMutation = useUploadProfilePicture();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'We need gallery permission to update profile photo.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      void handleUpload(result.assets[0]);
    }
  };

  const handleUpload = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const formData = new FormData();

      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        formData.append('profilePicture', blob, 'profile.jpg');
      } else {
        formData.append('profilePicture', {
          uri: asset.uri,
          name: 'profile.jpg',
          type: asset.mimeType || 'image/jpeg',
          base64: asset.base64 || undefined,
        } as any);
      }

      await uploadMutation.mutateAsync(formData);
      await refreshAuth();

      Toast.show({
        type: 'success',
        text1: 'Profile Picture Updated',
        text2: 'Your new photo has been saved.',
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: error?.message || 'Please try again later.',
      });
    }
  };

  const handleRefreshProfile = async () => {
    try {
      setIsRefreshing(true);
      await refreshAuth();
      Toast.show({
        type: 'success',
        text1: 'Profile Refreshed',
        text2: 'Latest profile data loaded.',
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: 'Refresh Failed',
        text2: 'Unable to refresh profile right now.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const openEditProfile = () => {
    router.push({ pathname: '/profile-setup', params: { mode: 'edit' } });
  };

  if (isLoading || !user) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  const roleValue = user.role as any;
  const roleName = (typeof roleValue === 'string' ? roleValue : roleValue?.name || '').toLowerCase();
  const profileImageUrl = getImageUrl(user.profilePicture);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: theme.background }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <ArrowLeft size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Profile Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: theme.cardBackground, shadowColor: theme.text }]}>
          <TouchableOpacity onPress={pickImage} disabled={uploadMutation.isPending}>
            <View style={[styles.avatarContainer, { backgroundColor: theme.successLight }]}>
              {uploadMutation.isPending ? (
                <ActivityIndicator color={theme.tint} />
              ) : profileImageUrl ? (
                <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
              ) : (
                <UserIcon size={40} color={theme.tint} />
              )}

              <View style={[styles.cameraIconContainer, { backgroundColor: theme.tint }]}>
                <Camera size={14} color="#fff" />
              </View>
            </View>
          </TouchableOpacity>

          <Text style={[styles.userName, { color: theme.text }]}>
            {user.firstName} {user.lastName}
          </Text>

          <View style={[styles.verifiedBadge, { backgroundColor: theme.successLight }]}>
            <CheckCircle size={14} color={theme.tint} style={{ marginRight: 4 }} />
            <Text style={[styles.verifiedText, { color: theme.tint }]}>
              {user.isVerified ? 'Verified Account' : 'Verification Pending'}
            </Text>
          </View>
          <Text style={[styles.roleText, { color: theme.textSecondary }]}>{displayOrPlaceholder(roleName, 'Patient')}</Text>
        </View>

        <View style={[styles.card, styles.infoCard, { backgroundColor: theme.cardBackground, shadowColor: theme.text }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Account Information</Text>

          <View style={styles.infoRow}>
            <View style={styles.iconBox}>
              <Mail size={20} color={theme.textSecondary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Email</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{user.email}</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

          <View style={styles.infoRow}>
            <View style={styles.iconBox}>
              <Phone size={20} color={theme.textSecondary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Phone Number</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>+91 {user.phoneNumber}</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.borderColor }]} />

          <View style={styles.infoRow}>
            <View style={styles.iconBox}>
              <Calendar size={20} color={theme.textSecondary} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>Member Since</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{formatDate(user.createdAt)}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.card, styles.metaCard, { backgroundColor: theme.cardBackground, shadowColor: theme.text }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            {roleName === 'doctor' ? 'Basic Information' : 'Patient Information'}
          </Text>
          <InfoRow label="Age" value={displayOrPlaceholder(user.age)} theme={theme} />
          <InfoRow label="Gender" value={displayOrPlaceholder(user.gender)} theme={theme} />
          <InfoRow label="Address" value={displayOrPlaceholder(user.address)} theme={theme} />
          {roleName !== 'doctor' && (
            <>
              <InfoRow label="Weight (kg)" value={displayOrPlaceholder(user.weight)} theme={theme} />
              <InfoRow label="BP (mmHg)" value={displayOrPlaceholder(user.bloodPressure)} theme={theme} />
              <InfoRow label="Pulse (bpm)" value={displayOrPlaceholder(user.pulse)} withDivider={false} theme={theme} />
            </>
          )}
          {roleName === 'doctor' && (
            <InfoRow label="Member Role" value={displayOrPlaceholder(roleName, 'Doctor')} withDivider={false} theme={theme} />
          )}
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.tint }]}
          onPress={openEditProfile}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Edit Information</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.refreshButton, { backgroundColor: theme.cardBackground, borderColor: theme.tint }]}
          onPress={handleRefreshProfile}
          disabled={isRefreshing}
          activeOpacity={0.85}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={theme.tint} />
          ) : (
            <Text style={[styles.refreshButtonText, { color: theme.tint }]}>Refresh Profile</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  backButton: {
    padding: 4,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  infoCard: {
    alignItems: 'stretch',
  },
  metaCard: {
    alignItems: 'stretch',
    paddingBottom: 12,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  roleText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
  },
  iconBox: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    width: '100%',
    marginLeft: 50,
  },
  metaRowWrap: {
    width: '100%',
  },
  metaRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  metaValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  metaDivider: {
    height: 1,
    width: '100%',
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  refreshButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
