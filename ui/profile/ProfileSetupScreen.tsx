import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { ArrowLeft, ArrowRight, ChevronDown, Info, User as UserIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import { useUpdateProfile } from '../../hooks/useAuth';
import { needsPatientProfileSetup } from '../../utils/profileSetup';

type Gender = 'Male' | 'Female' | 'Other';

const splitName = (fullName: string): { firstName: string; lastName: string } => {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName: lastName || '-' };
};

const ProfileSetupScreen: React.FC = () => {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    phone?: string | string[];
    mobile?: string | string[];
    phone_number?: string | string[];
    phoneNumber?: string | string[];
  }>();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { user, isAuthenticated, isLoading, isProfileResolved, refreshAuth } = useAuthContext();
  const updateProfileMutation = useUpdateProfile();
  const isEditMode = (Array.isArray(params.mode) ? params.mode[0] : params.mode) === 'edit';
  const isNarrowScreen = windowWidth < 380;
  const signupPhoneParam =
    (Array.isArray(params.phone) ? params.phone[0] : params.phone) ||
    (Array.isArray(params.mobile) ? params.mobile[0] : params.mobile) ||
    (Array.isArray(params.phone_number) ? params.phone_number[0] : params.phone_number) ||
    (Array.isArray(params.phoneNumber) ? params.phoneNumber[0] : params.phoneNumber) ||
    '';

  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [isGenderDropdownOpen, setIsGenderDropdownOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [weight, setWeight] = useState('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [pulse, setPulse] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  useEffect(() => {
    if (isLoading || !isProfileResolved) return;
    if (!isAuthenticated || !user) {
      router.replace('/auth/login');
      return;
    }

    const roleValue = (user as any)?.role;
    const roleName =
      typeof roleValue === 'string'
        ? roleValue.trim().toLowerCase()
        : String(roleValue?.name || '').trim().toLowerCase();
    if (roleName === 'admin') {
      router.replace('/admin/dashboard');
      return;
    }

    if (roleName === 'doctor' && !isEditMode) {
      router.replace('/doctor/dashboard');
      return;
    }

    if (!isEditMode && !needsPatientProfileSetup(user)) {
      router.replace('/(tabs)');
      return;
    }

    setFullName([user.firstName, user.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
    setAge(user.age ? String(user.age) : '');
    setGender(user.gender || '');
    setIsGenderDropdownOpen(false);
    setAddress(user.address || '');
    setWeight(user.weight ? String(user.weight) : '');
    setBloodPressure(user.bloodPressure || '');
    setPulse(user.pulse ? String(user.pulse) : '');
    setPhoneNumber(user.phoneNumber || signupPhoneParam || '');
  }, [isAuthenticated, isEditMode, isLoading, isProfileResolved, signupPhoneParam, user]);

  if (isLoading || !isProfileResolved || !user) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.tint} />
      </View>
    );
  }

  const handleSave = async () => {
    const trimmedName = fullName.trim();
    const parsedAge = Number(age.trim());
    const trimmedAddress = address.trim();
    const trimmedBP = bloodPressure.trim();
    const trimmedPhone = phoneNumber.trim();

    if (!trimmedName) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter full name.' });
      return;
    }
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter valid age (1-120).' });
      return;
    }
    if (!gender) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please select gender.' });
      return;
    }
    if (!trimmedAddress) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter address.' });
      return;
    }
    if (trimmedPhone && !/^\d{10}$/.test(trimmedPhone)) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter a valid 10-digit mobile number.' });
      return;
    }
    if (trimmedBP && !/^\d{2,3}\/\d{2,3}$/.test(trimmedBP)) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'BP format should be like 120/80.' });
      return;
    }

    const { firstName, lastName } = splitName(trimmedName);
    const resolvedLastName = lastName.trim() ? lastName : (user.lastName?.trim() || 'User');
    const parsedWeight = weight.trim() ? Number(weight.trim()) : undefined;
    const parsedPulse = pulse.trim() ? Number(pulse.trim()) : undefined;

    if (weight.trim() && (!Number.isFinite(parsedWeight) || (parsedWeight as number) <= 0)) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter valid weight.' });
      return;
    }
    if (pulse.trim() && (!Number.isFinite(parsedPulse) || (parsedPulse as number) < 20 || (parsedPulse as number) > 250)) {
      Toast.show({ type: 'error', text1: 'Validation Error', text2: 'Please enter valid pulse (20-250).' });
      return;
    }

    try {
      await updateProfileMutation.mutateAsync({
        firstName,
        lastName: resolvedLastName,
        age: parsedAge,
        gender,
        address: trimmedAddress,
        weight: parsedWeight,
        bloodPressure: trimmedBP || undefined,
        pulse: parsedPulse,
        phoneNumber: trimmedPhone || undefined,
        profileSetupCompleted: true,
      });

      Toast.show({
        type: 'success',
        text1: isEditMode ? 'Profile Updated' : 'Profile Completed',
        text2: isEditMode
          ? 'Your changes have been saved.'
          : 'Your details have been saved. Taking you to home.',
      });

      if (isEditMode) {
        const roleValue = (user as any)?.role;
        const roleName =
          typeof roleValue === 'string'
            ? roleValue.trim().toLowerCase()
            : String(roleValue?.name || '').trim().toLowerCase();

        if (roleName === 'doctor') {
          router.replace('/doctor/profile-details');
        } else {
          router.replace('/(tabs)/profile-details');
        }
      } else {
        router.replace('/(tabs)');
      }
    } catch (error: any) {
      console.error('handleSave error:', error);
      const errorMessage = error?.message || 'Failed to save profile.';
      Toast.show({
        type: 'error',
        text1: 'Save Failed',
        text2: errorMessage,
      });
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: isNarrowScreen ? 18 : 24,
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isEditMode && (
          <View style={styles.editHeaderRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.backButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <ArrowLeft size={20} color={theme.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Edit Profile</Text>
            <View style={{ width: 44 }} />
          </View>
        )}

        {!isEditMode && (
          <View style={styles.setupHeader}>
            <Text style={[styles.setupTitle, { color: theme.textSecondary }]}>Welcome to CD4</Text>
            <View style={[styles.progressBox, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <View style={styles.progressTextRow}>
                <Text style={[styles.progressLabel, { color: theme.textSecondary }]}>Setting up your profile</Text>
                <Text style={[styles.progressPercent, { color: theme.tint }]}>60%</Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: theme.borderColor + '50' }]}>
                <View style={[styles.progressFill, { backgroundColor: theme.tint }]} />
              </View>
            </View>
          </View>
        )}

        <View style={styles.heroSection}>
          <Text style={[styles.heroTitle, isNarrowScreen && styles.heroTitleCompact, { color: theme.text }]}>
            {isEditMode ? 'Refine your\nprofile details' : 'Complete your\nhealth profile'}
          </Text>
          <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
            This information stays private and helps our AI provide clinical-grade guidance for your unique body.
          </Text>
        </View>

        <View style={[styles.sectionCard, isNarrowScreen && styles.sectionCardCompact, { backgroundColor: theme.cardBackground, shadowColor: theme.text }]}>
          <View style={styles.sectionHeader}>
            <UserIcon size={20} color={theme.tint} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Identity</Text>
          </View>

          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Full Name</Text>
          </View>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="John Doe"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.premiumInput,
              { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
            ]}
          />

          <View style={styles.demographicsPanel}>
            <View style={styles.fieldLabelRow}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Age</Text>
            </View>
            <TextInput
              value={age}
              onChangeText={(text) => setAge(text.replace(/[^0-9]/g, ''))}
              placeholder="Enter age"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={[
                styles.premiumInput,
                { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
              ]}
              maxLength={3}
            />

            <View style={styles.fieldLabelRow}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Gender</Text>
            </View>
            <View style={styles.genderPickerRow}>
              {(['Male', 'Female', 'Other'] as Gender[]).map((option) => {
                const active = gender === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.genderButton,
                      { borderColor: active ? theme.tint : theme.borderColor, backgroundColor: active ? theme.tint + '15' : theme.background },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => setGender(option)}
                  >
                    <Text
                      style={[styles.genderButtonText, { color: active ? theme.tint : theme.textSecondary }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Residential Address</Text>
          </View>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Street, City, Country"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.premiumInput,
              { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
            ]}
          />

          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Mobile Number</Text>
          </View>
          <TextInput
            value={phoneNumber}
            onChangeText={(text) => setPhoneNumber(text.replace(/[^0-9]/g, ''))}
            placeholder="Enter 10-digit mobile number"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            maxLength={10}
            style={[
              styles.premiumInput,
              { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
            ]}
          />

          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Email (Read Only)</Text>
          </View>
          <TextInput
            value={user.email}
            editable={false}
            style={[
              styles.premiumInput,
              { borderColor: theme.borderColor, color: theme.textSecondary, backgroundColor: theme.background },
            ]}
          />
        </View>

        <View style={[styles.sectionCard, isNarrowScreen && styles.sectionCardCompact, { backgroundColor: theme.cardBackground, shadowColor: theme.text }]}>
          <View style={styles.sectionHeader}>
            <Info size={20} color={theme.tint} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Health Snapshot</Text>
            <View style={[styles.optionalBadge, { backgroundColor: theme.tint + '15' }]}>
              <Text style={[styles.optionalBadgeText, { color: theme.tint }]}>Optional</Text>
            </View>
          </View>

          <View style={[styles.row, isNarrowScreen && styles.healthRowWrap]}>
            <View style={[styles.third, isNarrowScreen && styles.healthThirdStacked]}>
              <Text style={[styles.microLabel, { color: theme.textSecondary }]}>WEIGHT (KG)</Text>
              <TextInput
                value={weight}
                onChangeText={(text) => setWeight(text.replace(/[^0-9.]/g, ''))}
                placeholder="--"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[
                  styles.premiumInput,
                  styles.smallInput,
                  { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
                ]}
              />
            </View>
            <View style={[styles.third, isNarrowScreen && styles.healthThirdStacked]}>
              <Text style={[styles.microLabel, { color: theme.textSecondary }]}>BP (MMHG)</Text>
              <TextInput
                value={bloodPressure}
                onChangeText={setBloodPressure}
                placeholder="120/80"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.premiumInput,
                  styles.smallInput,
                  { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
                ]}
                autoCapitalize="none"
              />
            </View>
            <View style={[styles.third, isNarrowScreen && styles.healthThirdStacked]}>
              <Text style={[styles.microLabel, { color: theme.textSecondary }]}>PULSE (BPM)</Text>
              <TextInput
                value={pulse}
                onChangeText={(text) => setPulse(text.replace(/[^0-9]/g, ''))}
                placeholder="--"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[
                  styles.premiumInput,
                  styles.smallInput,
                  { borderColor: theme.borderColor, color: theme.text, backgroundColor: theme.background },
                ]}
              />
            </View>
          </View>

          <View style={styles.tipCard}>
            <Text style={[styles.tipText, { color: theme.textSecondary }]}>
              Providing these helps our medical AI provide more accurate health predictions for your unique body.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.ctaButton, { backgroundColor: theme.tint }, updateProfileMutation.isPending && styles.ctaDisabled]}
          onPress={handleSave}
          disabled={updateProfileMutation.isPending}
          activeOpacity={0.9}
        >
          {updateProfileMutation.isPending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.ctaContent}>
              <Text style={styles.ctaText}>{isEditMode ? 'Save Changes' : 'Save and Continue'}</Text>
              <ArrowRight size={20} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  editHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  setupHeader: {
    marginBottom: 20,
  },
  setupTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.8,
  },
  progressBox: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '800',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '60%',
    borderRadius: 3,
  },
  heroSection: {
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 12,
  },
  heroTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    opacity: 0.8,
    fontWeight: '500',
  },
  sectionCard: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  sectionCardCompact: {
    padding: 18,
    borderRadius: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  fieldLabelRow: {
    marginBottom: 8,
    marginTop: 14,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  premiumInput: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  demographicsPanel: {
    marginTop: 4,
  },
  genderPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderButton: {
    flexGrow: 1,
    flexBasis: 78,
    height: 46,
    borderWidth: 1.5,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  genderButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  optionalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  optionalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  third: {
    flex: 1,
    minWidth: 0,
  },
  healthRowWrap: {
    flexWrap: 'wrap',
  },
  healthThirdStacked: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  microLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
    opacity: 0.6,
    letterSpacing: 0.5,
  },
  smallInput: {
    height: 52,
    fontSize: 15,
  },
  tipCard: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  tipText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    opacity: 0.7,
  },
  ctaButton: {
    height: 62,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ctaText: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});

export default ProfileSetupScreen;
