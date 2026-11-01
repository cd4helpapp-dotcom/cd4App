import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { KeyRound, Mail, MailCheck } from 'lucide-react-native';
import { supabase, createRedirectUrl } from '../../src/lib/supabase';
import { normalizeAuthEmail } from '../../src/utils/authAvailability';
import { isValidEmail } from '../../src/utils/validation';
import { Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import AppButton from '../common/AppButton';
import FormField from '../common/FormField';
import AuthLayout from './AuthLayout';
import { FormErrorBanner } from './AuthParts';

const RESEND_COOLDOWN_SECONDS = 60;

const ForgotPasswordScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendResetLink = async (target: string) => {
    setIsLoading(true);
    setFormError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: createRedirectUrl('auth/reset-password'),
      });
      if (error) throw error;
      setSentTo(target);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      return true;
    } catch (err: any) {
      const message = String(err?.message || '').toLowerCase().includes('rate limit')
        ? 'Too many requests. Please wait a minute and try again.'
        : err?.message || 'Could not send the reset link. Please try again.';
      setFormError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!email.trim()) return setEmailError('Enter your email address.');
    if (!isValidEmail(email)) return setEmailError('Enter a valid email address.');
    await sendResetLink(normalizeAuthEmail(email));
  };

  const handleResend = async () => {
    if (!sentTo || cooldown > 0) return;
    const ok = await sendResetLink(sentTo);
    if (ok) Toast.show({ type: 'success', text1: 'Reset link sent again' });
  };

  if (sentTo) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`If an account exists for ${sentTo}, you'll receive a link to reset your password.`}
        icon={<MailCheck size={26} color={theme.primary} />}
        showBack
      >
        <FormErrorBanner message={formError} />
        <AppButton title="Back to sign in" onPress={() => router.replace('/auth/login')} />
        <AppButton
          title={cooldown > 0 ? `Resend link in ${cooldown}s` : 'Resend link'}
          variant="outline"
          onPress={handleResend}
          disabled={cooldown > 0}
          loading={isLoading}
        />
        <Text style={[Typography.caption, styles.center, { color: theme.textSecondary }]}>
          The link expires in 1 hour. Check your spam folder if you don't see it.
        </Text>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email linked to your account and we'll send you a secure reset link."
      icon={<KeyRound size={26} color={theme.primary} />}
      showBack
    >
      <FormErrorBanner message={formError} />
      <FormField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setEmailError(null);
          setFormError(null);
        }}
        error={emailError}
        leftIcon={<Mail size={18} color={theme.textSecondary} />}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={handleSubmit}
        autoFocus
      />
      <AppButton title="Send reset link" onPress={handleSubmit} loading={isLoading} />
    </AuthLayout>
  );
};

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});

export default ForgotPasswordScreen;
