import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions, useColorScheme } from 'react-native';
import Colors from '../constants/Colors';
import { useAppMode } from '../context/AppModeContext';

const { width } = Dimensions.get('window');
const TOGGLE_WIDTH = width - 40; // Full width minus padding
const TAB_WIDTH = TOGGLE_WIDTH / 2;

export default function ModeToggle() {
    const { mode, setMode } = useAppMode();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const translateX = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.spring(translateX, {
            toValue: mode === 'reversal' ? TAB_WIDTH : 0,
            useNativeDriver: true,
            bounciness: 0,
        }).start();
    }, [mode]);

    return (
        <View style={[styles.container, { backgroundColor: theme.borderColor }]}>
            <Animated.View
                style={[
                    styles.activeIndicator,
                    {
                        width: TAB_WIDTH - 8, // Increased padding difference
                        marginHorizontal: 4, // Center it visually inside the tab area
                        backgroundColor: theme.cardBackground,
                        transform: [{ translateX }],
                    },
                ]}
            />
            <TouchableOpacity
                style={styles.tab}
                onPress={() => setMode('teleconsultation')}
                activeOpacity={0.8}
            >
                <Text
                    style={[
                        styles.tabText,
                        {
                            color: mode === 'teleconsultation' ? theme.text : theme.textSecondary,
                            fontWeight: mode === 'teleconsultation' ? '700' : '500',
                        },
                    ]}
                >
                    TeleConsultation
                </Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.tab}
                onPress={() => setMode('reversal')}
                activeOpacity={0.8}
            >
                <Text
                    numberOfLines={1}
                    style={[
                        styles.tabText,
                        {
                            color: mode === 'reversal' ? theme.text : theme.textSecondary,
                            fontWeight: mode === 'reversal' ? '700' : '500',
                        },
                    ]}
                >
                    Diabetes Reversal
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 48,
        marginTop: 12, // Add breathing room from top/safe area
        marginHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 24,
        padding: 2,
        marginBottom: 20,
        position: 'relative',
    },
    tab: {
        flex: 1,
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1,
    },
    tabText: {
        fontSize: 14,
    },
    activeIndicator: {
        position: 'absolute',
        height: 44,
        borderRadius: 22,
        top: 2,
        left: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
});
