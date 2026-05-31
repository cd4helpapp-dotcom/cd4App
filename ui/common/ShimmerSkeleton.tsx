import React from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type ShimmerBlockProps = {
    width?: number | `${number}%`;
    height: number;
    borderRadius?: number;
    baseColor?: string;
    highlightColor?: string;
    style?: StyleProp<ViewStyle>;
};

const withAlpha = (input: string, alpha: number): string => {
    const color = (input || '').trim();
    if (!color) return `rgba(255,255,255,${alpha})`;

    if (color.startsWith('#') && color.length === 7) {
        const alphaHex = Math.max(0, Math.min(255, Math.round(alpha * 255)))
            .toString(16)
            .padStart(2, '0');
        return `${color}${alphaHex}`;
    }

    if (color.startsWith('rgb(') && color.endsWith(')')) {
        const parts = color
            .slice(4, -1)
            .split(',')
            .map((part) => part.trim());
        if (parts.length === 3) {
            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
        }
    }

    return color;
};

export default function ShimmerBlock({
    width = '100%',
    height,
    borderRadius = 12,
    baseColor = 'rgba(148, 163, 184, 0.22)',
    highlightColor,
    style,
}: ShimmerBlockProps) {
    const shimmerAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        const loop = Animated.loop(
            Animated.timing(shimmerAnim, {
                toValue: 1,
                duration: 1200,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [shimmerAnim]);

    const translateX = shimmerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-180, 220],
    });

    return (
        <View style={[styles.block, { width, height, borderRadius, backgroundColor: baseColor }, style]}>
            <Animated.View
                style={[
                    styles.shimmer,
                    {
                        backgroundColor: highlightColor || withAlpha('#FFFFFF', 0.38),
                        transform: [{ translateX }, { skewX: '-18deg' }],
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    block: {
        overflow: 'hidden',
    },
    shimmer: {
        position: 'absolute',
        top: -18,
        bottom: -18,
        width: '42%',
        opacity: 0.85,
    },
});

