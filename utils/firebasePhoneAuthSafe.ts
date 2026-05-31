let firebaseAuthFactory: any;

try {
  firebaseAuthFactory = require('@react-native-firebase/auth').default;
} catch (error) {
  console.warn('Firebase phone auth native module is unavailable. Use a development/client build instead of Expo Go.');
}

const unavailableErrorMessage =
  'Phone OTP is unavailable in this build. Please use a development/client build (not Expo Go).';

const buildUnavailableError = () => new Error(unavailableErrorMessage);

const getFirebaseAuthInstance = () => {
  if (!firebaseAuthFactory) {
    throw buildUnavailableError();
  }
  return firebaseAuthFactory();
};

export const toIndianE164Phone = (value: string): string => {
  const digitsOnly = value.replace(/\D/g, '');
  const normalizedDigits =
    digitsOnly.length === 12 && digitsOnly.startsWith('91') ? digitsOnly.slice(2) : digitsOnly;

  if (!/^[6-9]\d{9}$/.test(normalizedDigits)) {
    throw new Error('Please enter a valid 10-digit Indian mobile number.');
  }

  return `+91${normalizedDigits}`;
};

export const getFirebasePhoneAuthErrorMessage = (error: any): string => {
  const code = String(error?.code || '');

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Invalid phone number format.';
    case 'auth/invalid-verification-code':
      return 'Invalid OTP. Please try again.';
    case 'auth/code-expired':
      return 'OTP expired. Please request a new OTP.';
    case 'auth/session-expired':
      return 'OTP session expired. Please request a new OTP.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again after some time.';
    case 'auth/quota-exceeded':
      return 'SMS quota exceeded. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    default:
      return error?.message || 'Phone authentication failed. Please try again.';
  }
};

export const requestFirebasePhoneOTP = async (phoneNumberE164: string): Promise<{ verificationId: string }> => {
  const authInstance = getFirebaseAuthInstance();
  const confirmation = await authInstance.signInWithPhoneNumber(phoneNumberE164);
  const verificationId = confirmation?.verificationId;

  if (!verificationId) {
    throw new Error('Unable to start OTP verification. Please try again.');
  }

  return { verificationId };
};

export const verifyFirebasePhoneOTP = async (
  verificationId: string,
  otpCode: string
): Promise<{ idToken: string }> => {
  if (!firebaseAuthFactory) {
    throw buildUnavailableError();
  }

  const sanitizedOtp = otpCode.replace(/\D/g, '').slice(0, 6);
  if (sanitizedOtp.length !== 6) {
    throw new Error('Please enter a valid 6-digit OTP.');
  }

  const phoneAuthProvider = firebaseAuthFactory.PhoneAuthProvider;
  if (!phoneAuthProvider?.credential) {
    throw new Error('Phone auth provider is unavailable. Please use a development/client build.');
  }

  const authInstance = getFirebaseAuthInstance();
  const credential = phoneAuthProvider.credential(verificationId, sanitizedOtp);
  const userCredential = await authInstance.signInWithCredential(credential);
  const idToken = await userCredential.user.getIdToken(true);

  // Backend tokens are the primary auth session for this app.
  try {
    await authInstance.signOut();
  } catch {
    // Ignore sign-out failures after ID token retrieval.
  }

  if (!idToken) {
    throw new Error('Unable to verify phone OTP. Please try again.');
  }

  return { idToken };
};
