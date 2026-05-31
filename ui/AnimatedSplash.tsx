import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, Animated, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

interface AnimatedSplashProps {
    onAnimationFinish: () => void;
}

export default function AnimatedSplash({ onAnimationFinish }: AnimatedSplashProps) {
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const logoSize = Math.min(width * 0.46, 180);

    useEffect(() => {
        Animated.sequence([
            Animated.delay(900),
            Animated.parallel([
                Animated.timing(scaleAnim, {
                    toValue: 1.04,
                    duration: 260,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 260,
                    useNativeDriver: true,
                }),
            ]),
        ]).start(() => {
            onAnimationFinish();
        });
    }, [fadeAnim, scaleAnim, onAnimationFinish]);

    return (
        <View style={styles.container}>
            <Animated.View
                style={[
                    styles.imageContainer,
                    {
                        width: logoSize,
                        height: logoSize,
                    },
                    {
                        opacity: fadeAnim,
                        transform: [{ scale: scaleAnim }],
                    },
                ]}
            >
                <Image
                    source={require('../assets/images/cd4_logo.png')}
                    style={styles.image}
                    resizeMode="contain"
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999, // Ensure it stays on top
    },
    imageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    image: {
        width: '100%',
        height: '100%',
    },
});
