import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

const LOCATION_PERMISSION_PROMPTED_KEY = '@cd4/location_permission_prompted';
const LOCATION_CITY_KEY = '@cd4/location_city';
const WEB_DEFAULT_CITY = 'Patna';

const normalizeCity = (value: string | null | undefined): string | null => {
  const city = value?.trim();
  return city ? city : null;
};

const extractCityFromGeocode = (
  addresses: Location.LocationGeocodedAddress[]
): string | null => {
  if (!addresses.length) {
    return null;
  }

  const primary = addresses[0];
  return normalizeCity(primary.city || primary.subregion || primary.region);
};

export const getStoredLocationCity = async (): Promise<string | null> => {
  const city = await AsyncStorage.getItem(LOCATION_CITY_KEY);
  const normalizedCity = normalizeCity(city);
  if (normalizedCity) {
    return normalizedCity;
  }

  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(LOCATION_CITY_KEY, WEB_DEFAULT_CITY);
    return WEB_DEFAULT_CITY;
  }

  return null;
};

export const syncLocationCityIfPermitted = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return getStoredLocationCity();
  }

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const addresses = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });

    const city = extractCityFromGeocode(addresses);
    if (city) {
      await AsyncStorage.setItem(LOCATION_CITY_KEY, city);
      return city;
    }

    await AsyncStorage.removeItem(LOCATION_CITY_KEY);
    return null;
  } catch (error) {
    console.warn('Location city sync failed:', error);
    return null;
  }
};

export const requestLocationPermissionOnce = async (): Promise<void> => {
  if (Platform.OS === 'web') {
    await getStoredLocationCity();
    return;
  }

  try {
    const alreadyPrompted = await AsyncStorage.getItem(LOCATION_PERMISSION_PROMPTED_KEY);
    if (alreadyPrompted !== 'true') {
      await Location.requestForegroundPermissionsAsync();
      await AsyncStorage.setItem(LOCATION_PERMISSION_PROMPTED_KEY, 'true');
    }

    await syncLocationCityIfPermitted();
  } catch (error) {
    console.warn('Location permission request failed:', error);
  }
};
