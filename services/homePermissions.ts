import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { requestLocationPermissionOnce } from './locationPermission';

const HOME_PERMISSIONS_REQUESTED_KEY = '@cd4/home_permissions_requested';

type SpeechRecognitionPermissionModule = {
  requestPermissionsAsync?: () => Promise<{ granted?: boolean }>;
};

const requestSpeechRecognitionPermission = async () => {
  try {
    const module = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule?: SpeechRecognitionPermissionModule;
    };
    await module.ExpoSpeechRecognitionModule?.requestPermissionsAsync?.();
  } catch {
    // The web build and older development clients may not include this native module.
  }
};

const requestIfNeeded = async (getPermission: () => Promise<any>, request: () => Promise<any>) => {
  try {
    const current = await getPermission();
    if (current?.status !== 'granted') {
      await request();
    }
  } catch (error) {
    if (__DEV__) console.warn('[HomePermissions] permission request failed', error);
  }
};

export const requestHomePermissionsOnce = async (): Promise<void> => {
  if (Platform.OS === 'web') return;

  const alreadyRequested = await AsyncStorage.getItem(HOME_PERMISSIONS_REQUESTED_KEY);
  if (alreadyRequested === 'true') return;

  // Set the guard first so navigating away/back cannot replay a permission chain.
  await AsyncStorage.setItem(HOME_PERMISSIONS_REQUESTED_KEY, 'true');

  await requestLocationPermissionOnce();
  await requestIfNeeded(Audio.getPermissionsAsync, Audio.requestPermissionsAsync);
  await requestSpeechRecognitionPermission();
  await requestIfNeeded(ImagePicker.getCameraPermissionsAsync, ImagePicker.requestCameraPermissionsAsync);
  await requestIfNeeded(Calendar.getCalendarPermissionsAsync, Calendar.requestCalendarPermissionsAsync);
  await requestIfNeeded(Notifications.getPermissionsAsync, Notifications.requestPermissionsAsync);
};
