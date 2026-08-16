import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';

type RouteLoadingScreenProps = {
  message?: string;
};

export default function RouteLoadingScreen({ message = 'Preparing your workspace...' }: RouteLoadingScreenProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      accessibilityLabel={message}
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.centerWrap}>
        <Image source={require('../../assets/images/cd4_logo.png')} style={styles.logo} resizeMode="contain" />
        <ActivityIndicator size="large" color={theme.tint} />
        <Text
          style={[
            styles.message,
            {
              color: theme.textSecondary,
              marginTop: 14,
              marginBottom: Math.max(6, insets.bottom * 0.35),
            },
          ]}
        >
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 76, height: 76, borderRadius: 18, marginBottom: 18 },
  message: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
});
