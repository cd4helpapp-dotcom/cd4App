import React, { useEffect, useState } from 'react';
import { Platform, StatusBar as NativeStatusBar, StyleSheet, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getStoredLocationCity, syncLocationCityIfPermitted } from '../../services/locationPermission';
import { useAuthContext } from '../../context/AuthContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { PatientHomeHeader } from '../home/PatientHomeShowcase';

// Tab-level header. Renders the same brand header as Home so every tab looks identical.
export default function GlobalHeader() {
    const router = useRouter();
    const pathname = usePathname();
    const { theme } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { user } = useAuthContext();
    const roleSlug = user?.role ? String(user.role).toLowerCase().trim() : 'patient';
    const fallbackTopInset = Platform.OS === 'android' ? Math.max(NativeStatusBar.currentHeight || 0, 24) : Platform.OS === 'web' ? 8 : 6;
    const safeTopInset = Math.max(insets.top, fallbackTopInset);
    const [cityLabel, setCityLabel] = useState<string>('Your area');

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const storedCity = await getStoredLocationCity();
                if (active && storedCity) setCityLabel(storedCity);
                const syncedCity = await syncLocationCityIfPermitted();
                if (active && syncedCity) setCityLabel(syncedCity);
            } catch {
                // Location is a best-effort label only.
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    // An open chat has its own title bar; Home renders this same header inside its scroll view.
    const isOpenChat = pathname.includes('/chat') && pathname !== '/chat';
    if (isOpenChat || pathname === '/' || pathname === '/index' || pathname === '/(tabs)') {
        return null;
    }

    const openProfile = () => {
        if (roleSlug === 'doctor') router.push('/doctor/settings');
        else if (roleSlug === 'admin') router.push('/admin/profile');
        else router.push('/(tabs)/settings');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background, borderBottomColor: theme.divider, paddingTop: safeTopInset }]}>
            <PatientHomeHeader
                theme={theme}
                locationCityLabel={cityLabel}
                onNotificationPress={() => router.push('/notifications')}
                onProfilePress={openProfile}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        zIndex: 50,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});
