import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import Colors from '../../constants/Colors';
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthContext } from '../../context/AuthContext';

const ResetPasswordScreen: React.FC = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
    const router = useRouter();

    const { session, isLoading: isAuthLoading } = useAuthContext();
    const [isSessionValid, setIsSessionValid] = useState<boolean | null>(null);

    useEffect(() => {
        if (isAuthLoading) return; // Wait for AuthContext to finish processing (including deep link parsing)

        if (!session) {
            console.warn('ResetPassword: No active session found');
            setIsSessionValid(false);
            Toast.show({
                type: 'error',
                text1: 'Session Missing',
                text2: 'Please use the link from your email to reset your password.',
            });

            setTimeout(() => {
                router.replace('/auth/login');
            }, 2500);
        } else {
            console.log('ResetPassword: Active session confirmed');
            setIsSessionValid(true);
        }
    }, [session, isAuthLoading]);

    const handleUpdatePassword = async () => {
        if (password.length < 6) {
            Toast.show({
                type: 'error',
                text1: 'Weak Password',
                text2: 'Password must be at least 6 characters long.',
            });
            return;
        }

        if (password !== confirmPassword) {
            Toast.show({
                type: 'error',
                text1: 'Password Mismatch',
                text2: 'Passwords do not match.',
            });
            return;
        }

        setIsLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: password,
            });

            if (error) throw error;

            setIsSuccess(true);
            Toast.show({
                type: 'success',
                text1: 'Password Updated',
                text2: 'Your password has been reset successfully.',
            });

            // Navigate to login after success
            setTimeout(() => {
                router.replace('/auth/login');
            }, 3000);
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Update Failed',
                text2: error.message || 'Could not update password.',
            });
        } finally {
            setIsLoading(false);
        }
    };

    if (isSuccess) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
                <View style={styles.successContainer}>
                    <CheckCircle2 size={80} color={theme.tint} />
                    <Text style={[styles.title, { color: theme.text, marginTop: 24 }]}>All Set!</Text>
                    <Text style={[styles.subtitle, { color: theme.textSecondary, textAlign: 'center' }]}>
                        Your password has been successfully updated. Redirecting you to login...
                    </Text>
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: theme.tint, width: '100%', marginTop: 32 }]}
                        onPress={() => router.replace('/auth/login')}
                    >
                        <Text style={styles.buttonText}>Go to Login</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (isAuthLoading || isSessionValid === null) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={theme.tint} />
                <Text style={{ marginTop: 16, color: theme.textSecondary }}>Checking secure connection...</Text>
            </SafeAreaView>
        );
    }

    if (isSessionValid === false) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: theme.textSecondary }}>Redirecting to login...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                <ScrollView contentContainerStyle={styles.scrollContent}>
                    <View style={styles.header}>
                        <Text style={[styles.title, { color: theme.text }]}>Reset Password</Text>
                        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                            Create a new password that is at least 6 characters long.
                        </Text>
                    </View>

                    <View style={styles.form}>
                        <Text style={[styles.label, { color: theme.textSecondary }]}>New Password</Text>
                        <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                            <Lock size={20} color={theme.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={[styles.input, { color: theme.text }]}
                                placeholder="Enter new password"
                                placeholderTextColor={theme.textSecondary}
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry={!showPassword}
                            />
                            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                                {showPassword ? (
                                    <EyeOff size={20} color={theme.tint} />
                                ) : (
                                    <Eye size={20} color={theme.tint} />
                                )}
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.label, { color: theme.textSecondary }]}>Confirm Password</Text>
                        <View style={[styles.inputWrapper, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                            <Lock size={20} color={theme.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={[styles.input, { color: theme.text }]}
                                placeholder="Confirm new password"
                                placeholderTextColor={theme.textSecondary}
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                secureTextEntry={!showPassword}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.button, { backgroundColor: theme.tint }]}
                            onPress={handleUpdatePassword}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.buttonText}>Update Password</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 24,
        flexGrow: 1,
    },
    successContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    header: {
        marginBottom: 40,
        marginTop: 20,
    },
    title: {
        fontSize: 28,
        fontFamily: 'Outfit-Bold',
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 16,
        fontFamily: 'Outfit-Regular',
        lineHeight: 24,
    },
    form: {
        gap: 20,
    },
    label: {
        fontSize: 14,
        fontFamily: 'Outfit-Medium',
        marginBottom: -12,
        marginLeft: 4,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 16,
    },
    inputIcon: {
        marginRight: 12,
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontFamily: 'Outfit-Regular',
    },
    button: {
        height: 56,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 12,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontFamily: 'Outfit-Bold',
    },
});

export default ResetPasswordScreen;
