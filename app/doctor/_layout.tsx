import { Tabs } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Easing, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '../../context/AuthContext';
import { Redirect } from 'expo-router';
import { prefetchChatRooms } from '../../hooks/useChat';
import { useDoctorProfile } from '../../hooks/useDoctor';
import { needsDoctorProfileSetup } from '../../utils/profileSetup';
import { usePathname } from 'expo-router';
import GlobalHeader from '../../ui/layout/GlobalHeader';
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

const DOCTOR_VISIBLE_TABS = ['dashboard', 'slots', 'chats', 'community', 'patients'] as const;

export default function DoctorTabLayout() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { user, isLoading, isProfileResolved } = useAuthContext();
    const { data: doctorProfileResponse, isLoading: doctorProfileLoading } = useDoctorProfile();
    const queryClient = useQueryClient();
    const pathname = usePathname();

    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const TAB_BAR_BASE_HEIGHT = 58;
    const TAB_SLIDE_DISTANCE = Math.min(76, Math.max(42, windowWidth * 0.16));

    React.useEffect(() => {
        if (!user?.id) return;
        void prefetchChatRooms(queryClient, user.id).catch(() => { });
    }, [queryClient, user?.id]);

    if (isLoading || !isProfileResolved) {
        return <RouteLoadingScreen />;
    }

    // Route security: Only allow doctors
    if (!isLoading) {
        if (!user) {
            return <Redirect href="/auth/login" />;
        }

        const userRole = typeof user.role === 'string'
            ? user.role.trim().toLowerCase()
            : 'patient';

        if (userRole !== 'doctor') {
            return <Redirect href="/(tabs)" />;
        }

        const isCompletingProfile = pathname === '/doctor/complete-profile';
        const doctorProfile = doctorProfileResponse?.data || null;
        const shouldCompleteDoctorProfile = !doctorProfileLoading && needsDoctorProfileSetup(user, doctorProfile);

        if (doctorProfileLoading) {
            return (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
                    <ActivityIndicator size="large" color={theme.tint} />
                </View>
            );
        }

        if (shouldCompleteDoctorProfile && !isCompletingProfile) {
            return <Redirect href="/doctor/complete-profile" />;
        }

        if (!shouldCompleteDoctorProfile && isCompletingProfile) {
            return <Redirect href="/doctor/dashboard" />;
        }
    }

    return (
        <Tabs
            detachInactiveScreens={false}
            tabBar={(props) => <SmoothTabBar {...props} visibleRouteNames={DOCTOR_VISIBLE_TABS} />}
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
                tabBarHideOnKeyboard: false, header: () => <GlobalHeader />, headerShown: true,
            }}
        >
            <Tabs.Screen
                name="dashboard"
                options={{
                    title: 'Dashboard',
                    tabBarLabel: 'Home',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="home" inactiveName="home-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="slots"
                options={{
                    title: 'Slots',
                    tabBarLabel: 'Slots',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="calendar" inactiveName="calendar-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="chats"
                options={{
                    headerShown: false,
                    title: 'Chats',
                    tabBarLabel: 'Chats',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="chatbubble" inactiveName="chatbubble-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="community"
                options={{
                    title: 'Community',
                    tabBarLabel: 'Community',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="people" inactiveName="people-outline" />
                    ),
                }}
            />
            <Tabs.Screen
                name="patients"
                options={{
                    title: 'Patients',
                    tabBarLabel: 'Patients',
                    tabBarIcon: ({ color, focused }) => (
                        <ModernTabIcon focused={focused} color={color} activeName="person-circle" inactiveName="person-circle-outline" />
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
            {/* Hidden screens */}
            <Tabs.Screen name="help" options={{ href: null }} />
            <Tabs.Screen name="appearance" options={{ href: null }} />
            <Tabs.Screen name="language" options={{ href: null }} />
            <Tabs.Screen name="notifications" options={{ href: null }} />
            <Tabs.Screen name="profile-details" options={{ href: null }} />
            <Tabs.Screen name="storage" options={{ href: null }} />
            <Tabs.Screen
                name="profile/fees"
                options={{
                    href: null,
                }}
            />
            <Tabs.Screen
                name="profile/clinic"
                options={{
                    href: null,
                }}
            />
            <Tabs.Screen
                name="complete-profile"
                options={{
                    href: null,
                    tabBarStyle: { display: 'none' },
                }}
            />
        </Tabs>
    );
}
