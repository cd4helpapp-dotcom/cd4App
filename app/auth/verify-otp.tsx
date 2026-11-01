import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { ShieldCheck } from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { routeAfterSuccessfulAuth } from '../../src/utils/authRouting';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import AppButton from '../../ui/common/AppButton';
import AuthLayout from '../../ui/auth/AuthLayout';
import { FormErrorBanner } from '../../ui/auth/AuthParts';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

type OtpType = 'email' | 'signup' | 'recovery' | 'magiclink' | 'invite' | 'email_change';
const OTP_TYPES: OtpType[] = ['email', 'signup', 'recovery', 'magiclink', 'invite', 'email_change'];

export default function VerifyOtpScreen() {
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ email?: string; type?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const type: OtpType = OTP_TYPES.includes(params.type as OtpType) ? (params.type as OtpType) : 'email';

  const inputRef = useRef<TextInputInstance | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async (value = code) => {
    if (isVerifying) return;
    if (value.length < CODE_LENGTH) return setError(`Enter the ${CODE_LENGTH}-digit code.`);
    if (!email) return setError('Missing email address. Go back and try again.');

    setIsVerifying(true);
    setError(null);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token: value, type });
      if (verifyError) throw verifyError;
      if (data.user) await routeAfterSuccessfulAuth(data.user.id);
    } catch (err: any) {
      setError('That code is incorrect or has expired. Check the latest email and try again.');
      setCode('');
      if (__DEV__) console.warn('verifyOtp failed:', err?.message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || !email) return;
    try {
      const { error: resendError } =
        type === 'signup'
          ? await supabase.auth.resend({ type: 'signup', email })
          : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (resendError) throw resendError;
      setCooldown(RESEND_COOLDOWN_SECONDS);
      Toast.show({ type: 'success', text1: 'New code sent', text2: `Check ${email}` });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Could not resend code', text2: err?.message || 'Please try again shortly.' });
    }
  };

  const digits = code.split('');

  return (
    <AuthLayout
      title="Enter verification code"
      subtitle={email ? `We sent a ${CODE_LENGTH}-digit code to ${email}.` : `Enter the ${CODE_LENGTH}-digit code from your email.`}
      icon={<ShieldCheck size={26} color={theme.primary} />}
      showBack
    >
      <FormErrorBanner message={error} />

      {/* One hidden input drives six visual boxes; this keeps paste and SMS/email autofill working. */}
      <Pressable onPress={() => inputRef.current?.focus()} style={styles.codeRow} accessibilityLabel="Verification code">
        {Array.from({ length: CODE_LENGTH }).map((_, index) => {
          const isActive = index === Math.min(code.length, CODE_LENGTH - 1);
          return (
            <View
              key={index}
              style={[
                styles.codeBox,
                {
                  borderColor: error ? theme.danger : isActive ? theme.primary : theme.borderColor,
                  backgroundColor: theme.inputBackground,
                },
              ]}
            >
              <Text style={[Typography.title, { color: theme.text }]}>{digits[index] || ''}</Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={(value) => {
          const clean = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
          setCode(clean);
          setError(null);
          if (clean.length === CODE_LENGTH) void handleVerify(clean);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        style={styles.hiddenInput}
      />

      <AppButton title="Verify" onPress={() => handleVerify()} loading={isVerifying} />

      <Text style={[Typography.body, styles.center, { color: theme.textSecondary }]}>
        Didn't receive a code?{' '}
        {cooldown > 0 ? (
          <Text style={{ color: theme.textTertiary }}>Resend in {cooldown}s</Text>
        ) : (
          <Text style={[styles.link, { color: theme.primary }]} onPress={handleResend}>
            Resend code
          </Text>
        )}
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  link: { fontWeight: '600' },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  codeBox: {
    flex: 1,
    maxWidth: 56,
    aspectRatio: 0.9,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
