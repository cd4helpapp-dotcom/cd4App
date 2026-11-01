import { requireOptionalNativeModule } from 'expo-modules-core';

type SpeakerRouteNative = {
  enableSpeaker(): boolean;
  reset(): boolean;
};

// Null on web and in builds made before this module existed; callers then fall back to expo-av.
const native = requireOptionalNativeModule<SpeakerRouteNative>('SpeakerRoute');

export const isSpeakerRouteAvailable = (): boolean => Boolean(native);

export const enableSpeaker = (): boolean => {
  try {
    return native?.enableSpeaker() ?? false;
  } catch {
    return false;
  }
};

export const resetSpeaker = (): boolean => {
  try {
    return native?.reset() ?? false;
  } catch {
    return false;
  }
};
