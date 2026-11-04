import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Lock, Mail, MailCheck } from 'lucide-react-native';
import { supabase, createRedirectUrl } from '../../src/lib/supabase';
import { routeAfterSuccessfulAuth } from '../../src/utils/authRouting';
import {
  checkEmailRegistrationStatus,
  getEmailAlreadyRegisteredMessage,
  isExistingEmailSignupResult,
  normalizeAuthEmail,
} from '../../src/utils/authAvailability';
import {
  isValidEmail,
  isValidIndianMobile,
  normalizeIndianMobile,
  validateNewPassword,
  validatePersonName,
} from '../../src/utils/validation';
import { Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import AppButton from '../common/AppButton';
import FormField from '../common/FormField';
import AuthLayout from './AuthLayout';
import { useGoogleSignIn } from './useGoogleSignIn';
import { AuthDivider, FormErrorBanner, GoogleButton, LegalNotice, PasswordStrengthMeter } from './AuthParts';

type Form = { firstName: string; lastName: string; email: string; phone: string; password: string };
type Errors = Partial<Record<keyof Form | 'form', string>>;

const SignupScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const google = useGoogleSignIn();
  const lastNameRef = useRef<TextInputInstance | null>(null);
  const emailRef = useRef<TextInputInstance | null>(null);
  const phoneRef = useRef<TextInputInstance | null>(null);
  const passwordRef = useRef<TextInputInstance | null>(null);

  const [form, setForm] = useState<Form>({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  const update = (field: keyof Form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field] || errors.form) setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    const firstNameError = validatePersonName(form.firstName, 'First name');
    const lastNameError = validatePersonName(form.lastName, 'Last name');
    if (firstNameError) next.firstName = firstNameError;
    if (lastNameError) next.lastName = lastNameError;
    if (!form.email.trim()) next.email = 'Enter your email address.';
    else if (!isValidEmail(form.email)) next.email = 'Enter a valid email address.';
    if (!form.phone.trim()) next.phone = 'Enter your mobile number.';
    else if (!isValidIndianMobile(form.phone)) next.phone = 'Enter a valid 10-digit Indian mobile number.';
    const passwordError = validateNewPassword(form.password);
    if (passwordError) next.password = passwordError;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSignup = async () => {
    if (isSubmitting || !validate()) return;
    setIsSubmitting(true);

    try {
      const email = normalizeAuthEmail(form.email);
      const phone = normalizeIndianMobile(form.phone);

      const existing = await checkEmailRegistrationStatus(email);
      if (existing?.exists) {
        setErrors({ email: getEmailAlreadyRegisteredMessage(existing.role) });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: createRedirectUrl('auth/login'),
          data: {
            first_name: form.firstName.trim(),
            last_name: form.lastName.trim(),
            phone_number: phone,
            phone,
          },
        },
      });

      if (error) {
        setErrors({ form: error.message || 'Unable to create your account. Please try again.' });
        return;
      }

      if (isExistingEmailSignupResult(data)) {
        setErrors({ email: getEmailAlreadyRegisteredMessage() });
        return;
      }

      // Email confirmation disabled in Supabase → a session is returned and the user can continue directly.
      if (data.session && data.user) {
        await routeAfterSuccessfulAuth(data.user.id);
        return;
      }

      // Route directly to the 6-digit OTP verification screen so user never gets stuck on external links
      router.push({
        pathname: '/auth/verify-otp',
        params: { email, type: 'signup' },
      });
    } catch (err: any) {
      setErrors({ form: err?.message || 'Unable to create your account. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    const email = normalizeAuthEmail(pendingVerificationEmail || '');
    if (!email || isResending) return;
    setIsResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: createRedirectUrl('auth/login') },
      });
      if (error) throw error;
      Toast.show({ type: 'success', text1: 'Verification email sent', text2: 'Check your inbox and spam folder.' });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Could not resend email', text2: err?.message || 'Please try again shortly.' });
    } finally {
      setIsResending(false);
    }
  };

  if (pendingVerificationEmail) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle={`We sent a verification link to ${pendingVerificationEmail}. Open it to activate your account, then sign in.`}
        icon={<MailCheck size={26} color={theme.primary} />}
        showBack
        onBack={() => setPendingVerificationEmail(null)}
      >
        <AppButton title="Go to sign in" onPress={() => router.replace('/auth/login')} />
        <AppButton title="Resend verification email" variant="outline" onPress={handleResend} loading={isResending} />
        <Text style={[Typography.caption, styles.centerText, { color: theme.textSecondary }]}>
          Didn't get it? Check your spam folder or wait a minute before resending.
        </Text>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Get AI-guided health support and consult verified doctors."
      footer={
        <>
          <Text style={[Typography.body, styles.centerText, { color: theme.textSecondary }]}>
            Already have an account?{' '}
            <Text style={[styles.inlineLink, { color: theme.primary }]} onPress={() => router.replace('/auth/login')}>
              Sign in
            </Text>
          </Text>
          <LegalNotice prefix="By creating an account, you agree to our" />
        </>
      }
    >
      <FormErrorBanner message={errors.form} />

      <View style={styles.nameRow}>
        <FormField
          containerStyle={styles.flex}
          label="First name"
          placeholder="Aarav"
          value={form.firstName}
          onChangeText={(value) => update('firstName', value)}
          error={errors.firstName}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => lastNameRef.current?.focus()}
          blurOnSubmit={false}
        />
        <FormField
          ref={lastNameRef}
          containerStyle={styles.flex}
          label="Last name"
          placeholder="Sharma"
          value={form.lastName}
          onChangeText={(value) => update('lastName', value)}
          error={errors.lastName}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          blurOnSubmit={false}
        />
      </View>

      <FormField
        ref={emailRef}
        label="Email"
        placeholder="you@example.com"
        value={form.email}
        onChangeText={(value) => update('email', value)}
        error={errors.email}
        leftIcon={<Mail size={18} color={theme.textSecondary} />}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
        blurOnSubmit={false}
      />

      <FormField
        ref={phoneRef}
        label="Mobile number"
        placeholder="98765 43210"
        prefix="+91"
        value={form.phone}
        onChangeText={(value) => update('phone', value.replace(/[^\d ]/g, '').slice(0, 11))}
        error={errors.phone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />

      <View style={styles.passwordBlock}>
        <FormField
          ref={passwordRef}
          label="Password"
          placeholder="At least 8 characters"
          value={form.password}
          onChangeText={(value) => update('password', value)}
          error={errors.password}
          hint={!form.password ? 'Use 8+ characters with letters and numbers.' : undefined}
          leftIcon={<Lock size={18} color={theme.textSecondary} />}
          isPassword
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleSignup}
        />
        <PasswordStrengthMeter password={form.password} />
      </View>

      <AppButton title="Create account" onPress={handleSignup} loading={isSubmitting} />

      {google.isSupported ? (
        <>
          <AuthDivider label="or" />
          <GoogleButton title="Sign up with Google" onPress={google.signIn} loading={google.isPending} />
        </>
      ) : null}
    </AuthLayout>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centerText: { textAlign: 'center' },
  inlineLink: { fontWeight: '600' },
  nameRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  passwordBlock: {
    gap: Spacing.sm,
  },
});

export default SignupScreen;
