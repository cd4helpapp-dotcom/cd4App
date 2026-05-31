import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import {
  CheckCircle,
  Briefcase,
  DollarSign,
  Clock,
  User,
  Phone,
  Mail,
  ChevronRight,
  FileText,
  Upload,
  Camera,
  ChevronDown,
  ArrowLeft,
  MapPin,
} from 'lucide-react-native';
import { supabase, createRedirectUrl } from '../src/lib/supabase';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Colors from '../constants/Colors';
import { DOCTOR_SPECIALIZATION_OPTIONS } from '../constants/DoctorOptions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenWrapper from '../ui/common/ScreenWrapper';
import { useThemePreference } from '../context/ThemePreferenceContext';
import { SUPABASE_PROFILE_MEDIA_BUCKET } from '../constants/Config';
import {
  checkEmailRegistrationStatus,
  getEmailAlreadyRegisteredMessage,
  isExistingEmailSignupResult,
  normalizeAuthEmail,
} from '../src/utils/authAvailability';

type DoctorRegisterFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  city: string;
  specialization: string;
  experience: string;
  fee: string;
  bio: string;
  registrationNumber: string;
  gender: string;
  password?: string;
};

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const PROFILE_MEDIA_BUCKET = SUPABASE_PROFILE_MEDIA_BUCKET;
const PROFILE_MEDIA_FOLDER = 'profile-pictures';
const KYC_BUCKET = 'doctor-kyc';

