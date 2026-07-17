import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Toast from 'react-native-toast-message';
import { supabase, createRedirectUrl } from '../../src/lib/supabase';
import { SignupData } from '../../src/types';
import Colors from '../../constants/Colors';
import { ArrowRight, Apple, Eye, EyeOff } from 'lucide-react-native';
import { AntDesign } from '@expo/vector-icons';
import {
  configureNativeGoogleSignin,
  isGoogleDeveloperError,
  isGooglePlayServicesUnavailable,
  isGoogleSigninBusy,
  isGoogleSigninCancelled,
  isNativeGooglePlatform,
  signInWithNativeGoogle,
} from '../../utils/googleNativeAuth';
import { useThemePreference } from '../../context/ThemePreferenceContext';
import {
  checkEmailRegistrationStatus,
  getEmailAlreadyRegisteredMessage,
  isExistingEmailSignupResult,
  normalizeAuthEmail,
} from '../../src/utils/authAvailability';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LoginProfileSnapshot = {
  id: string;
  age: number | null;
  gender: string | null;
  address: string | null;
  profile_setup_completed: boolean | null;
  roles?: { slug?: string } | Array<{ slug?: string }> | null;
};

const SignupScreen: React.FC = () => {
  const [formData, setFormData] = useState<SignupData>({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<SignupData>>({});
  const [showPassword, setShowPassword] = useState(false);

  const { resolvedColorScheme } = useThemePreference();
  const colorScheme = resolvedColorScheme;
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;

  const [isSignupPending, setIsSignupPending] = useState(false);
  const [isGoogleLoginPending, setIsGoogleLoginPending] = useState(false);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCompact = height < 760;

  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const [isNativeGoogleReady, setIsNativeGoogleReady] = useState(false);
  const FormWrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  React.useEffect(() => {
    if (isExpoGo || !isNativeGooglePlatform) {
      setIsNativeGoogleReady(false);
      return;
    }

    const result = configureNativeGoogleSignin({
      webClientId: googleWebClientId,
      iosClientId: googleIosClientId,
    });

    if (!result.ok) {
      console.warn('Native Google Sign-In configuration failed:', result.error);
      setIsNativeGoogleReady(false);
      return;
    }

    setIsNativeGoogleReady(true);
  }, [googleIosClientId, googleWebClientId, isExpoGo]);

  const handleGoogleLoginPress = async () => {
    if (isExpoGo) {
      Toast.show({
        type: 'error',
        text1: 'Google Login Unsupported in Expo Go',
        text2: 'Use a dev-client build.',
      });
      return;
    }

    if (!isNativeGooglePlatform) {
      Toast.show({
        type: 'error',
        text1: 'Google Login Unsupported',
        text2: 'Use Android or iOS app build for Google Sign-In.',
      });
      return;
    }

    if (!googleWebClientId) {
      Toast.show({
        type: 'error',
        text1: 'Google Setup Missing',
        text2: 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild the app.',
      });
      return;
    }

    if (!isNativeGoogleReady) {
      Toast.show({
        type: 'error',
        text1: 'Google Sign-In Not Ready',
        text2: 'Native Google SDK is still initializing. Reopen app and try again.',
      });
      return;
    }

    try {
      setIsGoogleLoginPending(true);
      const { idToken } = await signInWithNativeGoogle({ forceAccountSelection: true });
      await handleGoogleToken(idToken);
    } catch (err: any) {
      if (isGoogleSigninCancelled(err)) {
        setIsGoogleLoginPending(false);
        return;
      }

      if (isGoogleSigninBusy(err)) {
        Toast.show({
          type: 'info',
          text1: 'Google Sign-In in Progress',
          text2: 'Please wait and try again in a moment.',
        });
        setIsGoogleLoginPending(false);
        return;
      }

      if (isGooglePlayServicesUnavailable(err)) {
        Toast.show({
          type: 'error',
          text1: 'Google Play Services Required',
          text2: 'Update Google Play Services and try again.',
        });
        setIsGoogleLoginPending(false);
        return;
      }

      if (isGoogleDeveloperError(err)) {
        Toast.show({
          type: 'error',
          text1: 'Google OAuth Config Error',
          text2: 'Check SHA-1/SHA-256 and OAuth client IDs in Firebase/Google Cloud.',
        });
        setIsGoogleLoginPending(false);
        return;
      }

      console.warn('Native Google Sign-In Error:', err);
      Toast.show({
        type: 'error',
        text1: 'Google Login Error',
        text2: err?.message || 'Failed to authenticate with Google.',
      });
      setIsGoogleLoginPending(false);
    }
  };

  const handleGoogleToken = async (idToken: string) => {
    setIsGoogleLoginPending(true);
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) throw error;
      await routeAfterSuccessfulAuth(data.user!.id);
    } catch (errorObj: any) {
      Toast.show({
        type: 'error',
        text1: 'Google Login Failed',
        text2: errorObj.message || 'Failed to authenticate.',
      });
    } finally {
      setIsGoogleLoginPending(false);
    }
  };

  const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((email: string) => email.trim().toLowerCase())
    .filter((email: string) => email.length > 0);

  const isAdminEmail = (email?: string): boolean => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase().trim());
  };

  const resolveRoleSlugFromProfile = (profile: LoginProfileSnapshot | null, email?: string): string => {
    if (isAdminEmail(email)) return 'Admin';
    if (!profile?.roles) return 'Patient';

    const rawSlug = Array.isArray(profile.roles)
      ? profile.roles[0]?.slug
      : profile.roles.slug;

    const slug = typeof rawSlug === 'string' && rawSlug.trim() ? rawSlug.trim().toLowerCase() : 'patient';

    if (slug === 'admin') return 'Admin';
    if (slug === 'doctor') return 'Doctor';
    if (slug === 'marketing') return 'Marketing';
    if (slug === 'hospital') return 'Hospital';
    return 'Patient';
  };

  const routeAfterSuccessfulAuth = async (userId: string) => {
    // Basic routing logic similar to LoginScreen
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, age, gender, address, profile_setup_completed, roles:role_id(slug)')
      .eq('id', userId)
      .single();

    const { data: authUserData } = await supabase.auth.getUser();
    const userEmail = authUserData.user?.email;
    const roleSlug = resolveRoleSlugFromProfile(profile as any, userEmail);

    if (roleSlug === 'Admin') router.replace('/admin/dashboard');
    else if (roleSlug === 'Doctor') router.replace('/doctor/dashboard');
    else if (roleSlug === 'Hospital') router.replace('/hospital/dashboard');
    else router.replace('/(tabs)');
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<SignupData> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (formData.firstName.trim().length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (formData.lastName.trim().length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^[6-9]\d{9}$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Please enter a valid Indian phone number';
    }

    if (!formData.password || formData.password.trim().length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignup = async () => {
    if (!validateForm()) return;
    setIsSignupPending(true);

    try {
      const signupEmail = normalizeAuthEmail(formData.email);
      const emailStatus = await checkEmailRegistrationStatus(signupEmail);
      if (emailStatus?.exists) {
        Toast.show({
          type: 'error',
          text1: 'Email already registered',
          text2: getEmailAlreadyRegisteredMessage(emailStatus.role),
        });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: formData.password!,
        options: {
          emailRedirectTo: createRedirectUrl('auth/login'),
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone_number: formData.phoneNumber,
            phone: formData.phoneNumber,
          }
        }
      });

      if (!error) {
        if (isExistingEmailSignupResult(data)) {
          Toast.show({
            type: 'error',
            text1: 'Email already registered',
            text2: getEmailAlreadyRegisteredMessage(),
          });
          return;
        }

        Toast.show({
          type: 'success',
          text1: 'Account Created!',
          text2: 'Please verify your email to continue.',
          visibilityTime: 5000,
        });

        router.replace('/auth/login');
      } else {
        Toast.show({
          type: 'error',
          text1: 'Signup Failed',
          text2: error.message || 'Please check your details and try again.',
        });
      }
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Signup Error',
        text2: error.message || 'Signup failed. Please try again.',
      });
    } finally {
      setIsSignupPending(false);
    }
  };

  const updateFormData = (field: keyof SignupData, value: string) => {
    setFormData((prev: SignupData) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev: Partial<SignupData>) => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <FormWrapper
        style={[styles.container, { backgroundColor: theme.background }]}
        {...(Platform.OS === 'ios' ? { behavior: 'padding' as const, keyboardVerticalOffset: insets.top + 4 } : {})}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 20, 20) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
        <View style={styles.contentWrapper}>
          <View style={styles.header}>
            <View style={[styles.logoContainer, { shadowColor: theme.tint }]}>
              <Image
                source={require('../../assets/icon.png')}
                style={styles.logo}
                resizeMode="cover"
              />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Create Account</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Join CD4 and start your wellness journey
            </Text>
          </View>

          <View style={styles.form}>
            {/* First Name */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>First Name</Text>
              <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: errors.firstName ? theme.badgeText : theme.borderColor }]}>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter your first name"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.firstName}
                  onChangeText={(text: string) => updateFormData('firstName', text)}
                  autoCapitalize="words"
                />
              </View>
              {errors.firstName && <Text style={[styles.errorText, { color: theme.badgeText }]}>{errors.firstName}</Text>}
            </View>

            {/* Last Name */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Last Name</Text>
              <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: errors.lastName ? theme.badgeText : theme.borderColor }]}>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter your last name"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.lastName}
                  onChangeText={(text: string) => updateFormData('lastName', text)}
                  autoCapitalize="words"
                />
              </View>
              {errors.lastName && <Text style={[styles.errorText, { color: theme.badgeText }]}>{errors.lastName}</Text>}
            </View>

            {/* Email */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
              <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: errors.email ? theme.badgeText : theme.borderColor }]}>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter email"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.email}
                  onChangeText={(text: string) => updateFormData('email', text.toLowerCase())}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>
              {errors.email && <Text style={[styles.errorText, { color: theme.badgeText }]}>{errors.email}</Text>}
            </View>

            {/* Phone Number */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Phone Number</Text>
              <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: errors.phoneNumber ? theme.badgeText : theme.borderColor }]}>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter your phone number"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.phoneNumber}
                  onChangeText={(text: string) => updateFormData('phoneNumber', text.replace(/[^0-9]/g, ''))}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
              {errors.phoneNumber && <Text style={[styles.errorText, { color: theme.badgeText }]}>{errors.phoneNumber}</Text>}
            </View>

            {/* Password */}
            <View style={styles.inputContainer}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
              <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: errors.password ? theme.badgeText : theme.borderColor }]}>
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter password"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.password}
                  onChangeText={(text: string) => updateFormData('password', text)}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  style={styles.eyeIconContainer}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff size={20} color={theme.tint} />
                  ) : (
                    <Eye size={20} color={theme.tint} />
                  )}
                </TouchableOpacity>
              </View>
              {errors.password && <Text style={[styles.errorText, { color: theme.badgeText }]}>{errors.password}</Text>}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: theme.tint, shadowColor: theme.tint },
                isSignupPending && styles.buttonDisabled
              ]}
              onPress={handleSignup}
              disabled={isSignupPending}
            >
              {isSignupPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={styles.buttonContent}>
                  <Text style={styles.buttonText}>Create Account</Text>
                  <ArrowRight size={20} color="#fff" style={{ marginLeft: 8 }} />
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.socialSection}>
              <Text style={[styles.socialTitle, { color: theme.textSecondary }]}>or Sign up with</Text>

              <View style={styles.socialButtonsContainer}>
                <TouchableOpacity
                  style={[
                    styles.socialCircleButton,
                    isGoogleLoginPending && styles.buttonDisabled,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.borderColor,
                    },
                  ]}
                  onPress={handleGoogleLoginPress}
                  disabled={isGoogleLoginPending}
                  activeOpacity={0.85}
                >
                  <Image
                    source={require('../../assets/images/google_logo.png')}
                    style={styles.socialIcon}
                    resizeMode="contain"
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.socialCircleButton,
                    {
                      backgroundColor: theme.cardBackground,
                      borderColor: theme.borderColor,
                    },
                  ]}
                  onPress={() => Toast.show({ type: 'info', text1: 'Apple Sign-In', text2: 'Apple sign-in will be available soon.' })}
                  activeOpacity={0.85}
                >
                  <AntDesign name="apple" size={26} color={theme.text} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.footerBlock}>
              <TouchableOpacity
                onPress={() => router.push('/auth/login')}
                style={styles.linkButton}
              >
                <Text style={[styles.linkText, { color: theme.textSecondary }]}>
                  Already have an account? <Text style={[styles.linkTextBold, { color: theme.tint }]}>Login</Text>
                </Text>
              </TouchableOpacity>

              <View style={styles.doctorSection}>
                <View style={[styles.doctorDivider, { backgroundColor: theme.borderColor }]} />
                <TouchableOpacity
                  onPress={() => router.push('/doctor-register')}
                  style={[styles.doctorBadge, { backgroundColor: theme.cardBackground, borderColor: theme.tint }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.doctorBadgeText, { color: theme.textSecondary }]}>
                    Are you a doctor?{' '}
                    <Text style={[styles.doctorBadgeTextBold, { color: theme.tint }]}>Join our Panel</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
        </ScrollView>
      </FormWrapper>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  contentWrapper: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    paddingBottom: 20,
    justifyContent: 'flex-start',
  },
  header: {
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 4,
  },
  logoContainer: {
    width: 72,
    height: 72,
    minWidth: 72,
    maxWidth: 72,
    minHeight: 72,
    maxHeight: 72,
    marginBottom: 8,
    borderRadius: 36,
    backgroundColor: '#fff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    aspectRatio: 1,
    overflow: 'hidden',
  },
  logo: {
    width: 72,
    height: 72,
    minWidth: 72,
    maxWidth: 72,
    minHeight: 72,
    maxHeight: 72,
    aspectRatio: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  form: {
    width: '100%',
    gap: 12,
  },
  inputContainer: {
    marginBottom: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    marginLeft: 4,
  },
  inputWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    height: 46,
    justifyContent: 'center',
  },
  input: {
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '500',
    height: '100%',
  },
  errorText: {
    fontSize: 11,
    marginTop: 2,
    marginLeft: 4,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  linkButton: {
    alignItems: 'center',
    padding: 8,
  },
  linkText: {
    fontSize: 16,
  },
  linkTextBold: {
    fontWeight: '700',
  },
  footerBlock: {
    marginTop: 12,
    gap: 12,
    width: '100%',
  },
  doctorSection: {
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  doctorDivider: {
    height: 1,
    width: '60%',
    opacity: 0.5,
  },
  doctorBadge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  doctorBadgeText: {
    fontSize: 14,
  },
  doctorBadgeTextBold: {
    fontWeight: '700',
  },
  eyeIconContainer: {
    position: 'absolute',
    right: 14,
    height: '100%',
    justifyContent: 'center',
  },
  socialSection: {
    alignItems: 'center',
    marginTop: 16,
    width: '100%',
  },
  socialTitle: {
    fontSize: 16,
    marginBottom: 12,
    fontWeight: '500',
  },
  socialButtonsContainer: {
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  socialCircleButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  socialIcon: {
    width: 28,
    height: 28,
  },
});

export default SignupScreen;
