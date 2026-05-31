import { Platform } from 'react-native';
import { GoogleSignin, statusCodes } from './googleSigninSafe';

type ConfigureNativeGoogleParams = {
  webClientId?: string;
  iosClientId?: string;
};

let configuredKey = '';

const normalizeCode = (error: any): string => {
  if (typeof error?.code === 'string' && error.code.trim().length > 0) {
    return error.code.trim();
  }
  if (typeof error?.code === 'number') {
    return String(error.code);
  }
  if (typeof error?.status === 'number') {
    return String(error.status);
  }
  return '';
};

const messageIncludes = (error: any, value: string) => {
  const message = typeof error?.message === 'string' ? error.message.toUpperCase() : '';
  return message.includes(value.toUpperCase());
};

export const isNativeGooglePlatform = Platform.OS === 'android' || Platform.OS === 'ios';

export const configureNativeGoogleSignin = ({
  webClientId,
  iosClientId,
}: ConfigureNativeGoogleParams): { ok: boolean; error?: string } => {
  if (!isNativeGooglePlatform) {
    return { ok: false, error: 'Native Google Sign-In is only available on Android/iOS.' };
  }

  const cleanWebClientId = webClientId?.trim();
  const cleanIosClientId = iosClientId?.trim();

  if (!cleanWebClientId) {
    return { ok: false, error: 'Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.' };
  }

  const nextKey = `${cleanWebClientId}|${cleanIosClientId ?? ''}`;
  if (configuredKey === nextKey) {
    return { ok: true };
  }

  GoogleSignin.configure({
    webClientId: cleanWebClientId,
    iosClientId: cleanIosClientId || undefined,
    scopes: ['openid', 'profile', 'email'],
  });

  configuredKey = nextKey;
  return { ok: true };
};

export const signInWithNativeGoogle = async ({
  forceAccountSelection = true,
}: {
  forceAccountSelection?: boolean;
} = {}): Promise<{ idToken: string }> => {
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  if (forceAccountSelection) {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Ignore sign-out failures when no prior Google session exists on device.
    }
  }

  const userInfo = await GoogleSignin.signIn();
  let idToken = typeof userInfo?.idToken === 'string' ? userInfo.idToken.trim() : '';

  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = typeof tokens?.idToken === 'string' ? tokens.idToken.trim() : '';
  }

  if (!idToken) {
    throw new Error(
      'Google did not return an ID token. Verify the Web OAuth client ID and Google Cloud SHA fingerprints.'
    );
  }

  return { idToken };
};

export const isGoogleSigninCancelled = (error: any): boolean => {
  const code = normalizeCode(error);
  return code === statusCodes.SIGN_IN_CANCELLED;
};

export const isGoogleSigninBusy = (error: any): boolean => {
  const code = normalizeCode(error);
  return code === statusCodes.IN_PROGRESS;
};

export const isGooglePlayServicesUnavailable = (error: any): boolean => {
  const code = normalizeCode(error);
  return code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE;
};

export const isGoogleDeveloperError = (error: any): boolean => {
  const code = normalizeCode(error).toUpperCase();

  return (
    code === '10' ||
    code.includes('DEVELOPER_ERROR') ||
    messageIncludes(error, 'DEVELOPER_ERROR') ||
    messageIncludes(error, 'CODE 10')
  );
};
