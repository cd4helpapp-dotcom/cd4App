import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Clipboard, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Copy, Share2 } from 'lucide-react-native';
import Colors from '../constants/Colors';

export default function DoctorRecruitmentScreen() {
    const router = useRouter();

    // Dynamically determining the URL based on environment
    let REGISTRATION_URL = 'http://192.168.1.5:8081/doctor-register'; // Fallback for Mobile

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        REGISTRATION_URL = `${window.location.origin}/doctor-register`;
    }

    const QR_API = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(REGISTRATION_URL)}`;

    const copyToClipboard = () => {
        Clipboard.setString(REGISTRATION_URL);
        Alert.alert('Copied', 'Registration link copied to clipboard');
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <ArrowLeft size={24} color="#333" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Doctor Recruitment</Text>
            </View>

            <View style={styles.content}>
                <Text style={styles.description}>
                    Share this QR code with doctors to onboard them onto the CD4 platform.
                </Text>

                <View style={styles.qrContainer}>
                    <Image
                        source={{ uri: QR_API }}
                        style={styles.qrImage}
                        resizeMode="contain"
                    />
                </View>

                <Text style={styles.urlLabel}>Registration Link:</Text>
                <TouchableOpacity style={styles.urlContainer} onPress={copyToClipboard}>
                    <Text style={styles.urlText} numberOfLines={1}>{REGISTRATION_URL}</Text>
                    <Copy size={20} color={Colors.light.tint} />
                </TouchableOpacity>

                <View style={styles.tipsContainer}>
                    <Text style={styles.tipsTitle}>💡 How it works</Text>
                    <Text style={styles.tipText}>1. Doctor scans the QR code.</Text>
                    <Text style={styles.tipText}>2. Fills out the registration form.</Text>
                    <Text style={styles.tipText}>3. Instantly appears in the app after verification.</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 60,
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    backButton: {
        marginRight: 15,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
    },
    content: {
        padding: 30,
        alignItems: 'center',
    },
    description: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        marginBottom: 40,
        lineHeight: 24,
    },
    qrContainer: {
        padding: 20,
        backgroundColor: '#fff',
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
        marginBottom: 40,
    },
    qrImage: {
        width: 250,
        height: 250,
    },
    urlLabel: {
        fontSize: 14,
        color: '#888',
        marginBottom: 8,
        alignSelf: 'flex-start',
        width: '100%',
    },
    urlContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
        padding: 15,
        borderRadius: 12,
        width: '100%',
        justifyContent: 'space-between',
        marginBottom: 40,
    },
    urlText: {
        color: '#333',
        flex: 1,
        marginRight: 10,
        fontSize: 15,
    },
    tipsContainer: {
        width: '100%',
        backgroundColor: '#FFF8E1',
        padding: 20,
        borderRadius: 12,
    },
    tipsTitle: {
        fontWeight: 'bold',
        color: '#F57C00',
        marginBottom: 10,
        fontSize: 16,
    },
    tipText: {
        color: '#5D4037',
        marginBottom: 6,
        fontSize: 14,
    }
});
