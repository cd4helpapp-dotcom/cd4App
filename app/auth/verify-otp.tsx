import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import Toast from 'react-native-toast-message';
import Colors from '../../constants/Colors';
import { useColorScheme } from 'react-native';

export default function VerifyOtpScreen() {
    const { email, type } = useLocalSearchParams<{ email: string; type: string }>();
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const handleVerify = async () => {
        if (!token || token.length < 6) {
            Toast.show({
                type: 'error',
                text1: 'Invalid Code',
                text2: 'Please enter the 6-digit code sent to your email.',
            });
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.auth.verifyOtp({
                email: email as string,
                token,
                type: (type as any) || 'email',
            });

            if (error) throw error;

            Toast.show({
                type: 'success',
                text1: 'Verified!',
                text2: 'Your account is now ready.',
            });

            router.replace('/');
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Verification Failed',
                text2: error.message || 'The code is incorrect or expired.',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <Text style={[styles.title, { color: theme.text }]}>Enter Verification Code</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                We've sent a 6-digit code to {email}
            </Text>

            <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                placeholder="000000"
                placeholderTextColor={theme.textSecondary}
                value={token}
                onChangeText={setToken}
                keyboardType="number-pad"
                maxLength={6}
            />

            <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.tint }]}
                onPress={handleVerify}
                disabled={loading}
            >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify & Continue</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={{ color: theme.textSecondary }}>Go Back</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 24,
        justifyContent: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        marginBottom: 32,
        textAlign: 'center',
        lineHeight: 20,
    },
    input: {
        height: 56,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 24,
        textAlign: 'center',
        letterSpacing: 8,
        marginBottom: 24,
    },
    button: {
        height: 56,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    backButton: {
        marginTop: 24,
        alignItems: 'center',
    },
});
