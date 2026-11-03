import React, { useMemo } from 'react';
import {
    Alert,
    Clipboard,
    Image,
    Platform,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { ArrowLeft, Copy, Share2 } from 'lucide-react-native';
import * as Linking from 'expo-linking';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAuthContext } from '../context/AuthContext';
import { createRedirectUrl } from '../src/lib/supabase';
import RouteLoadingScreen from '../ui/common/RouteLoadingScreen';
import DoctorSafeScreen from '../ui/doctor/DoctorSafeScreen';

export default function DoctorRecruitmentScreen() {
    const router = useRouter();
    const { theme, isDark } = useAppTheme();
    const { user, isLoading, isProfileResolved } = useAuthContext();

    // Dynamically determining the URL based on environment (Bug 6.9)
    const registrationUrl = useMemo(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
            return `${window.location.origin}/doctor-register`;
        }
        try {
            return createRedirectUrl('doctor-register');
        } catch {
            return Linking.createURL('doctor-register');
        }
    }, []);

    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(registrationUrl)}`;

    const copyToClipboard = async () => {
        try {
            if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(registrationUrl);
                Alert.alert('Copied', 'Registration link copied to clipboard');
                return;
            }
            if ((Clipboard as any)?.setString) {
                (Clipboard as any).setString(registrationUrl);
                Alert.alert('Copied', 'Registration link copied to clipboard');
                return;
            }
            await Share.share({
                message: `Join CD4 as a doctor: ${registrationUrl}`,
                url: registrationUrl,
                title: 'Doctor Registration',
            });
        } catch {
            await Share.share({
                message: `Join CD4 as a doctor: ${registrationUrl}`,
                url: registrationUrl,
                title: 'Doctor Registration',
            }).catch(() => {});
        }
    };

    const shareLink = async () => {
        try {
            await Share.share({
                message: `Join the CD4 healthcare platform as a verified doctor: ${registrationUrl}`,
                url: registrationUrl,
                title: 'Doctor Registration',
            });
        } catch (error: any) {
            console.warn('Share error:', error);
        }
    };

    // Bug 6.14: Protected Recruitment Screen - only allow doctors and admins
    if (isLoading || !isProfileResolved) {
        return <RouteLoadingScreen />;
    }

    if (!user) {
        return <Redirect href="/auth/login" />;
    }

    const roleSlug = typeof user.role === 'string'
        ? user.role.trim().toLowerCase()
        : String((user.role as any)?.name || '').trim().toLowerCase();

    if (roleSlug !== 'doctor' && roleSlug !== 'admin') {
        return <Redirect href="/(tabs)" />;
    }

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['top', 'bottom']}>
            <View style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={[styles.header, { borderBottomColor: theme.borderColor }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
                        <ArrowLeft size={24} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Doctor Recruitment</Text>
                </View>

                <View style={styles.content}>
                    <Text style={[styles.description, { color: theme.textSecondary }]}>
                        Share this QR code or link with doctors to onboard them onto the CD4 platform.
                    </Text>

                    <View style={[styles.qrContainer, { backgroundColor: '#FFFFFF', borderColor: theme.borderColor }]}>
                        <Image
                            source={{ uri: qrApiUrl }}
                            style={styles.qrImage}
                            resizeMode="contain"
                        />
                    </View>

                    <Text style={[styles.urlLabel, { color: theme.textSecondary }]}>Registration Link:</Text>
                    <View style={[styles.urlContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.urlText, { color: theme.text }]} numberOfLines={1}>{registrationUrl}</Text>
                        <View style={styles.actionRow}>
                            <TouchableOpacity onPress={copyToClipboard} style={styles.actionBtn} hitSlop={8} accessibilityLabel="Copy link">
                                <Copy size={19} color={theme.tint} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={shareLink} style={styles.actionBtn} hitSlop={8} accessibilityLabel="Share link">
                                <Share2 size={19} color={theme.tint} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={[styles.tipsContainer, { backgroundColor: isDark ? 'rgba(245, 124, 0, 0.12)' : '#FFF8E1', borderColor: isDark ? 'rgba(245, 124, 0, 0.25)' : '#FFE082' }]}>
                        <Text style={[styles.tipsTitle, { color: isDark ? '#FFB74D' : '#F57C00' }]}>💡 How it works</Text>
                        <Text style={[styles.tipText, { color: isDark ? '#FFE0B2' : '#5D4037' }]}>1. Doctor scans the QR code or clicks the registration link.</Text>
                        <Text style={[styles.tipText, { color: isDark ? '#FFE0B2' : '#5D4037' }]}>2. Fills out professional credentials and uploads KYC documents.</Text>
                        <Text style={[styles.tipText, { color: isDark ? '#FFE0B2' : '#5D4037' }]}>3. Instantly verified and enabled for consultations.</Text>
                    </View>
                </View>
            </View>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        marginRight: 15,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    content: {
        padding: 24,
        alignItems: 'center',
    },
    description: {
        fontSize: 15,
        textAlign: 'center',
        marginBottom: 28,
        lineHeight: 22,
    },
    qrContainer: {
        padding: 16,
        borderRadius: 20,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
        marginBottom: 28,
    },
    qrImage: {
        width: 220,
        height: 220,
    },
    urlLabel: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 8,
        alignSelf: 'flex-start',
        width: '100%',
    },
    urlContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        width: '100%',
        justifyContent: 'space-between',
        marginBottom: 28,
    },
    urlText: {
        flex: 1,
        marginRight: 12,
        fontSize: 14,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    actionBtn: {
        padding: 4,
    },
    tipsContainer: {
        width: '100%',
        padding: 18,
        borderRadius: 14,
        borderWidth: 1,
    },
    tipsTitle: {
        fontWeight: 'bold',
        marginBottom: 8,
        fontSize: 15,
    },
    tipText: {
        marginBottom: 6,
        fontSize: 13,
        lineHeight: 19,
    },
});
