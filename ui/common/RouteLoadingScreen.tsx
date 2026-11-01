import React from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Design';

type RouteLoadingScreenProps = {
  message?: string;
};

const useNativeDriver = Platform.OS !== 'web';
const SLOW_AFTER_MS = 8000;

// App-start / route-guard loader: logo with a soft pulse and a slim progress bar. No bare spinner, and if the
// network is slow it says so instead of looking frozen.
export default function RouteLoadingScreen({ message }: RouteLoadingScreenProps) {
  const { theme } = useAppTheme();
  const pulse = React.useRef(new Animated.Value(0)).current;
  const slide = React.useRef(new Animated.Value(0)).current;
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ])
    );
    const slideLoop = Animated.loop(Animated.timing(slide, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver }));
    pulseLoop.start();
    slideLoop.start();
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      pulseLoop.stop();
      slideLoop.stop();
      clearTimeout(timer);
    };
  }, [pulse, slide]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.28] });
  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-72, 140] });

  return (
    <SafeAreaView edges={['top', 'bottom']} accessibilityRole="progressbar" accessibilityLabel={message || 'Loading'} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.center}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.halo, { backgroundColor: theme.primary, opacity: haloOpacity, transform: [{ scale }] }]} />
          <Image source={require('../../assets/images/cd4_logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={[styles.track, { backgroundColor: theme.primarySoft }]}>
          <Animated.View style={[styles.bar, { backgroundColor: theme.primary, transform: [{ translateX }] }]} />
        </View>
        <Text style={[Typography.label, styles.text, { color: theme.textSecondary }]}>
          {slow ? 'Taking longer than usual. Please check your internet connection.' : message || 'Getting things ready'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  logoWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  halo: { position: 'absolute', width: 112, height: 112, borderRadius: 32 },
  logo: { width: 76, height: 76, borderRadius: 18 },
  track: { width: 72, height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 16 },
  bar: { width: 36, height: 4, borderRadius: 2 },
  text: { textAlign: 'center', maxWidth: 280 },
});
