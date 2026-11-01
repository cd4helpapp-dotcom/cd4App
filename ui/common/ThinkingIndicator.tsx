import React from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../hooks/useAppTheme';

const useNativeDriver = Platform.OS !== 'web';
const DOT_COUNT = 3;
const CYCLE_MS = 1200;

// "The assistant is working" state shown in place of the reply until the first words arrive:
// three dots rise and fade in a staggered wave next to a softly breathing label.
export default function ThinkingIndicator({ label = 'Thinking' }: { label?: string }) {
  const { theme } = useAppTheme();
  const wave = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(Animated.timing(wave, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [wave]);

  const labelOpacity = wave.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] });

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={`${label}…`} accessibilityLiveRegion="polite">
      <View style={styles.dots}>
        {Array.from({ length: DOT_COUNT }).map((_, index) => {
          const start = index * 0.18;
          // Each dot peaks a little after the previous one, producing the travelling wave.
          const opacity = wave.interpolate({
            inputRange: [0, start, start + 0.18, start + 0.36, 1],
            outputRange: [0.35, 0.35, 1, 0.35, 0.35],
            extrapolate: 'clamp',
          });
          const translateY = wave.interpolate({
            inputRange: [0, start, start + 0.18, start + 0.36, 1],
            outputRange: [0, 0, -4, 0, 0],
            extrapolate: 'clamp',
          });
          return <Animated.View key={index} style={[styles.dot, { backgroundColor: theme.primary, opacity, transform: [{ translateY }] }]} />;
        })}
      </View>
      <Animated.Text style={[styles.label, { color: theme.textSecondary, opacity: labelOpacity }]}>{label}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    minHeight: 24,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    fontSize: 14,
  },
});
