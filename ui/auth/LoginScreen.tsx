import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { Lock, Mail, Stethoscope, ChevronRight } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { routeAfterSuccessfulAuth } from '../../src/utils/authRouting';
import { isValidEmail } from '../../src/utils/validation';
import { normalizeAuthEmail } from '../../src/utils/authAvailability';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import AppButton from '../common/AppButton';
import FormField from '../common/FormField';
import AuthLayout from './AuthLayout';
import { useGoogleSignIn } from './useGoogleSignIn';
import { AuthDivider, FormErrorBanner, GoogleButton, LegalNotice } from './AuthParts';

type FieldErrors = { email?: string; password?: string; form?: string };

// Supabase returns English sentences; map the common ones to clearer, actionable copy.
const toFriendlyAuthError = (message?: string): string => {
  const text = (message || '').toLowerCase();
  if (text.includes('invalid login credentials')) return 'Incorrect email or password. Please try again.';
  if (text.includes('email not confirmed')) return 'Please verify your email first. Check your inbox for the confirmation link.';
  if (text.includes('rate limit') || text.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (text.includes('network') || text.includes('fetch')) return 'No internet connection. Check your network and try again.';
  return message || 'Unable to sign in right now. Please try again.';
};

const LoginScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const google = useGoogleSignIn();
  const passwordRef = useRef<TextInputInstance | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!isValidEmail(email)) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    return !next.email && !next.password;
  };

  const handleLogin = async () => {
    if (isSubmitting || !validate()) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeAuthEmail(email),
        password,
      });
      if (error) {
        setErrors({ form: toFriendlyAuthError(error.message) });
        return;
      }
      if (!data?.user?.id) {
        setErrors({ form: 'Unable to sign in right now. Please try again.' });
        return;
      }
      await routeAfterSuccessfulAuth(data.user.id);
    } catch (err: any) {
      setErrors({ form: toFriendlyAuthError(err?.message) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue your consultations, reports and care plan."
      footer={
        <>
          <Text style={[Typography.body, styles.centerText, { color: theme.textSecondary }]}>
            New to CD4?{' '}
            <Text style={[styles.inlineLink, { color: theme.primary }]} onPress={() => router.push('/auth/signup')}>
              Create an account
            </Text>
          </Text>

          <Pressable
            onPress={() => router.push('/doctor-register')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.doctorCard,
              { borderColor: theme.borderColor, backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground },
            ]}
          >
            <View style={[styles.doctorIcon, { backgroundColor: theme.primarySoft }]}>
              <Stethoscope size={18} color={theme.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={[Typography.bodyStrong, { color: theme.text }]}>Are you a doctor?</Text>
              <Text style={[Typography.caption, { color: theme.textSecondary }]}>Join the CD4 panel and consult online</Text>
            </View>
            <ChevronRight size={18} color={theme.textTertiary} />
          </Pressable>

          <LegalNotice prefix="By continuing, you agree to our" />
        </>
      }
    >
      <FormErrorBanner message={errors.form} />

      <FormField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (errors.email || errors.form) setErrors({});
        }}
        error={errors.email}
        leftIcon={<Mail size={18} color={theme.textSecondary} />}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />

      <View>
        <FormField
          ref={passwordRef}
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password || errors.form) setErrors({});
          }}
          error={errors.password}
          leftIcon={<Lock size={18} color={theme.textSecondary} />}
          isPassword
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />
        <Pressable
          onPress={() => router.push('/auth/forgot-password')}
          accessibilityRole="link"
          hitSlop={8}
          style={styles.forgotLink}
        >
          <Text style={[Typography.label, { color: theme.primary }]}>Forgot password?</Text>
        </Pressable>
      </View>

      <AppButton title="Sign in" onPress={handleLogin} loading={isSubmitting} />

      {google.isSupported ? (
        <>
          <AuthDivider label="or" />
          <GoogleButton title="Continue with Google" onPress={google.signIn} loading={google.isPending} />
        </>
      ) : null}
    </AuthLayout>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centerText: { textAlign: 'center' },
  inlineLink: { fontWeight: '600' },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: Spacing.sm + 2,
  },
  doctorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md + 2,
  },
  doctorIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LoginScreen;