const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n${message}`);
    return;
  }

  Alert.alert(title, message);
};

const formatDoctorFee = (rawFee: string): string | null => {
  const numericFee = Number(rawFee.replace(/[^\d]/g, ''));
  if (!Number.isFinite(numericFee) || numericFee <= 0) {
    return null;
  }
  return `₹${numericFee}`;
};

export default function DoctorRegisterScreen() {
  const router = useRouter();
  const { resolvedColorScheme } = useThemePreference();
  const colorScheme = resolvedColorScheme;
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
  const insets = useSafeAreaInsets();
  const isDark = (colorScheme ?? 'light') === 'dark';
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const FormKeyboardWrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  const [formData, setFormData] = useState<DoctorRegisterFormState>({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    city: '',
    specialization: '',
    experience: '',
    fee: '',
    bio: '',
    registrationNumber: '',
    gender: '',
    password: '',
  });
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [showSpecializationDropdown, setShowSpecializationDropdown] = useState(false);
  const [profileImage, setProfileImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [kycDocs, setKycDocs] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successTitle, setSuccessTitle] = useState('Registration Submitted!');
  const [successSubText, setSuccessSubText] = useState(
    'Your profile and documents have been submitted for verification. Please check your email to verify your account. We will notify you once approved.'
  );

  const closeAllDropdowns = () => {
    setShowGenderDropdown(false);
    setShowSpecializationDropdown(false);
  };


  const pickImage = async (type: 'profile' | 'kyc') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: type === 'profile',
      aspect: type === 'profile' ? [1, 1] : undefined,
      quality: 0.5,
    });

    if (result.canceled) {
      return;
    }

    if (type === 'profile') {
      setProfileImage(result.assets[0]);
      return;
    }

    setKycDocs((prev) => [...prev, result.assets[0]]);
  };

  const handleSubmit = async () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      return showAlert('Name Required', 'Please enter your full name.');
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      return showAlert('Invalid Email', 'Please enter a valid email address.');
    }
    if (!formData.phoneNumber.trim() || formData.phoneNumber.length < 10) {
      return showAlert('Invalid Phone', 'Please enter a valid 10-digit phone number.');
    }
    if (!formData.city.trim()) {
      return showAlert('City Required', 'Please enter your city.');
    }
    if (!formData.gender) {
      return showAlert('Gender Required', 'Please select your gender.');
    }
    if (!formData.registrationNumber.trim()) {
      return showAlert('Reg. Number Required', 'Please enter your Medical Registration Number.');
    }
    if (!formData.specialization.trim()) {
      return showAlert('Specialization Required', 'Please select your medical specialization.');
    }
    if (!formData.experience.trim()) {
      return showAlert('Experience Required', 'Please enter your years of experience.');
    }
    const formattedFee = formatDoctorFee(formData.fee);
    if (!formattedFee) {
      return showAlert('Consultation Fee Required', 'Please enter a valid consultation fee.');
    }
    if (!formData.password || formData.password.length < 6) {
      return showAlert('Password Weak', 'Password must be at least 6 characters.');
    }

    setLoading(true);

    try {
      const signupEmail = normalizeAuthEmail(formData.email);
      const emailStatus = await checkEmailRegistrationStatus(signupEmail);
      if (emailStatus?.exists) {
        showAlert('Email Already Registered', getEmailAlreadyRegisteredMessage(emailStatus.role));
        return;
      }

      // 1. Sign up user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: signupEmail,
        password: formData.password!,
        options: {
          emailRedirectTo: createRedirectUrl('auth/login'),
          data: {
            first_name: formData.firstName.trim(),
            last_name: formData.lastName.trim(),
            phone: formData.phoneNumber.trim(),
            role: 'doctor', // Trigger will use this
            city: formData.city.trim(),
            specialization: formData.specialization.trim(),
            experience: formData.experience.trim(),
            fee: formattedFee,
            registration_number: formData.registrationNumber.trim(),
            bio: formData.bio.trim(),
          }
        }
      });

      if (authError) throw authError;
      if (isExistingEmailSignupResult(authData)) {
        showAlert('Email Already Registered', getEmailAlreadyRegisteredMessage());
        return;
      }
      if (!authData.user) throw new Error('Could not create user account.');

      const userId = authData.user.id;
      const hasActiveSession = Boolean(authData.session?.access_token);

      if (!hasActiveSession) {
        setSuccessTitle('Account Created');
        setSuccessSubText(
          'Please verify your email first. After login, your account will open as doctor role automatically. Then complete doctor profile from the app.'
        );
        setSuccess(true);
        return;
      }

      // Keep doctor role explicit for this user, even if metadata mapping was delayed.
      const { data: doctorRole } = await supabase
        .from('roles')
        .select('id')
        .eq('slug', 'doctor')
        .maybeSingle();

      if (doctorRole?.id) {
        await supabase
          .from('profiles')
          .update({ role_id: doctorRole.id })
          .eq('id', userId);
      }

      // 2. Upload Profile Image
      let profileImageUrl = '';
      if (profileImage) {
        const fileExt = profileImage.uri.split('.').pop();
        const fileName = `${PROFILE_MEDIA_FOLDER}/${userId}/profile.${fileExt}`;

        // Convert to base64 for upload if needed, or use blob if supported
        // Assuming your environment supports fetch/blob
        const response = await fetch(profileImage.uri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from(PROFILE_MEDIA_BUCKET)
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) console.warn('Profile image upload failed:', uploadError.message);
        else profileImageUrl = fileName;
      }

      // 3. Upload KYC Documents
      const kycPaths: string[] = [];
      for (let i = 0; i < kycDocs.length; i++) {
        const doc = kycDocs[i];
        const fileExt = doc.uri.split('.').pop();
        const fileName = `${userId}/kyc_${i}.${fileExt}`;

        const response = await fetch(doc.uri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from(KYC_BUCKET)
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

        if (!uploadError) {
          // Persist with bucket prefix so resolver can always identify target bucket.
          kycPaths.push(`${KYC_BUCKET}/${fileName}`);
        }
      }

      if (profileImageUrl) {
        const { error: profilePictureError } = await supabase
          .from('profiles')
          .update({ profile_picture: profileImageUrl })
          .eq('id', userId);

        if (profilePictureError) {
          console.warn('Could not persist doctor profile picture path:', profilePictureError.message);
        }
      }

      // 4. Update Doctors table (Profiles table is handled by trigger)
      // Note: We might need to wait a tiny bit for the trigger to finish profile creation
      // but Postgres transactions usually handle this if trigger is AFTER INSERT.

      const { error: doctorError } = await supabase
        .from('doctors')
        .upsert({
          id: userId,
          city: formData.city,
          specialization: formData.specialization,
          experience: formData.experience.trim(),
          fee: formattedFee,
          bio: formData.bio.trim(),
          image: profileImageUrl || null,
          registration_number: formData.registrationNumber.trim(),
          documents: kycPaths,
          // rating and verification will default in DB
        }, { onConflict: 'id' });

      if (doctorError) throw doctorError;

      setSuccessTitle('Registration Submitted!');
      setSuccessSubText(
        'Your profile and documents have been submitted for verification. Please check your email to verify your account. We will notify you once approved.'
      );
      setSuccess(true);
    } catch (error: any) {
      console.error('Registration Error:', error);
      showAlert('Registration Failed', error.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successCard}>
          <CheckCircle size={80} color={theme.success} />
          <Text style={styles.successTitle}>{successTitle}</Text>
          <Text style={styles.successText}>
            Dr. {formData.firstName} {formData.lastName}
          </Text>
          <Text style={styles.successSubText}>{successSubText}</Text>
          <TouchableOpacity style={styles.homeButton} onPress={() => router.push('/')}>
            <Text style={styles.homeButtonText}>Go to App</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScreenWrapper withScrollView={false} keyboardAvoiding={false} applyTopInset applyBottomInset extraBottomPadding={0}>
      <FormKeyboardWrapper
        style={styles.mainContainer}
        {...(Platform.OS === 'ios'
          ? { behavior: 'padding' as const, keyboardVerticalOffset: insets.top + 4 }
          : {})}
      >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 20, 20) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScrollBeginDrag={closeAllDropdowns}
      >
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={22} color={theme.text} />
            </TouchableOpacity>
            <View style={styles.logoContainer}>
              <Image source={require('../assets/icon.png')} style={styles.logoImage} resizeMode="cover" />
            </View>
            <View style={styles.backButtonSpacer} />
          </View>
          <Text style={styles.headerTitle}>Partner Registration</Text>
          <Text style={styles.headerSubtitle}>Join India's fastest growing holistic healthcare network.</Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.formIntroRow}>
            <Text style={styles.formIntroTitle}>Doctor Onboarding Form</Text>
            <View style={styles.formIntroBadge}>
              <Text style={styles.formIntroBadgeText}>~2 min</Text>
            </View>
          </View>
          <Text style={styles.formIntroSubtitle}>
            Fill accurate details for faster approval and onboarding.
          </Text>

          <Text style={styles.sectionHeader}>Personal Information</Text>

          <View style={styles.uploadCenter}>
            <TouchableOpacity style={styles.profileUpload} onPress={() => pickImage('profile')} activeOpacity={0.8}>
              {profileImage ? (
                <Image source={{ uri: profileImage.uri }} style={styles.profileImage} />
              ) : (
                <View style={styles.placeholderImage}>
                  <Camera size={30} color={theme.textSecondary} />
                  <Text style={styles.uploadText}>Add Selfie</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>First Name</Text>
            <View style={[styles.inputContainer, formData.firstName.trim() && styles.inputContainerFilled]}>
              <User size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="Ex. Amit"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                value={formData.firstName}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, firstName: value }))}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Last Name</Text>
            <View style={[styles.inputContainer, formData.lastName.trim() && styles.inputContainerFilled]}>
              <User size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="Ex. Sharma"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                value={formData.lastName}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, lastName: value }))}
              />
            </View>
          </View>

          <View style={[styles.inputWrapper, { zIndex: 100 }]}>
            <Text style={styles.inputLabel}>Gender</Text>
            <TouchableOpacity
              style={[styles.dropdownButton, formData.gender && styles.dropdownButtonFilled]}
              onPress={() => {
                setShowGenderDropdown((prev) => !prev);
                setShowSpecializationDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.inputText, !formData.gender && styles.placeholderText]}>
                {formData.gender || 'Select Gender'}
              </Text>
              <ChevronDown size={20} color={theme.textSecondary} />
            </TouchableOpacity>

            {showGenderDropdown && (
              <View style={styles.dropdownList}>
                {GENDER_OPTIONS.map((gender) => (
                  <TouchableOpacity
                    key={gender}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setFormData((prev) => ({ ...prev, gender }));
                      setShowGenderDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{gender}</Text>
                    {formData.gender === gender && <CheckCircle size={16} color={theme.tint} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={[styles.inputContainer, formData.email.trim() && styles.inputContainerFilled]}>
              <Mail size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="doctor@example.com"
                placeholderTextColor={theme.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                value={formData.email}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, email: value }))}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <View style={[styles.inputContainer, formData.phoneNumber.trim() && styles.inputContainerFilled]}>
              <Phone size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="9876543210"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                maxLength={10}
                value={formData.phoneNumber}
                onChangeText={(value) =>
                  setFormData((prev) => ({ ...prev, phoneNumber: value.replace(/[^\d]/g, '') }))
                }
              />
            </View>
            <Text style={styles.helperText}>Enter 10-digit mobile number</Text>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={[styles.inputContainer, formData.password?.trim() && styles.inputContainerFilled]}>
              <FileText size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="Choose a strong password"
                placeholderTextColor={theme.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                value={formData.password}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, password: value }))}
              />
            </View>
            <Text style={styles.helperText}>Minimum 6 characters</Text>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>City</Text>
            <View style={[styles.inputContainer, formData.city.trim() && styles.inputContainerFilled]}>
              <MapPin size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="Ex. Delhi"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                value={formData.city}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, city: value }))}
              />
            </View>
          </View>

          <Text style={[styles.sectionHeader, styles.sectionSpacing]}>Professional & KYC Details</Text>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Registration Number (MCI/State)</Text>
            <View style={[styles.inputContainer, formData.registrationNumber.trim() && styles.inputContainerFilled]}>
              <FileText size={18} color={theme.textSecondary} />
              <TextInput
                style={styles.input}
                placeholder="Ex. MCI-12345-A"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                value={formData.registrationNumber}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, registrationNumber: value }))}
              />
            </View>
          </View>

          <View style={[styles.inputWrapper, { zIndex: 80 }]}>
            <Text style={styles.inputLabel}>Specialization</Text>
            <TouchableOpacity
              style={[styles.dropdownButton, formData.specialization && styles.dropdownButtonFilled]}
              onPress={() => {
                setShowSpecializationDropdown((prev) => !prev);
                setShowGenderDropdown(false);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.dropdownButtonLeft}>
                <Briefcase size={18} color={theme.textSecondary} />
                <Text style={[styles.inputText, !formData.specialization && styles.placeholderText, styles.dropdownValueText]}>
                  {formData.specialization || 'Select Specialization'}
                </Text>
              </View>
              <ChevronDown size={20} color={theme.textSecondary} />
            </TouchableOpacity>

            {showSpecializationDropdown && (
              <View style={styles.dropdownList}>
                <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
                  {DOCTOR_SPECIALIZATION_OPTIONS.map((specialization) => (
                    <TouchableOpacity
                      key={specialization}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setFormData((prev) => ({ ...prev, specialization }));
                        setShowSpecializationDropdown(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{specialization}</Text>
                      {formData.specialization === specialization && <CheckCircle size={16} color={theme.tint} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={styles.row}>
            <View style={[styles.inputWrapper, styles.rowInput]}>
              <Text style={styles.inputLabel}>Experience</Text>
              <View style={[styles.inputContainer, formData.experience.trim() && styles.inputContainerFilled]}>
                <Clock size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Ex. 5"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  value={formData.experience}
                  onChangeText={(value) =>
                    setFormData((prev) => ({ ...prev, experience: value.replace(/[^\d]/g, '') }))
                  }
                />
              </View>
            </View>
            <View style={[styles.inputWrapper, styles.rowInputNoSpacing]}>
              <Text style={styles.inputLabel}>Consultation Fee</Text>
              <View style={[styles.inputContainer, formData.fee.trim() && styles.inputContainerFilled]}>
                <DollarSign size={18} color={theme.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Ex. 500"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  value={formData.fee}
                  onChangeText={(value) =>
                    setFormData((prev) => ({ ...prev, fee: value.replace(/[^\d]/g, '') }))
                  }
                />
              </View>
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>KYC Documents (Medical ID / Aadhar)</Text>
            <Text style={styles.helperText}>Upload clear document images for quicker verification.</Text>
            {kycDocs.map((_, index) => (
              <View key={index} style={styles.docItem}>
                <FileText size={16} color={theme.tint} />
                <Text style={styles.docName} numberOfLines={1}>
                  Document {index + 1}
                </Text>
              </View>
            ))}
            <TouchableOpacity style={styles.uploadButton} onPress={() => pickImage('kyc')} activeOpacity={0.8}>
              <Upload size={20} color={theme.textSecondary} />
              <Text style={styles.uploadBtnText}>Upload Document</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>Bio (Optional)</Text>
            <View style={[styles.inputContainer, styles.bioContainer]}>
              <TextInput
                style={[styles.input, styles.bioInput]}
                placeholder="Tell us briefly about your practice..."
                placeholderTextColor={theme.textSecondary}
                multiline
                maxLength={500}
                textAlignVertical="top"
                value={formData.bio}
                onChangeText={(value) => setFormData((prev) => ({ ...prev, bio: value }))}
              />
            </View>
            <Text style={styles.helperText}>{formData.bio.length}/500</Text>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            onPress={handleSubmit}
            activeOpacity={0.88}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={theme.buttonText} />
            ) : (
              <Text style={styles.submitButtonText}>Submit for Verification</Text>
            )}
            {!loading && <ChevronRight size={20} color={theme.buttonText} style={styles.submitIcon} />}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>© 2026 CD4 Healthcare</Text>
        </View>
      </ScrollView>
      </FormKeyboardWrapper>
    </ScreenWrapper>
  );
}

const createStyles = (theme: typeof Colors.light, isDark: boolean) =>
  StyleSheet.create({
    mainContainer: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      paddingVertical: 32,
      paddingHorizontal: 18,
    },
    header: {
      width: '100%',
      maxWidth: 500,
      marginBottom: 26,
      alignItems: 'center',
    },
    headerTopRow: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#1A2522' : '#EEF2F7',
      borderWidth: 1,
      borderColor: theme.borderColor,
    },
    backButtonSpacer: {
      width: 40,
      height: 40,
    },
    logoContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#fff',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: theme.tint,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 6,
      overflow: 'hidden',
    },
    logoImage: {
      width: '100%',
      height: '100%',
    },
    headerTitle: {
      fontSize: 31,
      fontWeight: '800',
      color: theme.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    headerSubtitle: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: 14,
    },
    formContainer: {
      width: '100%',
      maxWidth: 500,
      backgroundColor: theme.cardBackground,
      borderRadius: 24,
      padding: 22,
      borderWidth: 1,
      borderColor: theme.borderColor,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: isDark ? 0.24 : 0.08,
      shadowRadius: 20,
      elevation: 9,
    },
    formIntroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    formIntroTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: theme.text,
    },
    formIntroBadge: {
      borderWidth: 1,
      borderColor: theme.borderColor,
      backgroundColor: isDark ? '#102019' : '#ECFDF3',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    formIntroBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.tint,
    },
    formIntroSubtitle: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: 14,
      lineHeight: 18,
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 1.1,
      color: theme.textSecondary,
      marginBottom: 14,
    },
    sectionSpacing: {
      marginTop: 20,
    },
    row: {
      flexDirection: 'row',
    },
    rowInput: {
      flex: 1,
      marginRight: 10,
    },
    rowInputNoSpacing: {
      flex: 1,
    },
    inputWrapper: {
      marginBottom: 18,
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 8,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#0F1815' : '#F7FAFC',
      borderWidth: 1,
      borderColor: theme.borderColor,
      borderRadius: 12,
      paddingHorizontal: 12,
      height: 50,
    },
    inputContainerFilled: {
      borderColor: `${theme.tint}66`,
      backgroundColor: isDark ? '#13221C' : '#F1FCF6',
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: theme.text,
      marginLeft: 8,
      height: '100%',
    },
    dropdownButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? '#0F1815' : '#F7FAFC',
      borderWidth: 1,
      borderColor: theme.borderColor,
      borderRadius: 12,
      paddingHorizontal: 12,
      minHeight: 50,
    },
    dropdownButtonFilled: {
      borderColor: `${theme.tint}66`,
      backgroundColor: isDark ? '#13221C' : '#F1FCF6',
    },
    dropdownButtonLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: 8,
    },
    dropdownValueText: {
      marginLeft: 8,
    },
    dropdownList: {
      marginTop: 6,
      backgroundColor: theme.cardBackground,
      borderWidth: 1,
      borderColor: theme.borderColor,
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: isDark ? 0.25 : 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    dropdownScroll: {
      maxHeight: 220,
    },
    dropdownItem: {
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderColor,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    dropdownItemText: {
      fontSize: 15,
      color: theme.text,
      fontWeight: '500',
      flex: 1,
      paddingRight: 8,
    },
    inputText: {
      fontSize: 15,
      color: theme.text,
      fontWeight: '500',
      flex: 1,
    },
    placeholderText: {
      color: theme.textSecondary,
      fontWeight: '500',
    },
    helperText: {
      marginTop: 6,
      marginLeft: 4,
      color: theme.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    uploadCenter: {
      alignItems: 'center',
      marginBottom: 18,
    },
    profileUpload: {
      width: 108,
      height: 108,
      borderRadius: 54,
      backgroundColor: isDark ? '#101715' : '#F0F3F7',
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.borderColor,
    },
    profileImage: {
      width: '100%',
      height: '100%',
    },
    placeholderImage: {
      alignItems: 'center',
    },
    uploadText: {
      fontSize: 10,
      color: theme.textSecondary,
      marginTop: 4,
      fontWeight: '600',
    },
    docItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#101715' : '#F0F4F8',
      borderWidth: 1,
      borderColor: theme.borderColor,
      padding: 10,
      borderRadius: 8,
      marginBottom: 8,
    },
    docName: {
      marginLeft: 10,
      color: theme.text,
      fontSize: 14,
      flex: 1,
      fontWeight: '500',
    },
    uploadButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
      borderWidth: 1,
      borderColor: theme.borderColor,
      borderRadius: 12,
      borderStyle: 'dashed',
      backgroundColor: isDark ? '#101715' : '#F9FAFB',
    },
    uploadBtnText: {
      marginLeft: 8,
      color: theme.textSecondary,
      fontWeight: '700',
    },
    bioContainer: {
      alignItems: 'flex-start',
      minHeight: 104,
      paddingVertical: 0,
    },
    bioInput: {
      height: '100%',
      paddingTop: 10,
      marginLeft: 0,
    },
    submitButton: {
      backgroundColor: theme.buttonPrimary,
      minHeight: 56,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
      shadowColor: theme.buttonPrimary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28,
      shadowRadius: 10,
      elevation: 8,
    },
    submitButtonText: {
      color: theme.buttonText,
      fontSize: 17,
      fontWeight: '800',
    },
    submitIcon: {
      marginLeft: 5,
    },
    disabledButton: {
      opacity: 0.75,
    },
    footer: {
      marginTop: 28,
      alignItems: 'center',
      paddingBottom: 10,
    },
    footerText: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    successContainer: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    successCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: theme.cardBackground,
      borderRadius: 30,
      borderWidth: 1,
      borderColor: theme.borderColor,
      padding: 34,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: isDark ? 0.25 : 0.1,
      shadowRadius: 28,
      elevation: 16,
    },
    successTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: theme.text,
      marginTop: 20,
      marginBottom: 6,
      textAlign: 'center',
    },
    successText: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.tint,
      marginBottom: 10,
      textAlign: 'center',
    },
    successSubText: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 28,
    },
    homeButton: {
      backgroundColor: theme.successLight,
      borderColor: theme.successBorder,
      borderWidth: 1,
      paddingVertical: 12,
      paddingHorizontal: 30,
      borderRadius: 12,
    },
    homeButtonText: {
      color: theme.tint,
      fontWeight: '700',
      fontSize: 15,
    },
  });
