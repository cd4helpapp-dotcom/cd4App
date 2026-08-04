import React from 'react';
import { Tabs } from 'expo-router';
import { Easing, useColorScheme, useWindowDimensions, Platform, StatusBar as NativeStatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import Colors from '../../constants/Colors';
import { User } from 'lucide-react-native';
import { useAppMode } from '../../context/AppModeContext';
import AuthGuard from '../../ui/auth/AuthGuard';
import { Redirect } from 'expo-router';
import { useAuthContext } from '../../context/AuthContext';
import { needsPatientProfileSetup } from '../../utils/profileSetup';
import { prefetchChatRooms } from '../../hooks/useChat';
import GlobalHeader from '../../ui/layout/GlobalHeader';
import { useAppLanguage } from '../../context/AppLanguageContext';
import RouteLoadingScreen from '../../ui/common/RouteLoadingScreen';
import SmoothTabBar from '../../ui/navigation/SmoothTabBar';

function TabIcon({ Icon, color }: { Icon: any; color: string }) {
  return <Icon size={22} color={color} />;
}

function ModernTabIcon({
  focused,
  color,
  activeName,
  inactiveName,
}: {
  focused: boolean;
  color: string;
  activeName: React.ComponentProps<typeof Ionicons>['name'];
  inactiveName: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return <Ionicons name={focused ? activeName : inactiveName} size={22} color={color} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { mode } = useAppMode();
  const { user, session, isLoading, isProfileResolved, isProfileLoadedFromDb } = useAuthContext();
  const { t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const TAB_BAR_BASE_HEIGHT = 58;
  const topInset = Platform.OS === 'android'
    ? Math.max(insets.top, NativeStatusBar.currentHeight || 24)
    : insets.top;
  const GLOBAL_HEADER_HEIGHT = Math.max(topInset + 58, 72);
  const TAB_SLIDE_DISTANCE = Math.min(76, Math.max(42, windowWidth * 0.16));
  const visiblePatientTabs = React.useMemo(
    () =>
      mode === 'teleconsultation'
        ? ['index', 'appointments', 'records', 'chat', 'community']
        : ['index', 'daily-engine', 'food-log', 'community'],
    [mode]
  );
  const metadataRole = typeof session?.user?.user_metadata?.role === 'string'
    ? session.user.user_metadata.role
    : '';
  const roleSlug = user?.role
    ? String(user.role).toLowerCase().trim()
    : String(metadataRole || 'patient').toLowerCase().trim();

  React.useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void prefetchChatRooms(queryClient, user.id).catch(() => { });
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryClient, user?.id]);

  if (isLoading || (user && !isProfileResolved)) {
    return <RouteLoadingScreen />;
  }

  if (user && roleSlug === 'doctor') {
    return <Redirect href="/doctor/dashboard" />;
  }

  if (user && roleSlug === 'admin') {
    return <Redirect href="/admin/dashboard" />;
  }

  if (user && roleSlug === 'hospital') {
    return <Redirect href="/hospital/dashboard" />;
  }

  if (isProfileResolved && isProfileLoadedFromDb && user && needsPatientProfileSetup(user)) {
    return <Redirect href="/profile-setup" />;
  }

  return (
    <AuthGuard fallback={<Redirect href="/auth/login" />}>
      <Tabs
        detachInactiveScreens={false}
        tabBar={(props) => <SmoothTabBar {...props} visibleRouteNames={visiblePatientTabs} />}
        screenOptions={{
          animation: 'shift',
          lazy: true,
          freezeOnBlur: true,
          transitionSpec: {
            animation: 'timing',
            config: {
              duration: 210,
              easing: Easing.out(Easing.quad),
            },
          },
          sceneStyleInterpolator: ({ current }) => ({
            sceneStyle: {
              opacity: current.progress.interpolate({
                inputRange: [-1, -0.35, 0, 0.35, 1],
                outputRange: [0.86, 0.96, 1, 0.96, 0.86],
              }),
              transform: [
                {
                  translateX: current.progress.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [-TAB_SLIDE_DISTANCE, 0, TAB_SLIDE_DISTANCE],
                  }),
                },
              ],
            },
          }),
          sceneStyle: {
            backgroundColor: theme.background,
          },
          tabBarActiveTintColor: theme.tint,
          tabBarInactiveTintColor: theme.tabIconDefault,
          tabBarShowLabel: true,
          tabBarStyle: {
            backgroundColor: theme.background,
            borderTopColor: theme.borderColor,
            height: TAB_BAR_BASE_HEIGHT + insets.bottom + 4,
            paddingBottom: Math.max(insets.bottom, 4),
            paddingTop: 4,
          },
          tabBarItemStyle: {
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 0,
            paddingHorizontal: 0,
            paddingTop: 2,
            paddingBottom: 1,
          },
          tabBarLabelPosition: 'below-icon',
          tabBarLabelStyle: {
            fontSize: 10,
            lineHeight: 12,
            includeFontPadding: false,
            marginTop: 1,
            letterSpacing: 0,
          },
          tabBarIconStyle: {
            marginTop: 1,
            marginBottom: 0,
          },
          tabBarHideOnKeyboard: false,
          header: () => <GlobalHeader />,
          headerShown: true,
          headerStatusBarHeight: 0,
          headerShadowVisible: false,
          headerStyle: {
            height: GLOBAL_HEADER_HEIGHT,
            backgroundColor: theme.background,
          },
        }}>

        {/* 1. Home */}
        <Tabs.Screen
          name="index"
          options={{
            title: mode === 'teleconsultation' ? t('tab.consult') : t('tab.dashboard'),
            tabBarLabel: t('tab.home'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="home"
                inactiveName="home-outline"
              />
            ),
          }}
        />

        {/* 2. Daily Engine / Appointments */}
        <Tabs.Screen
          name="daily-engine"
          options={{
            href: mode === 'teleconsultation' ? null : '/daily-engine',
            title: 'Daily Engine',
            tabBarLabel: t('tab.daily'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="pulse"
                inactiveName="pulse-outline"
              />
            ),
          }}
        />
        <Tabs.Screen
          name="appointments"
          options={{
            href: mode === 'reversal' ? null : '/appointments',
            title: t('tab.appointments'),
            tabBarLabel: t('tab.appointments'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="calendar"
                inactiveName="calendar-outline"
              />
            ),
          }}
        />

        {/* 3. Food Log / Records */}
        <Tabs.Screen
          name="food-log"
          options={{
            href: mode === 'teleconsultation' ? null : '/food-log',
            title: 'Food Log',
            tabBarLabel: t('tab.food'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="restaurant"
                inactiveName="restaurant-outline"
              />
            ),
          }}
        />
        <Tabs.Screen
          name="records"
          options={{
            href: mode === 'reversal' ? null : '/records',
            title: t('tab.reports'),
            tabBarLabel: t('tab.reports'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="document-text"
                inactiveName="document-text-outline"
              />
            ),
          }}
        />

        {/* 4. Chat — NO GlobalHeader here */}
        <Tabs.Screen
          name="chat"
          options={{
            headerShown: false,
            href: mode === 'reversal' ? null : '/chat',
            title: t('tab.chat'),
            tabBarLabel: t('tab.chat'),
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="chatbubble"
                inactiveName="chatbubble-outline"
              />
            ),
          }}
        />

        {/* 5. Community */}
        <Tabs.Screen
          name="community"
          options={{
            href: '/community',
            title: t('tab.community'),
            tabBarLabel: t('tab.community'),
            tabBarHideOnKeyboard: true,
            tabBarIcon: ({ color, focused }) => (
              <ModernTabIcon
                focused={focused}
                color={color}
                activeName="people"
                inactiveName="people-outline"
              />
            ),
          }}
        />

        {/* 6. Profile - Hidden from Tab Bar */}
        <Tabs.Screen
          name="profile"
          options={{
            href: null, // Hides the tab
            title: t('tab.profile'),
            tabBarIcon: ({ color }) => (
              <TabIcon Icon={User} color={color} />
            ),
          }}
        />

        {/* Profile Details - Hidden from Tab Bar but accessible */}
        <Tabs.Screen
          name="profile-details"
          options={{
            href: null,
            headerShown: false,
          }}
        />

        {/* 7. Settings (kept routable, hidden from patient tab bar) */}
        <Tabs.Screen
          name="settings"
          options={{
            href: null,
            title: t('tab.settings'),
            tabBarLabel: t('tab.settings'),
          }}
        />
      </Tabs>
    </AuthGuard>
  );
}
