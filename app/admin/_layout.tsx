import React from 'react';
import { Tabs } from 'expo-router';
import Colors from '../../constants/Colors';
import { Easing, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuthContext } from '../../context/AuthContext';
import { Redirect } from 'expo-router';
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

const ADMIN_VISIBLE_TABS = ['dashboard', 'doctors', 'medicines', 'revenue', 'app-settings'] as const;

export default function AdminLayout() {
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

    // Route security: Only allow admins
    if (!isLoading) {
        if (!user) {
            return <Redirect href="/auth/login" />;
        }

        const userRole = typeof user.role === 'string'
            ? user.role.trim().toLowerCase()
            : 'patient';

        if (userRole !== 'admin') {
            return <Redirect href="/(tabs)" />;
        }
    }

    return (
        <Tabs
            detachInactiveScreens={false}
            tabBar={(props) => <SmoothTabBar {...props} visibleRouteNames={ADMIN_VISIBLE_TABS} />}
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
                tabBarItemStyle: {
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 0,
                    paddingTop: 1,
                    paddingBottom: 0,
                },
                tabBarLabelPosition: 'below-icon',
                tabBarLabelStyle: {
                    fontSize: 11,
                    lineHeight: 13,
                    fontFamily: 'Outfit-Medium',
                    includeFontPadding: false,
                    marginTop: 0,
                },
                tabBarIconStyle: {
                    marginTop: 0,
                    marginBottom: 0,
                },
            }}
        >
            <Tabs.Screen
                name="dashboard"
                options={{
                    title: 'Dashboard',
                    tabBarLabel: 'Dashboard',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="grid" inactiveName="grid-outline" />
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
                name="medicines"
                options={{
                    title: 'Medicines',
                    tabBarLabel: 'Medicines',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="flask" inactiveName="flask-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    href: null,
                    title: 'Settings',
                    tabBarLabel: 'Settings',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="settings" inactiveName="settings-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    href: null,
                    title: 'Profile',
                }}
            />
            <Tabs.Screen
                name="app-settings"
                options={{
                    title: 'App Settings',
                    tabBarLabel: 'App Settings',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="build" inactiveName="build-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="revenue"
                options={{
                    title: 'Revenue',
                    tabBarLabel: 'Revenue',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="analytics" inactiveName="analytics-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="ads"
                options={{
                    href: null,
                    title: 'Ads',
                }}
            />
            <Tabs.Screen
                name="doctor-profile"
                options={{
                    href: null,
                    title: 'Doctor Profile',
                }}
            />
            <Tabs.Screen
                name="support-tickets"
                options={{
                    href: null,
                    title: 'Support Tickets',
                }}
            />
            <Tabs.Screen
                name="doctor-revenue"
                options={{ href: null, title: 'All Doctor Revenue' }}
            />
        </Tabs>
    );
}
