import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme, Platform } from 'react-native';
import { MapPin, Menu, Bell } from 'lucide-react-native';
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
    const fallbackTopInset = Platform.OS === 'web' ? 10 : 6;
    const safeTopInset = Math.max(insets.top, fallbackTopInset);
    
    const { unreadCount } = useNotificationsSystem();
    const [cityLabel, setCityLabel] = useState<string>('your area');
    const [loadingCity, setLoadingCity] = useState(true);

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
    if (pathname.includes('/chat')) {
        return null;
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.background, paddingTop: safeTopInset }]}>
            <View style={styles.headerRow}>
                {/* Location Pill */}
                <TouchableOpacity 
                    style={[styles.cityPill, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}
                    activeOpacity={0.85}
                    onPress={() => {
                        // Could potentially open a location picker in the future
                        if (pathname !== '/(tabs)') {
                            router.push('/(tabs)');
                        }
                    }}
                >
                    <MapPin size={12} color={theme.text} />
                    <Text style={[styles.cityPillText, { color: theme.textSecondary }]} numberOfLines={1}>
                        Near: <Text style={[styles.cityPillValue, { color: theme.tint }]}>{loadingCity ? '...' : cityLabel}</Text>
                    </Text>
                </TouchableOpacity>

                {/* Right Actions */}
                <View style={styles.actionsRow}>
                    {/* Notification Bell */}
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

                    {/* Hamburger Menu */}
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
                        <Menu size={18} color={theme.text} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        paddingBottom: 4,
        zIndex: 50,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 2,
        paddingBottom: 2,
    },
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
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
