import React, { useEffect, useState } from 'react';
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
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/lib/supabase';
import Colors from '../../constants/Colors';
import { ArrowRight, ChevronDown, Apple, Eye, EyeOff, UserPlus, Trash2 } from 'lucide-react-native';
import { AntDesign } from '@expo/vector-icons';
import {
  getFirebasePhoneAuthErrorMessage,
  requestFirebasePhoneOTP,
  toIndianE164Phone,
} from '../../utils/firebasePhoneAuthSafe';
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

type LoginMethod = 'mobile' | 'email';

type SavedAuthAccount = {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  provider: 'email' | 'google';
  lastUsedAt: string;
};

type LoginProfileSnapshot = {
  id: string;
  role_id?: string | null;
  age: number | null;
  gender: string | null;
  address: string | null;
  profile_setup_completed: boolean | null;
  roles?: { slug?: string } | Array<{ slug?: string }> | null;
};

const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
const SAVED_AUTH_ACCOUNTS_KEY = 'cd4_saved_auth_accounts_v1';

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS || '')
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter((email: string) => email.length > 0);

const isAdminEmail = (email?: string): boolean => {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
};

const resolveRoleSlugFromProfile = (profile: LoginProfileSnapshot | null, email?: string): string | null => {
  if (isAdminEmail(email)) return 'Admin';
  if (!profile) return null;
  if (!profile.roles) return 'Patient';

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

const hasCompletedPatientSetup = (profile: LoginProfileSnapshot | null): boolean => {
  if (!profile) return false;
  if (profile.profile_setup_completed === true) return true;

  const hasAge = typeof profile.age === 'number' && profile.age > 0;
  const hasGender =
    typeof profile.gender === 'string' &&
    ['male', 'female', 'other'].includes(profile.gender.trim().toLowerCase());
  const hasAddress = typeof profile.address === 'string' && profile.address.trim().length > 0;

  return hasAge && hasGender && hasAddress;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LoginScreen: React.FC = () => {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('email'); // Defaulted to email temporarily
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isPhoneOtpSending, setIsPhoneOtpSending] = useState(false);

  const [isLoginPending, setIsLoginPending] = useState(false);
  const [isGoogleLoginPending, setIsGoogleLoginPending] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedAuthAccount[]>([]);
  const [isAccountChooserVisible, setIsAccountChooserVisible] = useState(false);
  const [isAccountChooserBusy, setIsAccountChooserBusy] = useState(false);
  const { resolvedColorScheme } = useThemePreference();
  const colorScheme = resolvedColorScheme;
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
  const isCompact = height < 760;
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const [isNativeGoogleReady, setIsNativeGoogleReady] = useState(false);
  const FormWrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  useEffect(() => {
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

  useEffect(() => {
    let isMounted = true;

    const loadSavedAccounts = async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_AUTH_ACCOUNTS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const cleaned = parsed
          .map((item: any) => {
            const userId = typeof item?.userId === 'string' ? item.userId.trim() : '';
            const email = typeof item?.email === 'string' ? item.email.trim().toLowerCase() : '';
            if (!userId || !email) return null;
            return {
              userId,
              email,
              displayName: typeof item?.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : email,
              avatarUrl: typeof item?.avatarUrl === 'string' && item.avatarUrl.trim() ? item.avatarUrl.trim() : null,
              provider: item?.provider === 'google' ? 'google' : 'email',
              lastUsedAt: typeof item?.lastUsedAt === 'string' && item.lastUsedAt.trim() ? item.lastUsedAt : new Date().toISOString(),
            } as SavedAuthAccount;
          })
          .filter((item: SavedAuthAccount | null): item is SavedAuthAccount => Boolean(item))
          .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
          .slice(0, 6);

        if (isMounted) {
          setSavedAccounts(cleaned);
        }
      } catch (err) {
        console.warn('Failed to load saved login accounts:', err);
      }
    };

    void loadSavedAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  const fetchProfileForRouting = async (
    userId: string,
    retries = 8
  ): Promise<LoginProfileSnapshot | null> => {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role_id, age, gender, address, profile_setup_completed')
        .eq('id', userId)
        .single();

      if (!error && data) {
        let roleSlug: string | undefined;
        if (data.role_id) {
          const { data: roleRow, error: roleError } = await supabase
            .from('roles')
            .select('slug')
            .eq('id', data.role_id)
            .single();

          if (roleError) {
            console.warn(`Route role fetch attempt ${attempt + 1} failed:`, roleError.message);
          } else if (typeof roleRow?.slug === 'string') {
            roleSlug = roleRow.slug;
          }
        }

        return {
          ...(data as LoginProfileSnapshot),
          roles: roleSlug ? { slug: roleSlug } : null,
        };
      }

      if (error) {
        console.warn(`Route profile fetch attempt ${attempt + 1} failed:`, error.message);
      }

      if (attempt < retries - 1) {
        await sleep(500);
      }
    }

    return null;
  };

  const routeAfterSuccessfulAuth = async (userId: string) => {
    const profile = await fetchProfileForRouting(userId);
    const { data: authUserData } = await supabase.auth.getUser();
    const userEmail = authUserData.user?.email;
    let roleSlug = resolveRoleSlugFromProfile(profile, userEmail);

    if (roleSlug !== 'Doctor') {
      const metadataRole = authUserData.user?.user_metadata?.role;
      if (typeof metadataRole === 'string') {
        const normalizedMetadataRole = metadataRole.trim().toLowerCase();
        if (normalizedMetadataRole === 'doctor') roleSlug = 'Doctor';
        if (normalizedMetadataRole === 'admin') roleSlug = 'Admin';
        if (normalizedMetadataRole === 'hospital') roleSlug = 'Hospital';
      }
    }

    if (!roleSlug) {
      router.replace('/');
      return;
    }

    if (roleSlug === 'Admin') {
      router.replace('/admin/dashboard');
      return;
    }

    if (roleSlug === 'Doctor') {
      router.replace('/doctor/dashboard');
      return;
    }

    if (roleSlug === 'Hospital') {
      router.replace('/hospital/dashboard');
      return;
    }

    if (!hasCompletedPatientSetup(profile)) {
      router.replace('/profile-setup');
      return;
    }

    router.replace('/(tabs)');
  };

  const handleGoogleLoginPress = async () => {
    if (isExpoGo) {
      setIsGoogleLoginPending(false);
      Toast.show({
        type: 'error',
        text1: 'Google Login Unsupported in Expo Go',
        text2: 'Install preview/dev-client build and try again.',
      });
      return;
    }

    if (!isNativeGooglePlatform) {
      setIsGoogleLoginPending(false);
      Toast.show({
        type: 'error',
        text1: 'Google Login Unsupported',
        text2: 'Use Android or iOS app build for Google Sign-In.',
      });
      return;
    }

    if (!googleWebClientId) {
      setIsGoogleLoginPending(false);
      Toast.show({
        type: 'error',
        text1: 'Google Setup Missing',
        text2: 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild the app.',
      });
      return;
    }

    if (!isNativeGoogleReady) {
      setIsGoogleLoginPending(false);
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
      await rememberAccount({
        user: data.user,
        provider: 'google',
      });
      await routeAfterSuccessfulAuth(data.user!.id);
    } catch (errorObj: any) {
      console.error('Google Supabase Auth Error:', errorObj);
      Toast.show({
        type: 'error',
        text1: 'Google Login Failed',
        text2: errorObj.message || 'Failed to authenticate.',
      });
    } finally {
      setIsGoogleLoginPending(false);
    }
  };

  const clearError = () => {
    if (error) setError('');
  };

  const rememberAccount = async (args: {
    user: any;
    provider: 'email' | 'google';
  }) => {
    const emailValue = typeof args.user?.email === 'string' ? args.user.email.trim().toLowerCase() : '';
    const userId = typeof args.user?.id === 'string' ? args.user.id.trim() : '';
    if (!emailValue || !userId) return;

    const metadata = (args.user?.user_metadata || {}) as Record<string, any>;
    const displayNameCandidate = [metadata.full_name, metadata.name, args.user?.email]
      .find((value) => typeof value === 'string' && value.trim().length > 0);

    const normalizedAccount: SavedAuthAccount = {
      userId,
      email: emailValue,
      displayName: typeof displayNameCandidate === 'string' ? displayNameCandidate.trim() : emailValue,
      avatarUrl:
        typeof metadata.avatar_url === 'string' && metadata.avatar_url.trim()
          ? metadata.avatar_url.trim()
          : typeof metadata.picture === 'string' && metadata.picture.trim()
            ? metadata.picture.trim()
            : null,
      provider: args.provider,
      lastUsedAt: new Date().toISOString(),
    };

    setSavedAccounts((prev) => {
      const deduped = [normalizedAccount, ...prev.filter((item) => item.email !== normalizedAccount.email)]
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
        .slice(0, 6);

      void AsyncStorage.setItem(SAVED_AUTH_ACCOUNTS_KEY, JSON.stringify(deduped)).catch((err) => {
        console.warn('Failed to persist saved login accounts:', err);
      });

      return deduped;
    });
  };

  const removeSavedAccount = (account: SavedAuthAccount) => {
    if (isAccountChooserBusy) return;
    Alert.alert(
      'Remove account',
      `Remove ${account.email} from quick account switch?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setSavedAccounts((prev) => {
              const next = prev.filter(
                (item) => !(item.email === account.email && item.userId === account.userId)
              );
              void AsyncStorage.setItem(SAVED_AUTH_ACCOUNTS_KEY, JSON.stringify(next)).catch((err) => {
                console.warn('Failed to persist updated login accounts:', err);
              });
              return next;
            });
            Toast.show({
              type: 'success',
              text1: 'Account removed',
              text2: `${account.email} removed from chooser.`,
            });
          },
        },
      ]
    );
  };

  const getInitials = (name: string) => {
    const clean = name.trim();
    if (!clean) return '?';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
  };

  const handleSelectSavedAccount = async (account: SavedAuthAccount) => {
    if (isAccountChooserBusy) return;
    setIsAccountChooserBusy(true);
    clearError();

    try {
      setEmail(account.email);
      setPassword('');
      setIsAccountChooserVisible(false);

      if (account.provider === 'google') {
        await handleGoogleLoginPress();
      } else {
        Toast.show({
          type: 'info',
          text1: 'Account selected',
          text2: `Enter password for ${account.email}`,
        });
      }
    } finally {
      setIsAccountChooserBusy(false);
    }
  };

  const validateLoginInput = (): { identifier: string; password?: string } | null => {
    if (loginMethod === 'mobile') {
      const mobileDigits = mobileNumber.replace(/\D/g, '');
      if (!mobileDigits) {
        setError('Please enter your mobile number');
        return null;
      }

      if (!/^[6-9]\d{9}$/.test(mobileDigits)) {
        setError('Please enter a valid 10-digit Indian mobile number');
        return null;
      }

      setError('');
      return { identifier: mobileDigits };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Please enter your email address');
      return null;
    }

    if (!emailRegex.test(normalizedEmail)) {
      setError('Please enter a valid email address');
      return null;
    }

    if (!password) {
      setError('Please enter your password');
      return null;
    }

    setError('');
    return { identifier: normalizedEmail, password };
  };

  const handleLogin = async () => {
    const loginPayload = validateLoginInput();
    if (!loginPayload || !loginPayload.password) return;

    if (loginMethod === 'mobile') {
      Toast.show({ type: 'error', text1: 'Not Supported', text2: 'Phone auth is disabled during Supabase migration.' });
      return;
    }

    setIsLoginPending(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginPayload.identifier,
        password: loginPayload.password
      });

      if (!error) {
      await rememberAccount({
        user: data.user,
        provider: 'email',
      });
        await routeAfterSuccessfulAuth(data.user.id);
      } else {
        Toast.show({
          type: 'error',
          text1: 'Login Failed',
          text2: error.message || 'Please check your details and try again.',
        });
      }
    } catch (errorObj: any) {
      Toast.show({
        type: 'error',
        text1: 'Login Error',
        text2: errorObj.message || 'Login failed. Please try again.',
      });
    } finally {
      setIsLoginPending(false);
    }
  };

  const handleMobileChange = (value: string) => {
    clearError();
    setMobileNumber(formatPhoneNumber(value));
  };

  const handleEmailChange = (value: string) => {
    clearError();
    setEmail(value);
  };

  const selectMethod = (method: LoginMethod) => {
    if (method === loginMethod) return;
    setLoginMethod(method);
    setError('');
  };

  const primaryActionPending = loginMethod === 'mobile' ? isPhoneOtpSending : isLoginPending;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <FormWrapper
        style={[styles.container, { backgroundColor: theme.background }]}
        {...(Platform.OS === 'ios' ? { behavior: 'padding' as const, keyboardVerticalOffset: insets.top + 4 } : {})}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            isCompact && styles.scrollContentCompact,
            { paddingBottom: Math.max(insets.bottom + 14, 14) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          bounces={false}
        >
          <View style={[styles.heroSection, isCompact ? styles.heroSectionCompact : null]}>
            <View style={[
              styles.logoWrapper, 
              isCompact ? styles.logoWrapperCompact : null, 
              { shadowColor: theme.tint }
            ]}>
              <Image
                source={require('../../assets/images/cd4_logo.png')}
                style={[
                  styles.logo, 
                  isCompact ? styles.logoCompact : null
                ]}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, isCompact && styles.titleCompact, { color: theme.text }]}>
              Welcome to the{'\n'}future of care.
            </Text>
            <Text style={[styles.subtitle, isCompact && styles.subtitleCompact, { color: theme.textSecondary }]}>
              Sign in or create your account to start your AI-assisted consultation.
            </Text>

            {/* {savedAccounts.length > 0 ? (
              <TouchableOpacity
                style={[styles.accountChooserButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                onPress={() => setIsAccountChooserVisible(true)}
                activeOpacity={0.86}
              >
                <Text style={[styles.accountChooserButtonText, { color: theme.text }]}>Choose an account</Text>
                <ChevronDown size={16} color={theme.textSecondary} />
              </TouchableOpacity>
            ) : null} */}
          </View>

          <View style={[styles.formSection, isCompact && styles.formSectionCompact]}>
            <View style={styles.emailLoginGroup}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: error && loginMethod === 'email' ? theme.badgeText : theme.borderColor,
                  },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter email"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={handleEmailChange}
                />
              </View>

              <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
              <View
                style={[
                  styles.inputWrapper,
                  {
                    backgroundColor: theme.cardBackground,
                    borderColor: error && loginMethod === 'email' ? theme.badgeText : theme.borderColor,
                  },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Enter password"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={(text) => { clearError(); setPassword(text); }}
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

              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={() => router.push('/auth/forgot-password')}
              >
                <Text style={[styles.forgotPasswordText, { color: theme.tint }]}>
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            </View>

            {error ? <Text style={[styles.errorText, { color: theme.badgeText }]}>{error}</Text> : null}

            <TouchableOpacity
              style={[
                styles.otpButton,
                isCompact && styles.otpButtonCompact,
                { backgroundColor: theme.tint, shadowColor: theme.tint },
                primaryActionPending && styles.buttonDisabled,
                { marginTop: 12 },
              ]}
              onPress={handleLogin}
              disabled={primaryActionPending}
              activeOpacity={0.85}
            >
              {primaryActionPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.otpButtonContent}>
                  <Text style={styles.otpButtonText}>Login</Text>
                  <ArrowRight size={20} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.socialSection}>
            <Text style={[styles.socialTitle, { color: theme.textSecondary }]}>or Login with</Text>

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
            {isGoogleLoginPending ? (
              <View style={styles.googleInlineStatusRow}>
                <ActivityIndicator size="small" color={theme.tint} />
                <Text style={[styles.googleInlineStatusText, { color: theme.textSecondary }]}>
                  Securing your Google sign-in...
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.footerBlock, isCompact && styles.footerBlockCompact]}>
            <TouchableOpacity
              onPress={() => router.push('/auth/signup')}
              style={styles.signupLinkButton}
              activeOpacity={0.7}
            >
              <Text style={[styles.signupLinkText, { color: theme.textSecondary }]}>
                Don't have an account?{' '}
                <Text style={[styles.signupLinkTextBold, { color: theme.tint }]}>Sign Up</Text>
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

            <Text style={[styles.termsText, isCompact && styles.termsTextCompact, { color: theme.textSecondary }]}>
              By continuing, you agree to our{' '}
              <Text style={[styles.termsUnderline, { color: theme.textSecondary }]}>Terms of Service</Text> and{' '}
              <Text style={[styles.termsUnderline, { color: theme.textSecondary }]}>Privacy Policy</Text>
            </Text>
          </View>
        </ScrollView>
        <Modal
          visible={isAccountChooserVisible}
          animationType="fade"
          transparent
          onRequestClose={() => {
            if (!isAccountChooserBusy) {
              setIsAccountChooserVisible(false);
            }
          }}
        >
          <View style={styles.accountModalBackdrop}>
            <TouchableOpacity
              style={styles.accountModalBackdropTap}
              activeOpacity={1}
              onPress={() => {
                if (!isAccountChooserBusy) {
                  setIsAccountChooserVisible(false);
                }
              }}
            />
            <View style={[styles.accountModalCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <View style={[styles.accountModalBrandIcon, { backgroundColor: theme.tint }]}>
                <Text style={styles.accountModalBrandIconText}>C</Text>
              </View>
              <Text style={[styles.accountModalTitle, { color: theme.text }]}>Choose an account</Text>
              <Text style={[styles.accountModalSubtitle, { color: theme.textSecondary }]}>to continue to CD4</Text>

              <View style={styles.accountRowsWrap}>
                {savedAccounts.map((account) => (
                  <TouchableOpacity
                    key={`${account.email}-${account.userId}`}
                    style={[styles.accountRow, { borderColor: theme.borderColor }]}
                    onPress={() => {
                      void handleSelectSavedAccount(account);
                    }}
                    activeOpacity={0.85}
                    disabled={isAccountChooserBusy || isGoogleLoginPending}
                  >
                    {account.avatarUrl ? (
                      <Image source={{ uri: account.avatarUrl }} style={styles.accountAvatar} />
                    ) : (
                      <View style={[styles.accountAvatarFallback, { backgroundColor: theme.tint + '22', borderColor: theme.tint + '55' }]}>
                        <Text style={[styles.accountAvatarFallbackText, { color: theme.tint }]}>{getInitials(account.displayName)}</Text>
                      </View>
                    )}
                    <View style={styles.accountRowInfo}>
                      <Text numberOfLines={1} style={[styles.accountName, { color: theme.text }]}>{account.displayName}</Text>
                      <Text numberOfLines={1} style={[styles.accountEmail, { color: theme.textSecondary }]}>{account.email}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.accountRemoveButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                      onPress={(event) => {
                        event.stopPropagation();
                        removeSavedAccount(account);
                      }}
                      disabled={isAccountChooserBusy || isGoogleLoginPending}
                      activeOpacity={0.8}
                    >
                      <Trash2 size={14} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.addAnotherAccountRow, { borderColor: theme.borderColor }]}
                onPress={() => {
                  if (isAccountChooserBusy || isGoogleLoginPending) return;
                  setIsAccountChooserVisible(false);
                  void handleGoogleLoginPress();
                }}
                disabled={isAccountChooserBusy || isGoogleLoginPending}
                activeOpacity={0.8}
              >
                <UserPlus size={18} color={theme.textSecondary} />
                <Text style={[styles.addAnotherAccountText, { color: theme.text }]}>Add another account</Text>
              </TouchableOpacity>

              {isAccountChooserBusy ? (
                <View style={styles.accountChooserBusyRow}>
                  <ActivityIndicator size="small" color={theme.tint} />
                  <Text style={[styles.accountChooserBusyText, { color: theme.textSecondary }]}>Switching account...</Text>
                </View>
              ) : null}
            </View>
          </View>
        </Modal>
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
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 8,
  },
  scrollContentCompact: {
    paddingBottom: 8,
    paddingTop: 4,
  },
  heroSection: {
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  heroSectionCompact: {
    marginTop: 2,
    marginBottom: 4,
  },
  logoWrapper: {
    width: 72,
    height: 72,
    minWidth: 72,
    maxWidth: 72,
    minHeight: 72,
    maxHeight: 72,
    borderRadius: 36,
    marginBottom: 6,
    backgroundColor: '#FFFFFF',
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
  logoWrapperCompact: {
    width: 64,
    height: 64,
    minWidth: 64,
    maxWidth: 64,
    minHeight: 64,
    maxHeight: 64,
    borderRadius: 32,
    marginBottom: 4,
    alignSelf: 'center',
    aspectRatio: 1,
  },
  logo: {
    width: 46,
    height: 46,
    minWidth: 46,
    maxWidth: 46,
    minHeight: 46,
    maxHeight: 46,
    aspectRatio: 1,
  },
  logoCompact: {
    width: 40,
    height: 40,
    minWidth: 40,
    maxWidth: 40,
    minHeight: 40,
    maxHeight: 40,
    aspectRatio: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center',
    marginBottom: 2,
    maxWidth: 360,
  },
  titleCompact: {
    fontSize: 24,
    lineHeight: 30,
    marginBottom: 2,
    maxWidth: 320,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 480,
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  accountChooserButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  accountChooserButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  formSection: {
    paddingTop: 2,
  },
  formSectionCompact: {
    paddingTop: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    // marginBottom: 4,
  },
  emailLoginGroup: {
    gap: 8,
  },
  input: {
    height: '100%',
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 14,
    marginTop: 8,
    marginLeft: 4,
  },
  otpButton: {
    marginTop: 10,
    borderRadius: 16,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  otpButtonCompact: {
    marginTop: 8,
    height: 48,
  },
  otpButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  otpButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  socialSection: {
    alignItems: 'center',
    marginTop: 10,
    width: '100%',
  },
  socialTitle: {
    fontSize: 13,
    marginBottom: 6,
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
  footerBlock: {
    marginTop: 20,
    paddingTop: 10,
    gap: 6,
  },
  footerBlockCompact: {
    paddingTop: 6,
    gap: 4,
  },
  signupLinkButton: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  signupLinkText: {
    fontSize: 14,
  },
  signupLinkTextBold: {
    fontWeight: '700',
  },
  doctorSection: {
    alignItems: 'center',
    width: '100%',
    gap: 8,
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
    fontSize: 12,
  },
  doctorBadgeTextBold: {
    fontWeight: '700',
  },
  termsText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: 14,
  },
  termsTextCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
  termsUnderline: {
    textDecorationLine: 'underline',
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    fontSize: 12,
    fontFamily: 'Outfit-Medium',
  },
  eyeIconContainer: {
    position: 'absolute',
    right: 14,
    height: '100%',
    justifyContent: 'center',
  },
  googleInlineStatusRow: {
    marginTop: 10,
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  googleInlineStatusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  accountModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  accountModalBackdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  accountModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  accountModalBrandIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 10,
  },
  accountModalBrandIconText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  accountModalTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  accountModalSubtitle: {
    marginTop: 6,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 14,
  },
  accountRowsWrap: {
    width: '100%',
  },
  accountRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
  },
  accountAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
  },
  accountAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarFallbackText: {
    fontSize: 14,
    fontWeight: '800',
  },
  accountRowInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 17,
    fontWeight: '600',
  },
  accountEmail: {
    fontSize: 14,
    marginTop: 1,
  },
  accountRemoveButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  addAnotherAccountRow: {
    marginTop: 2,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addAnotherAccountText: {
    fontSize: 17,
    fontWeight: '600',
  },
  accountChooserBusyRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 24,
  },
  accountChooserBusyText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default LoginScreen;
