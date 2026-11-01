import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { routeAfterSuccessfulAuth } from '../../src/utils/authRouting';
import { validateNewPassword } from '../../src/utils/validation';
import { Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAuthContext } from '../../context/AuthContext';
import AppButton from '../common/AppButton';
import FormField from '../common/FormField';
import AuthLayout from './AuthLayout';
import { FormErrorBanner, PasswordStrengthMeter } from './AuthParts';

const ResetPasswordScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { session, isLoading: isAuthLoading } = useAuthContext();
  const confirmRef = useRef<TextInputInstance | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);

  // The reset link signs the user in with a short-lived recovery session (parsed by AuthContext).
  const hasRecoverySession = Boolean(session);

  useEffect(() => {
    if (__DEV__ && !isAuthLoading && !session) console.warn('ResetPassword: no recovery session');
  }, [isAuthLoading, session]);

  const handleSave = async () => {
    if (isSaving) return;
    const next: typeof errors = {};
    const passwordError = validateNewPassword(password);
    if (passwordError) next.password = passwordError;
    if (!confirmPassword) next.confirm = 'Re-enter your new password.';
    else if (password !== confirmPassword) next.confirm = 'Passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setIsDone(true);
    } catch (err: any) {
      const message = String(err?.message || '');
      setErrors({
        form: message.toLowerCase().includes('different from the old')
          ? 'Your new password must be different from your current one.'
          : message || 'Could not update your password. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinue = async () => {
    const userId = session?.user?.id;
    if (!userId) return router.replace('/auth/login');
    setIsContinuing(true);
    try {
      await routeAfterSuccessfulAuth(userId);
    } finally {
      setIsContinuing(false);
    }
  };

  if (isAuthLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[Typography.body, { color: theme.textSecondary, marginTop: Spacing.lg }]}>Verifying your reset link…</Text>
      </View>
    );
  }

  if (isDone) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="Your password has been changed. Use it the next time you sign in."
        icon={<CheckCircle2 size={26} color={theme.success} />}
      >
        <AppButton title="Continue to CD4" onPress={handleContinue} loading={isContinuing} />
      </AuthLayout>
    );
  }

  if (!hasRecoverySession) {
    return (
      <AuthLayout
        title="Link expired"
        subtitle="This password reset link is invalid or has expired. Request a new one to continue."
        icon={<ShieldAlert size={26} color={theme.danger} />}
      >
        <AppButton title="Request a new link" onPress={() => router.replace('/auth/forgot-password')} />
        <AppButton title="Back to sign in" variant="outline" onPress={() => router.replace('/auth/login')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create a new password"
      subtitle="Choose a strong password you haven't used before."
      icon={<ShieldCheck size={26} color={theme.primary} />}
    >
      <FormErrorBanner message={errors.form} />
      <View style={styles.passwordBlock}>
        <FormField
          label="New password"
          placeholder="At least 8 characters"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrors({});
          }}
          error={errors.password}
          leftIcon={<Lock size={18} color={theme.textSecondary} />}
          isPassword
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          blurOnSubmit={false}
          autoFocus
        />
        <PasswordStrengthMeter password={password} />
      </View>
      <FormField
        ref={confirmRef}
        label="Confirm new password"
        placeholder="Re-enter password"
        value={confirmPassword}
        onChangeText={(value) => {
          setConfirmPassword(value);
          setErrors({});
        }}
        error={errors.confirm}
        leftIcon={<Lock size={18} color={theme.textSecondary} />}
        isPassword
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={handleSave}
      />
      <AppButton title="Update password" onPress={handleSave} loading={isSaving} />
    </AuthLayout>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordBlock: {
    gap: Spacing.sm,
  },
});

export default ResetPasswordScreen;
