import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { ShieldCheck } from 'lucide-react-native';
import { createRedirectUrl, supabase } from '../../src/lib/supabase';
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
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; type?: string; phone?: string }>();
  const email = typeof params.email === 'string' ? params.email.trim() : '';
  const type: OtpType = OTP_TYPES.includes(params.type as OtpType) ? (params.type as OtpType) : 'email';

  const inputRef = useRef<TextInputInstance | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  const cooldownStorageKey = email ? `cd4_otp_cooldown_${email.toLowerCase()}` : null;

  useEffect(() => {
    let isMounted = true;
    if (!cooldownStorageKey) return;

    void AsyncStorage.getItem(cooldownStorageKey).then((saved) => {
      if (!isMounted) return;
      if (saved) {
        const remaining = Math.max(0, Math.ceil((Number(saved) - Date.now()) / 1000));
        setCooldown(remaining);
      } else {
        // First entry right after OTP was sent from signup or login
        const expiresAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
        void AsyncStorage.setItem(cooldownStorageKey, String(expiresAt));
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [cooldownStorageKey]);

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
      if (type === 'recovery') {
        router.replace('/auth/reset-password');
        return;
      }
      if (data?.user || data?.session) {
        const uid = data.user?.id || data.session?.user?.id || '';
        if (uid) {
          try {
            const pendingPhone = (params.phone || '').trim() ||
              (await AsyncStorage.getItem('cd4_signup_pending_phone')) ||
              (data.user?.user_metadata?.phone_number || data.user?.user_metadata?.phone || '').trim();
            if (pendingPhone) {
              await supabase.from('profiles').update({ phone_number: pendingPhone }).eq('id', uid);
              await AsyncStorage.removeItem('cd4_signup_pending_phone');
            }
          } catch (syncErr) {
            if (__DEV__) console.warn('Failed to sync phone on verify OTP:', syncErr);
          }
        }
        try {
          await routeAfterSuccessfulAuth(uid);
        } catch (routeError: any) {
          if (__DEV__) console.warn('Post-auth routing failed after successful OTP verification:', routeError);
          // Fallback gracefully so the authenticated session is not stranded on OTP screen
          Toast.show({
            type: 'success',
            text1: 'Signed in successfully',
            text2: 'Opening your dashboard...',
          });
          router.replace('/');
        }
        return;
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/network|fetch|connection/i.test(msg)) {
        setError('Network connection error. Please check your internet and try again.');
      } else if (/rate limit/i.test(msg)) {
        setError('Too many attempts. Please wait a minute before trying again.');
      } else {
        setError('That code is incorrect or has expired. Check the latest email and try again.');
      }
      if (__DEV__) console.warn('verifyOtp failed:', msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;

    if (cooldownStorageKey) {
      const saved = await AsyncStorage.getItem(cooldownStorageKey);
      const remaining = saved ? Math.max(0, Math.ceil((Number(saved) - Date.now()) / 1000)) : 0;
      if (remaining > 0) {
        setCooldown(remaining);
        return;
      }
    }

    if (cooldown > 0) return;

    try {
      const { error: resendError } =
        type === 'signup' || type === 'email_change'
          ? await supabase.auth.resend({ type, email })
          : type === 'recovery'
            ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: createRedirectUrl('auth/reset-password') })
            : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (resendError) throw resendError;

      const expiresAt = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
      if (cooldownStorageKey) {
        await AsyncStorage.setItem(cooldownStorageKey, String(expiresAt));
      }
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

      {/* Full-width interactive overlay drives six visual boxes; ensures full touch target, accessibility & autofill */}
      <View style={styles.codeContainer}>
        <View style={styles.codeRow} pointerEvents="none" accessible={false} importantForAccessibility="no">
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
        </View>
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
          accessibilityLabel="Verification code"
          style={styles.hiddenInput}
        />
      </View>

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
  codeContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'stretch',
  },
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
});
