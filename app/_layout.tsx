import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState, useCallback } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import AnimatedSplash from '../ui/AnimatedSplash';
import { AppModeProvider } from '../context/AppModeContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '../providers/QueryProvider';
import { AuthProvider } from '../context/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import Toast from 'react-native-toast-message';
import { requestLocationPermissionOnce } from '../services/locationPermission';
import GlobalCallObserver from '../components/GlobalCallObserver';
import { CallProvider } from '../context/CallContext';
import OngoingCallBanner from '../components/OngoingCallBanner';
import GlobalCallPiP from '../components/GlobalCallPiP';
import { ThemePreferenceProvider } from '../context/ThemePreferenceContext';
import { AppLanguageProvider } from '../context/AppLanguageContext';
import { AppErrorBoundary } from '../components/AppErrorBoundary';

// Handler for Push Notifications - placed inside AuthProvider
function PushNotificationHandler({ children }: { children: React.ReactNode }) {
  usePushNotifications();
  return <>{children}</>;
}

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [splashAnimationFinished, setSplashAnimationFinished] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load fonts or other assets here
      } catch (e) {
        console.warn(e);
      } finally {
        setAppReady(true);
      }
    }
    prepare();
  }, []);

  useEffect(() => {
    if (appReady) {
      void requestLocationPermissionOnce();
    }
  }, [appReady]);


  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await SplashScreen.hideAsync();
    }
  }, [appReady]);

  if (!appReady) {
    return null;
  }

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryProvider>
          <AuthProvider>
            <AppLanguageProvider>
              <ThemePreferenceProvider>
                <PushNotificationHandler>
                  <CallProvider>
                    <AppModeProvider>
                      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
                        {!splashAnimationFinished && (
                          <AnimatedSplash
                            onAnimationFinish={() => setSplashAnimationFinished(true)}
                          />
                        )}
                        <StatusBar style="auto" />
                        <Stack screenOptions={{ headerShown: false }}>
                          <Stack.Screen name="index" />
                          <Stack.Screen name="auth/login" />
                          <Stack.Screen name="auth/signup" />
                          <Stack.Screen name="auth/verify-otp" />
                          <Stack.Screen name="oauthredirect" />
                          <Stack.Screen name="profile-setup" />
                          <Stack.Screen name="ai-guidance" />
                          <Stack.Screen name="upgrade-pro" />
                          <Stack.Screen name="confirm-consultation" />
                          <Stack.Screen name="report-assistant" />
                          <Stack.Screen name="community/post/[postId]" />
                          <Stack.Screen name="doctor-recruitment" options={{ presentation: 'modal', headerShown: false }} />
                          <Stack.Screen name="doctor-register" options={{ headerShown: false }} />
                          <Stack.Screen name="(tabs)" />
                        </Stack>
                        <Toast />
                        <GlobalCallObserver />
                        <OngoingCallBanner />
                        <GlobalCallPiP />
                      </View>
                    </AppModeProvider>
                  </CallProvider>
                </PushNotificationHandler>
              </ThemePreferenceProvider>
            </AppLanguageProvider>
          </AuthProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
