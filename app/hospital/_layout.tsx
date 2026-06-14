import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Easing, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { useAuthContext } from '../../context/AuthContext';
import RouteLoadingScreen from '../../ui/common/RouteLoadingScreen';
import SmoothTabBar from '../../ui/navigation/SmoothTabBar';

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

const HOSPITAL_VISIBLE_TABS = ['dashboard', 'stats', 'doctors', 'patients', 'settings'] as const;

export default function HospitalLayout() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const { user, isLoading, isProfileResolved } = useAuthContext();
    const TAB_BAR_BASE_HEIGHT = 58;
    const TAB_SLIDE_DISTANCE = Math.min(76, Math.max(42, windowWidth * 0.16));

    if (isLoading || !isProfileResolved) {
        return <RouteLoadingScreen />;
    }

    if (!user) {
        return <Redirect href="/auth/login" />;
    }

    const roleSlug = typeof user.role === 'string' ? user.role.trim().toLowerCase() : 'patient';
    if (roleSlug !== 'hospital') {
        if (roleSlug === 'admin') return <Redirect href="/admin/dashboard" />;
        if (roleSlug === 'doctor') return <Redirect href="/doctor/dashboard" />;
        return <Redirect href="/(tabs)" />;
    }

    return (
        <Tabs
            detachInactiveScreens={false}
            tabBar={(props) => <SmoothTabBar {...props} visibleRouteNames={HOSPITAL_VISIBLE_TABS} />}
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
                headerShown: false,
                tabBarShowLabel: true,
                tabBarStyle: {
                    backgroundColor: theme.background,
                    borderTopColor: theme.borderColor,
                    height: TAB_BAR_BASE_HEIGHT + insets.bottom,
                    paddingBottom: Math.max(insets.bottom, 2),
                    paddingTop: 2,
                },
                tabBarActiveTintColor: theme.tint,
                tabBarInactiveTintColor: theme.tabIconDefault,
                tabBarLabelPosition: 'below-icon',
                tabBarLabelStyle: {
                    fontSize: 10,
                    lineHeight: 12,
                    includeFontPadding: false,
                    marginTop: 1,
                    letterSpacing: 0,
                },
            }}
        >
            <Tabs.Screen
                name="dashboard"
                options={{
                    title: 'Hospital',
                    tabBarLabel: 'Home',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="home" inactiveName="home-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="stats"
                options={{
                    title: 'Stats',
                    tabBarLabel: 'Stats',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="stats-chart" inactiveName="stats-chart-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="doctors"
                options={{
                    title: 'Doctors',
                    tabBarLabel: 'Doctors',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="medkit" inactiveName="medkit-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="patients"
                options={{
                    title: 'Patients',
                    tabBarLabel: 'Patients',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="people" inactiveName="people-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="voice-intake"
                options={{
                    href: null,
                    title: 'Voice Intake',
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Profile',
                    tabBarLabel: 'Profile',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="person" inactiveName="person-outline" />
                    ),
                }}
            />
            <Tabs.Screen name="voice-intake-report" options={{ href: null, title: 'AI Intake PDF' }} />
        </Tabs>
    );
}
