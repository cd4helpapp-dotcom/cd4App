import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme, Platform, Image, StatusBar as NativeStatusBar } from 'react-native';
import { Bell, UserRound } from 'lucide-react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { useNotificationsSystem } from '../../hooks/useNotificationsSystem';
import { getStoredLocationCity, syncLocationCityIfPermitted } from '../../services/locationPermission';
import { useAuthContext } from '../../context/AuthContext';

export default function GlobalHeader() {
    const router = useRouter();
    const pathname = usePathname();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
    const insets = useSafeAreaInsets();
    const { user } = useAuthContext();
    const roleSlug = user?.role ? String(user.role).toLowerCase().trim() : 'patient';
    const fallbackTopInset = Platform.OS === 'android'
        ? Math.max(NativeStatusBar.currentHeight || 0, 24)
        : Platform.OS === 'web' ? 10 : 6;
    const safeTopInset = Math.max(insets.top, fallbackTopInset);
    
    const { unreadCount } = useNotificationsSystem();
    const [cityLabel, setCityLabel] = useState<string>('your area');
    const [loadingCity, setLoadingCity] = useState(true);
    const displayCityLabel = cityLabel === 'your area' ? 'YOUR AREA' : cityLabel.toUpperCase();

    useEffect(() => {
        let active = true;
        void (async () => {
            try {
                const storedCity = await getStoredLocationCity();
                if (active && storedCity) {
                    setCityLabel(storedCity);
                    setLoadingCity(false);
                }
                const syncedCity = await syncLocationCityIfPermitted();
                if (active && syncedCity) {
                    setCityLabel(syncedCity);
                    setLoadingCity(false);
                }
            } catch {
                // best effort only
            } finally {
                if (active) setLoadingCity(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    // Explicitly hide header on chat tab or screens that have their own custom top headers
    // Patient Home has its own CD4 header; keeping this one would duplicate the
    // location/menu strip above the new Home showcase.
    if (pathname.includes('/chat') || pathname === '/' || pathname === '/index' || pathname === '/(tabs)') {
        return null;
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.background, borderBottomColor: theme.borderColor, paddingTop: safeTopInset }]}>
            <View style={styles.headerRow}>
                <View style={styles.brandIdentity}>
                    <Image source={require('../../assets/images/cd4_logo.png')} style={styles.brandLogo} resizeMode="contain" />
                    <View style={styles.brandCopy}>
                        <Text style={[styles.brandName, { color: theme.text }]} numberOfLines={1}>CD4</Text>
                        <Text style={[styles.brandLocation, { color: theme.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">● {displayCityLabel}, INDIA</Text>
                    </View>
                </View>
                <View style={styles.actionsRow}>
                    <TouchableOpacity
                        style={[styles.iconButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        onPress={() => router.push('/notifications')}
                        activeOpacity={0.85}
                    >
                        <Bell size={18} color={theme.text} />
                        {unreadCount > 0 && (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.iconButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                        onPress={() => {
                            if (roleSlug === 'doctor') {
                                router.push('/doctor/settings');
                            } else if (roleSlug === 'admin') {
                                router.push('/admin/profile');
                            } else {
                                router.push('/(tabs)/settings');
                            }
                        }}
                        activeOpacity={0.85}
                    >
                        <UserRound size={18} color={theme.text} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingBottom: 6,
        zIndex: 50,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 3,
        paddingBottom: 7,
    },
    brandIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
    brandLogo: { width: 36, height: 36, borderRadius: 10, marginRight: 10, alignSelf: 'center' },
    brandCopy: { flex: 1, minWidth: 0 },
    brandName: { flexShrink: 1, fontSize: 17, fontWeight: '800', lineHeight: 19 },
    brandLocation: { maxWidth: '100%', fontSize: 8, lineHeight: 10, fontWeight: '700', letterSpacing: 0.7, marginTop: 1 },
    cityPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
        borderWidth: 1,
        maxWidth: '68%',
    },
    cityPillText: {
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 16,
        includeFontPadding: false,
    },
    cityPillValue: {
        fontWeight: '800',
    },
    actionsRow: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginLeft: 8,
    },
    iconButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: '#FF3B30',
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: '#FFF',
        paddingHorizontal: 4,
    },
    badgeText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: 'bold',
    },
});
