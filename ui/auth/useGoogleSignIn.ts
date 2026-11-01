import { useCallback, useEffect, useState } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Toast from 'react-native-toast-message';
import { supabase } from '../../src/lib/supabase';
import {
  configureNativeGoogleSignin,
  isGoogleDeveloperError,
  isGooglePlayServicesUnavailable,
  isGoogleSigninBusy,
  isGoogleSigninCancelled,
  isNativeGooglePlatform,
  signInWithNativeGoogle,
} from '../../utils/googleNativeAuth';
import { routeAfterSuccessfulAuth } from '../../src/utils/authRouting';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Google sign-in uses the native SDK, so it is only offered on Android/iOS builds (not web or Expo Go).
export const isGoogleSignInSupported = isNativeGooglePlatform && !isExpoGo && Boolean(googleWebClientId);

export function useGoogleSignIn() {
  const [isReady, setIsReady] = useState(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!isGoogleSignInSupported) return;
    const result = configureNativeGoogleSignin({ webClientId: googleWebClientId, iosClientId: googleIosClientId });
    if (!result.ok && __DEV__) console.warn('Native Google Sign-In configuration failed:', result.error);
    setIsReady(result.ok);
  }, []);

  const signIn = useCallback(async () => {
    if (!isGoogleSignInSupported || !isReady) {
      Toast.show({
        type: 'error',
        text1: 'Google sign-in unavailable',
        text2: 'Please sign in with your email and password.',
      });
      return;
    }

    setIsPending(true);
    try {
      const { idToken } = await signInWithNativeGoogle({ forceAccountSelection: true });
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (error) throw error;
      if (!data.user) throw new Error('No user returned from Google sign-in.');
      await routeAfterSuccessfulAuth(data.user.id);
    } catch (err: any) {
      if (isGoogleSigninCancelled(err)) return;

      if (isGoogleSigninBusy(err)) {
        Toast.show({ type: 'info', text1: 'Sign-in in progress', text2: 'Please wait a moment and try again.' });
        return;
      }

      if (isGooglePlayServicesUnavailable(err)) {
        Toast.show({
          type: 'error',
          text1: 'Google Play Services required',
          text2: 'Update Google Play Services and try again.',
        });
        return;
      }

      if (__DEV__) console.warn('Google sign-in error:', err);
      Toast.show({
        type: 'error',
        text1: 'Google sign-in failed',
        text2:
          __DEV__ && isGoogleDeveloperError(err)
            ? 'OAuth config error — check SHA fingerprints and client IDs.'
            : 'Something went wrong. Please try again or use email.',
      });
    } finally {
      setIsPending(false);
    }
  }, [isReady]);

  return { isSupported: isGoogleSignInSupported, isPending, signIn };
}
