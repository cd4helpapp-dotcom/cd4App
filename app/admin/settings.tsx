import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import Colors from '../../constants/Colors';
import { getImageUrl } from '../../constants/Config';
import { useAuthContext } from '../../context/AuthContext';
import { useLogout, useUpdateProfile, useUploadProfilePicture } from '../../hooks/useAuth';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

export default function AdminSettingsScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const logoutMutation = useLogout();
  const updateProfileMutation = useUpdateProfile();
  const uploadProfileMutation = useUploadProfilePicture();

  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const tabSwipeHandlers = useTabSwipeNavigation('admin-settings');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
    setEmail(user?.email || '');
    setPhoneNumber(user?.phoneNumber || '');
  }, [user]);

  const hasProfileChanges = useMemo(() => {
    return (
      firstName.trim() !== (user?.firstName || '') ||
      lastName.trim() !== (user?.lastName || '') ||
      email.trim().toLowerCase() !== (user?.email || '').toLowerCase() ||
      phoneNumber.trim() !== (user?.phoneNumber || '')
    );
  }, [email, firstName, lastName, phoneNumber, user]);

  const executeLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      router.replace('/auth/login');
    } catch (error) {
      console.error('Logout failed:', error);
      router.replace('/auth/login');
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      const confirmFn = (globalThis as any).confirm as ((message?: string) => boolean) | undefined;
      const shouldLogout = confirmFn ? confirmFn('Are you sure you want to logout?') : true;
      if (!shouldLogout) return;
      void executeLogout();
      return;
    }

    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          void executeLogout();
        },
      },
    ]);
  };

  const handleSaveProfile = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      Alert.alert('Missing fields', 'First name, last name and email are required.');
      return;
    }

    try {
      await updateProfileMutation.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phoneNumber.trim(),
      });

      Alert.alert('Profile updated', 'Your admin profile has been updated successfully.');
    } catch (error: any) {
      const message = error?.message || 'Unable to update profile right now.';
      Alert.alert('Update failed', message);
    }
  };

  const handlePickProfileImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please allow photo access to update profile image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        aspect: [1, 1],
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      const fileName = asset.fileName || `profile-${Date.now()}.jpg`;
      const fileType = asset.mimeType || 'image/jpeg';

      const formData = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const blob = await response.blob();
        formData.append('profilePicture', blob, fileName);
      } else {
        formData.append('profilePicture', {
          uri: asset.uri,
          name: fileName,
          type: fileType,
          base64: asset.base64 || undefined,
        } as any);
      }

      await uploadProfileMutation.mutateAsync(formData);
    } catch (error: any) {
      const message = error?.message || 'Could not upload profile picture.';
      Alert.alert('Upload failed', message);
    }
  };

  const profileImageUri = user?.profilePicture ? getImageUrl(user.profilePicture) : null;
  const busy = updateProfileMutation.isPending || uploadProfileMutation.isPending;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} {...tabSwipeHandlers}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Admin Settings</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Keep your profile accurate for team communication and account management.
          </Text>
        </View>

        <View style={[styles.profileCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <TouchableOpacity style={styles.avatarWrap} onPress={handlePickProfileImage} disabled={busy}>
            {profileImageUri ? (
              <Image source={{ uri: profileImageUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: theme.tint }]}>
                <Text style={styles.avatarText}>{user?.firstName?.charAt(0) || 'A'}</Text>
              </View>
            )}
            {uploadProfileMutation.isPending ? (
              <View style={[styles.avatarOverlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : (
              <View style={[styles.cameraBadge, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <Ionicons name="camera-outline" size={14} color={theme.text} />
              </View>
            )}
          </TouchableOpacity>

          <View style={[styles.roleBadge, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
            <Text style={[styles.roleText, { color: theme.success }]}>Admin</Text>
          </View>

          <View style={styles.form}>
            <LabeledInput
              label="First Name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Enter first name"
              theme={theme}
            />
            <LabeledInput
              label="Last Name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Enter last name"
              theme={theme}
            />
            <LabeledInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="Enter email"
              keyboardType="email-address"
              autoCapitalize="none"
              theme={theme}
            />
            <LabeledInput
              label="Phone Number"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="Enter phone number"
              keyboardType="phone-pad"
              theme={theme}
            />

            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: theme.buttonPrimary },
                (!hasProfileChanges || busy) && styles.disabledButton,
              ]}
              onPress={handleSaveProfile}
              disabled={!hasProfileChanges || busy}
            >
              {updateProfileMutation.isPending ? (
                <ActivityIndicator color={theme.buttonText} />
              ) : (
                <Text style={[styles.saveButtonText, { color: theme.buttonText }]}>Save Profile</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.actionCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <TouchableOpacity style={styles.logoutRow} onPress={handleLogout}>
            <View style={styles.logoutLeft}>
              <Ionicons name="log-out-outline" size={20} color={theme.badgeText} />
              <Text style={[styles.logoutText, { color: theme.badgeText }]}>Logout</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type LabeledInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  theme: typeof Colors.light;
};

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  theme,
}: LabeledInputProps) {
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.borderColor }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 28,
    gap: 16,
  },
  header: {
    gap: 6,
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  profileCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 10,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 36,
    color: '#fff',
    fontWeight: '700',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  form: {
    width: '100%',
    gap: 10,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  saveButton: {
    marginTop: 8,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  disabledButton: {
    opacity: 0.55,
  },
  actionCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  logoutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
